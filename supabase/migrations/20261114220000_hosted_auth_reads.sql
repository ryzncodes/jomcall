-- Hosted Supabase: the migration login (postgres) holds USAGE on schema auth
-- without the grant option, so `grant usage on schema auth to jomcall_authz`
-- in the first migration, and the same grants in supabase/auth-grants.sql, only
-- raise a warning there. jomcall_authz and jomcall_agent_jobs then cannot reach
-- auth.sessions or auth.users, and every signed-in request fails.
--
-- The migration login can already read those tables itself. These two narrow
-- functions run as that login and return exactly what the two roles could read
-- before: whether a session belongs to a user, and one user's email address.
-- Neither lists rows. The three callers below are otherwise unchanged.
create function app_private.auth_session_owned(p_session uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_session is not null and p_user is not null
 and exists(select 1 from auth.sessions a where a.id=p_session and a.user_id=p_user)
$$;
revoke all on function app_private.auth_session_owned(uuid,uuid) from public;
grant execute on function app_private.auth_session_owned(uuid,uuid) to jomcall_authz,jomcall_agent_jobs;

create function app_private.auth_user_email(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select u.email::text from auth.users u where u.id=p_user
$$;
revoke all on function app_private.auth_user_email(uuid) from public;
grant execute on function app_private.auth_user_email(uuid) to jomcall_authz;

create or replace function app_private.session_active() returns boolean language sql stable security definer set search_path='' as $$
 select app_private.auth_session_owned(nullif(current_setting('app.session_id',true),'')::uuid,nullif(current_setting('app.user_id',true),'')::uuid)
$$;

create or replace function app_private.workspace_members(p_org uuid) returns table(id uuid,org_id uuid,user_id uuid,role text,active boolean,revision int,email text)
language sql stable security definer set search_path='' as $$
 select m.id,m.org_id,m.user_id,m.role,m.active,m.revision,app_private.auth_user_email(m.user_id) from app.member m
 where m.org_id=p_org and app_private.active_role(p_org) is not null order by m.created_at,m.id
$$;

create or replace function app_private.agent_authorized(p_session app.test_session)returns boolean language sql stable security definer set search_path='' as $$
 select p_session.state='open' and p_session.expires_at>now()
 and exists(select 1 from app.member m where m.org_id=p_session.org_id and m.user_id=p_session.creator_id and m.active and m.role in('owner','admin'))
 and app_private.auth_session_owned(p_session.auth_session_id,p_session.creator_id)
 and (p_session.contact_id is null or exists(select 1 from app.contact c where c.org_id=p_session.org_id and c.id=p_session.contact_id and not c.deletion_pending))
$$;
