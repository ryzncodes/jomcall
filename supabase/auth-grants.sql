-- Auth's schema is owned by Supabase's internal admin, not the migration login.
-- Apply only inside the isolated local container, after app roles exist.
grant usage on schema auth to jomcall_authz;
grant select(id,user_id) on auth.sessions to jomcall_authz;
grant select(id,email) on auth.users to jomcall_authz;

-- Phase 2 worker verifies the original authenticated session on every operation.
grant usage on schema auth to jomcall_agent_jobs;
grant select(id,user_id) on auth.sessions to jomcall_agent_jobs;
