alter table app.test_session add column namespace text not null default 'local';
alter table app.test_turn add column usage jsonb not null default '[]';
do $$begin
 if not exists(select from pg_roles where rolname='jomcall_agent')then create role jomcall_agent login noinherit nobypassrls;end if;
 if not exists(select from pg_roles where rolname='jomcall_agent_jobs')then create role jomcall_agent_jobs nologin noinherit bypassrls;end if;
end$$;
grant jomcall_agent_jobs to postgres;
grant usage on schema app_private to jomcall_agent;
grant usage on schema app,app_private,auth to jomcall_agent_jobs;
grant create on schema app_private to jomcall_agent_jobs;
grant select,update,delete on app.test_session,app.test_turn to jomcall_agent_jobs;
grant select,insert,update,delete on app.test_tool_step,app.test_proposal to jomcall_agent_jobs;
grant select,update on app.outbox to jomcall_agent_jobs;
grant select on app.member,app.contact,app.booking_resource,app.location_schedule,app.booking to jomcall_agent_jobs;
grant update(id) on app.contact to jomcall_agent_jobs;
-- Auth schema grant is applied by supabase/auth-grants.sql after migration.
create function app_private.agent_authorized(p_session app.test_session)returns boolean language sql stable security definer set search_path='' as $$
 select p_session.state='open' and p_session.expires_at>now()
 and exists(select 1 from app.member m where m.org_id=p_session.org_id and m.user_id=p_session.creator_id and m.active and m.role in('owner','admin'))
 and exists(select 1 from auth.sessions a where a.id=p_session.auth_session_id and a.user_id=p_session.creator_id)
 and (p_session.contact_id is null or exists(select 1 from app.contact c where c.org_id=p_session.org_id and c.id=p_session.contact_id and not c.deletion_pending))
$$;
create function app_private.agent_size(p_session uuid)returns bigint language sql stable set search_path='' as $$
 select octet_length(s.snapshot::text)::bigint+
 coalesce((select sum(octet_length(t.input)+coalesce(octet_length(t.answer),0))from app.test_turn t where t.org_id=s.org_id and t.session_id=s.id),0)+
 coalesce((select sum(octet_length(p.input::text)+octet_length(p.result::text))from app.test_tool_step p where p.org_id=s.org_id and p.session_id=s.id),0)
 from app.test_session s where s.id=p_session
$$;
create function app_private.agent_work(p_action text,p_namespace text,p_id uuid default null,p_operation uuid default null,p_lease uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.test_session;t app.test_turn;o app.outbox;p app.test_proposal;r jsonb;v_step int;v_resource uuid;v_days int;v_start timestamptz;begin
 if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if p_action='maintain' then
  delete from app.test_session where id in(select id from app.test_session where namespace=p_namespace and expires_at<=now() order by expires_at limit 100 for update skip locked);
  update app.test_turn q set state='failed',error_code='TURN_INTERRUPTED',revision=q.revision+1,lease_token=null,lease_until=null
  from app.test_session x where q.org_id=x.org_id and q.session_id=x.id and x.namespace=p_namespace and q.state in('queued','running')
  and ((q.state='running' and q.lease_until<now())or not app_private.agent_authorized(x));return '{}';
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
  return jsonb_build_object('session',to_jsonb(s),'turn',to_jsonb(t),'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=s.org_id and b.location_id=s.location_id and b.active),'[]'));
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
alter function app_private.agent_authorized(app.test_session)owner to jomcall_agent_jobs;
alter function app_private.agent_size(uuid)owner to jomcall_agent_jobs;
alter function app_private.agent_work(text,text,uuid,uuid,uuid,jsonb)owner to jomcall_agent_jobs;
revoke all on function app_private.agent_authorized(app.test_session),app_private.agent_size(uuid),app_private.agent_work(text,text,uuid,uuid,uuid,jsonb)from public;
grant execute on function app_private.agent_work(text,text,uuid,uuid,uuid,jsonb)to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
create or replace function app_private.claim_outbox(p_namespace text,p_limit int) returns setof app.outbox language sql security definer set search_path='' as $$
 update app.outbox set lease_until=now()+interval '30 seconds',attempts=attempts+1 where id in(
 select id from app.outbox where namespace=p_namespace and kind in('privacy.process','invitation.deliver')and delivered_at is null and(lease_until is null or lease_until<now())order by created_at,id for update skip locked limit least(greatest(p_limit,1),20))returning *
$$;
