-- Billing: Curlec (Razorpay Curlec) as the payment provider, chosen by the
-- owner on 2026-11-14.
--
-- A Curlec order can take more than one payment, and refunds can start in the
-- Curlec dashboard as well as from the operator command. So:
-- * a top-up remembers the payment that credited it;
-- * a second captured payment on an already-credited order is never credited
--   again; it is recorded and audited for an operator to refund;
-- * a processed refund debits the wallet exactly once per Curlec refund id.

-- Ownership changes below need CREATE on the schema; revoked again at the end.
grant create on schema app_private to jomcall_billing;

alter table app.billing_topup
  add column provider_payment_ref text check(length(provider_payment_ref) between 1 and 200);
create unique index billing_topup_payment_ref on app.billing_topup(provider,provider_payment_ref)
  where provider_payment_ref is not null;

alter table app.billing_provider_event drop constraint billing_provider_event_source_check;
alter table app.billing_provider_event add constraint billing_provider_event_source_check
  check(source in('callback','reconcile','operator'));
alter table app.billing_provider_event
  add column kind text not null default 'payment' check(kind in('payment','refund'));

drop function app_private.settle_topup(text,text,text,boolean,integer,text,timestamptz,text);

-- p_ref is the order id; p_payment_ref the payment that settled it.
create function app_private.settle_topup(p_provider text,p_ref text,p_payment_ref text,p_event_key text,p_paid boolean,p_amount integer,p_currency text,p_paid_at timestamptz,p_source text)returns jsonb language plpgsql security definer set search_path='' as $$
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
alter function app_private.settle_topup(text,text,text,text,boolean,integer,text,timestamptz,text) owner to jomcall_billing;

-- A refund reported by the provider (webhook, reconciliation or the operator
-- command's own response). Only status 'processed' moves the wallet, once per
-- provider refund id. The full refund is recorded even when it takes the
-- balance below zero: the money has left, so the ledger says so.
create function app_private.settle_refund(p_provider text,p_ref text,p_payment_ref text,p_refund_ref text,p_event_key text,p_status text,p_amount integer,p_currency text,p_source text,p_reason text default null,p_operator text default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.billing_topup;ev app.billing_provider_event;v_outcome text;v_id uuid;v_key text;v_balance bigint;begin
 if p_provider is null or p_ref is null or length(p_ref)>200 or p_payment_ref is null or length(p_payment_ref)>200 or p_refund_ref is null or length(p_refund_ref)>200 or p_event_key is null or length(p_event_key)>200 or p_status not in('created','pending','processed','failed') or p_source not in('callback','reconcile','operator') or length(p_reason)>500 or length(p_operator)>120 then raise exception 'INVALID_EVENT';end if;
 select * into t from app.billing_topup where provider=p_provider and provider_ref=p_ref for update;
 if not found then
  insert into app.billing_provider_event(provider,event_key,source,paid,amount_sen,outcome,kind)values(p_provider,'unmatched:'||p_event_key||':'||gen_random_uuid()::text,p_source,false,p_amount,'unmatched','refund');
  return jsonb_build_object('outcome','unmatched');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||t.org_id::text,0));
 select * into ev from app.billing_provider_event where provider=p_provider and event_key=p_event_key;
 if found then return jsonb_build_object('outcome','duplicate','first',ev.outcome,'topupId',t.id);end if;
 v_key='refund:'||p_provider||':'||p_refund_ref;
 if p_status<>'processed' then
  v_outcome=case when p_status='failed' then 'refund_failed' else 'refund_pending' end;
 elsif exists(select 1 from app.wallet_ledger where org_id=t.org_id and idempotency_key=v_key) then
  v_outcome='already_refunded';
 elsif p_currency is distinct from 'MYR' or p_amount is null or p_amount<=0 then
  v_outcome='mismatch';
  insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.refund_mismatch','billing_topup',t.id,jsonb_build_object('reportedSen',p_amount,'currency',p_currency,'refundRef',p_refund_ref));
 elsif t.provider_payment_ref is distinct from p_payment_ref then
  -- A refund of an extra (never credited) payment: no wallet change.
  v_outcome='extra_payment_refunded';
  insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.extra_payment_refunded','billing_topup',t.id,jsonb_build_object('amountSen',p_amount,'paymentRef',p_payment_ref,'refundRef',p_refund_ref));
 elsif p_amount>t.amount_sen-t.refunded_sen then
  v_outcome='review';
  insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.refund_exceeds_topup','billing_topup',t.id,jsonb_build_object('amountSen',p_amount,'refundedSen',t.refunded_sen,'refundRef',p_refund_ref));
 else
  update app.billing_topup set refunded_sen=refunded_sen+p_amount,updated_at=now() where id=t.id;
  insert into app.wallet_ledger(org_id,kind,amount_sen,topup_id,reason,idempotency_key)values(t.org_id,'refund',-p_amount,t.id,coalesce(nullif(trim(p_reason),''),'Refund at payment provider'),v_key)returning id into v_id;
  v_balance=(app_private.wallet_snapshot(t.org_id)->>'balanceSen')::bigint;
  insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.refunded','billing_topup',t.id,jsonb_build_object('amountSen',p_amount,'provider',p_provider,'refundRef',p_refund_ref,'source',p_source,'operator',nullif(trim(p_operator),''),'balanceSen',v_balance));
  v_outcome='refunded';
 end if;
 insert into app.billing_provider_event(org_id,provider,event_key,topup_id,source,paid,amount_sen,outcome,kind)values(t.org_id,p_provider,p_event_key,t.id,p_source,false,p_amount,v_outcome,'refund');
 return jsonb_build_object('outcome',v_outcome,'topupId',t.id,'ledgerId',v_id);
end$$;
alter function app_private.settle_refund(text,text,text,text,text,text,integer,text,text,text,text) owner to jomcall_billing;

revoke all on function app_private.settle_topup(text,text,text,text,boolean,integer,text,timestamptz,text),
  app_private.settle_refund(text,text,text,text,text,text,integer,text,text,text,text) from public;
grant execute on function app_private.settle_topup(text,text,text,text,boolean,integer,text,timestamptz,text),
  app_private.settle_refund(text,text,text,text,text,text,integer,text,text,text,text) to jomcall_app,postgres;
revoke create on schema app_private from jomcall_billing;
