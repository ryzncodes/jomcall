-- "Submit to WhatsApp": staff send a message template for Meta's review from
-- JomCall, instead of creating it by hand in WhatsApp Manager.
--
-- The web process only marks the template (submit_state 'wanted'). The agent
-- process claims it, creates the template at the provider with the
-- business's stored token and reports the outcome. On success the template
-- counts as seen at the provider (provider_status set), so from then on the
-- hourly status check keeps its status and staff no longer record one by
-- hand. On failure the reason is kept for the settings page and staff can
-- try again.
--
-- A claim is not safe to repeat at the provider (a second template with the
-- same name and language is refused), so a claimed template is 'sending'
-- and is claimed again only after five minutes, for an agent process that
-- died in between. If the first attempt did reach the provider, the retry
-- fails and the next status check finds the template by name and language.
--
-- Deploy order: this migration, then the agent, then the web.
--
-- Re-runnable.

alter table app.whatsapp_template add column if not exists submit_state text;
alter table app.whatsapp_template add column if not exists submit_reason text;
alter table app.whatsapp_template add column if not exists submit_claimed_at timestamptz;
alter table app.whatsapp_template add column if not exists submitted_at timestamptz;
alter table app.whatsapp_template drop constraint if exists whatsapp_template_submit_state_check;
alter table app.whatsapp_template add constraint whatsapp_template_submit_state_check
 check(submit_state is null or submit_state in('wanted','sending','failed'));
alter table app.whatsapp_template drop constraint if exists whatsapp_template_submit_reason_check;
alter table app.whatsapp_template add constraint whatsapp_template_submit_reason_check
 check(submit_reason is null or submit_reason~'^[A-Z0-9_]{1,60}$');

-- The web role already reads the whole template row; it may only ask.
grant update(submit_state,submit_reason) on app.whatsapp_template to jomcall_app;
grant update(submit_state,submit_reason,submit_claimed_at,submitted_at) on app.whatsapp_template to jomcall_agent_jobs;

grant create on schema app_private to jomcall_agent_jobs;
-- Agent process only.
--   claim   first drops requests that can no longer be served: the template
--           was switched off, or the status check has meanwhile seen it at
--           the provider. Then takes one template that staff asked to submit
--           (or one left 'sending' for five minutes), on a connected channel
--           with a business account and stored credentials, not at the
--           provider (never seen, or seen and now gone) and not switched
--           off. Marks it 'sending'. Returns what the provider needs, with
--           the sealed credentials, the business account and the claim time.
--   result  p_data {claimedAt, wabaId, ok, reason, status}. Applied only to
--           the claim it answers. A channel that is no longer connected to
--           the claimed business account ends the request as failed
--           (TEMPLATE_SUBMIT_STALE): the template was created somewhere this
--           workspace no longer uses. ok: recorded as seen at the provider
--           with the status it reported (PENDING when unsaid); a template
--           switched off meanwhile stays disabled. not ok: 'failed' with
--           the reason.
create or replace function app_private.whatsapp_template_submit(p_action text,p_namespace text,p_id uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare t app.whatsapp_template;c app.whatsapp_channel;v_raw text;v_new text;v_at timestamptz;begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if p_action='claim' then
  update app.whatsapp_template x set submit_state=null,submit_reason=null,revision=x.revision+1,updated_at=now()
  from app.whatsapp_channel ch where ch.org_id=x.org_id and ch.id=x.channel_id and ch.namespace=p_namespace
   and x.submit_state in('wanted','failed')
   and(x.disabled_by_staff or(x.provider_status is not null and x.provider_status<>'NOT_FOUND'));
  select x.* into t from app.whatsapp_template x join app.whatsapp_channel ch on ch.org_id=x.org_id and ch.id=x.channel_id
  where ch.namespace=p_namespace and ch.state='connected' and ch.waba_id is not null and ch.credentials is not null
   and(x.provider_status is null or x.provider_status='NOT_FOUND')and not x.disabled_by_staff
   and(x.submit_state='wanted' or(x.submit_state='sending' and x.submit_claimed_at<now()-interval '5 minutes'))
  order by x.updated_at,x.id limit 1 for update of x skip locked;
  if not found then return null;end if;
  select * into c from app.whatsapp_channel ch where ch.org_id=t.org_id and ch.id=t.channel_id;
  v_at:=clock_timestamp();
  update app.whatsapp_template set submit_state='sending',submit_claimed_at=v_at where id=t.id;
  return jsonb_build_object('id',t.id,'orgId',t.org_id,'wabaId',c.waba_id,'credentials',c.credentials,
   'name',t.name,'language',t.language,'category',t.category,'body',t.body,'variables',t.variables,'claimedAt',v_at);
 elsif p_action='result' then
  select x.* into t from app.whatsapp_template x join app.whatsapp_channel ch on ch.org_id=x.org_id and ch.id=x.channel_id
  where x.id=p_id and ch.namespace=p_namespace for update of x;
  if not found or t.submit_state is distinct from 'sending' then return jsonb_build_object('applied',false);end if;
  begin v_at:=(p_data->>'claimedAt')::timestamptz;exception when others then v_at:=null;end;
  if v_at is null or v_at is distinct from t.submit_claimed_at then return jsonb_build_object('applied',false);end if;
  select * into c from app.whatsapp_channel ch where ch.org_id=t.org_id and ch.id=t.channel_id;
  if c.state<>'connected' or c.waba_id is distinct from p_data->>'wabaId' then
   update app.whatsapp_template set submit_state='failed',submit_reason='TEMPLATE_SUBMIT_STALE',revision=revision+1,updated_at=now() where id=t.id;
   return jsonb_build_object('applied',true);
  end if;
  if not coalesce((p_data->>'ok')::boolean,false) then
   update app.whatsapp_template set submit_state='failed',
    submit_reason=case when p_data->>'reason'~'^[A-Z0-9_]{1,60}$' then p_data->>'reason' else 'TEMPLATE_SUBMIT_FAILED' end,
    revision=revision+1,updated_at=now() where id=t.id;
   return jsonb_build_object('applied',true);
  end if;
  v_raw:=case when p_data->>'status'~'^[A-Z_]{1,60}$' and p_data->>'status'<>'NOT_FOUND' then p_data->>'status' else 'PENDING' end;
  -- The same mapping the status check uses; an unknown name reads as pending
  -- for a template that was created a moment ago.
  v_new:=case v_raw
   when 'APPROVED' then 'approved'
   when 'PAUSED' then 'paused'
   when 'REJECTED' then 'rejected'
   when 'DISABLED' then 'disabled' when 'ARCHIVED' then 'disabled' when 'PENDING_DELETION' then 'disabled' when 'LIMIT_EXCEEDED' then 'disabled'
   else 'pending' end;
  -- Switched off by staff while it was on its way: the provider's status is
  -- recorded and the template stays off, as the status check does.
  if t.disabled_by_staff then v_new:='disabled';end if;
  update app.whatsapp_template set status=v_new,provider_status=v_raw,synced_at=now(),submitted_at=now(),
   submit_state=null,submit_reason=null,revision=revision+1,updated_at=now() where id=t.id;
  return jsonb_build_object('applied',true);
 end if;
 raise exception 'INVALID_TEMPLATE_SUBMIT_OPERATION';
end$$;
alter function app_private.whatsapp_template_submit(text,text,uuid,jsonb) owner to jomcall_agent_jobs;
revoke all on function app_private.whatsapp_template_submit(text,text,uuid,jsonb) from public;
grant execute on function app_private.whatsapp_template_submit(text,text,uuid,jsonb) to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
