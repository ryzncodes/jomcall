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
create unique index if not exists billing_notice_plan_once on app.billing_notice(org_id,reason,due_date) where channel='plan';

grant select on app.org_plan,app.plan_period,app.billing_plan,app.wallet_ledger to jomcall_jobs;

grant create on schema app_private to jomcall_jobs;
-- Engine, hourly: queue the plan emails that are due at p_at. Returns how
-- many were queued. Safe to call any number of times.
create or replace function app_private.queue_plan_notices(p_namespace text,p_at timestamptz default now())returns integer language plpgsql security definer set search_path='' as $$
declare r record;v uuid;n integer:=0;v_day date:=(p_at at time zone 'Asia/Kuala_Lumpur')::date;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 for r in
  -- The fee of the period that starts next, when the wallet is short of it.
  select pp.org_id,'PLAN_FEE_DUE'::text reason,nx.code plan_code,nx.monthly_fee_sen::bigint amount_sen,pp.period_end due_date,
   (select coalesce(sum(l.amount_sen),0) from app.wallet_ledger l where l.org_id=pp.org_id)::bigint balance_sen
  from app.plan_period pp join app.org_plan op on op.org_id=pp.org_id
  join lateral(select p.* from app.billing_plan p where p.code=coalesce(op.pending_plan_code,op.plan_code) and p.effective_from<=p_at order by p.version desc limit 1)nx on true
  where pp.starts_at<=p_at and pp.ends_at>p_at and pp.state in('charged','unpaid') and nx.monthly_fee_sen>0
   and pp.period_end-v_day between 0 and 3
   and(select coalesce(sum(l.amount_sen),0) from app.wallet_ledger l where l.org_id=pp.org_id)<nx.monthly_fee_sen
  union all
  -- A period that began unpaid and is still in grace.
  select pp.org_id,'PLAN_FEE_UNPAID',pp.plan_code,pp.fee_sen::bigint,pp.period_start,
   (select coalesce(sum(l.amount_sen),0) from app.wallet_ledger l where l.org_id=pp.org_id)::bigint
  from app.plan_period pp where pp.starts_at<=p_at and pp.ends_at>p_at and pp.state='unpaid'
  union all
  -- A period whose grace ended unpaid.
  select pp.org_id,'PLAN_STOPPED',pp.plan_code,pp.fee_sen::bigint,pp.period_start,
   (select coalesce(sum(l.amount_sen),0) from app.wallet_ledger l where l.org_id=pp.org_id)::bigint
  from app.plan_period pp where pp.starts_at<=p_at and pp.ends_at>p_at and pp.state='downgraded' and pp.plan_code in('starter','growth')
 loop
  v=null;
  insert into app.billing_notice(org_id,namespace,channel,reason,kl_day,amount_sen,balance_sen,due_date,plan_code)
  values(r.org_id,p_namespace,'plan',r.reason,v_day,r.amount_sen,r.balance_sen,r.due_date,r.plan_code)
  on conflict do nothing returning id into v;
  if v is not null then
   insert into app.outbox(org_id,namespace,kind,resource_id)values(r.org_id,p_namespace,'billing.refusal_notice',v);
   n=n+1;
  end if;
 end loop;
 return n;
end$$;

-- Engine: what to send for one claimed notice. Owner email addresses only.
-- Plan notices carry the plan, the amount, the wallet balance when the
-- notice was queued and the date; for PLAN_FEE_UNPAID also the last day to
-- pay (the day before grace ends).
create or replace function app_private.billing_notice_payload(p_outbox uuid,p_namespace text)returns jsonb language plpgsql security definer set search_path='' as $$
declare o app.outbox;b app.billing_notice;begin
 select * into o from app.outbox where id=p_outbox and namespace=p_namespace and kind='billing.refusal_notice';if not found then return null;end if;
 select * into b from app.billing_notice where id=o.resource_id and org_id=o.org_id for update;
 if not found or b.delivery_state<>'pending' then return null;end if;
 return jsonb_build_object('id',b.id,'channel',b.channel,'reason',b.reason,'day',b.kl_day,'operationId',o.operation_id,
  'emails',coalesce((select jsonb_agg(x.email order by x.email)from(select app_private.auth_user_email(m.user_id)email from app.member m
   where m.org_id=b.org_id and m.role='owner' and m.active)x where x.email is not null),'[]'))
  ||case when b.channel='plan' then jsonb_build_object('plan',b.plan_code,'amountSen',b.amount_sen,'balanceSen',b.balance_sen,'dueDate',b.due_date,
    'payBy',(select((pp.grace_until at time zone 'Asia/Kuala_Lumpur')::date-1) from app.plan_period pp where pp.org_id=b.org_id and pp.period_start=b.due_date and pp.state='unpaid'))
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
