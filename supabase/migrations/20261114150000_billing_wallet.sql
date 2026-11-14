-- Prepaid MYR wallet: append-only ledger, usage metering, price versions,
-- top-ups through a payment provider, receipts. Design:
-- docs/superpowers/specs/2026-11-14-billing-design.md
-- Every write goes through a function in app_private owned by jomcall_billing.
-- No login role holds insert, update or delete on these tables.
do $$begin
 if not exists(select from pg_roles where rolname='jomcall_billing')then create role jomcall_billing nologin noinherit bypassrls;end if;
end$$;
grant jomcall_billing to postgres;
grant usage on schema app,app_private to jomcall_billing;
grant create on schema app_private to jomcall_billing;
grant execute on function app_private.active_role(uuid) to jomcall_billing;
grant select on app.organization,app.member to jomcall_billing;
grant insert on app.audit_log to jomcall_billing;

-- Platform price table. A change is a new version; rows are never edited.
-- amount = ceil(quantity * unit_sen / per_quantity), in whole sen per event.
create table app.billing_price(
 id uuid primary key default gen_random_uuid(),
 version integer not null check(version>0),
 kind text not null check(kind~'^[a-z][a-z0-9_]{1,40}$'),
 unit_sen integer not null check(unit_sen>=0),
 per_quantity integer not null check(per_quantity>0),
 currency text not null default 'MYR' check(currency='MYR'),
 effective_from timestamptz not null,
 created_at timestamptz not null default now(),
 unique(version,kind));
-- Version 1 is provisional (owner decides final prices). voice_minute is
-- metered in seconds: 32 sen per 60 seconds.
insert into app.billing_price(version,kind,unit_sen,per_quantity,effective_from)values
 (1,'voice_minute',32,60,'2026-01-01T00:00:00+08:00'),
 (1,'whatsapp_conversation',15,1,'2026-01-01T00:00:00+08:00'),
 (1,'typed_turn',2,1,'2026-01-01T00:00:00+08:00');

create table app.usage_event(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 kind text not null,
 quantity integer not null check(quantity>0),
 idempotency_key text not null check(idempotency_key~'^[A-Za-z0-9:_.-]{8,200}$'),
 price_id uuid not null references app.billing_price(id),
 amount_sen integer not null check(amount_sen>=0),
 currency text not null default 'MYR' check(currency='MYR'),
 occurred_at timestamptz not null,
 ref jsonb not null default '{}' check(octet_length(ref::text)<=2048),
 created_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,idempotency_key));

create table app.billing_topup(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 provider text not null check(provider~'^[a-z]{3,20}$'),
 amount_sen integer not null check(amount_sen between 1000 and 500000),
 currency text not null default 'MYR' check(currency='MYR'),
 state text not null default 'created' check(state in('created','pending','paid','failed','expired','review')),
 provider_ref text check(length(provider_ref) between 1 and 200),
 checkout_url text check(checkout_url~'^https?://' and length(checkout_url)<=2000),
 refunded_sen integer not null default 0 check(refunded_sen>=0 and refunded_sen<=amount_sen),
 failure_code text,
 created_by uuid not null,
 paid_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id),unique(provider,provider_ref));

-- The wallet. One row per movement; the balance is sum(amount_sen).
create table app.wallet_ledger(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 kind text not null check(kind in('topup','trial_credit','usage','refund','adjustment')),
 amount_sen integer not null,
 currency text not null default 'MYR' check(currency='MYR'),
 usage_event_id uuid,
 topup_id uuid,
 reason text check(length(reason) between 3 and 500),
 actor_id uuid,
 idempotency_key text not null check(length(idempotency_key) between 8 and 220),
 created_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,idempotency_key),
 foreign key(org_id,usage_event_id) references app.usage_event(org_id,id),
 foreign key(org_id,topup_id) references app.billing_topup(org_id,id),
 constraint ledger_sign check(
  (kind in('topup','trial_credit') and amount_sen>0) or
  (kind in('usage','refund') and amount_sen<0) or
  (kind='adjustment' and amount_sen<>0)),
 constraint ledger_links check(
  (kind='usage')=(usage_event_id is not null) and
  (kind in('topup','refund'))=(topup_id is not null)),
 constraint ledger_reason check(kind not in('adjustment','refund') or reason is not null));
create unique index ledger_one_usage on app.wallet_ledger(org_id,usage_event_id) where usage_event_id is not null;
create unique index ledger_one_topup on app.wallet_ledger(org_id,topup_id) where kind='topup';
create unique index ledger_one_trial on app.wallet_ledger(org_id) where kind='trial_credit';
create unique index ledger_trial_actor on app.wallet_ledger(actor_id) where kind='trial_credit';
create index ledger_timeline on app.wallet_ledger(org_id,created_at desc,id desc);
create index usage_timeline on app.usage_event(org_id,created_at desc,id desc);
create index topup_timeline on app.billing_topup(org_id,created_at desc,id desc);

-- One row per provider callback or reconciliation result; the unique key is
-- what makes a replayed callback a no-op. No payer details are stored.
create table app.billing_provider_event(
 id uuid primary key default gen_random_uuid(),
 org_id uuid references app.organization(id) on delete cascade,
 provider text not null,
 event_key text not null check(length(event_key) between 1 and 300),
 topup_id uuid,
 source text not null check(source in('callback','reconcile')),
 paid boolean not null,
 amount_sen integer,
 outcome text not null,
 received_at timestamptz not null default now(),
 unique(provider,event_key));

create sequence app.billing_receipt_number;
create table app.billing_receipt(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 topup_id uuid not null,
 number text not null unique,
 amount_sen integer not null check(amount_sen>0),
 tax_sen integer not null default 0 check(tax_sen>=0),
 currency text not null default 'MYR' check(currency='MYR'),
 buyer_name text not null,
 provider text not null,
 provider_ref text not null,
 einvoice_state text not null default 'not_submitted' check(einvoice_state in('not_submitted','submitted','validated','rejected')),
 issued_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,topup_id),
 foreign key(org_id,topup_id) references app.billing_topup(org_id,id));

-- Append-only at the database level, for every role including the owner.
-- A delete passes only while the organization itself is being deleted.
create function app_private.billing_immutable()returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='DELETE' and not exists(select 1 from app.organization where id=old.org_id)then return old;end if;
 raise exception 'APPEND_ONLY' using errcode='42501';
end$$;
create function app_private.billing_no_truncate()returns trigger language plpgsql set search_path='' as $$begin
 raise exception 'APPEND_ONLY' using errcode='42501';
end$$;
create trigger append_only before update or delete on app.wallet_ledger for each row execute function app_private.billing_immutable();
create trigger append_only before update or delete on app.usage_event for each row execute function app_private.billing_immutable();
create trigger append_only before update or delete on app.billing_receipt for each row execute function app_private.billing_immutable();
create trigger append_only before update or delete on app.billing_provider_event for each row execute function app_private.billing_immutable();
create trigger no_truncate before truncate on app.wallet_ledger for each statement execute function app_private.billing_no_truncate();
create trigger no_truncate before truncate on app.usage_event for each statement execute function app_private.billing_no_truncate();
create trigger no_truncate before truncate on app.billing_receipt for each statement execute function app_private.billing_no_truncate();

grant select,insert on app.wallet_ledger,app.usage_event,app.billing_receipt,app.billing_provider_event to jomcall_billing;
grant select,insert,update on app.billing_topup to jomcall_billing;
grant select on app.billing_price to jomcall_billing;
grant usage on sequence app.billing_receipt_number to jomcall_billing;

do $$declare t text;begin
 foreach t in array array['wallet_ledger','usage_event','billing_topup','billing_receipt','billing_provider_event','billing_price']loop
  execute format('alter table app.%I enable row level security',t);
  execute format('alter table app.%I force row level security',t);
 end loop;
 -- Only the owner and admins of an organization read its billing records.
 foreach t in array array['wallet_ledger','usage_event','billing_topup','billing_receipt']loop
  execute format('grant select on app.%I to jomcall_app',t);
  execute format('create policy manager_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) in(''owner'',''admin''))',t);
 end loop;
end$$;
grant select on app.billing_price to jomcall_app;
create policy signed_in_read on app.billing_price for select to jomcall_app using(app_private.session_active());

-- Balance and service state. Thresholds are fixed here on purpose: a change
-- is a reviewed migration. low: at or under RM10. grace: down to -RM5.
create function app_private.wallet_snapshot(p_org uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_balance bigint;v_rows bigint;v_state text;begin
 select coalesce(sum(amount_sen),0),count(*)into v_balance,v_rows from app.wallet_ledger where org_id=p_org;
 v_state=case when v_rows=0 then 'unfunded' when v_balance>1000 then 'ok' when v_balance>0 then 'low' when v_balance>-500 then 'grace' else 'exhausted' end;
 return jsonb_build_object('balanceSen',v_balance,'currency','MYR','state',v_state,'serviceAllowed',v_state in('ok','low','grace'),'lowThresholdSen',1000,'graceFloorSen',-500);
end$$;

-- The one function other services call to meter usage. Safe to call again
-- with the same key: the first call bills, later calls return it.
-- voice_minute: quantity is seconds. Other kinds: quantity is a count.
create function app_private.record_usage(p_org uuid,p_kind text,p_quantity integer,p_key text,p_occurred_at timestamptz default now(),p_ref jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare e app.usage_event;p app.billing_price;v_amount bigint;begin
 if p_org is null or p_kind is null or p_quantity is null or p_quantity<=0 or p_quantity>10000000 or p_key is null or p_key!~'^[A-Za-z0-9:_.-]{8,200}$' or p_occurred_at is null or octet_length(coalesce(p_ref,'{}')::text)>2048 then raise exception 'INVALID_USAGE';end if;
 if not exists(select 1 from app.organization where id=p_org)then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 select * into e from app.usage_event where org_id=p_org and idempotency_key=p_key;
 if found then
  if e.kind<>p_kind or e.quantity<>p_quantity then raise exception 'CONFLICT';end if;
  return jsonb_build_object('usageEventId',e.id,'amountSen',e.amount_sen,'duplicate',true)||app_private.wallet_snapshot(p_org);
 end if;
 select * into p from app.billing_price where kind=p_kind and effective_from<=p_occurred_at order by version desc limit 1;
 if not found then raise exception 'UNKNOWN_USAGE_KIND';end if;
 v_amount=ceil(p_quantity::numeric*p.unit_sen/p.per_quantity);
 if v_amount>2000000000 then raise exception 'INVALID_USAGE';end if;
 insert into app.usage_event(org_id,kind,quantity,idempotency_key,price_id,amount_sen,occurred_at,ref)values(p_org,p_kind,p_quantity,p_key,p.id,v_amount,p_occurred_at,coalesce(p_ref,'{}'))returning * into e;
 if v_amount>0 then
  insert into app.wallet_ledger(org_id,kind,amount_sen,usage_event_id,idempotency_key)values(p_org,'usage',-v_amount,e.id,'usage:'||p_key);
 end if;
 return jsonb_build_object('usageEventId',e.id,'amountSen',e.amount_sen,'duplicate',false)||app_private.wallet_snapshot(p_org);
end$$;

-- For workers deciding whether to take a new call or conversation.
create function app_private.wallet_state(p_org uuid)returns jsonb language sql stable security definer set search_path='' as $$
 select app_private.wallet_snapshot(p_org)
$$;

create function app_private.billing_manager(p_org uuid)returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_role text:=app_private.active_role(p_org);begin
 if v_role is null then raise exception 'NOT_FOUND';end if;
 if v_role not in('owner','admin')then raise exception 'FORBIDDEN';end if;
 return nullif(current_setting('app.user_id',true),'')::uuid;
end$$;

create function app_private.wallet_summary(p_org uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform app_private.billing_manager(p_org);
 return app_private.wallet_snapshot(p_org)||jsonb_build_object('trialClaimed',exists(select 1 from app.wallet_ledger where org_id=p_org and kind='trial_credit'),'trialCreditSen',2000);
end$$;

-- RM20 once per organization and once per claiming user.
create function app_private.claim_trial(p_org uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.billing_manager(p_org);v_id uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 if exists(select 1 from app.wallet_ledger where kind='trial_credit' and(org_id=p_org or actor_id=v_actor))then raise exception 'TRIAL_USED';end if;
 insert into app.wallet_ledger(org_id,kind,amount_sen,actor_id,idempotency_key)values(p_org,'trial_credit',2000,v_actor,'trial:'||p_org::text)returning id into v_id;
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id,metadata)values(p_org,v_actor,'billing.trial_claimed','wallet_ledger',v_id,jsonb_build_object('amountSen',2000));
 return jsonb_build_object('id',v_id);
end$$;

create function app_private.create_topup(p_org uuid,p_amount integer,p_provider text)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.billing_manager(p_org);t app.billing_topup;begin
 if p_amount is null or p_amount<1000 or p_amount>500000 or p_provider is null or p_provider!~'^[a-z]{3,20}$' then raise exception 'INVALID_TOPUP';end if;
 if(select count(*)from app.billing_topup where org_id=p_org and state in('created','pending'))>=5 then raise exception 'TOO_MANY_PENDING';end if;
 insert into app.billing_topup(org_id,provider,amount_sen,created_by)values(p_org,p_provider,p_amount,v_actor)returning * into t;
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id,metadata)values(p_org,v_actor,'billing.topup_created','billing_topup',t.id,jsonb_build_object('amountSen',p_amount,'provider',p_provider));
 return to_jsonb(t);
end$$;

create function app_private.attach_topup(p_org uuid,p_id uuid,p_ref text,p_url text)returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.billing_topup;begin
 perform app_private.billing_manager(p_org);
 select * into t from app.billing_topup where org_id=p_org and id=p_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if t.state<>'created' then raise exception 'CONFLICT';end if;
 update app.billing_topup set state='pending',provider_ref=p_ref,checkout_url=p_url,updated_at=now() where id=t.id returning * into t;
 return to_jsonb(t);
end$$;

create function app_private.fail_topup(p_org uuid,p_id uuid,p_code text)returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.billing_topup;begin
 perform app_private.billing_manager(p_org);
 update app.billing_topup set state='failed',failure_code=case when p_code~'^[A-Z_]{1,60}$' then p_code else 'PROVIDER_ERROR' end,updated_at=now() where org_id=p_org and id=p_id and state='created' returning * into t;
 if not found then raise exception 'CONFLICT';end if;
 return to_jsonb(t);
end$$;

-- Applies one provider result (callback or reconciliation) to a top-up.
-- The caller has already verified the provider's signature. A paid result
-- credits the wallet exactly once; replays and late failures change nothing.
create function app_private.settle_topup(p_provider text,p_ref text,p_event_key text,p_paid boolean,p_amount integer,p_currency text,p_paid_at timestamptz,p_source text)returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.billing_topup;ev app.billing_provider_event;v_outcome text;v_ledger uuid;v_number text;begin
 if p_provider is null or p_ref is null or p_event_key is null or p_paid is null or p_source not in('callback','reconcile')then raise exception 'INVALID_EVENT';end if;
 select * into t from app.billing_topup where provider=p_provider and provider_ref=p_ref for update;
 if not found then
  insert into app.billing_provider_event(provider,event_key,source,paid,amount_sen,outcome)values(p_provider,p_event_key,p_source,p_paid,p_amount,'unmatched')on conflict do nothing;
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
  if t.state='pending' then
   update app.billing_topup set state='failed',failure_code='PAYMENT_NOT_COMPLETED',updated_at=now() where id=t.id;v_outcome='failed';
  else v_outcome='ignored';end if;
 end if;
 insert into app.billing_provider_event(org_id,provider,event_key,topup_id,source,paid,amount_sen,outcome)values(t.org_id,p_provider,p_event_key,t.id,p_source,p_paid,p_amount,v_outcome);
 return jsonb_build_object('outcome',v_outcome,'topupId',t.id);
end$$;

-- Unpaid top-ups stop being payable after p_hours; a later paid result is
-- still credited by settle_topup.
create function app_private.expire_topups(p_hours integer default 24)returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;begin
 if p_hours is null or p_hours<1 then raise exception 'INVALID_EVENT';end if;
 update app.billing_topup set state='expired',updated_at=now() where state in('created','pending')and created_at<now()-p_hours*interval '1 hour';
 get diagnostics v_count=row_count;return v_count;
end$$;

-- Operator actions. Not granted to any application role: run them from an
-- administrative connection (npm run billing:admin). Each needs a reason
-- and the operator's name, and leaves an audit record.
create function app_private.admin_adjust(p_org uuid,p_amount integer,p_reason text,p_operator text,p_key text)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid;begin
 if p_amount is null or p_amount=0 or abs(p_amount)>500000 or p_reason is null or length(trim(p_reason))<3 or length(p_reason)>500 or p_operator is null or length(trim(p_operator))<2 or length(p_operator)>120 or p_key is null or p_key!~'^[A-Za-z0-9:_.-]{8,200}$' then raise exception 'INVALID_ADJUSTMENT';end if;
 if not exists(select 1 from app.organization where id=p_org)then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 select id into v_id from app.wallet_ledger where org_id=p_org and idempotency_key='adjust:'||p_key;
 if found then return jsonb_build_object('id',v_id,'duplicate',true)||app_private.wallet_snapshot(p_org);end if;
 insert into app.wallet_ledger(org_id,kind,amount_sen,reason,idempotency_key)values(p_org,'adjustment',p_amount,trim(p_reason),'adjust:'||p_key)returning id into v_id;
 insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(p_org,'billing.adjusted','wallet_ledger',v_id,jsonb_build_object('amountSen',p_amount,'reason',trim(p_reason),'operator',trim(p_operator)));
 return jsonb_build_object('id',v_id,'duplicate',false)||app_private.wallet_snapshot(p_org);
end$$;

-- Records that money was returned to the payer for a paid top-up. Moving
-- the money itself happens at the provider. Spent credit cannot be refunded.
create function app_private.admin_refund(p_org uuid,p_topup uuid,p_amount integer,p_reason text,p_operator text,p_key text)returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.billing_topup;v_id uuid;begin
 if p_amount is null or p_amount<=0 or p_reason is null or length(trim(p_reason))<3 or length(p_reason)>500 or p_operator is null or length(trim(p_operator))<2 or length(p_operator)>120 or p_key is null or p_key!~'^[A-Za-z0-9:_.-]{8,200}$' then raise exception 'INVALID_REFUND';end if;
 select * into t from app.billing_topup where org_id=p_org and id=p_topup for update;
 if not found then raise exception 'NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_org::text,0));
 select id into v_id from app.wallet_ledger where org_id=p_org and idempotency_key='refund:'||p_key;
 if found then return jsonb_build_object('id',v_id,'duplicate',true)||app_private.wallet_snapshot(p_org);end if;
 if t.state<>'paid' then raise exception 'NOT_REFUNDABLE';end if;
 if p_amount>t.amount_sen-t.refunded_sen then raise exception 'REFUND_EXCEEDS_TOPUP';end if;
 if p_amount>(app_private.wallet_snapshot(p_org)->>'balanceSen')::bigint then raise exception 'REFUND_EXCEEDS_BALANCE';end if;
 update app.billing_topup set refunded_sen=refunded_sen+p_amount,updated_at=now() where id=t.id;
 insert into app.wallet_ledger(org_id,kind,amount_sen,topup_id,reason,idempotency_key)values(p_org,'refund',-p_amount,t.id,trim(p_reason),'refund:'||p_key)returning id into v_id;
 insert into app.audit_log(org_id,action,target_type,target_id,metadata)values(p_org,'billing.refunded','billing_topup',t.id,jsonb_build_object('amountSen',p_amount,'reason',trim(p_reason),'operator',trim(p_operator)));
 return jsonb_build_object('id',v_id,'duplicate',false)||app_private.wallet_snapshot(p_org);
end$$;

do $$declare f text;begin
 foreach f in array array[
  'billing_immutable()','wallet_snapshot(uuid)','record_usage(uuid,text,integer,text,timestamptz,jsonb)','wallet_state(uuid)',
  'billing_manager(uuid)','wallet_summary(uuid)','claim_trial(uuid)','create_topup(uuid,integer,text)','attach_topup(uuid,uuid,text,text)',
  'fail_topup(uuid,uuid,text)','settle_topup(text,text,text,boolean,integer,text,timestamptz,text)','expire_topups(integer)',
  'admin_adjust(uuid,integer,text,text,text)','admin_refund(uuid,uuid,integer,text,text,text)']loop
  execute format('alter function app_private.%s owner to jomcall_billing',f);
  execute format('revoke all on function app_private.%s from public',f);
 end loop;
end$$;
revoke all on function app_private.billing_no_truncate() from public;
grant execute on function app_private.wallet_summary(uuid),app_private.claim_trial(uuid),app_private.create_topup(uuid,integer,text),app_private.attach_topup(uuid,uuid,text,text),app_private.fail_topup(uuid,uuid,text),app_private.settle_topup(text,text,text,boolean,integer,text,timestamptz,text) to jomcall_app;
grant execute on function app_private.record_usage(uuid,text,integer,text,timestamptz,jsonb),app_private.wallet_state(uuid),app_private.expire_topups(integer) to jomcall_worker,jomcall_agent;
grant execute on function app_private.admin_adjust(uuid,integer,text,text,text),app_private.admin_refund(uuid,uuid,integer,text,text,text),app_private.record_usage(uuid,text,integer,text,timestamptz,jsonb),app_private.wallet_state(uuid),app_private.expire_topups(integer),app_private.settle_topup(text,text,text,boolean,integer,text,timestamptz,text) to postgres;
revoke create on schema app_private from jomcall_billing;
