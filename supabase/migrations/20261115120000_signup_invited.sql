-- Sign-up allow-list (JOMCALL_SIGNUP_ALLOW, hosted mode only): an address
-- that is not on the list may still create an account when a workspace has a
-- pending, unexpired invitation for it. The web login (jomcall_app) cannot see
-- invitations before sign-in, so this narrow function answers yes or no for
-- one address. It lists nothing and returns no invitation detail.
create function app_private.signup_invited(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_email is not null and exists(
  select 1 from app.invitation i
  where lower(i.email)=lower(trim(p_email)) and i.state='pending' and i.expires_at>now())
$$;
revoke all on function app_private.signup_invited(text) from public;
grant execute on function app_private.signup_invited(text) to jomcall_app;
