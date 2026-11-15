-- Setup document import, read side. The agent process reads a queued upload
-- and writes draft items (price rows and facts) into app.setup_item, all
-- through app_private.setup_read. The agent role gets no table grant: the
-- function, owned by jomcall_agent_jobs, is its only way in.
--
-- Lease: claim sets a random lease_token and a lease_until five minutes out (a
-- 60-second read, a 60-second fallback read, the chunk fetch and the result
-- all fit). chunk, result, fail and release act only while state is
-- 'reading', the token matches and lease_until has not passed; a second worker
-- cannot guess the token. maintain re-queues expired leases.
--
-- Outbox: the setup.read row stays undelivered while its upload is queued or
-- reading, so a released or re-queued upload is claimed again. It is
-- delivered when the upload is done, failed or removed, or is gone.
--
-- Lock order wherever two are taken: session, then outbox row, then upload.
--
-- Re-runnable (if not exists, drop function if exists), because the shared
-- local database is patched with psql while its migration history is ahead
-- of main.
alter table app.setup_upload add column if not exists lease_token uuid;
-- Rows the reader returned that could not be used at all.
alter table app.setup_upload add column if not exists dropped_count int not null default 0;
alter table app.setup_upload drop constraint if exists setup_upload_dropped_count_min;
alter table app.setup_upload add constraint setup_upload_dropped_count_min check (dropped_count >= 0);
create index if not exists setup_upload_leased on app.setup_upload(lease_until) where state = 'reading';
create index if not exists setup_upload_open on app.setup_upload(created_at) where state = 'uploading';
create index if not exists setup_upload_unswept on app.setup_upload(created_at) where delete_after is null;
-- Set when the 30-day sweep has run for an upload, so the sweep's index holds
-- only uploads it has not reached yet.
alter table app.setup_upload add column if not exists bytes_deleted_at timestamptz;
drop index if exists app.setup_upload_delete_after;
create index if not exists setup_upload_due on app.setup_upload(delete_after) where bytes_deleted_at is null;
-- The read actions find an upload's setup.read row by resource id.
create index if not exists outbox_setup_read on app.outbox(resource_id) where kind = 'setup.read';

grant select, update on app.setup_upload to jomcall_agent_jobs;
grant select, delete on app.setup_upload_chunk to jomcall_agent_jobs;
grant select, update on app.setup_session to jomcall_agent_jobs;
grant select, insert, update on app.setup_item to jomcall_agent_jobs;
grant select, update on app.outbox to jomcall_agent_jobs;
grant create on schema app_private to jomcall_agent_jobs;

drop function if exists app_private.setup_read(text, text, uuid, uuid, jsonb);
create function app_private.setup_read(p_action text, p_namespace text, p_upload uuid default null, p_lease uuid default null, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 o app.outbox; u app.setup_upload; s app.setup_session;
 v_active text[]; v_rows int := 0; v_facts int := 0; v_dropped int; v_code text;
 v_requeued int := 0; v_abandoned int := 0; v_marked int := 0; v_swept int := 0;
 c app.setup_upload_chunk;
begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE'; end if;

 if p_action = 'maintain' then
  -- A read whose lease ran out goes back to the queue; its attempt counts.
  with x as (
   select u2.id from app.setup_upload u2
   where u2.state = 'reading' and u2.lease_until < now()
    and exists(select 1 from app.outbox b where b.org_id = u2.org_id and b.resource_id = u2.id and b.kind = 'setup.read' and b.namespace = p_namespace)
   order by u2.lease_until limit 100 for update skip locked)
  update app.setup_upload t set state = 'queued', lease_token = null, lease_until = null from x where t.id = x.id;
  get diagnostics v_requeued = row_count;
  -- The retention sweeps below are time-based and apply to every upload in
  -- this database, whichever namespace runs them (an upload still uploading
  -- has no outbox row to carry one).
  -- Never finished within a day: removed, bytes deleted.
  with x as (
   select u2.id from app.setup_upload u2
   where u2.state = 'uploading' and u2.created_at < now() - interval '24 hours'
   order by u2.created_at limit 100 for update skip locked),
  gone as (delete from app.setup_upload_chunk k using x where k.upload_id = x.id)
  update app.setup_upload t set state = 'removed', fail_code = 'ABANDONED', lease_token = null, lease_until = null, bytes_deleted_at = now() from x where t.id = x.id;
  get diagnostics v_abandoned = row_count;
  -- Every upload's bytes go 30 days after it was created, whatever happens
  -- to its session.
  with x as (
   select u2.id from app.setup_upload u2 where u2.delete_after is null
   order by u2.created_at limit 100 for update skip locked)
  update app.setup_upload t set delete_after = t.created_at + interval '30 days' from x where t.id = x.id;
  get diagnostics v_marked = row_count;
  -- The upload row and its items stay. Each upload is swept once.
  with x as (
   select u2.id from app.setup_upload u2
   where u2.delete_after < now() and u2.bytes_deleted_at is null
   order by u2.delete_after limit 100 for update skip locked),
  gone as (delete from app.setup_upload_chunk k using x where k.upload_id = x.id)
  update app.setup_upload t set bytes_deleted_at = now() from x where t.id = x.id;
  get diagnostics v_swept = row_count;
  return jsonb_build_object('requeued', v_requeued, 'abandoned', v_abandoned, 'marked', v_marked, 'swept', v_swept);

 elsif p_action = 'claim' then
  -- Reading uploads are left alone (their row stays for a later re-queue).
  for o in
   select b.* from app.outbox b left join app.setup_upload y on y.org_id = b.org_id and y.id = b.resource_id
   where b.namespace = p_namespace and b.kind = 'setup.read' and b.delivered_at is null and (y.id is null or y.state <> 'reading')
   order by b.created_at, b.id limit 20 for update of b skip locked
  loop
   select * into u from app.setup_upload where org_id = o.org_id and id = o.resource_id for update;
   if found and u.state = 'reading' then continue; end if;
   if not found or u.state <> 'queued' then
    -- Removed, done, failed or gone: nothing to read.
    update app.outbox set delivered_at = now(), lease_until = null where id = o.id;
    continue;
   end if;
   select * into s from app.setup_session where org_id = u.org_id and id = u.session_id;
   if s.state <> 'open' or u.attempts >= 2 then
    update app.setup_upload set state = 'failed', fail_code = 'READ_FAILED', lease_token = null, lease_until = null where id = u.id;
    update app.outbox set delivered_at = now(), lease_until = null where id = o.id;
    continue;
   end if;
   update app.setup_upload set state = 'reading', attempts = attempts + 1, lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes'
   where id = u.id returning * into u;
   return jsonb_build_object('upload', u.id, 'lease', u.lease_token, 'attempt', u.attempts, 'kind', u.kind, 'mime', u.mime,
    'name', u.name, 'chunks', u.chunks, 'mainPack', s.main_pack, 'extraPacks', to_jsonb(s.extra_packs), 'questionIds', to_jsonb(s.question_ids));
  end loop;
  return null;

 elsif p_action in ('chunk', 'result', 'fail', 'release') then
  -- The upload must have a setup.read row in this namespace.
  select b.* into o from app.outbox b where b.resource_id = p_upload and b.kind = 'setup.read' and b.namespace = p_namespace
  order by b.created_at desc, b.id desc limit 1;
  if not found then return null; end if;

  if p_action = 'chunk' then
   select * into u from app.setup_upload where org_id = o.org_id and id = p_upload;
   if not found or u.state <> 'reading' or u.lease_token is distinct from p_lease or u.lease_until <= now() then return null; end if;
   if jsonb_typeof(p_data->'seq') <> 'number' or (p_data->>'seq') !~ '^[0-9]$' then raise exception 'INVALID_SETUP_READ_OPERATION'; end if;
   select * into c from app.setup_upload_chunk where org_id = u.org_id and upload_id = u.id and seq = (p_data->>'seq')::int;
   if not found then return jsonb_build_object('missing', true); end if;
   return jsonb_build_object('data', encode(c.data, 'base64'));
  end if;

  select * into u from app.setup_upload where org_id = o.org_id and id = p_upload;
  if not found then return null; end if;
  if p_action = 'result' then
   select * into s from app.setup_session where org_id = u.org_id and id = u.session_id for update;
  end if;
  select * into o from app.outbox where id = o.id for update;
  select * into u from app.setup_upload where id = u.id for update;
  -- Removed while it was being read: left as it is.
  if u.state = 'removed' then return jsonb_build_object('removed', true); end if;
  if u.state <> 'reading' or u.lease_token is distinct from p_lease or u.lease_until <= now() then return null; end if;

  if p_action = 'release' then
   -- A retryable failure: back to the queue, unless this was the second try.
   if u.attempts >= 2 then
    update app.setup_upload set state = 'failed', fail_code = 'READ_FAILED', lease_token = null, lease_until = null where id = u.id;
    update app.outbox set delivered_at = now(), lease_until = null where id = o.id;
    return jsonb_build_object('state', 'failed', 'code', 'READ_FAILED');
   end if;
   update app.setup_upload set state = 'queued', lease_token = null, lease_until = null where id = u.id;
   return jsonb_build_object('state', 'queued');
  end if;

  if p_action = 'fail' then
   v_code := p_data->>'code';
   if v_code is null or v_code not in ('TOO_LONG', 'UNREADABLE', 'REFUSED', 'READ_FAILED', 'READER_OFF') then raise exception 'INVALID_SETUP_READ_OPERATION'; end if;
   update app.setup_upload set state = 'failed', fail_code = v_code, lease_token = null, lease_until = null where id = u.id;
   update app.outbox set delivered_at = now(), lease_until = null where id = o.id;
   return jsonb_build_object('state', 'failed', 'code', v_code);
  end if;

  -- result. The session closed while reading: nothing is written.
  if s.state <> 'open' then
   update app.setup_upload set state = 'failed', fail_code = 'READ_FAILED', lease_token = null, lease_until = null where id = u.id;
   update app.outbox set delivered_at = now(), lease_until = null where id = o.id;
   return jsonb_build_object('state', 'failed', 'code', 'READ_FAILED');
  end if;
  if jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') > 300
   or jsonb_typeof(p_data->'facts') is distinct from 'array' or jsonb_array_length(p_data->'facts') > 200
   or jsonb_typeof(p_data->'dropped') is distinct from 'number' or (p_data->>'dropped') !~ '^[0-9]{1,4}$' then
   raise exception 'INVALID_SETUP_READ_RESULT';
  end if;
  v_dropped := (p_data->>'dropped')::int;
  -- Every row and fact is checked before anything is written. CASE keeps a
  -- cast from running on a value of the wrong type.
  if exists(
   select 1 from jsonb_array_elements(p_data->'rows') r(x) where case
    when jsonb_typeof(x) <> 'object' then true
    when jsonb_typeof(x->'item') is distinct from 'string' or char_length(btrim(x->>'item')) not between 1 and 200 then true
    when jsonb_typeof(x->'variant') is distinct from 'string' or char_length(x->>'variant') > 200 then true
    when jsonb_typeof(x->'unit') is distinct from 'string' or char_length(x->>'unit') > 60 then true
    when jsonb_typeof(x->'notes') is distinct from 'string' or char_length(x->>'notes') > 300 then true
    when jsonb_typeof(x->'needsCheck') is distinct from 'boolean' then true
    when jsonb_typeof(x->'checkReason') is distinct from 'string' or char_length(x->>'checkReason') > 500 then true
    when jsonb_typeof(x->'priceSen') = 'null' then false
    when jsonb_typeof(x->'priceSen') is distinct from 'number' then true
    when (x->>'priceSen') !~ '^[0-9]{1,12}$' then true
    else (x->>'priceSen')::bigint > 100000000000 end)
  or exists(
   select 1 from jsonb_array_elements(p_data->'facts') f(x) where case
    when jsonb_typeof(x) <> 'object' then true
    when jsonb_typeof(x->'packId') is distinct from 'string' or (x->>'packId') !~ '^[a-z][a-z0-9-]{1,40}$' then true
    when jsonb_typeof(x->'fieldKey') is distinct from 'string' or (x->>'fieldKey') !~ '^[a-z][a-z0-9_]{1,60}$' then true
    when jsonb_typeof(x->'title') is distinct from 'string' or char_length(btrim(x->>'title')) not between 1 and 200 then true
    when jsonb_typeof(x->'value') is distinct from 'string' or char_length(btrim(x->>'value')) not between 1 and 2000 then true
    when octet_length((x->'value')::text) > 4000 then true
    when jsonb_typeof(x->'needsCheck') is distinct from 'boolean' then true
    when jsonb_typeof(x->'checkReason') is distinct from 'string' or char_length(x->>'checkReason') > 500 then true
    else false end) then
   raise exception 'INVALID_SETUP_READ_RESULT';
  end if;

  -- Price rows. "Listed twice": the same item and variant (lower case,
  -- trimmed, inner spaces collapsed) as an earlier row of this document or a
  -- pending import row of the session, from any upload. Still stored, flagged.
  with r as (
   select n, x,
    lower(regexp_replace(btrim(x->>'item'), '\s+', ' ', 'g')) as ni,
    lower(regexp_replace(btrim(x->>'variant'), '\s+', ' ', 'g')) as nv
   from jsonb_array_elements(p_data->'rows') with ordinality e(x, n)),
  d as (
   select r.*, (row_number() over (partition by ni, nv order by n) > 1 or exists(
     select 1 from app.setup_item i where i.org_id = u.org_id and i.session_id = s.id and i.kind = 'catalogue_row'
      and i.source = 'import' and i.state = 'pending'
      and lower(regexp_replace(btrim(coalesce(i.payload->>'item', '')), '\s+', ' ', 'g')) = r.ni
      and lower(regexp_replace(btrim(coalesce(i.payload->>'variant', '')), '\s+', ' ', 'g')) = r.nv)) as twice,
    nullif(btrim(x->>'checkReason'), '') as reason
   from r),
  ins as (
   insert into app.setup_item(org_id, session_id, kind, key, payload, source, needs_check, check_reason, state)
   select u.org_id, s.id, 'catalogue_row', u.id::text || ':' || d.n,
    jsonb_build_object('uploadId', u.id, 'item', btrim(x->>'item'), 'variant', btrim(x->>'variant'), 'priceSen', x->'priceSen',
     'unit', btrim(x->>'unit'), 'notes', btrim(x->>'notes')),
    'import', (x->>'needsCheck')::boolean or d.twice,
    case
     when d.twice and (x->>'needsCheck')::boolean and d.reason is not null then left(d.reason, 500 - char_length('; listed twice')) || '; listed twice'
     when d.twice then 'listed twice'
     when (x->>'needsCheck')::boolean then coalesce(left(d.reason, 500), 'The reader was not sure about this row.')
    end,
    'pending'
   from d order by d.n
   on conflict (session_id, kind, key) do nothing
   returning 1)
  select count(*) into v_rows from ins;

  -- Facts: written exactly as the interview writes an answer, plus uploadId.
  -- A fact of a pack the owner dropped while reading is left out. A live item
  -- for the same key (an interview answer, an earlier import, an applied
  -- value) wins; a removed one is replaced. One per key, first wins.
  v_active := array['every-business', s.main_pack] || s.extra_packs; -- every-business: the base pack, always active
  with f as (
   select distinct on (x->>'fieldKey') x, n
   from jsonb_array_elements(p_data->'facts') with ordinality e(x, n)
   where (x->>'packId') = any(v_active)
   order by x->>'fieldKey', n),
  ins as (
   insert into app.setup_item(org_id, session_id, kind, key, payload, source, needs_check, check_reason, state)
   select u.org_id, s.id, 'fact', x->>'fieldKey',
    jsonb_build_object('packId', x->>'packId', 'fieldKey', x->>'fieldKey', 'title', btrim(x->>'title'), 'value', btrim(x->>'value'),
     'language', 'mixed', 'uploadId', u.id),
    'import', (x->>'needsCheck')::boolean,
    case when (x->>'needsCheck')::boolean then coalesce(left(nullif(btrim(x->>'checkReason'), ''), 500), 'The reader was not sure about this value.') end,
    'pending'
   from f order by f.n
   on conflict (session_id, kind, key) do update set payload = excluded.payload, source = 'import', needs_check = excluded.needs_check,
    check_reason = excluded.check_reason, state = 'pending', updated_at = now()
   where app.setup_item.state = 'removed'
   returning 1)
  select count(*) into v_facts from ins;

  update app.setup_upload set state = 'done', fail_code = null, row_count = v_rows, fact_count = v_facts, dropped_count = v_dropped,
   read_at = now(), lease_token = null, lease_until = null where id = u.id;
  update app.outbox set delivered_at = now(), lease_until = null where id = o.id;
  -- Items changed: the open review page must reload.
  if v_rows + v_facts > 0 then
   update app.setup_session set revision = revision + 1, updated_at = now() where id = s.id;
  end if;
  return jsonb_build_object('state', 'done', 'rows', v_rows, 'facts', v_facts);
 end if;
 raise exception 'INVALID_SETUP_READ_OPERATION';
end$$;

alter function app_private.setup_read(text, text, uuid, uuid, jsonb) owner to jomcall_agent_jobs;
revoke all on function app_private.setup_read(text, text, uuid, uuid, jsonb) from public;
grant execute on function app_private.setup_read(text, text, uuid, uuid, jsonb) to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
