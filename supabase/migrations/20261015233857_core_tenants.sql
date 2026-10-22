create schema if not exists app;
create schema if not exists app_private;
revoke all on schema app,app_private from public,anon,authenticated,service_role;
create extension if not exists vector with schema extensions;
do $$ begin
 if not exists(select from pg_roles where rolname='jomcall_app') then create role jomcall_app login noinherit nobypassrls; end if;
 if not exists(select from pg_roles where rolname='jomcall_authz') then create role jomcall_authz nologin noinherit bypassrls; end if;
 if not exists(select from pg_roles where rolname='jomcall_bootstrap') then create role jomcall_bootstrap nologin noinherit bypassrls; end if;
 if not exists(select from pg_roles where rolname='jomcall_worker') then create role jomcall_worker login noinherit nobypassrls; end if;
 if not exists(select from pg_roles where rolname='jomcall_queue') then create role jomcall_queue login noinherit nobypassrls; end if;
end $$;
grant jomcall_authz,jomcall_bootstrap to postgres;
grant create on schema app_private to jomcall_authz,jomcall_bootstrap;
grant usage on schema app,app_private to jomcall_app,jomcall_authz,jomcall_bootstrap;
grant usage on schema auth to jomcall_authz;
grant select(id,user_id) on auth.sessions to jomcall_authz;
create table app.organization(
 id uuid primary key default gen_random_uuid(), org_id uuid generated always as(id) stored,
 name text not null check(length(name) between 1 and 120),business_type text not null,
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(org_id,id));
create table app.member(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,role text not null check(role in('owner','admin','staff')),
 active boolean not null default true,revision integer not null default 1,created_at timestamptz not null default now(),unique(org_id,user_id),unique(org_id,id));
create unique index one_owner on app.member(org_id) where role='owner' and active;
create table app.location(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id) on delete cascade,
 name text not null,primary_location boolean not null default false,address text not null default '',state text not null default '',timezone text not null default 'Asia/Kuala_Lumpur',
 revision integer not null default 1,archived_at timestamptz,created_at timestamptz not null default now(),unique(org_id,id));
create unique index one_primary_location on app.location(org_id) where primary_location and archived_at is null;
create table app.agent(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id) on delete cascade,
 location_id uuid not null,draft jsonb not null default '{"name":"Agent","languages":["ms","en"],"manglish":true,"greeting":"","instructions":"","aiDisclosure":"","recordingEnabled":false,"recordingDisclosure":"","voicePreference":""}',
 revision integer not null default 1,published_version_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),foreign key(org_id,location_id) references app.location(org_id,id));
create table app.command_receipt(
 id uuid primary key default gen_random_uuid(),org_id uuid references app.organization(id) on delete cascade,actor_id uuid not null,
 scope text not null,command text not null,idempotency_key uuid not null,request_hash text not null,result_ref jsonb not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours',unique(scope,actor_id,command,idempotency_key));
create table app.audit_log(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id) on delete cascade,
 actor_id uuid,action text not null,target_type text not null,target_id uuid,metadata jsonb not null default '{}',created_at timestamptz not null default now(),unique(org_id,id));
grant select on app.member to jomcall_authz;
create function app_private.session_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=nullif(current_setting('app.session_id',true),'')::uuid and user_id=nullif(current_setting('app.user_id',true),'')::uuid)
$$;
alter function app_private.session_active() owner to jomcall_authz;
create function app_private.active_role(p_org uuid) returns text language sql stable security definer set search_path='' as $$
 select role from app.member where org_id=p_org and user_id=nullif(current_setting('app.user_id',true),'')::uuid and active and app_private.session_active()
$$;
alter function app_private.active_role(uuid) owner to jomcall_authz;
revoke all on all functions in schema app_private from public;
grant execute on all functions in schema app_private to jomcall_app,jomcall_bootstrap;
grant select on app.organization,app.member,app.location,app.agent,app.audit_log,app.command_receipt to jomcall_app;
grant update(name,business_type,revision,updated_at) on app.organization to jomcall_app;
grant insert,update on app.location,app.agent to jomcall_app;
grant insert on app.audit_log,app.command_receipt to jomcall_app;
do $$ declare t text; begin
 foreach t in array array['organization','member','location','agent','audit_log','command_receipt'] loop
 execute format('alter table app.%I enable row level security',t);
 execute format('alter table app.%I force row level security',t);
 execute format('create policy tenant_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) is not null)',t);
 end loop;
 foreach t in array array['organization','location','agent'] loop
 execute format('create policy manager_write on app.%I for update to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) in(''owner'',''admin'')) with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) in(''owner'',''admin''))',t);
 end loop;
 foreach t in array array['location','agent'] loop
 execute format('create policy manager_insert on app.%I for insert to jomcall_app with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) in(''owner'',''admin''))',t);
 end loop;
 foreach t in array array['audit_log','command_receipt'] loop
 execute format('create policy actor_insert on app.%I for insert to jomcall_app with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) is not null and actor_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',t);
 end loop;
end $$;
drop policy tenant_read on app.agent;
create policy manager_read on app.agent for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) in('owner','admin'));
drop policy tenant_read on app.audit_log;
create policy manager_read on app.audit_log for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) in('owner','admin'));
grant select,insert on app.organization,app.member,app.location,app.agent,app.command_receipt,app.audit_log to jomcall_bootstrap;
create function app_private.bootstrap_workspace(p_name text,p_type text,p_location text,p_key uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; receipt app.command_receipt; org uuid; loc uuid; agent uuid; result jsonb;
begin
 if not app_private.session_active() then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_key::text,0));
 select * into receipt from app.command_receipt where scope='bootstrap' and actor_id=actor and command='createOrganization' and idempotency_key=p_key;
 if found then
  if receipt.request_hash<>p_hash then raise exception 'CONFLICT';end if;
  if app_private.active_role(receipt.org_id) is null then raise exception 'NOT_FOUND';end if;
  return receipt.result_ref;
 end if;
 insert into app.organization(name,business_type) values(p_name,p_type) returning id into org;
 insert into app.member(org_id,user_id,role) values(org,actor,'owner');
 insert into app.location(org_id,name,primary_location) values(org,p_location,true) returning id into loc;
 insert into app.agent(org_id,location_id) values(org,loc) returning id into agent;
 result:=jsonb_build_object('orgId',org,'locationId',loc,'agentId',agent,'role','owner');
 insert into app.command_receipt(org_id,actor_id,scope,command,idempotency_key,request_hash,result_ref) values(org,actor,'bootstrap','createOrganization',p_key,p_hash,result);
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id) values(org,actor,'organization.created','organization',org);
 return result;
end $$;
alter function app_private.bootstrap_workspace(text,text,text,uuid,text) owner to jomcall_bootstrap;
revoke all on function app_private.bootstrap_workspace(text,text,text,uuid,text) from public;
grant execute on function app_private.bootstrap_workspace(text,text,text,uuid,text) to jomcall_app;
create function app_private.my_organizations() returns table(id uuid,name text,role text) language sql stable security definer set search_path='' as $$
 select o.id,o.name,m.role from app.member m join app.organization o on o.id=m.org_id where m.user_id=nullif(current_setting('app.user_id',true),'')::uuid and m.active and app_private.session_active()
$$;
grant select on app.organization to jomcall_authz;
alter function app_private.my_organizations() owner to jomcall_authz;
revoke all on function app_private.my_organizations() from public;
grant execute on function app_private.my_organizations() to jomcall_app;
create index audit_timeline on app.audit_log(org_id,created_at desc,id desc);

revoke create on schema app_private from jomcall_authz,jomcall_bootstrap;
