-- Plan picker (owner decisions 2026-11-16).
--
-- 1. A first paid plan starts at once: the monthly date becomes today
--    (Kuala Lumpur), the full fee is debited now, and nothing starts when
--    the wallet does not hold the fee (no grace on a first pick). "First"
--    means the organization is on pay as you go right now, which includes
--    one that fell back after an unpaid period.
-- 2. A change between paid plans, or down to pay as you go, still waits for
--    the next period (unchanged).
-- 3. A credited top-up retries an unpaid plan fee in the same transaction.
-- 4. The scheduled run keeps going when one organization fails.
--
-- Every function keeps its signature, owner and grants.

-- An owner or admin asks for a plan. Returns what happened in `outcome`:
--   started       a first paid plan began now and its fee was debited
--   wallet_short  a first paid plan was not started; neededSen, balanceSen
--   scheduled     the change takes effect when the next period starts
--   cancelled     a pending change was dropped
--   unchanged     nothing to do
create or replace function app_private.choose_plan(p_org uuid,p_code text)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.billing_manager(p_org);op app.org_plan;pl app.billing_plan;pp app.plan_period;r jsonb;
 v_from text;v_outcome text;v_balance bigint;v_today date;v_midnight timestamptz;v_start date;v_end date;begin
 if p_code is null or p_code not in('starter','growth','payg')then raise exception 'INVALID_PLAN';end if;
 pl=app_private.plan_for(p_code,now());
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 -- Bring the current period up to date first (a fee that is due, a grace
 -- that has ended), so the choice is made against the true state.
 -- A row the earlier rule left on pay as you go with a paid plan waiting
 -- is a first pick too: drop the waiting plan so it cannot start in grace.
 update app.org_plan set pending_plan_code=null,updated_at=now() where org_id=p_org and plan_code='payg' and pending_plan_code is not null;
 if exists(select 1 from app.org_plan where org_id=p_org)then perform app_private.charge_plan_period(p_org,now());end if;
 select * into op from app.org_plan where org_id=p_org for update;
 v_from=coalesce(op.plan_code,'payg');
 if v_from='payg' and pl.monthly_fee_sen>0 then
  select coalesce(sum(amount_sen),0) into v_balance from app.wallet_ledger where org_id=p_org;
  if v_balance<pl.monthly_fee_sen then
   return jsonb_build_object('outcome','wallet_short','plan','payg','pendingPlan',null,'anchorDate',op.anchor_date,
    'neededSen',pl.monthly_fee_sen,'balanceSen',v_balance);
  end if;
  v_today=(now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_midnight=v_today::timestamp at time zone 'Asia/Kuala_Lumpur';
  -- The pay-as-you-go period that was running ends today, so two periods
  -- never cover the same moment.
  update app.plan_period set period_end=v_today,ends_at=v_midnight,updated_at=now()
   where org_id=p_org and period_start<v_today and ends_at>v_midnight;
  -- One that began today becomes the new plan's period in place.
  select b.period_start,b.period_end into v_start,v_end from app_private.plan_period_bounds(v_today,now())b;
  update app.plan_period set plan_id=pl.id,plan_code=pl.code,period_end=v_end,ends_at=v_end::timestamp at time zone 'Asia/Kuala_Lumpur',
    fee_sen=pl.monthly_fee_sen,included_voice_seconds=pl.included_voice_seconds,phone_numbers=pl.phone_numbers,whatsapp_agent=pl.whatsapp_agent,
    state='unpaid',grace_until=v_midnight+make_interval(days=>pl.grace_days),updated_at=now()
   where org_id=p_org and period_start=v_today and state in('free','downgraded');
  insert into app.org_plan(org_id,plan_code,pending_plan_code,anchor_date,updated_by)values(p_org,p_code,null,v_today,v_actor)
   on conflict(org_id)do update set plan_code=excluded.plan_code,pending_plan_code=null,anchor_date=excluded.anchor_date,updated_by=excluded.updated_by,updated_at=now()
   returning * into op;
  r=app_private.charge_plan_period(p_org,now());
  -- The balance was checked under the wallet lock, so the fee must have landed.
  if r->>'periodState' is distinct from 'charged' then raise exception 'PLAN_START_FAILED';end if;
  insert into app.audit_log(org_id,actor_id,action,target_type,target_id,metadata)values(p_org,v_actor,'billing.plan_started','organization',p_org,jsonb_build_object('from',v_from,'to',p_code,'feeSen',pl.monthly_fee_sen));
  return jsonb_build_object('outcome','started','plan',op.plan_code,'pendingPlan',null,'anchorDate',op.anchor_date);
 end if;
 if op.org_id is null then
  -- Pay as you go asked for with no plan row yet: record it, nothing to charge.
  insert into app.org_plan(org_id,plan_code,pending_plan_code,anchor_date,updated_by)
  select p_org,'payg',null,(o.created_at at time zone 'Asia/Kuala_Lumpur')::date,v_actor from app.organization o where o.id=p_org
  returning * into op;
  v_outcome='unchanged';
 else
  v_outcome=case when p_code=op.plan_code and op.pending_plan_code is null then 'unchanged'
   when p_code=op.plan_code then 'cancelled' else 'scheduled' end;
  update app.org_plan set pending_plan_code=nullif(p_code,op.plan_code),updated_by=v_actor,updated_at=now() where org_id=p_org returning * into op;
 end if;
 if v_outcome<>'unchanged' then
  insert into app.audit_log(org_id,actor_id,action,target_type,target_id,metadata)values(p_org,v_actor,'billing.plan_change_requested','organization',p_org,jsonb_build_object('from',v_from,'to',p_code,'outcome',v_outcome));
 end if;
 return jsonb_build_object('outcome',v_outcome,'plan',op.plan_code,'pendingPlan',op.pending_plan_code,'anchorDate',op.anchor_date);
end$$;

-- What the wallet screen shows: the current period, a pending change, the
-- balance and the plans on offer (latest version in force).
create or replace function app_private.plan_summary(p_org uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare op app.org_plan;begin
 perform app_private.billing_manager(p_org);
 select * into op from app.org_plan where org_id=p_org;
 return app_private.plan_entitlements(p_org,now())||jsonb_build_object('pendingPlan',op.pending_plan_code,'anchorDate',op.anchor_date,
  'balanceSen',(select coalesce(sum(amount_sen),0) from app.wallet_ledger where org_id=p_org),
  'plans',(select coalesce(jsonb_agg(jsonb_build_object('code',p.code,'feeSen',p.monthly_fee_sen,'includedVoiceSeconds',p.included_voice_seconds,
    'phoneNumbers',p.phone_numbers,'whatsappAgent',p.whatsapp_agent,'graceDays',p.grace_days)order by p.monthly_fee_sen desc),'[]'::jsonb)
   from app.billing_plan p where p.effective_from<=now() and p.version=(select max(version) from app.billing_plan where effective_from<=now())));
end$$;

-- For the scheduled job: start or retry the current period of every
-- organization that has chosen a plan. One organization's failure (a
-- deadlock with a call starting, a bad row) is rolled back alone and does
-- not stop the rest; the next run retries it. Returns how many succeeded.
create or replace function app_private.charge_due_plans(p_at timestamptz default now())returns integer language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;v_failed integer:=0;begin
 for r in select org_id from app.org_plan order by org_id loop
  begin
   perform app_private.charge_plan_period(r.org_id,p_at);n=n+1;
  exception when others then
   v_failed=v_failed+1;
   raise warning 'PLAN_CHARGE_FAILED %',sqlstate;
  end;
 end loop;
 if v_failed>0 then raise warning 'PLAN_CHARGE_RUN failed=% ok=%',v_failed,n;end if;
 return n;
end$$;

-- p_ref is the order id; p_payment_ref the payment that settled it. Same
-- body as before plus one step: after a credit, an unpaid plan fee is
-- retried in this transaction. A failure of that step never undoes the
-- credit; the scheduled run retries the fee.
create or replace function app_private.settle_topup(p_provider text,p_ref text,p_payment_ref text,p_event_key text,p_paid boolean,p_amount integer,p_currency text,p_paid_at timestamptz,p_source text)returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.billing_topup;ev app.billing_provider_event;v_outcome text;v_ledger uuid;v_number text;begin
 if p_provider is null or p_ref is null or length(p_ref)>200 or length(p_payment_ref)>200 or p_event_key is null or length(p_event_key)>200 or p_paid is null or p_source not in('callback','reconcile')then raise exception 'INVALID_EVENT';end if;
 if p_paid and p_payment_ref is null then raise exception 'INVALID_EVENT';end if;
 select * into t from app.billing_topup where provider=p_provider and provider_ref=p_ref for update;
 if not found then
  insert into app.billing_provider_event(provider,event_key,source,paid,amount_sen,outcome)values(p_provider,'unmatched:'||p_event_key||':'||gen_random_uuid()::text,p_source,p_paid,p_amount,'unmatched');
  return jsonb_build_object('outcome','unmatched');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||t.org_id::text,0));
 select * into ev from app.billing_provider_event where provider=p_provider and event_key=p_event_key;
 if found then return jsonb_build_object('outcome','duplicate','first',ev.outcome,'topupId',t.id);end if;
 if p_currency is distinct from 'MYR' or(p_paid and p_amount is distinct from t.amount_sen)then
  v_outcome='mismatch';
  if t.state<>'paid' then update app.billing_topup set state='review',failure_code='AMOUNT_MISMATCH',updated_at=now() where id=t.id;end if;
  insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.topup_mismatch','billing_topup',t.id,jsonb_build_object('expectedSen',t.amount_sen,'reportedSen',p_amount,'currency',p_currency));
 elsif p_paid then
  if t.state='paid' then
   if t.provider_payment_ref is distinct from p_payment_ref then
    -- Money taken twice for one top-up: never a second credit; an operator refunds it.
    v_outcome='extra_payment';
    insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.topup_extra_payment','billing_topup',t.id,jsonb_build_object('amountSen',p_amount,'paymentRef',p_payment_ref));
   else v_outcome='already_paid';end if;
  elsif t.state='review' then v_outcome='review';
  else
   update app.billing_topup set state='paid',paid_at=coalesce(p_paid_at,now()),provider_payment_ref=p_payment_ref,failure_code=null,updated_at=now() where id=t.id;
   insert into app.wallet_ledger(org_id,kind,amount_sen,topup_id,actor_id,idempotency_key)values(t.org_id,'topup',t.amount_sen,t.id,t.created_by,'topup:'||t.id::text)returning id into v_ledger;
   v_number='JC-'||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY')||'-'||lpad(nextval('app.billing_receipt_number')::text,6,'0');
   insert into app.billing_receipt(org_id,topup_id,number,amount_sen,buyer_name,provider,provider_ref)select t.org_id,t.id,v_number,t.amount_sen,o.name,t.provider,t.provider_ref from app.organization o where o.id=t.org_id;
   insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.topup_paid','billing_topup',t.id,jsonb_build_object('amountSen',t.amount_sen,'provider',t.provider,'source',p_source,'receipt',v_number));
   v_outcome='credited';
   -- Retry a plan fee that was waiting for money.
   if exists(select 1 from app.plan_period where org_id=t.org_id and state='unpaid')then
    begin
     perform app_private.charge_plan_period(t.org_id,now());
    exception when others then
     insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.plan_retry_failed','billing_topup',t.id,jsonb_build_object('sqlstate',sqlstate));
    end;
   end if;
  end if;
 else
  -- A failed attempt leaves the order payable; a later captured payment still credits.
  if t.state='pending' then
   update app.billing_topup set state='failed',failure_code='PAYMENT_NOT_COMPLETED',updated_at=now() where id=t.id;v_outcome='failed';
  else v_outcome='ignored';end if;
 end if;
 insert into app.billing_provider_event(org_id,provider,event_key,topup_id,source,paid,amount_sen,outcome)values(t.org_id,p_provider,p_event_key,t.id,p_source,p_paid,p_amount,v_outcome);
 return jsonb_build_object('outcome',v_outcome,'topupId',t.id);
end$$;

-- Starts (or retries) the period containing p_at. Same rules as before
-- (fee debited at most once per organization and period, never into a
-- negative balance) with two additions for the plan picker:
--   * No period is ever created before the monthly date. A first pick moves
--     that date to today; a caller whose clock is a little behind (a
--     transaction that began before midnight) is given today's period
--     instead of a backdated one with its own fee.
--   * A paid plan waiting on a pay-as-you-go row is never started here: it
--     is dropped and the owner picks the plan, which starts it today.
create or replace function app_private.charge_plan_period(p_org uuid,p_at timestamptz default now())returns jsonb language plpgsql security definer set search_path='' as $$
declare op app.org_plan;pl app.billing_plan;pp app.plan_period;v_start date;v_end date;v_code text;v_balance bigint;v_ledger uuid;v_dup boolean:=true;v_at timestamptz;begin
 if p_org is null or p_at is null then raise exception 'INVALID_PLAN';end if;
 if not exists(select 1 from app.organization where id=p_org)then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 select * into op from app.org_plan where org_id=p_org for update;
 -- No plan chosen: pay as you go, nothing to charge.
 if not found then return jsonb_build_object('plan','payg','periodState','none','duplicate',true)||app_private.wallet_snapshot(p_org);end if;
 v_at=greatest(p_at,op.anchor_date::timestamp at time zone 'Asia/Kuala_Lumpur');
 select b.period_start,b.period_end into v_start,v_end from app_private.plan_period_bounds(op.anchor_date,v_at)b;
 select * into pp from app.plan_period where org_id=p_org and period_start=v_start for update;
 if not found then
  v_dup=false;
  if op.plan_code='payg' and op.pending_plan_code is not null and op.pending_plan_code<>'payg' then
   -- Left by the earlier rule or by an operator. Starting it here would
   -- charge a full fee for a period that began on the old monthly date and
   -- may be nearly over, so it is dropped: the owner picks the plan, which
   -- starts it today.
   insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(p_org,'billing.plan_start_skipped','organization',p_org,jsonb_build_object('plan',op.pending_plan_code));
   op.pending_plan_code=null;
  end if;
  -- A change requested during the previous period takes effect now.
  v_code=coalesce(op.pending_plan_code,op.plan_code);
  pl=app_private.plan_for(v_code,v_at);
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
  elsif v_at>=pp.grace_until then
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

-- For the scheduled job: the organizations whose plan needs attention at
-- p_at, which are those with no period covering p_at yet or with an unpaid
-- one. The job then charges each in its own short transaction, so one
-- organization's wallet lock is never held while another is processed.
drop function if exists app_private.plan_orgs_due(timestamptz);
create function app_private.plan_orgs_due(p_at timestamptz default now())returns setof uuid language sql stable security definer set search_path='' as $$
 select op.org_id from app.org_plan op
 where not exists(select 1 from app.plan_period pp where pp.org_id=op.org_id and pp.starts_at<=p_at and pp.ends_at>p_at and pp.state<>'unpaid')
 order by op.org_id
$$;
grant create on schema app_private to jomcall_billing;
alter function app_private.plan_orgs_due(timestamptz) owner to jomcall_billing;
revoke create on schema app_private from jomcall_billing;
revoke all on function app_private.plan_orgs_due(timestamptz) from public;
grant execute on function app_private.plan_orgs_due(timestamptz) to jomcall_worker,postgres;
