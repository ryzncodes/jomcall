-- Spoken-answer cache entries expire after 7 days. Until now an entry lived
-- for as long as its agent snapshot did, so an answer could outlast the facts
-- it was built on. voice_cache_get ignores an entry older than 7 days,
-- voice_cache_put replaces one, and the agent worker's existing maintenance
-- tick deletes them, 100 at a time.
-- Both functions below are the previous definitions with only those changes
-- (agent_voice from 20261113160000, agent_work from 20261016034829); create or
-- replace keeps their owner and grants.
grant delete on app.voice_answer_cache to jomcall_agent_jobs;
create index voice_answer_cache_created_at on app.voice_answer_cache(created_at);

create or replace function app_private.agent_voice(p_action text,p_namespace text,p_session uuid,p_token_hash text,p_turn uuid default null,p_lease uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
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
  select jsonb_build_object('answer',c.answer,'evidence',c.evidence)into r from app.voice_answer_cache c where c.org_id=s.org_id and c.snapshot_hash=s.snapshot_hash and c.language=p_data->>'language' and c.key=p_data->>'key' and c.created_at>now()-interval '7 days';
  return r;
 elsif p_action='voice_cache_put' then
  if coalesce(p_data->>'language','')not in('ms','en','zh')or octet_length(coalesce(p_data->>'key',''))not between 1 and 400 or octet_length(coalesce(p_data->>'answer',''))not between 1 and 4000 or jsonb_typeof(coalesce(p_data->'evidence','[]'))<>'array' or octet_length(coalesce(p_data->'evidence','[]')::text)>8192 then raise exception 'INVALID_CACHE_ENTRY';end if;
  -- An expired entry must not block the next answer to the same question.
  delete from app.voice_answer_cache c where c.org_id=s.org_id and c.snapshot_hash=s.snapshot_hash and c.language=p_data->>'language' and c.key=p_data->>'key' and c.created_at<=now()-interval '7 days';
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
  return jsonb_build_object('session',to_jsonb(s)-'voice_token_hash','turn',to_jsonb(t),
   'history',coalesce((select jsonb_agg(jsonb_build_object('input',h.input,'answer',h.answer,'evidence',h.evidence)order by h.created_at,h.id)from(select h.id,h.created_at,h.input,h.answer,h.evidence from app.test_turn h where h.org_id=s.org_id and h.session_id=s.id and h.state='completed' and h.answer is not null and(h.created_at,h.id)<(t.created_at,t.id)order by h.created_at desc,h.id desc limit 6)h),'[]'),
   -- What completed turns of this session recorded, oldest first. A proposal
   -- of a cancelled or failed turn is never listed: it was removed or never
   -- reached the caller.
   'recorded',coalesce((select jsonb_agg(jsonb_build_object('kind',p.kind,'details',p.details)order by q.created_at,q.id,p.step)from app.test_proposal p join app.test_turn q on q.org_id=p.org_id and q.id=p.turn_id where p.org_id=s.org_id and p.session_id=s.id and q.state='completed'),'[]'),
   'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=s.org_id and b.location_id=s.location_id and b.active),'[]'));
 end if;

 if p_action not in('voice_complete','voice_fail','voice_cancel')then raise exception 'INVALID_AGENT_OPERATION';end if;
 select * into t from app.test_turn where org_id=s.org_id and session_id=s.id and id=p_turn and channel='voice' for update;
 if not found or t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=now()then return null;end if;
 if p_action='voice_complete' then
  if octet_length(coalesce(p_data->>'answer',''))not between 1 and 4000 or jsonb_typeof(coalesce(p_data->'timings','{}'))<>'object' or jsonb_typeof(coalesce(p_data->'evidence','[]'))<>'array' or jsonb_typeof(coalesce(p_data->'usage','[]'))<>'array' or octet_length(coalesce(p_data->'timings','{}')::text)>8192 or octet_length(coalesce(p_data->'evidence','[]')::text)>8192 or octet_length(coalesce(p_data->'usage','[]')::text)>8192 then raise exception 'MODEL_OUTPUT_INVALID';end if;
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

create or replace function app_private.agent_work(p_action text,p_namespace text,p_id uuid default null,p_operation uuid default null,p_lease uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.test_session;t app.test_turn;o app.outbox;p app.test_proposal;r jsonb;v_step int;v_resource uuid;v_days int;v_start timestamptz;begin
 if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if p_action='maintain' then
  delete from app.test_session where id in(select id from app.test_session where namespace=p_namespace and expires_at<=now() order by expires_at limit 100 for update skip locked);
  update app.test_turn q set state='failed',error_code='TURN_INTERRUPTED',revision=q.revision+1,lease_token=null,lease_until=null
  where q.id in(select candidate.id from app.test_turn candidate join app.test_session x on(candidate.org_id=x.org_id and candidate.session_id=x.id)
  where x.namespace=p_namespace and candidate.state in('queued','running')
  and ((candidate.state='running' and candidate.lease_until<now())or not app_private.agent_authorized(x))
  order by candidate.created_at,candidate.id limit 100 for update of candidate skip locked);
  -- Spoken-answer cache entries past their 7 days. The cache has no namespace:
  -- an expired entry is never served, so any worker may remove it. No row
  -- locking clause: the worker role holds delete, not update, on this table.
  delete from app.voice_answer_cache c where(c.org_id,c.snapshot_hash,c.language,c.key)in(select x.org_id,x.snapshot_hash,x.language,x.key from app.voice_answer_cache x where x.created_at<=now()-interval '7 days' order by x.created_at limit 100);return '{}';
 elsif p_action='outbox' then
  with claimed as(update app.outbox set lease_until=now()+interval '30 seconds',attempts=attempts+1 where id in(select id from app.outbox where namespace=p_namespace and kind='agent.turn' and delivered_at is null and(lease_until is null or lease_until<now())order by created_at,id for update skip locked limit 20)returning *)select coalesce(jsonb_agg(to_jsonb(claimed)),'[]')into r from claimed;return r;
 elsif p_action='ack' then
  update app.outbox set delivered_at=now(),lease_until=null where id=p_id and namespace=p_namespace and kind='agent.turn';return '{}';
 elsif p_action='pending' then
  select coalesce(jsonb_agg(v),'[]')into r from(select q.id,q.operation_id from app.test_turn q join app.test_session x on(x.org_id=q.org_id and x.id=q.session_id)where x.namespace=p_namespace and q.state in('queued','running')and exists(select 1 from app.outbox b where b.operation_id=q.operation_id and b.delivered_at is not null and b.namespace=p_namespace and b.kind='agent.turn')order by q.created_at limit 100)v;return r;
 end if;
 select q.* into t from app.test_turn q join app.test_session x on(x.org_id=q.org_id and x.id=q.session_id)where q.id=p_id and q.operation_id=p_operation and x.namespace=p_namespace;
 if not found then return null;end if;
 select * into s from app.test_session where org_id=t.org_id and id=t.session_id;
 -- Match the domain lock order; contact erasure cannot race a committed step.
 if s.contact_id is not null then perform id from app.contact where org_id=s.org_id and id=s.contact_id for share;end if;
 select * into s from app.test_session where org_id=t.org_id and id=t.session_id for update;
 if not found then return null;end if;
 select * into t from app.test_turn where id=p_id and operation_id=p_operation for update;
 if not found then return null;end if;
 if p_action='fail' then
  if t.state in('queued','running')then update app.test_turn set state='failed',revision=revision+1,error_code=case when p_data->>'code'~'^[A-Z_]{1,60}$' then p_data->>'code' else 'TURN_FAILED' end,lease_token=null,lease_until=null where id=t.id;end if;return '{}';
 end if;
 if not app_private.agent_authorized(s)then
  if t.state in('queued','running')then update app.test_turn set state='failed',revision=revision+1,error_code='AUTHORITY_REVOKED',lease_token=null,lease_until=null where id=t.id;end if;return null;
 end if;
 if p_action='claim' then
  if t.state<>'queued' then return null;end if;
  update app.test_turn set state='running',revision=revision+1,lease_token=gen_random_uuid(),lease_until=now()+interval '65 seconds' where id=t.id returning * into t;
 elsif t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=now()then return null;
 end if;
 if p_action in('claim','context')then
  return jsonb_build_object('session',to_jsonb(s),'turn',to_jsonb(t),'history',coalesce((select jsonb_agg(jsonb_build_object('input',h.input,'answer',h.answer) order by h.created_at,h.id) from(select h.id,h.created_at,h.input,h.answer from app.test_turn h where h.org_id=s.org_id and h.session_id=s.id and h.state='completed' and h.answer is not null and (h.created_at,h.id)<(t.created_at,t.id) order by h.created_at desc,h.id desc limit 6)h),'[]'),'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=s.org_id and b.location_id=s.location_id and b.active),'[]'));
 elsif p_action='availability' then
  v_resource=(p_data->>'resourceId')::uuid;v_days=(p_data->>'days')::int;
  if v_days<1 or v_days>7 or(p_data->>'fromDate')!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'INVALID_TOOL';end if;
  v_start=((p_data->>'fromDate')||'T00:00:00+08:00')::timestamptz;
  if not exists(select 1 from app.booking_resource b where b.org_id=s.org_id and b.id=v_resource and b.location_id=s.location_id and b.active)then raise exception 'NOT_FOUND';end if;
  return jsonb_build_object('resource',(select to_jsonb(b)from app.booking_resource b where b.org_id=s.org_id and b.id=v_resource),'schedule',(select to_jsonb(b)from app.location_schedule b where b.org_id=s.org_id and b.location_id=s.location_id),'occupied',coalesce((select jsonb_agg(b)from(select start_at,end_at from app.booking where org_id=s.org_id and resource_id=v_resource and status='confirmed' and start_at<v_start+v_days*interval '1 day' and end_at>v_start limit 10000)b),'[]'));
 elsif p_action='record' then
  v_step=(p_data->>'step')::int;
  if v_step<0 or v_step>3 or octet_length(p_data::text)>65536 then raise exception 'TOOL_LIMIT';end if;
  select result into r from app.test_tool_step where org_id=s.org_id and turn_id=t.id and attempt=t.attempt and step=v_step;
  if found then return r;end if;
  if(p_data->'call'->>'name')not in('search_knowledge','check_availability','book_slot','take_message','handoff_to_human')then raise exception 'INVALID_TOOL';end if;
  r=p_data->'effect';
  if r->>'kind'='proposal'then
   insert into app.test_proposal(org_id,session_id,turn_id,attempt,step,kind,details)values(s.org_id,s.id,t.id,t.attempt,v_step,r->'proposal'->>'kind',r->'proposal'->'details')returning * into p;
   r=jsonb_build_object('kind','proposal','proposal',to_jsonb(p));
  end if;
  insert into app.test_tool_step(org_id,session_id,turn_id,attempt,step,tool,input,result)values(s.org_id,s.id,t.id,t.attempt,v_step,p_data->'call'->>'name',p_data->'call'->'args',r);
  if app_private.agent_size(s.id)>2097152 then raise exception 'TEST_SIZE_LIMIT';end if;return r;
 elsif p_action='complete' then
  if octet_length(p_data->>'text')>4000 or jsonb_array_length(p_data->'citations')>5 then raise exception 'MODEL_OUTPUT_INVALID';end if;
  update app.test_turn set state='completed',answer=p_data->>'text',citations=p_data->'citations',usage=coalesce(p_data->'usage','[]'),revision=revision+1,lease_token=null,lease_until=null where id=t.id;
  if app_private.agent_size(s.id)>2097152 then raise exception 'TEST_SIZE_LIMIT';end if;return '{}';
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;
