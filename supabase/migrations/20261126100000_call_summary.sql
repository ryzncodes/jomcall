-- Call summaries (2026-11-26). Design:
-- docs/superpowers/specs/2026-11-26-call-summary-design.md sections 2 and 6.
--
-- One short, two-language summary per answered phone call: why the caller
-- rang, what happened, what is left to do. A trigger queues a pending row when
-- an answered call ends; the agent process claims it through
-- app_private.call_summary (lease based, at most 3 attempts) and writes the
-- six sentences back. Owners and admins may correct the text; staff read it.
-- The web role cannot insert or delete a summary and cannot run the worker
-- function.

create table app.call_summary(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,
 namespace text not null,
 call_id uuid not null unique,
 state text not null default 'pending' check(state in('pending','running','done','skipped','failed')),
 skip_reason text check(skip_reason in('TOO_SHORT','NO_TURNS')),
 reason_en text check(char_length(reason_en)<=300),reason_ms text check(char_length(reason_ms)<=300),
 outcome_en text check(char_length(outcome_en)<=300),outcome_ms text check(char_length(outcome_ms)<=300),
 next_step_en text check(char_length(next_step_en)<=300),next_step_ms text check(char_length(next_step_ms)<=300),
 model text,
 attempts integer not null default 0,
 lease_token uuid,lease_until timestamptz,
 error_code text check(error_code~'^[A-Z_]{1,40}$'),
 edited boolean not null default false,edited_at timestamptz,
 created_at timestamptz not null default now(),completed_at timestamptz,
 revision integer not null default 1,
 -- Deleting the call (PDPA deletion of the contact) deletes its summary.
 foreign key(org_id,call_id)references app.call(org_id,id)on delete cascade
);
create index call_summary_queue on app.call_summary(namespace,state,created_at);

alter table app.call_summary enable row level security;
alter table app.call_summary force row level security;
grant select on app.call_summary to jomcall_app;
grant update(reason_en,reason_ms,outcome_en,outcome_ms,next_step_en,next_step_ms,edited,edited_at,revision)on app.call_summary to jomcall_app;
create policy tenant_read on app.call_summary for select to jomcall_app
 using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
create policy manager_update on app.call_summary for update to jomcall_app
 using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'))
 with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));

-- What the trigger function (owned by jomcall_jobs) and the worker function
-- (owned by jomcall_agent_jobs) touch. jomcall_jobs already reads
-- app.call(id,org_id,namespace,contact_id); it never reads what was said.
grant insert(org_id,namespace,call_id),select(call_id)on app.call_summary to jomcall_jobs;
grant select,update on app.call_summary to jomcall_agent_jobs;
grant create on schema app_private to jomcall_jobs,jomcall_agent_jobs;

-- Queue one pending summary when an answered call ends. A refused or
-- unanswered call never reaches this; a second end adds nothing.
create function app_private.call_summary_queue()returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into app.call_summary(org_id,namespace,call_id)values(new.org_id,new.namespace,new.id)on conflict(call_id)do nothing;
 return null;
end$$;

-- The worker's way in. claim: the oldest pending summary worth writing
-- (calls with no completed turn, under 15 seconds, or under 2 turns unless
-- the outcome is one staff act on, are marked skipped on the way, at most 25
-- per call) with what the model reads. write
-- and fail need the live lease. maintain returns expired leases to the queue.
create function app_private.call_summary(p_action text,p_namespace text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.call_summary;c app.call;v_turns int;v_lease uuid;v_n int;v_i int;v_code text;v_f text;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;

 if p_action='claim' then
  for v_i in 1..25 loop
   select * into s from app.call_summary where namespace=p_namespace and state='pending' order by created_at,id limit 1 for update skip locked;
   if not found then return null;end if;
   select * into c from app.call where org_id=s.org_id and id=s.call_id;
   select count(*)into v_turns from app.call_turn where org_id=s.org_id and call_id=s.call_id and state='completed';
   if v_turns=0 then
    update app.call_summary set state='skipped',skip_reason='NO_TURNS',revision=revision+1 where id=s.id;
   -- One completed turn is enough when the call ended in a transfer, a
   -- handoff, a message or a booking request (staff act on it and cannot
   -- read the turns); otherwise 2 are needed.
   elsif coalesce(c.duration_seconds,0)<15 or(v_turns<2 and coalesce(c.outcome,'')not in('transferred','transfer_failed','handoff','message','booking_proposed'))then
    update app.call_summary set state='skipped',skip_reason='TOO_SHORT',revision=revision+1 where id=s.id;
   else
    v_lease=gen_random_uuid();
    update app.call_summary set state='running',attempts=attempts+1,lease_token=v_lease,lease_until=now()+interval '60 seconds' where id=s.id returning * into s;
    return jsonb_build_object('id',s.id,'lease',v_lease,'attempt',s.attempts,
     'call',jsonb_build_object('outcome',c.outcome,'transfer_result',c.transfer_result,'after_hours',c.after_hours,'caller_e164',c.caller_e164),
     'turns',coalesce((select jsonb_agg(jsonb_build_object('input',t.input,'answer',t.answer)order by t.created_at,t.id)from app.call_turn t where t.org_id=s.org_id and t.call_id=s.call_id and t.state='completed'),'[]'),
     'proposals',coalesce((select jsonb_agg(p.kind order by p.created_at,p.id)from app.call_proposal p where p.org_id=s.org_id and p.call_id=s.call_id),'[]'));
   end if;
  end loop;
  return null;

 elsif p_action='write' then
  foreach v_f in array array['reason_en','reason_ms','outcome_en','outcome_ms']loop
   if jsonb_typeof(p_data->v_f)is distinct from 'string' or char_length(p_data->>v_f)not between 1 and 300 then raise exception 'SUMMARY_INVALID';end if;
  end loop;
  -- Next step may be null or absent (nothing left to do); else a 1-300 character string.
  foreach v_f in array array['next_step_en','next_step_ms']loop
   if jsonb_typeof(p_data->v_f)is not null and jsonb_typeof(p_data->v_f)<>'null' and(jsonb_typeof(p_data->v_f)<>'string' or char_length(p_data->>v_f)not between 1 and 300)then raise exception 'SUMMARY_INVALID';end if;
  end loop;
  if jsonb_typeof(p_data->'model')is distinct from 'string' or char_length(p_data->>'model')not between 1 and 100 then raise exception 'SUMMARY_INVALID';end if;
  update app.call_summary set state='done',reason_en=p_data->>'reason_en',reason_ms=p_data->>'reason_ms',outcome_en=p_data->>'outcome_en',outcome_ms=p_data->>'outcome_ms',
   next_step_en=p_data->>'next_step_en',next_step_ms=p_data->>'next_step_ms',model=p_data->>'model',completed_at=now(),lease_token=null,lease_until=null,revision=revision+1
   where namespace=p_namespace and id=p_id and state='running' and lease_token is not null and lease_token=p_lease and lease_until>now();
  get diagnostics v_n=row_count;
  return jsonb_build_object('ok',v_n=1);

 elsif p_action='fail' then
  v_code=coalesce(p_data->>'code','');
  if v_code!~'^[A-Z_]{1,40}$' then v_code='UNKNOWN';end if;
  update app.call_summary set state=case when attempts<3 then 'pending' else 'failed' end,error_code=v_code,lease_token=null,lease_until=null,revision=revision+1
   where namespace=p_namespace and id=p_id and state='running' and lease_token is not null and lease_token=p_lease;
  get diagnostics v_n=row_count;
  return jsonb_build_object('ok',v_n=1);

 elsif p_action='maintain' then
  update app.call_summary set state=case when attempts>=3 then 'failed' else 'pending' end,error_code=case when attempts>=3 then 'LEASE_EXPIRED' else error_code end,
   lease_token=null,lease_until=null,revision=revision+1
   where namespace=p_namespace and state='running' and lease_until<now();
  get diagnostics v_n=row_count;
  return to_jsonb(v_n);
 end if;
 raise exception 'INVALID_ACTION';
end$$;

alter function app_private.call_summary_queue()owner to jomcall_jobs;
alter function app_private.call_summary(text,text,uuid,uuid,jsonb)owner to jomcall_agent_jobs;
revoke create on schema app_private from jomcall_jobs,jomcall_agent_jobs;
revoke all on function app_private.call_summary_queue()from public;
revoke all on function app_private.call_summary(text,text,uuid,uuid,jsonb)from public;
grant execute on function app_private.call_summary(text,text,uuid,uuid,jsonb)to jomcall_agent;

create trigger call_summary_queue after update of state on app.call for each row
 when(old.state='active' and new.state='ended' and new.answered_at is not null)execute function app_private.call_summary_queue();
