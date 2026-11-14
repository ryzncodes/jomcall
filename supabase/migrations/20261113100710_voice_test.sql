-- Spoken test turns. A voice session is an ordinary test session with a
-- channel, a hashed one-call token and a short expiry. The agent process
-- begins and ends spoken turns through app_private.agent_voice; tools keep
-- using app_private.agent_work with the turn's lease, unchanged.
alter table app.test_session
  add column channel text not null default 'text' check(channel in('text','voice')),
  add column voice_token_hash text check(voice_token_hash is null or voice_token_hash~'^[0-9a-f]{64}$'),
  add column voice_expires_at timestamptz;
alter table app.test_turn
  add column channel text not null default 'text' check(channel in('text','voice')),
  add column timings jsonb not null default '{}' check(octet_length(timings::text)<=8192),
  add column evidence jsonb not null default '[]' check(octet_length(evidence::text)<=8192);

-- Answers the spoken brain already gave, reusable for the same snapshot,
-- language and normalized question. Never holds a caller's own words beyond
-- the normalized question key.
create table app.voice_answer_cache(
  org_id uuid not null references app.organization(id)on delete cascade,
  snapshot_hash text not null,
  language text not null check(language in('ms','en','zh')),
  key text not null check(octet_length(key)between 1 and 400),
  answer text not null check(octet_length(answer)between 1 and 4000),
  evidence jsonb not null default '[]' check(octet_length(evidence::text)<=8192),
  created_at timestamptz not null default now(),
  primary key(org_id,snapshot_hash,language,key)
);
alter table app.voice_answer_cache enable row level security;
alter table app.voice_answer_cache force row level security;
grant select,delete on app.voice_answer_cache to jomcall_app;
create policy manager_all on app.voice_answer_cache for all to jomcall_app
  using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'))
  with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));

grant insert on app.test_turn to jomcall_agent_jobs;
grant select,insert on app.voice_answer_cache to jomcall_agent_jobs;
grant create on schema app_private to jomcall_agent_jobs;

create function app_private.agent_voice(p_action text,p_namespace text,p_session uuid,p_token_hash text,p_turn uuid default null,p_lease uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.test_session;t app.test_turn;old app.test_turn;r jsonb;begin
 if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 select * into s from app.test_session where id=p_session and namespace=p_namespace;
 if not found then raise exception 'VOICE_UNAUTHORIZED';end if;
 -- Same lock order as agent_work: contact, then session, then turn.
 if s.contact_id is not null then perform id from app.contact where org_id=s.org_id and id=s.contact_id for share;end if;
 select * into s from app.test_session where org_id=s.org_id and id=s.id for update;
 if not found then raise exception 'VOICE_UNAUTHORIZED';end if;
 if s.channel<>'voice' or s.voice_token_hash is null or s.voice_token_hash is distinct from p_token_hash or not app_private.agent_authorized(s)then raise exception 'VOICE_UNAUTHORIZED';end if;
 if s.voice_expires_at is null or s.voice_expires_at<=now()then raise exception 'VOICE_EXPIRED';end if;

 if p_action='voice_cache_get' then
  select jsonb_build_object('answer',c.answer,'evidence',c.evidence)into r from app.voice_answer_cache c where c.org_id=s.org_id and c.snapshot_hash=s.snapshot_hash and c.language=p_data->>'language' and c.key=p_data->>'key';
  return r;
 elsif p_action='voice_cache_put' then
  if coalesce(p_data->>'language','')not in('ms','en','zh')or octet_length(coalesce(p_data->>'key',''))not between 1 and 400 or octet_length(coalesce(p_data->>'answer',''))not between 1 and 4000 or jsonb_typeof(coalesce(p_data->'evidence','[]'))<>'array' or octet_length(coalesce(p_data->'evidence','[]')::text)>8192 then raise exception 'INVALID_CACHE_ENTRY';end if;
  insert into app.voice_answer_cache(org_id,snapshot_hash,language,key,answer,evidence)values(s.org_id,s.snapshot_hash,p_data->>'language',p_data->>'key',p_data->>'answer',coalesce(p_data->'evidence','[]'))on conflict do nothing;
  return '{}';
 elsif p_action='voice_begin' then
  if octet_length(coalesce(p_data->>'input',''))not between 1 and 4000 or coalesce(p_data->>'clientTurnId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_VOICE_INPUT';end if;
  if(select count(*)from app.test_turn q where q.org_id=s.org_id and q.session_id=s.id)>=60 then raise exception 'TURN_LIMIT';end if;
  -- A new spoken turn replaces the one still running: the caller spoke again.
  for old in select * from app.test_turn q where q.org_id=s.org_id and q.session_id=s.id and q.state in('queued','running')for update loop
   if old.channel<>'voice' then raise exception 'TURN_ACTIVE';end if;
   delete from app.test_proposal where org_id=s.org_id and turn_id=old.id;
   delete from app.test_tool_step where org_id=s.org_id and turn_id=old.id;
   update app.test_turn set state='cancelled',revision=revision+1,lease_token=null,lease_until=null where id=old.id;
  end loop;
  insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,channel,lease_token,lease_until)
  values(s.org_id,s.id,(p_data->>'clientTurnId')::uuid,encode(sha256(convert_to(p_data->>'input','UTF8')),'hex'),p_data->>'input','running','voice',gen_random_uuid(),now()+interval '65 seconds')returning * into t;
  if app_private.agent_size(s.id)>2097152 then raise exception 'TEST_SIZE_LIMIT';end if;
  return jsonb_build_object('session',to_jsonb(s),'turn',to_jsonb(t),
   'history',coalesce((select jsonb_agg(jsonb_build_object('input',h.input,'answer',h.answer)order by h.created_at,h.id)from(select h.id,h.created_at,h.input,h.answer from app.test_turn h where h.org_id=s.org_id and h.session_id=s.id and h.state='completed' and h.answer is not null and(h.created_at,h.id)<(t.created_at,t.id)order by h.created_at desc,h.id desc limit 6)h),'[]'),
   'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=s.org_id and b.location_id=s.location_id and b.active),'[]'));
 end if;

 if p_action not in('voice_complete','voice_fail','voice_cancel')then raise exception 'INVALID_AGENT_OPERATION';end if;
 select * into t from app.test_turn where org_id=s.org_id and session_id=s.id and id=p_turn and channel='voice' for update;
 if not found or t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=now()then return null;end if;
 if p_action='voice_complete' then
  if octet_length(coalesce(p_data->>'answer',''))not between 1 and 4000 or jsonb_typeof(coalesce(p_data->'timings','{}'))<>'object' or jsonb_typeof(coalesce(p_data->'evidence','[]'))<>'array' or octet_length(coalesce(p_data->'timings','{}')::text)>8192 or octet_length(coalesce(p_data->'evidence','[]')::text)>8192 then raise exception 'MODEL_OUTPUT_INVALID';end if;
  update app.test_turn set state='completed',answer=p_data->>'answer',timings=coalesce(p_data->'timings','{}'),evidence=coalesce(p_data->'evidence','[]'),usage=coalesce(p_data->'usage','[]'),revision=revision+1,lease_token=null,lease_until=null where id=t.id;
  if app_private.agent_size(s.id)>2097152 then raise exception 'TEST_SIZE_LIMIT';end if;
 elsif p_action='voice_fail' then
  update app.test_turn set state='failed',revision=revision+1,error_code=case when p_data->>'code'~'^[A-Z_]{1,60}$' then p_data->>'code' else 'TURN_FAILED' end,lease_token=null,lease_until=null where id=t.id;
 else
  -- A cancelled turn leaves nothing a person could apply.
  delete from app.test_proposal where org_id=s.org_id and turn_id=t.id;
  delete from app.test_tool_step where org_id=s.org_id and turn_id=t.id;
  update app.test_turn set state='cancelled',revision=revision+1,lease_token=null,lease_until=null where id=t.id;
 end if;
 return '{}';
end$$;
alter function app_private.agent_voice(text,text,uuid,text,uuid,uuid,jsonb)owner to jomcall_agent_jobs;
revoke all on function app_private.agent_voice(text,text,uuid,text,uuid,uuid,jsonb)from public;
grant execute on function app_private.agent_voice(text,text,uuid,text,uuid,uuid,jsonb)to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
