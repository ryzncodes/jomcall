-- Phone number requests (2026-11-20).
--
-- Phone numbers are bought by an operator, not by the customer. An owner or
-- admin asks for one on the Phone numbers screen; the operator buys it with
-- the phone-provision command and inserts the app.phone_number row; a
-- trigger then marks the request ready. The engine reads
-- app_private.phone_request_notices() every few minutes and emails the
-- operator about an open request (again every 4 hours while it stays open)
-- and the organization's owners once when the number is ready.
--
-- One open request per organization. forward_from is the business's own
-- existing number (the one it will forward from), given by the owner; it is
-- business contact data, not a customer's.

create table app.phone_number_request(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 area text not null check(area in('any','klang_valley','penang','johor','perak','melaka','negeri_sembilan','pahang','kedah','sabah','sarawak')),
 forward_from text check(forward_from ~ '^\+[1-9][0-9]{6,14}$'),
 state text not null default 'open' check(state in('open','ready','cancelled')),
 requested_by uuid,
 phone_number_id uuid,
 created_at timestamptz not null default now(),
 ready_at timestamptz,
 operator_noticed_at timestamptz,
 owner_noticed_at timestamptz
);
create unique index phone_number_request_open on app.phone_number_request(org_id) where state='open';
create index phone_number_request_org on app.phone_number_request(org_id,created_at desc);

alter table app.phone_number_request enable row level security;
alter table app.phone_number_request force row level security;
grant select on app.phone_number_request to jomcall_app;
grant insert(org_id,area,forward_from,requested_by) on app.phone_number_request to jomcall_app;
create policy tenant_read on app.phone_number_request for select to jomcall_app
 using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) is not null);
create policy manager_insert on app.phone_number_request for insert to jomcall_app
 with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) in('owner','admin'));
grant select,update on app.phone_number_request to jomcall_jobs;
grant select on app.phone_number,app.organization,app.member to jomcall_jobs;

grant create on schema app_private to jomcall_jobs;

-- A number added to an organization answers its open request, however the
-- row was inserted (operator SQL or the screen).
create function app_private.phone_request_fulfil() returns trigger language plpgsql security definer set search_path='' as $$begin
 update app.phone_number_request r set state='ready',ready_at=now(),phone_number_id=new.id
  where r.org_id=new.org_id and r.state='open';
 return new;
end$$;
alter function app_private.phone_request_fulfil() owner to jomcall_jobs;
revoke all on function app_private.phone_request_fulfil() from public;
create trigger phone_request_fulfil after insert on app.phone_number for each row execute function app_private.phone_request_fulfil();

-- What the engine should email now. Each row is marked before it is
-- returned, so a failed send is not repeated at once: an open request comes
-- back after 4 hours, a ready one does not come back (the owner sees the
-- number on the screen either way). At most 20 of each per call.
create function app_private.phone_request_notices() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_open jsonb; v_ready jsonb; begin
 with x as (
  select r.id from app.phone_number_request r
  where r.state='open' and (r.operator_noticed_at is null or r.operator_noticed_at < now() - interval '4 hours')
  order by r.created_at limit 20 for update skip locked),
 u as (update app.phone_number_request r set operator_noticed_at=now() from x where r.id=x.id returning r.*)
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',u.id,'orgId',u.org_id,'orgName',(select o.name from app.organization o where o.id=u.org_id),
   'area',u.area,'forwardFrom',u.forward_from,'requestedAt',u.created_at,
   'requestedBy',app_private.auth_user_email(u.requested_by)) order by u.created_at),'[]') into v_open from u;
 with x as (
  select r.id from app.phone_number_request r
  where r.state='ready' and r.owner_noticed_at is null
  order by r.ready_at limit 20 for update skip locked),
 u as (update app.phone_number_request r set owner_noticed_at=now() from x where r.id=x.id returning r.*)
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',u.id,
   'e164',(select n.e164 from app.phone_number n where n.org_id=u.org_id and n.id=u.phone_number_id),
   'emails',coalesce((select jsonb_agg(e.email order by e.email) from (select app_private.auth_user_email(m.user_id) email from app.member m
     where m.org_id=u.org_id and m.role='owner' and m.active) e where e.email is not null),'[]')) order by u.ready_at),'[]') into v_ready from u;
 return jsonb_build_object('open',v_open,'ready',v_ready);
end$$;
alter function app_private.phone_request_notices() owner to jomcall_jobs;
revoke create on schema app_private from jomcall_jobs;
revoke all on function app_private.phone_request_notices() from public;
grant execute on function app_private.phone_request_notices() to jomcall_worker;

-- Whether the plan in force includes a phone number. Readable by every
-- active member (plan_summary is for owners and admins only, and the Phone
-- numbers screen is read by staff too). Nothing else about the plan leaves.
create function app_private.plan_has_phone_number(p_org uuid) returns boolean language plpgsql stable security definer set search_path='' as $$begin
 if app_private.active_role(p_org) is null then raise exception 'NOT_FOUND'; end if;
 return coalesce((app_private.plan_entitlements(p_org,now())->>'phoneNumbers')::int,0) > 0;
end$$;
revoke all on function app_private.plan_has_phone_number(uuid) from public;
grant execute on function app_private.plan_has_phone_number(uuid) to jomcall_app;
