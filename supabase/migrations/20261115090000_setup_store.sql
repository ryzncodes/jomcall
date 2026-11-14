-- Setup staging store: holds an owner's guided-setup answers until they confirm
-- the review page. Rows are removed with the agent or the organization.
--
-- Written to be re-runnable (if not exists / drop policy if exists), because
-- the shared local database is patched with psql while its migration history
-- is ahead of main.
create table if not exists app.setup_session(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 agent_id uuid not null,
 main_pack text not null check (main_pack ~ '^[a-z][a-z0-9-]{1,40}$'),
 extra_packs text[] not null default '{}' check (cardinality(extra_packs) <= 8),
 state text not null default 'open' check (state in ('open','applied')),
 revision int not null default 1,
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (org_id, id),
 foreign key (org_id, agent_id) references app.agent(org_id, id) on delete cascade);
create unique index if not exists setup_session_one_open on app.setup_session(org_id, agent_id) where state = 'open';

create table if not exists app.setup_item(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 session_id uuid not null,
 kind text not null check (kind in ('fact','schedule','settings','catalogue_row')),
 key text not null check (char_length(key) between 1 and 200),
 payload jsonb not null check (octet_length(payload::text) <= 8000),
 source text not null check (source in ('interview','import')),
 needs_check boolean not null default false,
 check_reason text check (char_length(check_reason) <= 500),
 state text not null default 'pending' check (state in ('pending','confirmed','removed','applied')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (session_id, kind, key),
 foreign key (org_id, session_id) references app.setup_session(org_id, id) on delete cascade);

-- Web role: every member reads; only owners and admins write.
grant select, insert, update, delete on app.setup_session, app.setup_item to jomcall_app;
do $$ declare t text; begin
 foreach t in array array['setup_session','setup_item'] loop
  execute format('alter table app.%I enable row level security', t);
  execute format('alter table app.%I force row level security', t);
  execute format('drop policy if exists tenant_read on app.%I', t);
  execute format('create policy tenant_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id) is not null)', t);
  execute format('drop policy if exists manager_insert on app.%I', t);
  execute format('create policy manager_insert on app.%I for insert to jomcall_app with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  execute format('drop policy if exists manager_update on app.%I', t);
  execute format('create policy manager_update on app.%I for update to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  execute format('drop policy if exists manager_delete on app.%I', t);
  execute format('create policy manager_delete on app.%I for delete to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
 end loop;
end $$;
