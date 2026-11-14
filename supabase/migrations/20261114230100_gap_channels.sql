-- Gap log for real phone calls and WhatsApp turns. An ask now belongs to a
-- browser test session, a phone call or a WhatsApp conversation. The write
-- moves out of app_private.agent_knowledge into one internal function that all
-- three callers use after their own turn authority checks.
-- Re-runnable: every step replaces or guards.

alter table app.knowledge_gap_ask add column if not exists call_id uuid;
alter table app.knowledge_gap_ask add column if not exists conversation_id uuid;

do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='app.knowledge_gap_ask'::regclass and conname='knowledge_gap_ask_call_fk') then
  alter table app.knowledge_gap_ask add constraint knowledge_gap_ask_call_fk
   foreign key(org_id,call_id)references app.call(org_id,id)on delete cascade;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='app.knowledge_gap_ask'::regclass and conname='knowledge_gap_ask_conversation_fk') then
  alter table app.knowledge_gap_ask add constraint knowledge_gap_ask_conversation_fk
   foreign key(org_id,conversation_id)references app.conversation(org_id,id)on delete cascade;
 end if;
end $$;

alter table app.knowledge_gap_ask drop constraint if exists knowledge_gap_ask_channel_check;
alter table app.knowledge_gap_ask add constraint knowledge_gap_ask_channel_check check(channel in('text','voice','phone','whatsapp'));

-- At most one parent. A test session may expire and be deleted, which sets its
-- column to null and keeps the ask (the gap log outlives the session), so a
-- browser ask with no parent is valid; a phone or WhatsApp ask always has its
-- own parent.
alter table app.knowledge_gap_ask drop constraint if exists knowledge_gap_ask_one_parent;
alter table app.knowledge_gap_ask add constraint knowledge_gap_ask_one_parent check(
 num_nonnulls(session_id,call_id,conversation_id)<=1
 and (channel='phone')=(call_id is not null)
 and (channel='whatsapp')=(conversation_id is not null));

create index if not exists knowledge_gap_ask_call on app.knowledge_gap_ask(org_id,call_id)where call_id is not null;
create index if not exists knowledge_gap_ask_conversation on app.knowledge_gap_ask(org_id,conversation_id)where conversation_id is not null;

-- Internal. p_parent carries agent_id, contact_id (may be null) and the one
-- parent id. The question arrives already masked by the caller's TypeScript.
create or replace function app_private.knowledge_gap_write(p_org uuid,p_parent jsonb,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare g app.knowledge_gap;
begin
 if coalesce(p_data->>'key','')!~'^[0-9a-f]{64}$' or octet_length(coalesce(p_data->>'question',''))not between 1 and 2000
  or coalesce(p_data->>'language','')not in('ms','en','zh','mixed') or coalesce(p_data->>'channel','')not in('text','voice','phone','whatsapp')
  or octet_length(coalesce(p_data->>'answer',''))>4000 then raise exception 'INVALID_GAP';end if;
 insert into app.knowledge_gap(org_id,agent_id,question_key,ask_count)values(p_org,(p_parent->>'agent_id')::uuid,p_data->>'key',1)
  on conflict(org_id,agent_id,question_key)do update set ask_count=app.knowledge_gap.ask_count+1,last_asked_at=now(),revision=app.knowledge_gap.revision+1
  returning * into g;
 insert into app.knowledge_gap_ask(org_id,gap_id,contact_id,session_id,call_id,conversation_id,question,language,channel,answer)
  values(p_org,g.id,nullif(p_parent->>'contact_id','')::uuid,nullif(p_parent->>'session_id','')::uuid,nullif(p_parent->>'call_id','')::uuid,
   nullif(p_parent->>'conversation_id','')::uuid,p_data->>'question',p_data->>'language',p_data->>'channel',coalesce(p_data->>'answer',''));
 delete from app.knowledge_gap_ask a where a.org_id=p_org and a.gap_id=g.id and a.id in(
  select b.id from app.knowledge_gap_ask b where b.org_id=p_org and b.gap_id=g.id order by b.asked_at desc,b.id offset 20);
 return jsonb_build_object('id',g.id);
end$$;

-- Browser path: same authority checks and results as before, write delegated.
create or replace function app_private.agent_knowledge(p_action text,p_namespace text,p_turn uuid,p_lease uuid,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.test_session;t app.test_turn;v_set uuid;
begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 select * into t from app.test_turn where id=p_turn;
 if not found or t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=now() then raise exception 'TURN_CANCELLED';end if;
 select * into s from app.test_session where org_id=t.org_id and id=t.session_id and namespace=p_namespace;
 if not found or not app_private.agent_authorized(s) then raise exception 'AUTHORITY_REVOKED';end if;
 v_set=nullif(s.snapshot->'catalogue'->>'setId','')::uuid;
 if p_action in('catalogue','units') then
  return app_private.knowledge_lookup(s.org_id,v_set,p_action,p_data);
 elsif p_action='gap' then
  if coalesce(p_data->>'channel','')not in('text','voice') then raise exception 'INVALID_GAP';end if;
  return app_private.knowledge_gap_write(s.org_id,jsonb_build_object('agent_id',s.agent_id,'contact_id',s.contact_id,'session_id',s.id),p_data);
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;

grant create on schema app_private to jomcall_agent_jobs;
alter function app_private.knowledge_gap_write(uuid,jsonb,jsonb) owner to jomcall_agent_jobs;
alter function app_private.agent_knowledge(text,text,uuid,uuid,jsonb) owner to jomcall_agent_jobs;
revoke create on schema app_private from jomcall_agent_jobs;
revoke all on function app_private.knowledge_gap_write(uuid,jsonb,jsonb) from public;
revoke all on function app_private.agent_knowledge(text,text,uuid,uuid,jsonb) from public;
grant execute on function app_private.agent_knowledge(text,text,uuid,uuid,jsonb) to jomcall_agent;

-- Phone calls: the gap action, behind the call's token and turn lease.
do $migration$
declare body text;hits int;
 branch_old constant text=$o$elsif p_action in('catalogue','units') then$o$;
 branch_new constant text=$n$elsif p_action='gap' then
  if coalesce(p_data->>'channel','')<>'phone' then raise exception 'INVALID_GAP';end if;
  return app_private.knowledge_gap_write(c.org_id,jsonb_build_object('agent_id',c.agent_id,'contact_id',c.contact_id,'call_id',c.id),p_data);
 elsif p_action in('catalogue','units') then$n$;
begin
 select pg_get_functiondef('app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.knowledge_gap_write' in body)>0 then return;end if;
 hits=(length(body)-length(replace(body,branch_old,'')))/length(branch_old);
 if hits<>1 then raise exception 'agent_call: expected one lookup branch, found %',hits;end if;
 execute replace(body,branch_old,branch_new);
end
$migration$;

-- WhatsApp turns: same, behind the turn's lease checks.
do $migration$
declare body text;hits int;
 list_old constant text=$o$'turn_fail','catalogue','units')then$o$;
 list_new constant text=$n$'turn_fail','catalogue','units','gap')then$n$;
 branch_old constant text=$o$elsif p_action in('catalogue','units') then$o$;
 branch_new constant text=$n$elsif p_action='gap' then
   if coalesce(p_data->>'channel','')<>'whatsapp' then raise exception 'INVALID_GAP';end if;
   return app_private.knowledge_gap_write(c.org_id,jsonb_build_object(
    'agent_id',coalesce((select v.agent_id from app.agent_version v where v.org_id=c.org_id and v.id=t.agent_version_id),(select h.agent_id from app.whatsapp_channel h where h.org_id=c.org_id and h.id=c.channel_id)),
    'contact_id',c.contact_id,'conversation_id',c.id),p_data);
  elsif p_action in('catalogue','units') then$n$;
begin
 select pg_get_functiondef('app_private.whatsapp_work(text,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.knowledge_gap_write' in body)>0 then return;end if;
 hits=(length(body)-length(replace(body,list_old,'')))/length(list_old);
 if hits<>1 then raise exception 'whatsapp_work: expected one turn action list, found %',hits;end if;
 hits=(length(body)-length(replace(body,branch_old,'')))/length(branch_old);
 if hits<>1 then raise exception 'whatsapp_work: expected one lookup branch, found %',hits;end if;
 execute replace(replace(body,list_old,list_new),branch_old,branch_new);
end
$migration$;
