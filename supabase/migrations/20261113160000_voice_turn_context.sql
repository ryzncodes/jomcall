-- A spoken turn needs to know what the call already established. The first
-- live run showed the model retracting its own earlier answers, and telling a
-- caller that a recorded message was not recorded, because voice_begin
-- returned only the earlier questions and answers. voice_begin now also
-- returns each earlier turn's evidence and what this session has recorded.
-- It no longer returns the token hash, and voice_complete checks usage.
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
