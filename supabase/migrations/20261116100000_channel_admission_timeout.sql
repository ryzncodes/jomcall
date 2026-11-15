-- Admission must not stall every call start (billing design section 13).
--
-- agent_call('call_start') holds the global 'jomcall.call_start' lock while it
-- runs channel_admission, and admission waits on the organization's 'wallet:'
-- advisory lock (charge_plan_period). A maintenance pass billing many items,
-- or a top-up, can hold that lock for a while, and until now every
-- organization's call start waited behind it with no limit.
--
-- This gives channel_admission its own lock_timeout. The setting applies only
-- while the function runs and is restored when it returns (a function-level
-- SET), so nothing else in call_start or whatsapp_work changes. A wait longer
-- than the timeout raises lock_not_available inside admission, which is
-- handled as before:
--   - while charging the period: the charge is deferred; if the period that
--     was already charged still gives the entitlement, the plan and wallet are
--     read as usual (neither read takes a lock); if not, BILLING_CHECK_FAILED;
--   - anywhere else: BILLING_CHECK_FAILED.
-- BILLING_CHECK_FAILED is answered and marked (owner decision A, 2026-11-15).
--
-- Re-runnable: the guard skips the change when the function already carries
-- this setting.
do $m$
declare v_conf text[];begin
 select proconfig into v_conf from pg_proc
  where oid='app_private.channel_admission(uuid,text,timestamptz,text)'::regprocedure;
 if exists(select 1 from unnest(coalesce(v_conf,'{}'::text[])) c where c like 'lock_timeout=%') then return;end if;
 alter function app_private.channel_admission(uuid,text,timestamptz,text) set lock_timeout='500ms';
end
$m$;
