-- WhatsApp template status sync (design open item O8).
--
-- Until now staff recorded each template's review outcome by hand. The
-- agent process now asks the provider for the business account's templates
-- about once an hour and copies each one's status onto the matching local
-- row (same name and language). It never creates or deletes a template and
-- never changes a body. A template that was seen at the provider and is
-- later missing from its list is flagged (provider_status NOT_FOUND) and
-- keeps its status. Staff can switch a template off for good
-- (disabled_by_staff); a check never switches it back on. Built and tested against the fake provider only;
-- the provider's status names other than APPROVED and PAUSED are
-- unconfirmed, so an unknown name leaves the local status alone and is kept
-- in provider_status for staff to see.
--
-- Re-runnable.

alter table app.whatsapp_channel add column if not exists templates_synced_at timestamptz;
alter table app.whatsapp_channel add column if not exists templates_sync_reason text;
alter table app.whatsapp_channel drop constraint if exists whatsapp_channel_templates_sync_reason_check;
alter table app.whatsapp_channel add constraint whatsapp_channel_templates_sync_reason_check
 check(templates_sync_reason is null or templates_sync_reason~'^[A-Z0-9_]{1,60}$');
alter table app.whatsapp_template add column if not exists provider_status text;
alter table app.whatsapp_template add column if not exists synced_at timestamptz;
alter table app.whatsapp_template drop constraint if exists whatsapp_template_provider_status_check;
alter table app.whatsapp_template add constraint whatsapp_template_provider_status_check
 check(provider_status is null or provider_status~'^[A-Z_]{1,60}$');

grant update(status,provider_status,synced_at,revision,updated_at) on app.whatsapp_template to jomcall_agent_jobs;
-- The web role reads the new columns with the rest of the row (it already
-- has table-level select on templates; the channel is read column by column).
grant select(templates_synced_at,templates_sync_reason) on app.whatsapp_channel to jomcall_app;

-- Staff can always switch a template off; a check never switches it back on.
alter table app.whatsapp_template add column if not exists disabled_by_staff boolean not null default false;
-- The status a template had when staff switched it off, so switching it on
-- can put it back when the provider's own status is unknown.
alter table app.whatsapp_template add column if not exists status_before_off text;
alter table app.whatsapp_template drop constraint if exists whatsapp_template_status_before_off_check;
alter table app.whatsapp_template add constraint whatsapp_template_status_before_off_check
 check(status_before_off is null or status_before_off in('draft','pending','approved','rejected','paused'));
grant update(disabled_by_staff,status_before_off) on app.whatsapp_template to jomcall_app;

grant create on schema app_private to jomcall_agent_jobs;
-- Agent process only.
--   claim   the connected channel whose templates were checked longest ago
--           (not within the last hour) and that has a template. Marks it
--           checked now and not yet answered, so a failing provider is
--           asked once an hour, not in a loop. Returns the business account
--           id, the channel revision and the sealed credentials.
--   result  p_data {ok, reason, wabaId, revision, templates:[{name,
--           language, status}]}. Applied only to the claim it answers: the
--           channel must still be connected, still waiting for this answer,
--           and unchanged (same business account and revision). A list with
--           the same name and language twice is refused.
create or replace function app_private.whatsapp_template_sync(p_action text,p_namespace text,p_id uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare h app.whatsapp_channel;t record;v_new text;v_raw text;v_changed integer:=0;v_seen integer:=0;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if p_action='claim' then
  select * into h from app.whatsapp_channel c
  where c.namespace=p_namespace and c.state='connected' and c.waba_id is not null and c.credentials is not null
   and(c.templates_synced_at is null or c.templates_synced_at<now()-interval '1 hour')
   and exists(select 1 from app.whatsapp_template x where x.org_id=c.org_id and x.channel_id=c.id)
  order by c.templates_synced_at nulls first,c.id limit 1 for update skip locked;
  if not found then return null;end if;
  update app.whatsapp_channel set templates_synced_at=now(),templates_sync_reason='TEMPLATE_SYNC_PENDING' where id=h.id;
  return jsonb_build_object('id',h.id,'orgId',h.org_id,'wabaId',h.waba_id,'revision',h.revision,'credentials',h.credentials);
 elsif p_action='result' then
  select * into h from app.whatsapp_channel c where c.id=p_id and c.namespace=p_namespace for update;
  if not found then return jsonb_build_object('applied',false);end if;
  -- Not the claim this answers (reconnected, changed, or already answered).
  if h.templates_sync_reason is distinct from 'TEMPLATE_SYNC_PENDING' then return jsonb_build_object('applied',false);end if;
  if h.state<>'connected' or h.waba_id is distinct from p_data->>'wabaId' or h.revision::text is distinct from p_data->>'revision' then
   update app.whatsapp_channel set templates_sync_reason='TEMPLATE_SYNC_STALE',templates_synced_at=null where id=h.id;
   return jsonb_build_object('applied',false);
  end if;
  if not coalesce((p_data->>'ok')::boolean,false) then
   update app.whatsapp_channel set templates_sync_reason=case when p_data->>'reason'~'^[A-Z0-9_]{1,60}$' and p_data->>'reason'<>'TEMPLATE_SYNC_PENDING' then p_data->>'reason' else 'TEMPLATE_SYNC_FAILED' end where id=h.id;
   return jsonb_build_object('applied',false);
  end if;
  if jsonb_typeof(p_data->'templates')is distinct from 'array' or jsonb_array_length(p_data->'templates')>1000
   or exists(select 1 from jsonb_array_elements(p_data->'templates')e group by e->>'name',e->>'language' having count(*)>1)then
   update app.whatsapp_channel set templates_sync_reason='TEMPLATE_LIST_INVALID' where id=h.id;
   return jsonb_build_object('applied',false);
  end if;
  for t in
   select x.id,x.status,x.provider_status,x.disabled_by_staff,
    (select e->>'status' from jsonb_array_elements(p_data->'templates')e
     where e->>'name'=x.name and e->>'language'=x.language limit 1)raw
   from app.whatsapp_template x where x.org_id=h.org_id and x.channel_id=h.id for update
  loop
   v_raw=case when t.raw~'^[A-Z_]{1,60}$' and t.raw<>'NOT_FOUND' then t.raw else null end;
   -- Not in the provider's list. Never seen there: nothing changes. Seen
   -- before: flagged NOT_FOUND for staff and the status is left alone. A
   -- list can come back short for reasons other than deletion, and a
   -- template wrongly switched off would stop replies without anyone
   -- noticing, while sending one that really was deleted fails in the open.
   if v_raw is null then
    update app.whatsapp_template set provider_status='NOT_FOUND',synced_at=now() where id=t.id and provider_status is not null and provider_status<>'NOT_FOUND';
    continue;
   end if;
   v_seen=v_seen+1;
   v_new=case v_raw
    when 'APPROVED' then 'approved'
    when 'PAUSED' then 'paused'
    when 'PENDING' then 'pending' when 'IN_REVIEW' then 'pending' when 'IN_APPEAL' then 'pending'
    when 'REJECTED' then 'rejected'
    when 'DISABLED' then 'disabled' when 'ARCHIVED' then 'disabled' when 'PENDING_DELETION' then 'disabled' when 'LIMIT_EXCEEDED' then 'disabled'
    else t.status end;
   -- Switched off by staff: the provider's status is recorded, the local
   -- status stays disabled.
   if t.disabled_by_staff then v_new='disabled';end if;
   if v_new is distinct from t.status then
    update app.whatsapp_template set status=v_new,provider_status=v_raw,synced_at=now(),revision=revision+1,updated_at=now() where id=t.id;
    v_changed=v_changed+1;
   else
    update app.whatsapp_template set provider_status=v_raw,synced_at=now() where id=t.id;
   end if;
  end loop;
  update app.whatsapp_channel set templates_sync_reason=null,templates_synced_at=now() where id=h.id;
  return jsonb_build_object('applied',true,'seen',v_seen,'changed',v_changed);
 end if;
 raise exception 'INVALID_TEMPLATE_SYNC_OPERATION';
end$$;
alter function app_private.whatsapp_template_sync(text,text,uuid,jsonb) owner to jomcall_agent_jobs;
revoke all on function app_private.whatsapp_template_sync(text,text,uuid,jsonb) from public;
grant execute on function app_private.whatsapp_template_sync(text,text,uuid,jsonb) to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
