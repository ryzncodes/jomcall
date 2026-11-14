-- Monthly plans on top of the prepaid wallet (price table version 2).
-- Design: docs/superpowers/specs/2026-11-14-billing-design.md section 13.
-- Every figure below is an owner placeholder, changeable by a new version;
-- rows are never edited. No card is ever charged automatically: the monthly
-- fee is debited from the wallet.
--
-- 1. billing_price gains a status column; version 2 prices are added.
-- 2. billing_plan: starter, growth, payg (version 2).
-- 3. org_plan: the organization's plan, a pending change, and the anchor date.
-- 4. plan_period: one row per organization and month, frozen when created.
-- 5. Ledger kind plan_fee; usage_event records seconds drawn from the allowance.
-- 6. record_usage draws voice seconds from a paid period's allowance first.

alter table app.billing_price add column status text not null default 'owner_placeholder' check(status in('owner_placeholder','final'));
-- Version 2: same unit prices as version 1. whatsapp_conversation is JomCall's
-- own agent fee per conversation; Meta bills its message fees to the business
-- directly (the business connects its own WhatsApp number).
insert into app.billing_price(version,kind,unit_sen,per_quantity,effective_from)values
 (2,'voice_second',32,60,'2026-11-14T00:00:00+08:00'),
 (2,'whatsapp_conversation',15,1,'2026-11-14T00:00:00+08:00'),
 (2,'typed_turn',2,1,'2026-11-14T00:00:00+08:00');

create table app.billing_plan(
 id uuid primary key default gen_random_uuid(),
 version integer not null check(version>0),
 code text not null check(code in('starter','growth','payg')),
 monthly_fee_sen integer not null check(monthly_fee_sen between 0 and 10000000),
 included_voice_seconds integer not null check(included_voice_seconds between 0 and 10000000),
 phone_numbers integer not null check(phone_numbers between 0 and 10),
 whatsapp_agent boolean not null,
 -- Days after the period starts during which an unpaid fee keeps the plan
 -- (phone number included) before it falls back to payg.
 grace_days integer not null check(grace_days between 0 and 31),
 currency text not null default 'MYR' check(currency='MYR'),
 status text not null default 'owner_placeholder' check(status in('owner_placeholder','final')),
 effective_from timestamptz not null,
 created_at timestamptz not null default now(),
 unique(version,code));
-- Owner placeholders (2026-11-14). Voice overage on every plan is the
-- voice_second price of the same version: RM0.32 a minute.
insert into app.billing_plan(version,code,monthly_fee_sen,included_voice_seconds,phone_numbers,whatsapp_agent,grace_days,effective_from)values
 (2,'starter',4900,6000,1,false,7,'2026-11-14T00:00:00+08:00'),
 (2,'growth',12900,24000,1,true,7,'2026-11-14T00:00:00+08:00'),
 (2,'payg',0,0,0,false,0,'2026-11-14T00:00:00+08:00');

create table app.org_plan(
 org_id uuid primary key references app.organization(id) on delete cascade,
 plan_code text not null check(plan_code in('starter','growth','payg')),
 -- Takes effect when the next period starts.
 pending_plan_code text check(pending_plan_code in('starter','growth','payg')),
 -- The organization's start date in Asia/Kuala_Lumpur; periods run from
 -- anchor + k months to anchor + k+1 months.
 anchor_date date not null,
 updated_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now());

create table app.plan_period(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 plan_id uuid not null references app.billing_plan(id),
 plan_code text not null check(plan_code in('starter','growth','payg')),
 period_start date not null,
 period_end date not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 -- Frozen from the plan when the period is created.
 fee_sen integer not null check(fee_sen>=0),
 included_voice_seconds integer not null check(included_voice_seconds>=0),
 phone_numbers integer not null check(phone_numbers>=0),
 whatsapp_agent boolean not null,
 -- free: no fee. charged: fee debited, allowance usable. unpaid: in grace,
 -- no allowance. downgraded: grace ended unpaid, organization moved to payg.
 state text not null check(state in('free','charged','unpaid','downgraded')),
 grace_until timestamptz,
 ledger_id uuid,
 charged_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,period_start),unique(org_id,id),
 check(period_end>period_start and ends_at>starts_at),
 check((state='charged')=(ledger_id is not null)),
 foreign key(org_id,ledger_id) references app.wallet_ledger(org_id,id));
create index plan_period_time on app.plan_period(org_id,starts_at desc);

alter table app.wallet_ledger drop constraint wallet_ledger_kind_check;
alter table app.wallet_ledger add constraint wallet_ledger_kind_check check(kind in('topup','trial_credit','usage','refund','adjustment','plan_fee'));
alter table app.wallet_ledger drop constraint ledger_sign;
alter table app.wallet_ledger add constraint ledger_sign check(
 (kind in('topup','trial_credit') and amount_sen>0) or
 (kind in('usage','refund','plan_fee') and amount_sen<0) or
 (kind='adjustment' and amount_sen<>0));

alter table app.usage_event add column period_id uuid;
alter table app.usage_event add column included_seconds integer not null default 0 check(included_seconds>=0);
alter table app.usage_event add constraint usage_period foreign key(org_id,period_id) references app.plan_period(org_id,id);
alter table app.usage_event add constraint usage_included check(included_seconds<=quantity);
create index usage_by_period on app.usage_event(period_id) where period_id is not null;

grant select on app.billing_plan to jomcall_billing;
grant select,insert,update on app.org_plan,app.plan_period to jomcall_billing;
do $$declare t text;begin
 foreach t in array array['billing_plan','org_plan','plan_period']loop
  execute format('alter table app.%I enable row level security',t);
  execute format('alter table app.%I force row level security',t);
 end loop;
 foreach t in array array['org_plan','plan_period']loop
  execute format('grant select on app.%I to jomcall_app',t);
  execute format('create policy manager_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) in(''owner'',''admin''))',t);
 end loop;
end$$;
grant select on app.billing_plan to jomcall_app;
create policy signed_in_read on app.billing_plan for select to jomcall_app using(app_private.session_active());

-- The period containing p_at, as Kuala Lumpur dates. Each boundary is
-- anchor + k months from the original anchor, so a 31st anchor gives
-- 31 Jan, 28 Feb, 31 Mar and does not drift.
create function app_private.plan_period_bounds(p_anchor date,p_at timestamptz,out period_start date,out period_end date)language plpgsql stable set search_path='' as $$
declare v_day date:=(p_at at time zone 'Asia/Kuala_Lumpur')::date;k integer;begin
 k=(extract(year from v_day)::integer-extract(year from p_anchor)::integer)*12+(extract(month from v_day)::integer-extract(month from p_anchor)::integer);
 if(p_anchor+make_interval(months=>k))::date>v_day then k=k-1;end if;
 period_start=(p_anchor+make_interval(months=>k))::date;
 period_end=(p_anchor+make_interval(months=>k+1))::date;
end$$;

create function app_private.plan_for(p_code text,p_at timestamptz)returns app.billing_plan language plpgsql stable security definer set search_path='' as $$
declare pl app.billing_plan;begin
 select * into pl from app.billing_plan where code=p_code and effective_from<=p_at order by version desc limit 1;
 if not found then raise exception 'UNKNOWN_PLAN';end if;
 return pl;
end$$;

create function app_private.plan_period_json(pp app.plan_period)returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('periodId',pp.id,'plan',pp.plan_code,'periodState',pp.state,'periodStart',pp.period_start,'periodEnd',pp.period_end,
  'feeSen',pp.fee_sen,'includedVoiceSeconds',pp.included_voice_seconds,'graceUntil',pp.grace_until,
  'usedIncludedSeconds',(select coalesce(sum(included_seconds),0) from app.usage_event where org_id=pp.org_id and period_id=pp.id))
$$;

-- Starts (or retries) the period containing p_at. Safe to call any number
-- of times: the fee is debited at most once per organization and period
-- (one ledger key per period row, one row per period start). Never debits
-- the fee into a negative balance.
create function app_private.charge_plan_period(p_org uuid,p_at timestamptz default now())returns jsonb language plpgsql security definer set search_path='' as $$
declare op app.org_plan;pl app.billing_plan;pp app.plan_period;v_start date;v_end date;v_code text;v_balance bigint;v_ledger uuid;v_dup boolean:=true;begin
 if p_org is null or p_at is null then raise exception 'INVALID_PLAN';end if;
 if not exists(select 1 from app.organization where id=p_org)then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 select * into op from app.org_plan where org_id=p_org for update;
 -- No plan chosen: pay as you go, nothing to charge.
 if not found then return jsonb_build_object('plan','payg','periodState','none','duplicate',true)||app_private.wallet_snapshot(p_org);end if;
 select b.period_start,b.period_end into v_start,v_end from app_private.plan_period_bounds(op.anchor_date,p_at)b;
 select * into pp from app.plan_period where org_id=p_org and period_start=v_start for update;
 if not found then
  v_dup=false;
  -- A change requested during the previous period takes effect now.
  v_code=coalesce(op.pending_plan_code,op.plan_code);
  pl=app_private.plan_for(v_code,p_at);
  update app.org_plan set plan_code=v_code,pending_plan_code=null,updated_at=now() where org_id=p_org;
  insert into app.plan_period(org_id,plan_id,plan_code,period_start,period_end,starts_at,ends_at,fee_sen,included_voice_seconds,phone_numbers,whatsapp_agent,state,grace_until)
  values(p_org,pl.id,pl.code,v_start,v_end,v_start::timestamp at time zone 'Asia/Kuala_Lumpur',v_end::timestamp at time zone 'Asia/Kuala_Lumpur',
   pl.monthly_fee_sen,pl.included_voice_seconds,pl.phone_numbers,pl.whatsapp_agent,case when pl.monthly_fee_sen=0 then 'free' else 'unpaid' end,
   case when pl.monthly_fee_sen=0 then null else (v_start::timestamp at time zone 'Asia/Kuala_Lumpur')+make_interval(days=>pl.grace_days) end)
  returning * into pp;
 end if;
 if pp.state='unpaid' then
  select coalesce(sum(amount_sen),0) into v_balance from app.wallet_ledger where org_id=p_org;
  if v_balance>=pp.fee_sen then
   insert into app.wallet_ledger(org_id,kind,amount_sen,reason,idempotency_key)
   values(p_org,'plan_fee',-pp.fee_sen,initcap(pp.plan_code)||' plan, '||pp.period_start||' to '||pp.period_end,'plan_fee:'||pp.id::text)returning id into v_ledger;
   update app.plan_period set state='charged',ledger_id=v_ledger,charged_at=now(),grace_until=null,updated_at=now() where id=pp.id returning * into pp;
   insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(p_org,'billing.plan_charged','plan_period',pp.id,jsonb_build_object('plan',pp.plan_code,'feeSen',pp.fee_sen,'periodStart',pp.period_start));
   v_dup=false;
  elsif p_at>=pp.grace_until then
   -- Grace ended unpaid: the rest of this period and later ones are payg.
   -- A call in progress is never cut; usage keeps billing from the wallet.
   update app.plan_period set state='downgraded',updated_at=now() where id=pp.id returning * into pp;
   update app.org_plan set plan_code='payg',pending_plan_code=null,updated_at=now() where org_id=p_org;
   insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(p_org,'billing.plan_downgraded','plan_period',pp.id,jsonb_build_object('plan',pp.plan_code,'feeSen',pp.fee_sen,'balanceSen',v_balance));
   v_dup=false;
  elsif not v_dup then
   insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(p_org,'billing.plan_unpaid','plan_period',pp.id,jsonb_build_object('plan',pp.plan_code,'feeSen',pp.fee_sen,'balanceSen',v_balance,'graceUntil',pp.grace_until));
  end if;
 end if;
 return app_private.plan_period_json(pp)||jsonb_build_object('duplicate',v_dup)||app_private.wallet_snapshot(p_org);
end$$;

-- For a scheduled job: start or retry the current period of every
-- organization that has chosen a plan.
create function app_private.charge_due_plans(p_at timestamptz default now())returns integer language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;begin
 for r in select org_id from app.org_plan order by org_id loop
  perform app_private.charge_plan_period(r.org_id,p_at);n=n+1;
 end loop;
 return n;
end$$;

-- What the current period allows. Read by other services (phone line,
-- WhatsApp) to decide entitlements; an unpaid period in grace keeps them.
create function app_private.plan_entitlements(p_org uuid,p_at timestamptz default now())returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pp app.plan_period;v_on boolean;begin
 select * into pp from app.plan_period where org_id=p_org and starts_at<=p_at and ends_at>p_at;
 if not found then
  return jsonb_build_object('plan',coalesce((select plan_code from app.org_plan where org_id=p_org),'payg'),'periodState','none','phoneNumbers',0,'whatsappAgent',false,'includedVoiceSeconds',0,'usedIncludedSeconds',0);
 end if;
 v_on=pp.state in('charged','unpaid');
 return app_private.plan_period_json(pp)||jsonb_build_object(
  'phoneNumbers',case when v_on then pp.phone_numbers else 0 end,
  'whatsappAgent',v_on and pp.whatsapp_agent,
  'includedVoiceSeconds',case when pp.state='charged' then pp.included_voice_seconds else 0 end);
end$$;

-- An owner or admin asks for a plan. It takes effect when the next period
-- starts; asking for the current plan cancels a pending change.
create function app_private.choose_plan(p_org uuid,p_code text)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.billing_manager(p_org);op app.org_plan;v_from text;begin
 if p_code is null or p_code not in('starter','growth','payg')then raise exception 'INVALID_PLAN';end if;
 perform app_private.plan_for(p_code,now());
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 select * into op from app.org_plan where org_id=p_org for update;
 if not found then
  insert into app.org_plan(org_id,plan_code,pending_plan_code,anchor_date,updated_by)
  select p_org,'payg',nullif(p_code,'payg'),(o.created_at at time zone 'Asia/Kuala_Lumpur')::date,v_actor from app.organization o where o.id=p_org
  returning * into op;
  v_from='payg';
 else
  v_from=op.plan_code;
  update app.org_plan set pending_plan_code=nullif(p_code,op.plan_code),updated_by=v_actor,updated_at=now() where org_id=p_org returning * into op;
 end if;
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id,metadata)values(p_org,v_actor,'billing.plan_change_requested','organization',p_org,jsonb_build_object('from',v_from,'to',p_code));
 return jsonb_build_object('plan',op.plan_code,'pendingPlan',op.pending_plan_code,'anchorDate',op.anchor_date);
end$$;

create function app_private.plan_summary(p_org uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare op app.org_plan;begin
 perform app_private.billing_manager(p_org);
 select * into op from app.org_plan where org_id=p_org;
 return app_private.plan_entitlements(p_org,now())||jsonb_build_object('pendingPlan',op.pending_plan_code,'anchorDate',op.anchor_date);
end$$;

-- Same signature as before. Voice seconds come from the allowance of a
-- charged period that contains the call first; the rest is billed from the
-- wallet at the voice_second price. Usage during an unpaid period is billed
-- from the wallet; the allowance applies only once the fee has landed.
create or replace function app_private.record_usage(p_org uuid,p_kind text,p_quantity integer,p_key text,p_occurred_at timestamptz default now(),p_ref jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare e app.usage_event;p app.billing_price;pp app.plan_period;v_amount bigint;v_used bigint;v_included integer:=0;begin
 if p_org is null or p_kind is null or p_quantity is null or p_quantity<=0 or p_quantity>10000000 or p_key is null or p_key!~'^[A-Za-z0-9:_.-]{8,200}$' or p_occurred_at is null or octet_length(coalesce(p_ref,'{}')::text)>2048 then raise exception 'INVALID_USAGE';end if;
 if not exists(select 1 from app.organization where id=p_org)then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 select * into e from app.usage_event where org_id=p_org and idempotency_key=p_key;
 if found then
  if e.kind<>p_kind or e.quantity<>p_quantity then raise exception 'CONFLICT';end if;
  return jsonb_build_object('usageEventId',e.id,'amountSen',e.amount_sen,'includedSeconds',e.included_seconds,'duplicate',true)||app_private.wallet_snapshot(p_org);
 end if;
 select * into p from app.billing_price where kind=p_kind and effective_from<=p_occurred_at order by version desc limit 1;
 if not found then raise exception 'UNKNOWN_USAGE_KIND';end if;
 if p_kind='voice_second' then
  select * into pp from app.plan_period where org_id=p_org and state='charged' and starts_at<=p_occurred_at and ends_at>p_occurred_at;
  if found then
   select coalesce(sum(included_seconds),0) into v_used from app.usage_event where org_id=p_org and period_id=pp.id;
   v_included=greatest(0,least(p_quantity::bigint,pp.included_voice_seconds-v_used));
  end if;
 end if;
 v_amount=ceil((p_quantity-v_included)::numeric*p.unit_sen/p.per_quantity);
 if v_amount>2000000000 then raise exception 'INVALID_USAGE';end if;
 insert into app.usage_event(org_id,kind,quantity,idempotency_key,price_id,amount_sen,occurred_at,ref,period_id,included_seconds)
 values(p_org,p_kind,p_quantity,p_key,p.id,v_amount,p_occurred_at,coalesce(p_ref,'{}'),pp.id,v_included)returning * into e;
 if v_amount>0 then
  insert into app.wallet_ledger(org_id,kind,amount_sen,usage_event_id,idempotency_key)values(p_org,'usage',-v_amount,e.id,'usage:'||p_key);
 end if;
 return jsonb_build_object('usageEventId',e.id,'amountSen',e.amount_sen,'includedSeconds',e.included_seconds,'duplicate',false)||app_private.wallet_snapshot(p_org);
end$$;

grant create on schema app_private to jomcall_billing;
do $$declare f text;begin
 foreach f in array array['plan_period_bounds(date,timestamptz)','plan_for(text,timestamptz)','plan_period_json(app.plan_period)',
  'charge_plan_period(uuid,timestamptz)','charge_due_plans(timestamptz)','plan_entitlements(uuid,timestamptz)','choose_plan(uuid,text)','plan_summary(uuid)']loop
  execute format('alter function app_private.%s owner to jomcall_billing',f);
  execute format('revoke all on function app_private.%s from public',f);
 end loop;
end$$;
revoke create on schema app_private from jomcall_billing;
grant execute on function app_private.choose_plan(uuid,text),app_private.plan_summary(uuid) to jomcall_app;
grant execute on function app_private.charge_plan_period(uuid,timestamptz),app_private.charge_due_plans(timestamptz),app_private.plan_entitlements(uuid,timestamptz) to jomcall_worker,postgres;
grant execute on function app_private.plan_entitlements(uuid,timestamptz) to jomcall_agent;
