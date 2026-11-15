-- Usage metering and plan entitlements on the real channels.
--
-- Phone calls bill `voice_second` once per call, keyed `call:<call id>`, when
-- the call ends: through `call_end` (hang-up, transfer, worker error) or
-- through `maintain` (worker crash, token expiry). WhatsApp bills
-- `whatsapp_conversation` once per customer (contact and channel) per 24
-- hours: a billing window opens at the first agent message the provider
-- accepts while no window for that customer is open, and its key names the
-- window (`wa:<channel>:<contact>:<window start, epoch seconds>`), not the
-- conversation, so resolving and reopening a chat inside the window bills
-- nothing more. Both go through app_private.record_usage (the function
-- recordUsage wraps) inside the agent's own security-definer functions.
--
-- A bill is priced, and voice seconds drawn from a plan allowance, at the
-- moment the usage started: a call's answer, a WhatsApp window's start.
--
-- A new call or a new WhatsApp conversation is admitted only when the plan
-- covers the channel and the wallet allows service (billing design section 4),
-- or, for a phone call, when the paid plan still has included minutes. When
-- reading the plan or wallet fails, the call or turn is answered anyway and
-- marked BILLING_CHECK_FAILED (owner decision, 2026-11-15). A plan or wallet
-- refusal queues one email to the organization's owner per reason per Kuala
-- Lumpur day, through the engine's outbox. A call or conversation already
-- under way is never cut off.
--
-- The agent login role loses direct access to the billing functions: it can
-- no longer bill an organization or read its balance. The web role (owners,
-- admins and staff alike) cannot read the billing columns on calls, nor the
-- WhatsApp billing windows.
--
-- Re-runnable: tables, columns and constraints are guarded, helpers are
-- replaced, and each function rewrite is skipped once applied. Design and
-- decisions: docs/superpowers/specs/2026-11-14-billing-design.md section 13.

-- Billing state of a call: null before this migration or while active;
-- 'pending' once ended and owed; 'billed' with the usage event; 'free' when
-- there is nothing to bill (never answered, or 0 seconds).
alter table app.call add column if not exists usage_state text;
alter table app.call add column if not exists billed_seconds integer;
alter table app.call add column if not exists usage_event_id uuid;
-- Failed billing attempts. Maintenance retries the least-tried first and stops
-- after 20, so a bill that can never land (a missing price, a key conflict)
-- cannot hold up the others; it stays 'pending' for an operator
-- (`npm run billing:admin -- usage-pending`, `usage-retry <id>`).
alter table app.call add column if not exists usage_attempts integer not null default 0;
-- BILLING_CHECK_FAILED when the plan or wallet could not be read at admission
-- and the call (or WhatsApp turn) was answered anyway.
alter table app.call add column if not exists billing_check text;
alter table app.conversation_turn add column if not exists billing_check text;
-- When a turn finished (completed, failed or cancelled). After a worker crash
-- this is the latest sign that the call was alive.
alter table app.call_turn add column if not exists completed_at timestamptz;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='app.call'::regclass and conname='call_usage_state_check') then
  alter table app.call add constraint call_usage_state_check check(
   (usage_state is null or usage_state in('pending','billed','free'))
   and (usage_state='billed')=(usage_event_id is not null)
   and (billed_seconds is null or billed_seconds>0)
   and (usage_state='billed')=(billed_seconds is not null));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='app.call'::regclass and conname='call_billing_check_check') then
  alter table app.call add constraint call_billing_check_check check(billing_check is null or billing_check~'^[A-Z_]{1,40}$');
 end if;
 if not exists(select 1 from pg_constraint where conrelid='app.conversation_turn'::regclass and conname='conversation_turn_billing_check_check') then
  alter table app.conversation_turn add constraint conversation_turn_billing_check_check check(billing_check is null or billing_check~'^[A-Z_]{1,40}$');
 end if;
end $$;
create index if not exists call_usage_pending on app.call(namespace,ended_at)where usage_state='pending';

-- One WhatsApp billing window per customer (contact and channel) per 24
-- hours. It starts when the provider accepts an agent message for that
-- customer while no window is open (starts_at), and is billed once under a
-- key that names it. `conversation_id` is the conversation that opened it.
create table if not exists app.whatsapp_usage_window(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 channel_id uuid not null,
 contact_id uuid not null,
 conversation_id uuid not null,
 starts_at timestamptz not null,
 usage_state text not null default 'pending' check(usage_state in('pending','billed')),
 usage_event_id uuid,
 usage_attempts integer not null default 0,
 created_at timestamptz not null default now(),
 unique(org_id,channel_id,contact_id,starts_at),
 check((usage_state='billed')=(usage_event_id is not null)),
 foreign key(org_id,conversation_id) references app.conversation(org_id,id) on delete cascade);
create index if not exists whatsapp_usage_window_customer on app.whatsapp_usage_window(org_id,channel_id,contact_id,starts_at desc);
create index if not exists whatsapp_usage_window_pending on app.whatsapp_usage_window(org_id,created_at)where usage_state='pending';
alter table app.whatsapp_usage_window enable row level security;
alter table app.whatsapp_usage_window force row level security;
grant select,insert,update on app.whatsapp_usage_window to jomcall_agent_jobs;

-- Billing data stays out of the web role's reach (billing design section 7):
-- the web role reads calls column by column, without the billing columns.
-- Owners and admins see what was billed through the wallet. A later migration
-- that adds a column to app.call must grant it here.
do $$declare cols text;begin
 revoke select on app.call from jomcall_app;
 select string_agg(quote_ident(column_name),',' order by ordinal_position) into cols from information_schema.columns
  where table_schema='app' and table_name='call' and column_name not in('usage_state','billed_seconds','usage_event_id','usage_attempts','billing_check');
 execute format('grant select(%s) on app.call to jomcall_app',cols);
end$$;

-- The owner of agent_call and whatsapp_work calls the billing functions.
grant execute on function app_private.record_usage(uuid,text,integer,text,timestamptz,jsonb),
 app_private.wallet_state(uuid),app_private.plan_entitlements(uuid,timestamptz),
 app_private.charge_plan_period(uuid,timestamptz) to jomcall_agent_jobs;
-- The agent login role does not.
revoke execute on function app_private.record_usage(uuid,text,integer,text,timestamptz,jsonb),
 app_private.wallet_state(uuid),app_private.plan_entitlements(uuid,timestamptz) from jomcall_agent;

-- Refusal emails to owners. One row per organization, reason and Kuala
-- Lumpur day; each new row queues one engine outbox item of the fixed kind
-- 'billing.refusal_notice'. It holds no phone number and no message text.
create table if not exists app.billing_notice(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 namespace text not null,
 channel text not null check(channel in('phone','whatsapp')),
 reason text not null check(reason in('NO_PHONE_ENTITLEMENT','NO_WHATSAPP_ENTITLEMENT','WALLET_UNFUNDED','WALLET_EXHAUSTED')),
 kl_day date not null,
 delivery_state text not null default 'pending' check(delivery_state in('pending','sent','failed')),
 delivered_at timestamptz,
 created_at timestamptz not null default now(),
 unique(org_id,reason,kl_day));
alter table app.billing_notice enable row level security;
alter table app.billing_notice force row level security;
grant select,insert,update on app.billing_notice to jomcall_jobs;
grant execute on function app_private.auth_user_email(uuid) to jomcall_jobs;

grant create on schema app_private to jomcall_jobs;
-- Internal. Queues the owner email for this refusal unless one was already
-- queued for the organization, reason and Kuala Lumpur day. Owned by the
-- engine's jobs role, which already writes the outbox; the agent's function
-- owner may call this and nothing else of the outbox.
create or replace function app_private.queue_billing_notice(p_org uuid,p_namespace text,p_channel text,p_reason text)returns void language plpgsql security definer set search_path='' as $$
declare v uuid;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 insert into app.billing_notice(org_id,namespace,channel,reason,kl_day)
 values(p_org,p_namespace,p_channel,p_reason,(now() at time zone 'Asia/Kuala_Lumpur')::date)
 on conflict(org_id,reason,kl_day)do nothing returning id into v;
 if v is not null then
  insert into app.outbox(org_id,namespace,kind,resource_id)values(p_org,p_namespace,'billing.refusal_notice',v);
 end if;
end$$;
-- Engine: what to send for one claimed notice. Owner email addresses only.
create or replace function app_private.billing_notice_payload(p_outbox uuid,p_namespace text)returns jsonb language plpgsql security definer set search_path='' as $$
declare o app.outbox;b app.billing_notice;begin
 select * into o from app.outbox where id=p_outbox and namespace=p_namespace and kind='billing.refusal_notice';if not found then return null;end if;
 select * into b from app.billing_notice where id=o.resource_id and org_id=o.org_id for update;
 if not found or b.delivery_state<>'pending' then return null;end if;
 return jsonb_build_object('id',b.id,'channel',b.channel,'reason',b.reason,'day',b.kl_day,'operationId',o.operation_id,
  'emails',coalesce((select jsonb_agg(x.email order by x.email)from(select app_private.auth_user_email(m.user_id)email from app.member m
   where m.org_id=b.org_id and m.role='owner' and m.active)x where x.email is not null),'[]'));
end$$;
create or replace function app_private.ack_billing_notice(p_outbox uuid,p_namespace text,p_failed boolean)returns void language sql security definer set search_path='' as $$
 update app.billing_notice b set delivery_state=case when p_failed then 'failed' else 'sent' end,delivered_at=now()
 from app.outbox o where o.id=p_outbox and o.namespace=p_namespace and o.kind='billing.refusal_notice' and b.id=o.resource_id and b.org_id=o.org_id and b.delivery_state='pending'
$$;
alter function app_private.queue_billing_notice(uuid,text,text,text) owner to jomcall_jobs;
alter function app_private.billing_notice_payload(uuid,text) owner to jomcall_jobs;
alter function app_private.ack_billing_notice(uuid,text,boolean) owner to jomcall_jobs;
revoke all on function app_private.queue_billing_notice(uuid,text,text,text) from public;
revoke all on function app_private.billing_notice_payload(uuid,text) from public;
revoke all on function app_private.ack_billing_notice(uuid,text,boolean) from public;
grant execute on function app_private.queue_billing_notice(uuid,text,text,text) to jomcall_agent_jobs;
grant execute on function app_private.billing_notice_payload(uuid,text),app_private.ack_billing_notice(uuid,text,boolean) to jomcall_worker;
revoke create on schema app_private from jomcall_jobs;

-- The engine claims the new kind with the others.
do $migration$
declare body text;
 old text:=$o$kind in('privacy.process','invitation.deliver')and$o$;
 new text:=$n$kind in('privacy.process','invitation.deliver','billing.refusal_notice')and$n$;
begin
 select pg_get_functiondef('app_private.claim_outbox(text,integer)'::regprocedure) into body;
 if position('billing.refusal_notice' in body)>0 then return;end if;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'claim_outbox: anchor not found once';end if;
 execute replace(body,old,new);
end
$migration$;

grant create on schema app_private to jomcall_agent_jobs;

-- An earlier draft of this migration had no namespace argument.
drop function if exists app_private.channel_admission(uuid,text,timestamptz);
drop function if exists app_private.conversation_bill(uuid);

-- Internal. Null when the organization may take a new call ('phone') or a new
-- WhatsApp conversation ('whatsapp'); otherwise the refusal code. The current
-- plan period is started or retried first, because nothing else schedules it
-- yet: without a period the plan reports no entitlements. Callers pass the
-- database clock. Grace (down to -RM4.99) is still served; unfunded and
-- exhausted are not, except that a phone call is answered while the charged
-- period still has included seconds (owner decision, 2026-11-15).
-- It never raises: any error, or a failed period charge that leaves no
-- entitlement, gives BILLING_CHECK_FAILED, which the callers answer anyway
-- (owner decision, 2026-11-15). A plan or wallet refusal queues the owner
-- email; a failure to queue it never changes the answer.
create or replace function app_private.channel_admission(p_org uuid,p_need text,p_at timestamptz,p_namespace text)returns text language plpgsql security definer set search_path='' as $$
declare e jsonb;w jsonb;v_charge_failed boolean:=false;v_code text;begin
 if p_need not in('phone','whatsapp') or p_org is null or p_at is null then raise exception 'INVALID_ADMISSION';end if;
 begin
  begin
   perform app_private.charge_plan_period(p_org,p_at);
  exception when others then
   -- A failed charge leaves the period as it was. If that leaves no
   -- entitlement, the cause is the failure, not the plan.
   v_charge_failed:=true;
   raise warning 'PLAN_PERIOD_DEFERRED';
  end;
  e=app_private.plan_entitlements(p_org,p_at);
  if p_need='phone' and coalesce((e->>'phoneNumbers')::int,0)<1 then
   v_code=case when v_charge_failed then 'BILLING_CHECK_FAILED' else 'NO_PHONE_ENTITLEMENT' end;
  elsif p_need='whatsapp' and not coalesce((e->>'whatsappAgent')::boolean,false) then
   v_code=case when v_charge_failed then 'BILLING_CHECK_FAILED' else 'NO_WHATSAPP_ENTITLEMENT' end;
  else
   w=app_private.wallet_state(p_org);
   if coalesce((w->>'serviceAllowed')::boolean,false) then v_code=null;
   -- Paid minutes left: the call costs nothing until they run out. If they
   -- run out mid-call, the call goes on and the rest is billed as overage.
   elsif p_need='phone' and coalesce((e->>'includedVoiceSeconds')::bigint,0)>coalesce((e->>'usedIncludedSeconds')::bigint,0) then v_code=null;
   else v_code=case w->>'state' when 'unfunded' then 'WALLET_UNFUNDED' else 'WALLET_EXHAUSTED' end;
   end if;
  end if;
 exception when others then
  raise warning 'BILLING_CHECK_FAILED';
  return 'BILLING_CHECK_FAILED';
 end;
 if v_code in('NO_PHONE_ENTITLEMENT','NO_WHATSAPP_ENTITLEMENT','WALLET_UNFUNDED','WALLET_EXHAUSTED') then
  begin
   perform app_private.queue_billing_notice(p_org,p_namespace,p_need,v_code);
  exception when others then
   raise warning 'BILLING_NOTICE_DEFERRED';
  end;
 end if;
 return v_code;
end$$;

-- Internal. Bills one ended call that is still owed. The seconds are the call
-- row's own duration (from the answer to the end), so the bill and the call
-- log always agree. A call with a caller turn counts as answered even if the
-- worker's answer report was lost. Priced at the answer. The idempotency key
-- makes a repeat a no-op.
create or replace function app_private.call_bill(p_call uuid)returns text language plpgsql security definer set search_path='' as $$
declare c app.call;r jsonb;begin
 select * into c from app.call where id=p_call for update;
 if not found or c.state<>'ended' or c.usage_state is distinct from 'pending' then return coalesce(c.usage_state,'none');end if;
 if coalesce(c.duration_seconds,0)<=0
  or(c.answered_at is null and not exists(select 1 from app.call_turn q where q.org_id=c.org_id and q.call_id=c.id))then
  update app.call set usage_state='free' where id=c.id;
  return 'free';
 end if;
 r=app_private.record_usage(c.org_id,'voice_second',c.duration_seconds,'call:'||c.id::text,coalesce(c.answered_at,c.started_at),
  jsonb_build_object('callId',c.id::text));
 update app.call set usage_state='billed',usage_event_id=(r->>'usageEventId')::uuid,billed_seconds=c.duration_seconds where id=c.id;
 return 'billed';
end$$;

-- Internal. Bills one WhatsApp window, priced at its start. The key names
-- the customer and the window, so it can never be billed twice.
create or replace function app_private.whatsapp_window_bill(p_window uuid)returns text language plpgsql security definer set search_path='' as $$
declare w app.whatsapp_usage_window;r jsonb;begin
 select * into w from app.whatsapp_usage_window where id=p_window for update;
 if not found or w.usage_state<>'pending' then return coalesce(w.usage_state,'none');end if;
 r=app_private.record_usage(w.org_id,'whatsapp_conversation',1,
  'wa:'||w.channel_id::text||':'||w.contact_id::text||':'||floor(extract(epoch from w.starts_at))::bigint::text,w.starts_at,
  jsonb_build_object('conversationId',w.conversation_id::text,'windowId',w.id::text));
 update app.whatsapp_usage_window set usage_state='billed',usage_event_id=(r->>'usageEventId')::uuid where id=w.id;
 return 'billed';
end$$;

alter function app_private.channel_admission(uuid,text,timestamptz,text) owner to jomcall_agent_jobs;
alter function app_private.call_bill(uuid) owner to jomcall_agent_jobs;
alter function app_private.whatsapp_window_bill(uuid) owner to jomcall_agent_jobs;
revoke all on function app_private.channel_admission(uuid,text,timestamptz,text) from public;
revoke all on function app_private.call_bill(uuid) from public;
revoke all on function app_private.whatsapp_window_bill(uuid) from public;
revoke create on schema app_private from jomcall_agent_jobs;

-- Phone calls. Rewritten from the CURRENT body; each expected text must be
-- found exactly once or the migration fails.
do $migration$
declare body text;hits int;i int;
 olds text[]:=array[
  -- 1. A variable for a failed billing check.
  $o$v_prev uuid;v_caller text;begin$o$,
  -- 2. Plan and wallet come last, after every other refusal: a call refused
  --    for its configuration, the caller limit or a busy line never starts
  --    or charges a plan period.
  $o$  select * into v_sched from app.location_schedule where org_id=n.org_id and location_id=n.location_id;$o$,
  -- 3-4. The failed check is kept on the call row.
  $o$state,refusal,outcome,recording_enabled,after_hours,do_not_contact,token_hash,token_expires_at,started_at,ended_at,duration_seconds)$o$,
  $o$now(),case when v_refusal is not null then now() end,case when v_refusal is not null then 0 end)returning * into c;$o$,
  -- 5. A crashed call's seconds stop at the last sign it was alive.
  $o$   duration_seconds=greatest(0,extract(epoch from now()-coalesce(answered_at,started_at))::int),token_hash=null,revision=revision+1$o$,
  -- 6. Maintenance bills every call still owed (crash recovery).
  $o$   where id in(select id from app.call where namespace=p_namespace and state='active' and token_expires_at<=now()limit 100);
  return '{}';$o$,
  -- 7. A normal end bills in the same transaction.
  $o$    when answered_at is null then 'abandoned' else 'answered' end
   where id=c.id;
  return '{}';$o$,
  -- 8. A caller who speaks was answered, even if the answer report was lost.
  $o$  insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)$o$,
  -- 9-11. When each turn finished.
  $o$update app.call_turn set state='completed',answer=p_data->>'answer',$o$,
  $o$update app.call_turn set state='failed',revision=revision+1,error_code=case$o$,
  $o$update app.call_turn set state='cancelled',revision=revision+1,lease_token=null,lease_until=null where id=t.id;$o$];
 news text[]:=array[
  $n$v_prev uuid;v_caller text;v_check text;begin$n$,
  $n$  if v_refusal is null then
   -- The database clock, never the agent's `at`: the agent process must not
   -- choose which plan period is charged or checked. channel_admission never
   -- raises; this guard keeps any fault inside this call.
   begin
    v_refusal=app_private.channel_admission(n.org_id,'phone',now(),p_namespace);
   exception when others then
    v_refusal='BILLING_CHECK_FAILED';
   end;
   -- Owner decision (2026-11-15): when the plan or wallet cannot be read,
   -- answer anyway (fail open) and record it on the call and in the log.
   if v_refusal='BILLING_CHECK_FAILED' then
    v_refusal=null;v_check='BILLING_CHECK_FAILED';
    raise warning 'BILLING_CHECK_FAILED channel=phone org=%',n.org_id;
   end if;
  end if;
  select * into v_sched from app.location_schedule where org_id=n.org_id and location_id=n.location_id;$n$,
  $n$state,refusal,outcome,recording_enabled,after_hours,do_not_contact,token_hash,token_expires_at,started_at,ended_at,duration_seconds,billing_check)$n$,
  $n$now(),case when v_refusal is not null then now() end,case when v_refusal is not null then 0 end,v_check)returning * into c;$n$,
  $n$   duration_seconds=case when answered_at is null then greatest(0,extract(epoch from now()-started_at)::int)
    else greatest(0,extract(epoch from coalesce((select max(coalesce(q.completed_at,q.created_at))from app.call_turn q where q.org_id=app.call.org_id and q.call_id=app.call.id),answered_at)-answered_at)::int)end,
   usage_state='pending',token_hash=null,revision=revision+1$n$,
  $n$   where id in(select id from app.call where namespace=p_namespace and state='active' and token_expires_at<=now()limit 100);
  -- Each owed call on its own: one that cannot be billed stays owed and is
  -- retried on the next pass, without holding up the others.
  for v_prev in select id from app.call where namespace=p_namespace and usage_state='pending' and usage_attempts<20 order by usage_attempts,ended_at,id limit 100 loop
   begin
    perform app_private.call_bill(v_prev);
   exception when others then
    update app.call set usage_attempts=usage_attempts+1 where id=v_prev;
    raise warning 'CALL_BILLING_DEFERRED';
   end;
  end loop;
  return '{}';$n$,
  $n$    when answered_at is null then 'abandoned' else 'answered' end,
   usage_state='pending'
   where id=c.id;
  -- Billed now; if billing fails the call still ends, stays owed and
  -- maintenance retries it. The key makes a retry a no-op.
  begin
   perform app_private.call_bill(c.id);
  exception when others then
   update app.call set usage_attempts=usage_attempts+1 where id=c.id;
   raise warning 'CALL_BILLING_DEFERRED';
  end;
  return '{}';$n$,
  $n$  -- The caller spoke, so the call was answered: if the worker's answer
  -- report was lost, the first turn stands in for it (billing counts from it).
  -- The disclosure time is left alone: it records what was played.
  update app.call set answered_at=now(),revision=revision+1 where id=c.id and answered_at is null;
  insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)$n$,
  $n$update app.call_turn set state='completed',completed_at=now(),answer=p_data->>'answer',$n$,
  $n$update app.call_turn set state='failed',completed_at=now(),revision=revision+1,error_code=case$n$,
  $n$update app.call_turn set state='cancelled',completed_at=now(),revision=revision+1,lease_token=null,lease_until=null where id=t.id;$n$];
begin
 select pg_get_functiondef('app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.channel_admission' in body)>0 then return;end if;
 for i in 1..array_length(olds,1) loop
  hits=(length(body)-length(replace(body,olds[i],'')))/length(olds[i]);
  if hits<>1 then raise exception 'agent_call: anchor % found % times',i,hits;end if;
  body=replace(body,olds[i],news[i]);
 end loop;
 execute body;
end
$migration$;

-- WhatsApp. Same approach.
do $migration$
declare body text;hits int;i int;
 olds text[]:=array[
  -- 1. Admission for a customer the agent is not already serving.
  $o$    update app.conversation set needs_attention=true,attention_reason='AGENT_NOT_PUBLISHED',revision=revision+1 where id=c.id;return jsonb_build_object('skipped',true);
   end if;
  end if;$o$,
  -- 2. An agent message accepted by the provider opens (and bills) a window
  --    when none is open for the customer.
  $o$   update app.conversation set last_message_at=now() where id=c.id;
  elsif v_status in('failed','blocked','unknown')then$o$,
  -- 3. Maintenance retries windows still owed.
  $o$state<>'pending' and processed_at<now()-interval '7 days' limit 1000);
  return '{}';$o$];
 news text[]:=array[
  $n$    update app.conversation set needs_attention=true,attention_reason='AGENT_NOT_PUBLISHED',revision=revision+1 where id=c.id;return jsonb_build_object('skipped',true);
   end if;
   -- The agent keeps serving a conversation it already answered, and a
   -- customer whose billing window is open (already paid). Otherwise it needs
   -- the plan's WhatsApp agent and a wallet that allows service: if not, the
   -- turn is skipped, the conversation is flagged for staff and nothing is
   -- sent. A skipped turn is not answered later (after a top-up, say) unless
   -- the customer writes again. channel_admission never raises; the guard
   -- keeps any fault on this turn, so the oldest-first claim moves on.
   if not exists(select 1 from app.whatsapp_usage_window w where w.org_id=c.org_id
    and(w.conversation_id=c.id or(w.channel_id=c.channel_id and w.contact_id=c.contact_id and w.starts_at>now()-interval '24 hours')))then
    begin
     v_kind:=app_private.channel_admission(c.org_id,'whatsapp',now(),p_namespace);
    exception when others then
     v_kind:='BILLING_CHECK_FAILED';
    end;
    if v_kind='BILLING_CHECK_FAILED' then
     -- Owner decision (2026-11-15): answer anyway and record it.
     raise warning 'BILLING_CHECK_FAILED channel=whatsapp org=%',c.org_id;
     update app.conversation_turn set billing_check='BILLING_CHECK_FAILED' where id=t.id;
    elsif v_kind is not null then
     update app.conversation_turn set state='skipped',error_code=v_kind,completed_at=now() where id=t.id;
     update app.conversation set needs_attention=true,attention_reason=v_kind,revision=revision+1 where id=c.id;return jsonb_build_object('skipped',true);
    end if;
   end if;
  end if;$n$,
  $n$   update app.conversation set last_message_at=now() where id=c.id;
   -- One bill per customer (contact and channel) per 24 hours, however
   -- often the chat is resolved and reopened. The window starts now, at the
   -- first agent message the provider accepts while none is open.
   if m.author='agent' then
    perform pg_advisory_xact_lock(hashtextextended('jomcall.wa_window:'||c.channel_id::text||':'||c.contact_id::text,0));
    if not exists(select 1 from app.whatsapp_usage_window w where w.org_id=c.org_id and w.channel_id=c.channel_id
     and w.contact_id=c.contact_id and w.starts_at>now()-interval '24 hours')then
     insert into app.whatsapp_usage_window(org_id,channel_id,contact_id,conversation_id,starts_at)
     values(c.org_id,c.channel_id,c.contact_id,c.id,now())returning id into v_id;
     begin
      perform app_private.whatsapp_window_bill(v_id);
     exception when others then
      update app.whatsapp_usage_window set usage_attempts=usage_attempts+1 where id=v_id;
      raise warning 'CONVERSATION_BILLING_DEFERRED';
     end;
    end if;
   end if;
  elsif v_status in('failed','blocked','unknown')then$n$,
  $n$state<>'pending' and processed_at<now()-interval '7 days' limit 1000);
  for v_id in select w.id from app.whatsapp_usage_window w join app.whatsapp_channel h on(h.org_id=w.org_id and h.id=w.channel_id)
   where h.namespace=p_namespace and w.usage_state='pending' and w.usage_attempts<20 order by w.usage_attempts,w.starts_at,w.id limit 100 loop
   begin
    perform app_private.whatsapp_window_bill(v_id);
   exception when others then
    update app.whatsapp_usage_window set usage_attempts=usage_attempts+1 where id=v_id;
    raise warning 'CONVERSATION_BILLING_DEFERRED';
   end;
  end loop;
  return '{}';$n$];
begin
 select pg_get_functiondef('app_private.whatsapp_work(text,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.channel_admission' in body)>0 then return;end if;
 for i in 1..array_length(olds,1) loop
  hits=(length(body)-length(replace(body,olds[i],'')))/length(olds[i]);
  if hits<>1 then raise exception 'whatsapp_work: anchor % found % times',i,hits;end if;
  body=replace(body,olds[i],news[i]);
 end loop;
 execute body;
end
$migration$;
