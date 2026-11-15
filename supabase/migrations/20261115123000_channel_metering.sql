-- Usage metering and plan entitlements on the real channels.
--
-- Phone calls bill `voice_second` once per call, keyed `call:<call id>`, when
-- the call ends: through `call_end` (hang-up, transfer, worker error) or
-- through `maintain` (worker crash, token expiry). WhatsApp bills
-- `whatsapp_conversation` once per conversation, keyed `wa:<conversation id>`,
-- when the agent's first message in it is accepted by the provider. Both go
-- through app_private.record_usage (the function recordUsage wraps) inside the
-- agent's own security-definer functions.
--
-- A new call or a new WhatsApp conversation is admitted only when the plan
-- covers the channel and the wallet allows service (billing design section 4).
-- A call or conversation already under way is never cut off.
--
-- The agent login role loses direct access to the billing functions: it can
-- no longer bill an organization or read its balance. It sees only a refusal
-- code for the number that was dialled.
--
-- Re-runnable: columns and constraints are guarded, helpers are replaced, and
-- each function rewrite is skipped once applied. Design and decisions:
-- docs/superpowers/specs/2026-11-14-billing-design.md section 13.

-- Billing state of a call: null before this migration or while active;
-- 'pending' once ended and owed; 'billed' with the usage event; 'free' when
-- there is nothing to bill (never answered, or 0 seconds).
alter table app.call add column if not exists usage_state text;
alter table app.call add column if not exists billed_seconds integer;
alter table app.call add column if not exists usage_event_id uuid;
alter table app.conversation add column if not exists usage_state text;
alter table app.conversation add column if not exists usage_event_id uuid;
-- Failed billing attempts. Maintenance retries the least-tried first and stops
-- after 20, so a bill that can never land (a missing price, a key conflict)
-- cannot hold up the others; it stays 'pending' for an operator.
alter table app.call add column if not exists usage_attempts integer not null default 0;
alter table app.conversation add column if not exists usage_attempts integer not null default 0;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='app.call'::regclass and conname='call_usage_state_check') then
  alter table app.call add constraint call_usage_state_check check(
   (usage_state is null or usage_state in('pending','billed','free'))
   and (usage_state='billed')=(usage_event_id is not null)
   and (billed_seconds is null or billed_seconds>0)
   and (usage_state='billed')=(billed_seconds is not null));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='app.conversation'::regclass and conname='conversation_usage_state_check') then
  alter table app.conversation add constraint conversation_usage_state_check check(
   (usage_state is null or usage_state in('pending','billed'))
   and (usage_state='billed')=(usage_event_id is not null));
 end if;
end $$;
create index if not exists call_usage_pending on app.call(namespace,ended_at)where usage_state='pending';
create index if not exists conversation_usage_pending on app.conversation(org_id,last_message_at)where usage_state='pending';

-- The owner of agent_call and whatsapp_work calls the billing functions.
grant execute on function app_private.record_usage(uuid,text,integer,text,timestamptz,jsonb),
 app_private.wallet_state(uuid),app_private.plan_entitlements(uuid,timestamptz),
 app_private.charge_plan_period(uuid,timestamptz) to jomcall_agent_jobs;
-- The agent login role does not.
revoke execute on function app_private.record_usage(uuid,text,integer,text,timestamptz,jsonb),
 app_private.wallet_state(uuid),app_private.plan_entitlements(uuid,timestamptz) from jomcall_agent;

grant create on schema app_private to jomcall_agent_jobs;

-- Internal. Null when the organization may take a new call ('phone') or a new
-- WhatsApp conversation ('whatsapp'); otherwise the refusal code. The current
-- plan period is started or retried first, because nothing else schedules it
-- yet: without a period the plan reports no entitlements. Callers pass the
-- database clock. Grace (down to
-- -RM4.99) is still served; unfunded and exhausted are not.
create or replace function app_private.channel_admission(p_org uuid,p_need text,p_at timestamptz)returns text language plpgsql security definer set search_path='' as $$
declare e jsonb;w jsonb;begin
 if p_need not in('phone','whatsapp') or p_org is null or p_at is null then raise exception 'INVALID_ADMISSION';end if;
 begin
  perform app_private.charge_plan_period(p_org,p_at);
 exception when others then
  -- A failed charge leaves the period as it was; the entitlements below decide.
  raise warning 'PLAN_PERIOD_DEFERRED';
 end;
 e=app_private.plan_entitlements(p_org,p_at);
 if p_need='phone' and coalesce((e->>'phoneNumbers')::int,0)<1 then return 'NO_PHONE_ENTITLEMENT';end if;
 if p_need='whatsapp' and not coalesce((e->>'whatsappAgent')::boolean,false) then return 'NO_WHATSAPP_ENTITLEMENT';end if;
 w=app_private.wallet_state(p_org);
 if not coalesce((w->>'serviceAllowed')::boolean,false) then
  return case w->>'state' when 'unfunded' then 'WALLET_UNFUNDED' else 'WALLET_EXHAUSTED' end;
 end if;
 return null;
end$$;

-- Internal. Bills one ended call that is still owed. The seconds are the call
-- row's own duration (from the answer to the end), so the bill and the call
-- log always agree. The idempotency key makes a repeat a no-op.
create or replace function app_private.call_bill(p_call uuid)returns text language plpgsql security definer set search_path='' as $$
declare c app.call;r jsonb;begin
 select * into c from app.call where id=p_call for update;
 if not found or c.state<>'ended' or c.usage_state is distinct from 'pending' then return coalesce(c.usage_state,'none');end if;
 if c.answered_at is null or coalesce(c.duration_seconds,0)<=0 then
  update app.call set usage_state='free' where id=c.id;
  return 'free';
 end if;
 r=app_private.record_usage(c.org_id,'voice_second',c.duration_seconds,'call:'||c.id::text,coalesce(c.ended_at,now()),
  jsonb_build_object('callId',c.id::text));
 update app.call set usage_state='billed',usage_event_id=(r->>'usageEventId')::uuid,billed_seconds=c.duration_seconds where id=c.id;
 return 'billed';
end$$;

-- Internal. Bills one WhatsApp conversation the agent answered.
create or replace function app_private.conversation_bill(p_conversation uuid)returns text language plpgsql security definer set search_path='' as $$
declare c app.conversation;r jsonb;begin
 select * into c from app.conversation where id=p_conversation for update;
 if not found or c.usage_state is distinct from 'pending' then return coalesce(c.usage_state,'none');end if;
 r=app_private.record_usage(c.org_id,'whatsapp_conversation',1,'wa:'||c.id::text,now(),
  jsonb_build_object('conversationId',c.id::text));
 update app.conversation set usage_state='billed',usage_event_id=(r->>'usageEventId')::uuid where id=c.id;
 return 'billed';
end$$;

alter function app_private.channel_admission(uuid,text,timestamptz) owner to jomcall_agent_jobs;
alter function app_private.call_bill(uuid) owner to jomcall_agent_jobs;
alter function app_private.conversation_bill(uuid) owner to jomcall_agent_jobs;
revoke all on function app_private.channel_admission(uuid,text,timestamptz) from public;
revoke all on function app_private.call_bill(uuid) from public;
revoke all on function app_private.conversation_bill(uuid) from public;
revoke create on schema app_private from jomcall_agent_jobs;

-- Phone calls. Rewritten from the CURRENT body; each expected text must be
-- found exactly once or the migration fails.
do $migration$
declare body text;hits int;i int;
 olds text[]:=array[
  -- 1. A variable for the admission result.
  $o$v_prev uuid;v_caller text;begin$o$,
  -- 2. Admission runs inside the call-start lock, before the refusal chain.
  $o$  if(select calls_suspended_at from app.organization where id=n.org_id)is not null then v_refusal='CALLS_SUSPENDED';$o$,
  -- 3. Plan and wallet refusals come after the configuration refusals.
  $o$  elsif v_caller is not null and(select count(*)from app.call x where x.org_id=n.org_id and x.caller_e164=v_caller$o$,
  -- 4. A crashed call's seconds stop at the last sign it was alive.
  $o$   duration_seconds=greatest(0,extract(epoch from now()-coalesce(answered_at,started_at))::int),token_hash=null,revision=revision+1$o$,
  -- 5. Maintenance bills every call still owed (crash recovery).
  $o$   where id in(select id from app.call where namespace=p_namespace and state='active' and token_expires_at<=now()limit 100);
  return '{}';$o$,
  -- 6. A normal end bills in the same transaction.
  $o$    when answered_at is null then 'abandoned' else 'answered' end
   where id=c.id;
  return '{}';$o$];
 news text[]:=array[
  $n$v_prev uuid;v_caller text;v_admission text;begin$n$,
  $n$  -- The database clock, never the agent's `at`: the agent process must not
  -- choose which plan period is charged or checked.
  v_admission=app_private.channel_admission(n.org_id,'phone',now());
  if(select calls_suspended_at from app.organization where id=n.org_id)is not null then v_refusal='CALLS_SUSPENDED';$n$,
  $n$  elsif v_admission is not null then v_refusal=v_admission;
  elsif v_caller is not null and(select count(*)from app.call x where x.org_id=n.org_id and x.caller_e164=v_caller$n$,
  $n$   duration_seconds=case when answered_at is null then greatest(0,extract(epoch from now()-started_at)::int)
    else greatest(0,extract(epoch from coalesce((select max(q.created_at)from app.call_turn q where q.org_id=app.call.org_id and q.call_id=app.call.id),answered_at)-answered_at)::int)end,
   usage_state='pending',token_hash=null,revision=revision+1$n$,
  $n$   where id in(select id from app.call where namespace=p_namespace and state='active' and token_expires_at<=now()limit 100);
  -- Each owed call on its own: one that cannot be billed stays owed and is
  -- retried on the next pass, without holding up the others.
  for v_prev in select id from app.call where namespace=p_namespace and usage_state='pending' and usage_attempts<20 order by usage_attempts,ended_at,id limit 100 loop
   begin
    perform app_private.call_bill(v_prev);
   exception when others then
    update app.call set usage_attempts=usage_attempts+1 where id=v_prev;
    raise warning 'CALL_BILLING_DEFERRED';
   end;
  end loop;
  return '{}';$n$,
  $n$    when answered_at is null then 'abandoned' else 'answered' end,
   usage_state='pending'
   where id=c.id;
  -- Billed now; if billing fails the call still ends, stays owed and
  -- maintenance retries it. The key makes a retry a no-op.
  begin
   perform app_private.call_bill(c.id);
  exception when others then
   update app.call set usage_attempts=usage_attempts+1 where id=c.id;
   raise warning 'CALL_BILLING_DEFERRED';
  end;
  return '{}';$n$];
begin
 select pg_get_functiondef('app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.channel_admission' in body)>0 then return;end if;
 for i in 1..array_length(olds,1) loop
  hits=(length(body)-length(replace(body,olds[i],'')))/length(olds[i]);
  if hits<>1 then raise exception 'agent_call: anchor % found % times',i,hits;end if;
  body=replace(body,olds[i],news[i]);
 end loop;
 execute body;
end
$migration$;

-- WhatsApp. Same approach.
do $migration$
declare body text;hits int;i int;
 olds text[]:=array[
  -- 1. Admission for a conversation the agent has not answered yet.
  $o$    update app.conversation set needs_attention=true,attention_reason='AGENT_NOT_PUBLISHED',revision=revision+1 where id=c.id;return jsonb_build_object('skipped',true);
   end if;
  end if;$o$,
  -- 2. The agent's first message accepted by the provider bills the conversation.
  $o$   update app.conversation set last_message_at=now() where id=c.id;
  elsif v_status in('failed','blocked','unknown')then$o$,
  -- 3. Maintenance retries conversations still owed.
  $o$state<>'pending' and processed_at<now()-interval '7 days' limit 1000);
  return '{}';$o$];
 news text[]:=array[
  $n$    update app.conversation set needs_attention=true,attention_reason='AGENT_NOT_PUBLISHED',revision=revision+1 where id=c.id;return jsonb_build_object('skipped',true);
   end if;
   -- A conversation already answered (and so billed) in this window keeps
   -- its agent. A new one needs the plan's WhatsApp agent and a wallet that
   -- allows service; otherwise it goes to the human inbox and nothing is sent.
   if c.usage_state is null then
    v_kind:=app_private.channel_admission(c.org_id,'whatsapp',now());
    if v_kind is not null then
     update app.conversation_turn set state='skipped',error_code=v_kind,completed_at=now() where id=t.id;
     update app.conversation set needs_attention=true,attention_reason=v_kind,revision=revision+1 where id=c.id;return jsonb_build_object('skipped',true);
    end if;
   end if;
  end if;$n$,
  $n$   update app.conversation set last_message_at=now() where id=c.id;
   if m.author='agent' and c.usage_state is null then
    update app.conversation set usage_state='pending' where id=c.id;
    begin
     perform app_private.conversation_bill(c.id);
    exception when others then
     update app.conversation set usage_attempts=usage_attempts+1 where id=c.id;
     raise warning 'CONVERSATION_BILLING_DEFERRED';
    end;
   end if;
  elsif v_status in('failed','blocked','unknown')then$n$,
  $n$state<>'pending' and processed_at<now()-interval '7 days' limit 1000);
  for v_id in select x.id from app.conversation x join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)
   where h.namespace=p_namespace and x.usage_state='pending' and x.usage_attempts<20 order by x.usage_attempts,x.last_message_at,x.id limit 100 loop
   begin
    perform app_private.conversation_bill(v_id);
   exception when others then
    update app.conversation set usage_attempts=usage_attempts+1 where id=v_id;
    raise warning 'CONVERSATION_BILLING_DEFERRED';
   end;
  end loop;
  return '{}';$n$];
begin
 select pg_get_functiondef('app_private.whatsapp_work(text,text,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('app_private.channel_admission' in body)>0 then return;end if;
 for i in 1..array_length(olds,1) loop
  hits=(length(body)-length(replace(body,olds[i],'')))/length(olds[i]);
  if hits<>1 then raise exception 'whatsapp_work: anchor % found % times',i,hits;end if;
  body=replace(body,olds[i],news[i]);
 end loop;
 execute body;
end
$migration$;
