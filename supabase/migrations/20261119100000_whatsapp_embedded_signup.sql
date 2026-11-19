-- Embedded Signup: an owner connects WhatsApp through Meta's popup instead of
-- pasting a phone number ID, a business account ID and an access token.
--
-- The browser hands JomCall the two IDs and a one-time code. The web process
-- seals the code into signup_code (a column it can write and never read) and
-- sets signup_pending. The stored credentials are not touched: a number that
-- is connected and keeps its phone number ID stays connected and keeps
-- answering on its old token while the agent process works; any other
-- channel goes to 'pending' as on a first connect.
--
-- The agent process claims the channel, exchanges the code for the business's
-- token at Meta, checks the number, subscribes the app, registers the number
-- (not when signup_coexistence is set: such a number stays on the WhatsApp
-- Business app) and hands back the sealed token with its result.
--
-- whatsapp_verify, compared with 20261118100000:
--   claim   also takes a connected channel with signup_pending, and returns
--           signupPending, signupCode and coexistence.
--   result  for a signup that passed, p_data.credentials (a sealed envelope)
--           replaces the stored credentials. p_data.credentials is ignored
--           for anything that is not a signup.
--           for a signup that failed, the stored credentials stay as they
--           were: a pending channel ends 'failed', a connected one stays
--           connected with the reason recorded as its last failed check.
--   result  p_data.warning (a fixed code) is recorded as the last failed
--           check on a signup that connected, so the settings page can say
--           that the number could not be registered.
--   The spent code is always cleared. Pasted-token connects and re-checks
--   behave as before.
--
-- Deploy order: this migration, then the agent, then the web.
--
-- Re-runnable.

alter table app.whatsapp_channel add column if not exists signup_pending boolean not null default false;
alter table app.whatsapp_channel add column if not exists signup_coexistence boolean not null default false;
alter table app.whatsapp_channel add column if not exists signup_code jsonb;
alter table app.whatsapp_channel drop constraint if exists whatsapp_channel_signup_code_check;
alter table app.whatsapp_channel add constraint whatsapp_channel_signup_code_check
 check(signup_code is null or octet_length(signup_code::text)<=8192);

-- The web role writes the sealed code and never reads it back.
grant select(signup_pending,signup_coexistence) on app.whatsapp_channel to jomcall_app;
grant insert(signup_pending,signup_coexistence,signup_code) on app.whatsapp_channel to jomcall_app;
grant update(signup_pending,signup_coexistence,signup_code) on app.whatsapp_channel to jomcall_app;

grant create on schema app_private to jomcall_agent_jobs;
create or replace function app_private.whatsapp_verify(p_action text,p_namespace text,p_id uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare h app.whatsapp_channel;r jsonb;v_ok boolean;v_reason text;v_new jsonb;v_warning text;v_phone text;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if p_action='claim' then
  select jsonb_build_object('id',c.id,'orgId',c.org_id,'revision',c.revision,'phoneNumberId',c.phone_number_id,'wabaId',c.waba_id,'credentials',c.credentials,
   'signupPending',c.signup_pending,'signupCode',case when c.signup_pending then c.signup_code else null end,'coexistence',c.signup_coexistence)into r
  from app.whatsapp_channel c where c.namespace=p_namespace and(c.state='pending' or(c.state='connected' and(c.recheck_wanted or c.signup_pending)))
  order by(c.state<>'pending'),c.updated_at,c.id limit 1;
  return r;
 elsif p_action='result' then
  v_ok:=coalesce((p_data->>'ok')::boolean,false);
  v_reason:=case when p_data->>'reason'~'^[A-Z0-9_]{1,60}$' then p_data->>'reason' else 'VERIFICATION_FAILED' end;
  v_warning:=case when p_data->>'warning'~'^[A-Z0-9_]{1,60}$' then p_data->>'warning' else null end;
  v_phone:=case when p_data->>'displayPhone'~'^\+[1-9][0-9]{1,14}$' then p_data->>'displayPhone' else null end;
  select * into h from app.whatsapp_channel c where c.id=p_id and c.namespace=p_namespace for update;
  if not found or h.revision::text is distinct from p_data->>'revision' then return jsonb_build_object('applied',false);end if;
  if h.signup_pending and h.state in('pending','connected') then
   -- A sealed envelope and nothing else: version 1 with three hex strings,
   -- short enough for the column's size check.
   v_new:=case when v_ok and jsonb_typeof(p_data->'credentials')='object'
     and p_data->'credentials'->>'version'='1' and p_data->'credentials'->>'iv'~'^[a-f0-9]{24}$'
     and p_data->'credentials'->>'tag'~'^[a-f0-9]{32}$' and p_data->'credentials'->>'data'~'^[a-f0-9]+$'
     and length(p_data->'credentials'->>'data')<=7900
    then jsonb_build_object('version',1,'iv',p_data->'credentials'->>'iv','tag',p_data->'credentials'->>'tag','data',p_data->'credentials'->>'data') else null end;
   -- A signup that passed must bring its token.
   if v_ok and v_new is null then v_ok:=false;v_reason:='SIGNUP_TOKEN_MISSING';end if;
   if v_ok then
    update app.whatsapp_channel set state='connected',state_reason=null,
     display_phone_e164=coalesce(v_phone,display_phone_e164),
     credentials=v_new,credentials_set_at=now(),
     signup_pending=false,signup_code=null,recheck_wanted=false,
     last_check_failed_reason=v_warning,
     last_check_failed_at=case when v_warning is null then null else now() end,
     revision=revision+1,updated_at=now() where id=h.id;
   elsif h.state='pending' then
    update app.whatsapp_channel set state='failed',state_reason=v_reason,
     signup_pending=false,signup_code=null,recheck_wanted=false,
     last_check_failed_reason=null,last_check_failed_at=null,
     revision=revision+1,updated_at=now() where id=h.id;
   else
    -- A working number stays connected on its old token; only a warning.
    update app.whatsapp_channel set signup_pending=false,signup_code=null,
     last_check_failed_reason=v_reason,last_check_failed_at=now(),
     revision=revision+1,updated_at=now() where id=h.id;
   end if;
  elsif h.state='pending' then
   update app.whatsapp_channel set state=case when v_ok then 'connected' else 'failed' end,
    state_reason=case when v_ok then null else v_reason end,
    display_phone_e164=coalesce(v_phone,display_phone_e164),
    recheck_wanted=false,last_check_failed_reason=null,last_check_failed_at=null,
    revision=revision+1,updated_at=now() where id=h.id;
  elsif h.state='connected' and h.recheck_wanted then
   update app.whatsapp_channel set recheck_wanted=false,
    last_check_failed_reason=case when v_ok then null else v_reason end,
    last_check_failed_at=case when v_ok then null else now() end,
    display_phone_e164=case when v_ok then coalesce(v_phone,display_phone_e164) else display_phone_e164 end,
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
