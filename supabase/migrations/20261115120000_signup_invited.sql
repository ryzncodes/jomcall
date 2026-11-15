-- Sign-up allow-list (JOMCALL_SIGNUP_ALLOW, hosted mode only): an address
-- that is not on the list may still create an account when a workspace has a
-- pending, unexpired invitation for it. The web login (jomcall_app) cannot see
-- invitations before sign-in, so this narrow function answers yes or no for
-- one address. It lists nothing and returns no invitation detail.
--
-- app.invitation forces row-level security, so the function is owned by
-- jomcall_members (bypassrls, select on app.invitation), the same owner as
-- app_private.accept_invitation. Ownership needs CREATE on app_private for a
-- moment; it is granted and taken back here, as in the members migration.
create function app_private.signup_invited(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_email is not null and exists(
  select 1 from app.invitation i
  where lower(i.email)=lower(trim(p_email)) and i.state='pending' and i.expires_at>now())
$$;
grant create on schema app_private to jomcall_members;
alter function app_private.signup_invited(text) owner to jomcall_members;
revoke create on schema app_private from jomcall_members;
revoke all on function app_private.signup_invited(text) from public;
grant execute on function app_private.signup_invited(text) to jomcall_app;
