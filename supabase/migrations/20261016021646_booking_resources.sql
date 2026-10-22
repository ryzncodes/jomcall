create table app.booking_resource (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references app.organization(id) on delete cascade,
 location_id uuid not null, name text not null check(length(name) between 1 and 120),
 duration_minutes integer not null check(duration_minutes between 15 and 240 and duration_minutes%15=0),
 active boolean not null default true, revision integer not null default 1 check(revision>0),
 unique(org_id,id), unique(org_id,location_id,id),
 foreign key(org_id,location_id) references app.location(org_id,id) on delete cascade
);
alter table app.booking_resource enable row level security;
alter table app.booking_resource force row level security;
grant select,insert,update on app.booking_resource to jomcall_app;
create policy tenant_read on app.booking_resource for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
create policy manager_insert on app.booking_resource for insert to jomcall_app with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));
create policy manager_update on app.booking_resource for update to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'))with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));
create index resource_location on app.booking_resource(org_id,location_id);
