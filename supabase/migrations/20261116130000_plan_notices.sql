-- Plan picker follow-ups (2026-11-16).
--
-- 1. Owner emails about the monthly fee, through the notice queue that
--    already sends refusal emails (same table, same outbox kind, same
--    engine path). Three new reasons:
--      PLAN_FEE_DUE     the next fee is due within three days and the wallet
--                       does not hold it
--      PLAN_FEE_UNPAID  a period started unpaid; the plan stops when grace ends
--      PLAN_STOPPED     grace ended unpaid; the plan fell back to pay as you go
--    At most one email per organization, reason and period. No customer data.
--    A notice that is no longer true when it is about to be sent is skipped.
-- 2. plan_entitlements follows the same late-clock rule as
--    charge_plan_period: a time before the monthly date is read as that
--    date's midnight, so a call start that began just before a first pick
--    is not refused once the plan is charged.
--
-- Re-runnable.

alter table app.billing_notice add column if not exists amount_sen bigint;
alter table app.billing_notice add column if not exists balance_sen bigint;
alter table app.billing_notice add column if not exists due_date date;
alter table app.billing_notice add column if not exists plan_code text;
alter table app.billing_notice drop constraint if exists billing_notice_channel_check;
alter table app.billing_notice add constraint billing_notice_channel_check check(channel in('phone','whatsapp','plan'));
alter table app.billing_notice drop constraint if exists billing_notice_reason_check;
alter table app.billing_notice add constraint billing_notice_reason_check check(reason in(
 'NO_PHONE_ENTITLEMENT','NO_WHATSAPP_ENTITLEMENT','WALLET_UNFUNDED','WALLET_EXHAUSTED','PLAN_FEE_DUE','PLAN_FEE_UNPAID','PLAN_STOPPED'));
alter table app.billing_notice drop constraint if exists billing_notice_plan_shape;
alter table app.billing_notice add constraint billing_notice_plan_shape check(
 (channel='plan')=(reason in('PLAN_FEE_DUE','PLAN_FEE_UNPAID','PLAN_STOPPED'))
 and(channel<>'plan' or(due_date is not null and plan_code in('starter','growth') and amount_sen>=0)));
-- One plan email per organization, reason and period (due_date is the day
-- the fee falls due: the period's first day).
alter table app.billing_notice drop constraint if exists billing_notice_delivery_state_check;
alter table app.billing_notice add constraint billing_notice_delivery_state_check check(delivery_state in('pending','sent','failed','skipped'));
create unique index if not exists billing_notice_plan_once on app.billing_notice(org_id,reason,due_date) where channel='plan';

grant select on app.org_plan,app.plan_period,app.billing_plan,app.wallet_ledger to jomcall_jobs;

grant create on schema app_private to jomcall_jobs;
-- Engine, hourly: queue the plan emails that are due at p_at. Returns how
-- many were queued. Safe to call any number of times. One organization's
-- failure does not stop the others.
create or replace function app_private.queue_plan_notices(p_namespace text,p_at timestamptz default now())returns integer language plpgsql security definer set search_path='' as $$
declare r record;v uuid;n integer:=0;v_day date:=(p_at at time zone 'Asia/Kuala_Lumpur')::date;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 for r in
  with cur as(
   select pp.*,(select coalesce(sum(l.amount_sen),0) from app.wallet_ledger l where l.org_id=pp.org_id)::bigint balance_sen
   from app.plan_period pp where pp.starts_at<=p_at and pp.ends_at>p_at)
  -- The fee of the period that starts next (at the price in force on that
  -- day), when the wallet is short of it.
  select c.org_id,'PLAN_FEE_DUE'::text reason,nx.code plan_code,nx.monthly_fee_sen::bigint amount_sen,c.period_end due_date,c.balance_sen
  from cur c join app.org_plan op on op.org_id=c.org_id
  join lateral(select p.* from app.billing_plan p where p.code=coalesce(op.pending_plan_code,op.plan_code) and p.effective_from<=c.ends_at order by p.version desc limit 1)nx on true
  where c.state in('charged','unpaid') and nx.monthly_fee_sen>0 and c.period_end-v_day between 0 and 3 and c.balance_sen<nx.monthly_fee_sen
  union all
  -- A period that began unpaid, is still in grace, and whose fee the wallet
  -- does not hold (a fee the wallet holds is only waiting for the next run).
  select c.org_id,'PLAN_FEE_UNPAID',c.plan_code,c.fee_sen::bigint,c.period_start,c.balance_sen
  from cur c where c.state='unpaid' and c.balance_sen<c.fee_sen and c.grace_until>p_at
  union all
  -- A period whose grace ended unpaid in the last two days (older ones are
  -- not announced late).
  select c.org_id,'PLAN_STOPPED',c.plan_code,c.fee_sen::bigint,c.period_start,c.balance_sen
  from cur c join app.org_plan op on op.org_id=c.org_id
  where c.state='downgraded' and c.plan_code in('starter','growth') and op.plan_code='payg' and c.grace_until>p_at-interval '2 days'
 loop
  begin
   v=null;
   insert into app.billing_notice(org_id,namespace,channel,reason,kl_day,amount_sen,balance_sen,due_date,plan_code)
   values(r.org_id,p_namespace,'plan',r.reason,v_day,r.amount_sen,r.balance_sen,r.due_date,r.plan_code)
   on conflict do nothing returning id into v;
   if v is not null then
    insert into app.outbox(org_id,namespace,kind,resource_id)values(r.org_id,p_namespace,'billing.refusal_notice',v);
    n=n+1;
   end if;
  exception when others then
   raise warning 'PLAN_NOTICE_FAILED %',sqlstate;
  end;
 end loop;
 return n;
end$$;

-- Engine: what to send for one claimed notice. Owner email addresses only.
-- Plan notices carry the plan, the amount, the wallet balance and the date;
-- for PLAN_FEE_UNPAID also the last day to pay (the day before grace ends).
-- A plan notice is checked again here and skipped when it is no longer
-- true: the wallet now holds the fee, the fee was charged, grace has ended,
-- the next plan became pay as you go, or a plan was started again. The
-- amounts sent are the ones true now, not the ones stored when it was queued.
create or replace function app_private.billing_notice_payload(p_outbox uuid,p_namespace text)returns jsonb language plpgsql security definer set search_path='' as $$
declare o app.outbox;b app.billing_notice;pp app.plan_period;op app.org_plan;nx app.billing_plan;v_balance bigint;v_plan text;v_amount bigint;v_pay_by date;v_ok boolean:=false;begin
 select * into o from app.outbox where id=p_outbox and namespace=p_namespace and kind='billing.refusal_notice';if not found then return null;end if;
 select * into b from app.billing_notice where id=o.resource_id and org_id=o.org_id for update;
 if not found or b.delivery_state<>'pending' then return null;end if;
 if b.channel='plan' then
  select coalesce(sum(l.amount_sen),0) into v_balance from app.wallet_ledger l where l.org_id=b.org_id;
  select * into op from app.org_plan where org_id=b.org_id;
  v_plan=b.plan_code;v_amount=b.amount_sen;
  if b.reason='PLAN_FEE_DUE' then
   -- due_date is the first day of the period the fee is for.
   select p.* into nx from app.billing_plan p where p.code=coalesce(op.pending_plan_code,op.plan_code)
    and p.effective_from<=(b.due_date::timestamp at time zone 'Asia/Kuala_Lumpur')order by p.version desc limit 1;
   if found and nx.monthly_fee_sen>0 and v_balance<nx.monthly_fee_sen
    and exists(select 1 from app.plan_period x where x.org_id=b.org_id and x.period_end=b.due_date and x.state in('charged','unpaid'))then
    v_ok=true;v_plan=nx.code;v_amount=nx.monthly_fee_sen;
   end if;
  elsif b.reason='PLAN_FEE_UNPAID' then
   select * into pp from app.plan_period x where x.org_id=b.org_id and x.period_start=b.due_date and x.state='unpaid';
   if found and v_balance<pp.fee_sen and pp.grace_until>now() then
    v_ok=true;v_pay_by=(pp.grace_until at time zone 'Asia/Kuala_Lumpur')::date-1;
   end if;
  elsif b.reason='PLAN_STOPPED' then
   v_ok=coalesce(op.plan_code,'payg')='payg' and exists(select 1 from app.plan_period x where x.org_id=b.org_id and x.period_start=b.due_date and x.state='downgraded');
  end if;
  if not v_ok then
   update app.billing_notice set delivery_state='skipped',delivered_at=now() where id=b.id;
   return null;
  end if;
 end if;
 return jsonb_build_object('id',b.id,'channel',b.channel,'reason',b.reason,'day',b.kl_day,'operationId',o.operation_id,
  'emails',coalesce((select jsonb_agg(x.email order by x.email)from(select app_private.auth_user_email(m.user_id)email from app.member m
   where m.org_id=b.org_id and m.role='owner' and m.active)x where x.email is not null),'[]'))
  ||case when b.channel='plan' then jsonb_build_object('plan',v_plan,'amountSen',v_amount,'balanceSen',v_balance,'dueDate',b.due_date,'payBy',v_pay_by,
    'whatsappAgent',(select p.whatsapp_agent from app.billing_plan p where p.code=v_plan order by p.version desc limit 1))
   else '{}'::jsonb end;
end$$;
alter function app_private.queue_plan_notices(text,timestamptz) owner to jomcall_jobs;
alter function app_private.billing_notice_payload(uuid,text) owner to jomcall_jobs;
revoke create on schema app_private from jomcall_jobs;
revoke all on function app_private.queue_plan_notices(text,timestamptz) from public;
revoke all on function app_private.billing_notice_payload(uuid,text) from public;
grant execute on function app_private.queue_plan_notices(text,timestamptz),app_private.billing_notice_payload(uuid,text) to jomcall_worker;

-- What the current period allows. Same as before, except that a time before
-- the organization's monthly date is read as that date's midnight (Kuala
-- Lumpur), as charge_plan_period does.
create or replace function app_private.plan_entitlements(p_org uuid,p_at timestamptz default now())returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pp app.plan_period;v_on boolean;v_at timestamptz;begin
 v_at=greatest(p_at,coalesce((select anchor_date::timestamp at time zone 'Asia/Kuala_Lumpur' from app.org_plan where org_id=p_org),p_at));
 select * into pp from app.plan_period where org_id=p_org and starts_at<=v_at and ends_at>v_at;
 if not found then
  return jsonb_build_object('plan',coalesce((select plan_code from app.org_plan where org_id=p_org),'payg'),'periodState','none','phoneNumbers',0,'whatsappAgent',false,'includedVoiceSeconds',0,'usedIncludedSeconds',0);
 end if;
 v_on=pp.state in('charged','unpaid');
 return app_private.plan_period_json(pp)||jsonb_build_object(
  'phoneNumbers',case when v_on then pp.phone_numbers else 0 end,
  'whatsappAgent',v_on and pp.whatsapp_agent,
  'includedVoiceSeconds',case when pp.state='charged' then pp.included_voice_seconds else 0 end);
end$$;
