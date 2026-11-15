-- Setup document import: an owner's uploaded price list, PDF, spreadsheet or
-- pasted text, held for the agent process to read into draft setup items.
-- Uploads belong to one setup session and go with it (and with the agent or
-- the organization). Removing an upload keeps its row as state 'removed', so
-- the 24-hour upload cap still counts it; its bytes are deleted.
--
-- The agent roles get no grant here: the reader reaches these rows through a
-- security-definer function added with the read worker.
--
-- Written to be re-runnable (if not exists / drop policy if exists), because
-- the shared local database is patched with psql while its migration history
-- is ahead of main.
create table if not exists app.setup_upload(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 session_id uuid not null,
 kind text not null check (kind in ('image','pdf','sheet','text')),
 name text not null check (char_length(name) between 1 and 200),
 mime text not null check (char_length(mime) <= 100),
 bytes int not null check (bytes between 1 and 10485760),
 chunks int not null default 0 check (chunks between 0 and 10),
 state text not null default 'uploading' check (state in ('uploading','queued','reading','done','failed','removed')),
 fail_code text check (char_length(fail_code) <= 40),
 row_count int not null default 0 check (row_count >= 0),
 fact_count int not null default 0 check (fact_count >= 0),
 attempts int not null default 0 check (attempts >= 0),
 lease_until timestamptz,
 created_by uuid,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 delete_after timestamptz,
 unique (org_id, id),
 foreign key (org_id, session_id) references app.setup_session(org_id, id) on delete cascade);
create index if not exists setup_upload_session on app.setup_upload(org_id, session_id);
create index if not exists setup_upload_recent on app.setup_upload(org_id, created_at);

-- org_id is repeated on the chunk so row-level security reads it directly.
create table if not exists app.setup_upload_chunk(
 org_id uuid not null,
 upload_id uuid not null,
 seq int not null check (seq between 0 and 9),
 data bytea not null check (octet_length(data) between 1 and 3145728),
 primary key (upload_id, seq),
 foreign key (org_id, upload_id) references app.setup_upload(org_id, id) on delete cascade);

-- Web role only. Every member reads upload rows; only owners and admins write
-- them, and only owners and admins read or write the bytes.
grant select, insert, update, delete on app.setup_upload, app.setup_upload_chunk to jomcall_app;
alter table app.setup_upload enable row level security;
alter table app.setup_upload force row level security;
alter table app.setup_upload_chunk enable row level security;
alter table app.setup_upload_chunk force row level security;

drop policy if exists tenant_read on app.setup_upload;
create policy tenant_read on app.setup_upload for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) is not null);
drop policy if exists manager_read on app.setup_upload_chunk;
create policy manager_read on app.setup_upload_chunk for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));
do $$ declare t text; begin
 foreach t in array array['setup_upload','setup_upload_chunk'] loop
  execute format('drop policy if exists manager_insert on app.%I', t);
  execute format('create policy manager_insert on app.%I for insert to jomcall_app with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  execute format('drop policy if exists manager_update on app.%I', t);
  execute format('create policy manager_update on app.%I for update to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  execute format('drop policy if exists manager_delete on app.%I', t);
  execute format('create policy manager_delete on app.%I for delete to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
 end loop;
end $$;
