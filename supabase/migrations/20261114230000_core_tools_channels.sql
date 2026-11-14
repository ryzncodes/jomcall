-- Catalogue and unit lookups for real phone calls and WhatsApp turns.
-- The query bodies move out of app_private.agent_knowledge into one internal
-- function that reads only the catalogue set a session's snapshot froze, and
-- agent_call and whatsapp_work reach it after their own turn authority checks.
-- Re-runnable: every step replaces or guards.

-- Internal. Not granted to any service role: only the agent-jobs owner of the
-- three callers can execute it.
create or replace function app_private.knowledge_lookup(p_org uuid,p_set uuid,p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_code text;v_item text;v_fits text;r jsonb;
begin
 if p_action='catalogue' then
  if p_set is null then return '[]';end if;
  v_code=upper(regexp_replace(left(coalesce(p_data->>'code',''),80),'[^[:alnum:]]','','g'));
  v_item=lower(left(coalesce(p_data->>'item',''),200));
  v_fits=lower(left(coalesce(p_data->>'fits',''),200));
  if v_code='' and btrim(v_item)='' and btrim(v_fits)='' then raise exception 'INVALID_TOOL';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc,x.ordinal),'[]') into r from(
   select y.* from(
    select c.ordinal,c.item,c.aliases,c.price_sen,c.stock_note,c.attributes,c.updated_at,
     case when v_code<>'' and v_code=any(c.lookup_keys) then 'code'
          when v_code<>'' and exists(select 1 from unnest(c.lookup_keys)k where extensions.similarity(v_code,k)>=0.5) then 'code'
          else 'trigram' end as match,
     round(greatest(
      case when v_code<>'' and v_code=any(c.lookup_keys) then 1.0 else 0 end,
      case when v_code<>'' then coalesce((select max(extensions.similarity(v_code,k))from unnest(c.lookup_keys)k),0)*0.9 else 0 end,
      case when btrim(v_item)<>'' or btrim(v_fits)<>'' then
       (case when btrim(v_item)<>'' then extensions.word_similarity(v_item,c.search_text) else 0 end+
        case when btrim(v_fits)<>'' then extensions.word_similarity(v_fits,c.search_text) else 0 end)/
       ((btrim(v_item)<>'')::int+(btrim(v_fits)<>'')::int)
      else 0 end)::numeric,3)::float8 as score
    from app.catalogue_set_row c where c.org_id=p_org and c.set_id=p_set)y
   where y.score>=0.3 order by y.score desc,y.ordinal limit 5)x;
  return r;
 elsif p_action='units' then
  if coalesce(p_data->>'model','')!~'^[a-z0-9.:/_-]{1,80}$' or jsonb_typeof(p_data->'hashes')<>'array' or jsonb_array_length(p_data->'hashes')>2000 then raise exception 'INVALID_TOOL';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc),'[]') into r from(
   select u.hash,u.source,u.title,u.text,round((1-(u.embedding OPERATOR(extensions.<=>) (p_data->>'vector')::extensions.vector(768)))::numeric,3)::float8 as score
   from app.knowledge_unit u
   where u.org_id=p_org and u.embedding_model=p_data->>'model'
    and(u.hash in(select jsonb_array_elements_text(p_data->'hashes'))
     or u.hash in(select c.unit_hash from app.catalogue_set_row c where c.org_id=p_org and c.set_id=p_set))
   order by u.embedding OPERATOR(extensions.<=>) (p_data->>'vector')::extensions.vector(768) limit 5)x;
  return r;
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;

-- Browser path: same authority checks and results as before, lookups delegated.
create or replace function app_private.agent_knowledge(p_action text,p_namespace text,p_turn uuid,p_lease uuid,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.test_session;t app.test_turn;g app.knowledge_gap;v_set uuid;
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
  if coalesce(p_data->>'key','')!~'^[0-9a-f]{64}$' or octet_length(coalesce(p_data->>'question',''))not between 1 and 2000
   or coalesce(p_data->>'language','')not in('ms','en','zh','mixed') or coalesce(p_data->>'channel','')not in('text','voice')
   or octet_length(coalesce(p_data->>'answer',''))>4000 then raise exception 'INVALID_GAP';end if;
  insert into app.knowledge_gap(org_id,agent_id,question_key,ask_count)values(s.org_id,s.agent_id,p_data->>'key',1)
   on conflict(org_id,agent_id,question_key)do update set ask_count=app.knowledge_gap.ask_count+1,last_asked_at=now(),revision=app.knowledge_gap.revision+1
   returning * into g;
  insert into app.knowledge_gap_ask(org_id,gap_id,contact_id,session_id,question,language,channel,answer)
   values(s.org_id,g.id,s.contact_id,s.id,p_data->>'question',p_data->>'language',p_data->>'channel',coalesce(p_data->>'answer',''));
  delete from app.knowledge_gap_ask a where a.org_id=s.org_id and a.gap_id=g.id and a.id in(
   select b.id from app.knowledge_gap_ask b where b.org_id=s.org_id and b.gap_id=g.id order by b.asked_at desc,b.id offset 20);
  return jsonb_build_object('id',g.id);
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;

grant create on schema app_private to jomcall_agent_jobs;
alter function app_private.knowledge_lookup(uuid,uuid,text,jsonb) owner to jomcall_agent_jobs;
alter function app_private.agent_knowledge(text,text,uuid,uuid,jsonb) owner to jomcall_agent_jobs;
revoke create on schema app_private from jomcall_agent_jobs;
revoke all on function app_private.knowledge_lookup(uuid,uuid,text,jsonb) from public;
revoke all on function app_private.agent_knowledge(text,text,uuid,uuid,jsonb) from public;
grant execute on function app_private.agent_knowledge(text,text,uuid,uuid,jsonb) to jomcall_agent;

-- Phone calls: lookups and the tool name. Rewritten from the CURRENT body (as
-- 20261114200000_knowledge_core.sql does for agent_work); each expected text
-- must be found exactly once or the migration fails.
do $migration$
declare body text;hits int;
 allow_old constant text=$o$'handoff_to_human')then raise exception 'INVALID_TOOL'$o$;
 allow_new constant text=$n$'handoff_to_human','lookup_catalogue')then raise exception 'INVALID_TOOL'$n$;
 branch_old constant text=$o$ elsif p_action='context' then$o$;
 branch_new constant text=$n$ elsif p_action in('catalogue','units') then
  return app_private.knowledge_lookup(c.org_id,nullif(c.snapshot->'catalogue'->>'setId','')::uuid,p_action,p_data);
 elsif p_action='context' then$n$;
begin
 select pg_get_functiondef('app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.knowledge_lookup' in body)>0 then return;end if;
 hits=(length(body)-length(replace(body,allow_old,'')))/length(allow_old);
 if hits<>1 then raise exception 'agent_call: expected one tool allow-list, found %',hits;end if;
 hits=(length(body)-length(replace(body,branch_old,'')))/length(branch_old);
 if hits<>1 then raise exception 'agent_call: expected one context branch, found %',hits;end if;
 execute replace(replace(body,allow_old,allow_new),branch_old,branch_new);
end
$migration$;

-- WhatsApp turns: same, behind the turn's lease checks.
do $migration$
declare body text;hits int;
 allow_old constant text=$o$'handoff_to_human')then raise exception 'INVALID_TOOL'$o$;
 allow_new constant text=$n$'handoff_to_human','lookup_catalogue')then raise exception 'INVALID_TOOL'$n$;
 list_old constant text=$o$p_action in('turn_context','turn_availability','turn_record','turn_complete','turn_fail')then$o$;
 list_new constant text=$n$p_action in('turn_context','turn_availability','turn_record','turn_complete','turn_fail','catalogue','units')then$n$;
 branch_old constant text=$o$  elsif p_action='turn_availability' then$o$;
 branch_new constant text=$n$  elsif p_action in('catalogue','units') then
   return app_private.knowledge_lookup(c.org_id,nullif((select v.snapshot from app.agent_version v where v.org_id=c.org_id and v.id=t.agent_version_id)->'catalogue'->>'setId','')::uuid,p_action,p_data);
  elsif p_action='turn_availability' then$n$;
begin
 select pg_get_functiondef('app_private.whatsapp_work(text,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.knowledge_lookup' in body)>0 then return;end if;
 hits=(length(body)-length(replace(body,allow_old,'')))/length(allow_old);
 if hits<>1 then raise exception 'whatsapp_work: expected one tool allow-list, found %',hits;end if;
 hits=(length(body)-length(replace(body,list_old,'')))/length(list_old);
 if hits<>1 then raise exception 'whatsapp_work: expected one turn action list, found %',hits;end if;
 hits=(length(body)-length(replace(body,branch_old,'')))/length(branch_old);
 if hits<>1 then raise exception 'whatsapp_work: expected one availability branch, found %',hits;end if;
 execute replace(replace(replace(body,allow_old,allow_new),list_old,list_new),branch_old,branch_new);
end
$migration$;
