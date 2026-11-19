-- Embedded Signup: an owner connects WhatsApp through Meta's popup instead of
-- pasting a phone number ID, a business account ID and an access token.
--
-- The browser hands JomCall the two IDs and a one-time code. The web process
-- seals the code into the credentials column (it still cannot read that
-- column), sets signup_pending and leaves the channel 'pending'. The agent
-- process claims it as any pending channel, exchanges the code for the
-- business's token at Meta, checks the number, subscribes the app, registers
-- the number (not when signup_coexistence is set: such a number stays on the
-- WhatsApp Business app) and hands back the sealed token with its result.
--
-- whatsapp_verify changes in three ways, all for a pending channel only:
--   claim   also returns signupPending and coexistence.
--   result  p_data.credentials (a sealed envelope) replaces the stored
--           credentials when the claimed channel was a signup and the check
--           passed. A failed signup clears the credentials: the code is spent.
--   result  p_data.warning (a fixed code) is recorded as the last failed
--           check on a channel that connected, so the settings page can say
--           that the number could not be registered.
-- A connected channel's re-check is unchanged.
--
-- Deploy order: this migration, then the agent, then the web.
--
-- Re-runnable.

alter table app.whatsapp_channel add column if not exists signup_pending boolean not null default false;
alter table app.whatsapp_channel add column if not exists signup_coexistence boolean not null default false;

grant select(signup_pending,signup_coexistence) on app.whatsapp_channel to jomcall_app;
grant insert(signup_pending,signup_coexistence) on app.whatsapp_channel to jomcall_app;
grant update(signup_pending,signup_coexistence) on app.whatsapp_channel to jomcall_app;

grant create on schema app_private to jomcall_agent_jobs;
create or replace function app_private.whatsapp_verify(p_action text,p_namespace text,p_id uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare h app.whatsapp_channel;r jsonb;v_ok boolean;v_reason text;v_new jsonb;v_warning text;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if p_action='claim' then
  select jsonb_build_object('id',c.id,'orgId',c.org_id,'revision',c.revision,'phoneNumberId',c.phone_number_id,'wabaId',c.waba_id,'credentials',c.credentials,
   'signupPending',c.state='pending' and c.signup_pending,'coexistence',c.signup_coexistence)into r
  from app.whatsapp_channel c where c.namespace=p_namespace and(c.state='pending' or(c.state='connected' and c.recheck_wanted))
  order by(c.state<>'pending'),c.updated_at,c.id limit 1;
  return r;
 elsif p_action='result' then
  v_ok:=coalesce((p_data->>'ok')::boolean,false);
  v_reason:=case when p_data->>'reason'~'^[A-Z0-9_]{1,60}$' then p_data->>'reason' else 'VERIFICATION_FAILED' end;
  v_warning:=case when p_data->>'warning'~'^[A-Z0-9_]{1,60}$' then p_data->>'warning' else null end;
  select * into h from app.whatsapp_channel c where c.id=p_id and c.namespace=p_namespace for update;
  if not found or h.revision::text is distinct from p_data->>'revision' then return jsonb_build_object('applied',false);end if;
  if h.state='pending' then
   -- A sealed envelope and nothing else: version 1 with three hex strings.
   v_new:=case when h.signup_pending and v_ok and jsonb_typeof(p_data->'credentials')='object'
     and p_data->'credentials'->>'version'='1' and p_data->'credentials'->>'iv'~'^[a-f0-9]{24}$'
     and p_data->'credentials'->>'tag'~'^[a-f0-9]{32}$' and p_data->'credentials'->>'data'~'^[a-f0-9]+$' and length(p_data->'credentials'->>'data')<=16384
    then jsonb_build_object('version',1,'iv',p_data->'credentials'->>'iv','tag',p_data->'credentials'->>'tag','data',p_data->'credentials'->>'data') else null end;
   -- A signup that passed must bring its token; without one the channel
   -- would be connected with a spent code in place of credentials.
   if h.signup_pending and v_ok and v_new is null then v_ok:=false;v_reason:='SIGNUP_TOKEN_MISSING';end if;
   update app.whatsapp_channel set state=case when v_ok then 'connected' else 'failed' end,
    state_reason=case when v_ok then null else v_reason end,
    display_phone_e164=case when p_data->>'displayPhone'~'^\+[1-9][0-9]{1,14}$' then p_data->>'displayPhone' else display_phone_e164 end,
    credentials=case when h.signup_pending then v_new else credentials end,
    credentials_set_at=case when h.signup_pending then case when v_new is null then null else now() end else credentials_set_at end,
    signup_pending=false,
    recheck_wanted=false,
    last_check_failed_reason=case when v_ok then v_warning else null end,
    last_check_failed_at=case when v_ok and v_warning is not null then now() else null end,
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
