-- A connected WhatsApp number that is saved again is checked again WITHOUT
-- being switched off.
--
-- Until now every save put the channel into 'pending', and a failed check put
-- it into 'failed'; while it was not 'connected' every incoming message was
-- ignored. On 2026-11-18 on hosted staging a working number stopped answering
-- for about five minutes because the owner pasted a new token that was not yet
-- allowed to use the business account.
--
-- Now a save that keeps the same phone number ID on a connected channel stays
-- 'connected' and sets recheck_wanted. The agent process verifies the number
-- and subscribes the app as before. A pass clears the flag and any warning. A
-- failure keeps the channel connected and records the reason and time in
-- last_check_failed_reason and last_check_failed_at, which the settings screen
-- shows as a warning. A changed phone number ID, a channel that is not
-- connected and a disconnect behave as before. state itself gets no new value,
-- so every existing state='connected' condition is unchanged.
--
-- The verify actions move to their own function (whatsapp_work has been
-- replaced by later migrations; copying it here would risk undoing them). The
-- verify_claim and verify_result branches of whatsapp_work are no longer called.
--
-- Re-runnable.

alter table app.whatsapp_channel add column if not exists recheck_wanted boolean not null default false;
alter table app.whatsapp_channel add column if not exists last_check_failed_reason text;
alter table app.whatsapp_channel add column if not exists last_check_failed_at timestamptz;
alter table app.whatsapp_channel drop constraint if exists whatsapp_channel_last_check_failed_reason_check;
alter table app.whatsapp_channel add constraint whatsapp_channel_last_check_failed_reason_check
 check(last_check_failed_reason is null or last_check_failed_reason~'^[A-Z0-9_]{1,60}$');
-- No constraint ties recheck_wanted to state: an older web build does not
-- clear the flag on Disconnect or save, and such a write must never fail. The
-- claim only looks at connected rows, so a stray flag elsewhere is inert.
-- (Dropped if an earlier version of this migration added it.)
alter table app.whatsapp_channel drop constraint if exists whatsapp_channel_recheck_state_check;

-- The web role reads the channel column by column and the save writes the new
-- columns. The agent job role already holds table-level select and update.
grant select(recheck_wanted,last_check_failed_reason,last_check_failed_at) on app.whatsapp_channel to jomcall_app;
grant update(recheck_wanted,last_check_failed_reason,last_check_failed_at) on app.whatsapp_channel to jomcall_app;

grant create on schema app_private to jomcall_agent_jobs;
-- Agent process only.
--   claim   a pending channel, or a connected channel that wants a re-check
--           (pending first, then the longest waiting). Returns the same facts
--           as before, including the channel revision.
--   result  p_data {revision, ok, reason, displayPhone}. Applied only to the
--           claim it answers: the channel's revision must still be the
--           claimed one. Every save, disconnect and number change bumps the
--           revision, so a result for a channel that was disconnected,
--           changed or saved again meanwhile is ignored.
--           pending   -> connected (ok) or failed (not ok), as before.
--           connected -> stays connected. ok clears the flag and any warning;
--                        not ok clears the flag and records reason and time.
--                        A re-check result changes no revision.
create or replace function app_private.whatsapp_verify(p_action text,p_namespace text,p_id uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare h app.whatsapp_channel;r jsonb;v_ok boolean;v_reason text;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if p_action='claim' then
  select jsonb_build_object('id',c.id,'orgId',c.org_id,'revision',c.revision,'phoneNumberId',c.phone_number_id,'wabaId',c.waba_id,'credentials',c.credentials)into r
  from app.whatsapp_channel c where c.namespace=p_namespace and(c.state='pending' or(c.state='connected' and c.recheck_wanted))
  order by(c.state<>'pending'),c.updated_at,c.id limit 1;
  return r;
 elsif p_action='result' then
  v_ok:=coalesce((p_data->>'ok')::boolean,false);
  v_reason:=case when p_data->>'reason'~'^[A-Z0-9_]{1,60}$' then p_data->>'reason' else 'VERIFICATION_FAILED' end;
  select * into h from app.whatsapp_channel c where c.id=p_id and c.namespace=p_namespace for update;
  if not found or h.revision::text is distinct from p_data->>'revision' then return jsonb_build_object('applied',false);end if;
  if h.state='pending' then
   update app.whatsapp_channel set state=case when v_ok then 'connected' else 'failed' end,
    state_reason=case when v_ok then null else v_reason end,
    display_phone_e164=case when p_data->>'displayPhone'~'^\+[1-9][0-9]{1,14}$' then p_data->>'displayPhone' else display_phone_e164 end,
    recheck_wanted=false,last_check_failed_reason=null,last_check_failed_at=null,
    revision=revision+1,updated_at=now() where id=h.id;
  elsif h.state='connected' and h.recheck_wanted then
   update app.whatsapp_channel set recheck_wanted=false,
    last_check_failed_reason=case when v_ok then null else v_reason end,
    last_check_failed_at=case when v_ok then null else now() end,
    display_phone_e164=case when v_ok and p_data->>'displayPhone'~'^\+[1-9][0-9]{1,14}$' then p_data->>'displayPhone' else display_phone_e164 end,
    updated_at=now() where id=h.id;
  else return jsonb_build_object('applied',false);
  end if;
  return jsonb_build_object('applied',true);
 end if;
 raise exception 'INVALID_VERIFY_OPERATION';
end$$;
alter function app_private.whatsapp_verify(text,text,uuid,jsonb) owner to jomcall_agent_jobs;
revoke all on function app_private.whatsapp_verify(text,text,uuid,jsonb) from public;
grant execute on function app_private.whatsapp_verify(text,text,uuid,jsonb) to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
