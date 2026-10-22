-- Expose only a current workspace's membership identities, never a global Auth directory.
grant create on schema app_private to jomcall_authz;
create function app_private.workspace_members(p_org uuid) returns table(id uuid,org_id uuid,user_id uuid,role text,active boolean,revision int,email text)
language sql stable security definer set search_path='' as $$
 select m.id,m.org_id,m.user_id,m.role,m.active,m.revision,u.email::text from app.member m join auth.users u on u.id=m.user_id
 where m.org_id=p_org and app_private.active_role(p_org) is not null order by m.created_at,m.id
$$;
alter function app_private.workspace_members(uuid) owner to jomcall_authz;
revoke all on function app_private.workspace_members(uuid) from public;
grant execute on function app_private.workspace_members(uuid) to jomcall_app;
revoke create on schema app_private from jomcall_authz;
