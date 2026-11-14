-- Follow-up to 20261114150000_billing_wallet.sql.
-- 1. Voice usage is metered in seconds; the kind now says so.
-- 2. A callback that arrives before its top-up is attached is kept under a
--    unique key, so the provider's retry after attach still settles it.
-- 3. Only top-ups from the last 24 hours count toward the pending limit.
-- 4. fail_topup is removed: a failed provider call rolls the top-up back.
update app.billing_price set kind='voice_second' where version=1 and kind='voice_minute';
drop function app_private.fail_topup(uuid,uuid,text);

create or replace function app_private.create_topup(p_org uuid,p_amount integer,p_provider text)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.billing_manager(p_org);t app.billing_topup;begin
 if p_amount is null or p_amount<1000 or p_amount>500000 or p_provider is null or p_provider!~'^[a-z]{3,20}$' then raise exception 'INVALID_TOPUP';end if;
 if(select count(*)from app.billing_topup where org_id=p_org and state in('created','pending')and created_at>now()-interval '24 hours')>=5 then raise exception 'TOO_MANY_PENDING';end if;
 insert into app.billing_topup(org_id,provider,amount_sen,created_by)values(p_org,p_provider,p_amount,v_actor)returning * into t;
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id,metadata)values(p_org,v_actor,'billing.topup_created','billing_topup',t.id,jsonb_build_object('amountSen',p_amount,'provider',p_provider));
 return to_jsonb(t);
end$$;

create or replace function app_private.settle_topup(p_provider text,p_ref text,p_event_key text,p_paid boolean,p_amount integer,p_currency text,p_paid_at timestamptz,p_source text)returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.billing_topup;ev app.billing_provider_event;v_outcome text;v_ledger uuid;v_number text;begin
 if p_provider is null or p_ref is null or length(p_ref)>200 or p_event_key is null or length(p_event_key)>200 or p_paid is null or p_source not in('callback','reconcile')then raise exception 'INVALID_EVENT';end if;
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
  if t.state='paid' then v_outcome='already_paid';
  elsif t.state='review' then v_outcome='review';
  else
   update app.billing_topup set state='paid',paid_at=coalesce(p_paid_at,now()),failure_code=null,updated_at=now() where id=t.id;
   insert into app.wallet_ledger(org_id,kind,amount_sen,topup_id,actor_id,idempotency_key)values(t.org_id,'topup',t.amount_sen,t.id,t.created_by,'topup:'||t.id::text)returning id into v_ledger;
   v_number='JC-'||to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY')||'-'||lpad(nextval('app.billing_receipt_number')::text,6,'0');
   insert into app.billing_receipt(org_id,topup_id,number,amount_sen,buyer_name,provider,provider_ref)select t.org_id,t.id,v_number,t.amount_sen,o.name,t.provider,t.provider_ref from app.organization o where o.id=t.org_id;
   insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(t.org_id,'billing.topup_paid','billing_topup',t.id,jsonb_build_object('amountSen',t.amount_sen,'provider',t.provider,'source',p_source,'receipt',v_number));
   v_outcome='credited';
  end if;
 else
  -- A failed attempt leaves the bill payable; a later paid result still credits.
  if t.state='pending' then
   update app.billing_topup set state='failed',failure_code='PAYMENT_NOT_COMPLETED',updated_at=now() where id=t.id;v_outcome='failed';
  else v_outcome='ignored';end if;
 end if;
 insert into app.billing_provider_event(org_id,provider,event_key,topup_id,source,paid,amount_sen,outcome)values(t.org_id,p_provider,p_event_key,t.id,p_source,p_paid,p_amount,v_outcome);
 return jsonb_build_object('outcome',v_outcome,'topupId',t.id);
end$$;
