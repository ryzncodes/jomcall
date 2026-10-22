create extension if not exists btree_gist with schema extensions;
set search_path=app,extensions,public;
create table app.booking (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references app.organization(id)on delete cascade,
 contact_id uuid not null,resource_id uuid not null,location_id uuid not null,title text not null check(length(title)between 1 and 120),
 start_at timestamptz not null,end_at timestamptz not null check(end_at>start_at),timezone text not null check(timezone='Asia/Kuala_Lumpur'),
 status text not null default 'requested' check(status in('requested','confirmed','cancelled')),
 source text not null check(source in('staff','reviewed_test')),creator_id uuid not null,
 revision integer not null default 1 check(revision>0),created_at timestamptz not null default now(),
 unique(org_id,id), foreign key(org_id,contact_id)references app.contact(org_id,id)on delete cascade,
 foreign key(org_id,location_id,resource_id)references app.booking_resource(org_id,location_id,id),
 constraint booking_no_confirmed_overlap exclude using gist(org_id with =,resource_id with =,tstzrange(start_at,end_at,'[)')with &&)where(status='confirmed')
);
reset search_path;
alter table app.booking enable row level security;alter table app.booking force row level security;
grant select,insert,update on app.booking to jomcall_app;
create policy tenant_read on app.booking for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
create policy tenant_insert on app.booking for insert to jomcall_app with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
create policy tenant_update on app.booking for update to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null)with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
create index booking_contact on app.booking(org_id,contact_id,start_at,id);
create index booking_location on app.booking(org_id,location_id,start_at,id);
