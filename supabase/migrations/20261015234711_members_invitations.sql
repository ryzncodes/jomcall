create table app.invitation(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id) on delete cascade,email text not null,role text not null check(role in('admin','staff')),
 invited_by uuid not null,token_hash text not null unique,delivery_ciphertext jsonb,expires_at timestamptz not null default now()+interval '7 days',state text not null default 'pending' check(state in('pending','accepted','revoked')),
 accepted_by uuid,delivery_state text not null default 'pending',revision integer not null default 1,created_at timestamptz not null default now(),unique(org_id,id));
create table app.outbox(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id) on delete cascade,namespace text not null default 'local',kind text not null,resource_id uuid not null,
 operation_id uuid not null unique default gen_random_uuid(),delivered_at timestamptz,lease_until timestamptz,attempts integer not null default 0,created_at timestamptz not null default now(),unique(org_id,id));
alter table app.invitation enable row level security;alter table app.invitation force row level security;
alter table app.outbox enable row level security;alter table app.outbox force row level security;
create policy manager_read on app.invitation for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) in('owner','admin'));
create policy manager_insert on app.invitation for insert to jomcall_app with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and invited_by=nullif(current_setting('app.user_id',true),'')::uuid and (app_private.active_role(org_id)='owner' or(app_private.active_role(org_id)='admin' and role='staff')));
create policy manager_update on app.invitation for update to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and (app_private.active_role(org_id)='owner' or(app_private.active_role(org_id)='admin' and role='staff'))) with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and(app_private.active_role(org_id)='owner' or(app_private.active_role(org_id)='admin' and role='staff')));
create policy outbox_insert on app.outbox for insert to jomcall_app with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) in('owner','admin'));
grant select,insert,update on app.invitation to jomcall_app;grant insert on app.outbox to jomcall_app;
do $$ begin if not exists(select from pg_roles where rolname='jomcall_members') then create role jomcall_members nologin noinherit bypassrls;end if;end $$;
grant jomcall_members to postgres;grant usage on schema app,app_private to jomcall_members;grant create on schema app_private to jomcall_members;
grant select,update on app.organization,app.member,app.invitation to jomcall_members;grant insert on app.member to jomcall_members;
grant execute on function app_private.session_active(),app_private.active_role(uuid) to jomcall_members;
create function app_private.change_member(p_org uuid,p_member uuid,p_revision int,p_role text,p_active boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_role text; target app.member;begin
 perform 1 from app.organization where id=p_org for update;actor_role:=app_private.active_role(p_org);
 if actor_role is null then raise exception 'NOT_FOUND';end if;
 if actor_role='staff' then raise exception 'FORBIDDEN';end if;
 select * into target from app.member where org_id=p_org and id=p_member for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if target.role='owner' then raise exception 'CONFLICT';end if;
 if actor_role='admin' and(target.role<>'staff' or coalesce(p_role,target.role)<>'staff')then raise exception 'FORBIDDEN';end if;
 if target.revision<>p_revision then raise exception 'CONFLICT';end if;
 if coalesce(p_role,target.role) not in('staff','admin')then raise exception 'FORBIDDEN';end if;
 update app.member set role=coalesce(p_role,role),active=p_active,revision=revision+1 where id=target.id returning * into target;return to_jsonb(target);
end $$;
alter function app_private.change_member(uuid,uuid,int,text,boolean) owner to jomcall_members;
create function app_private.accept_invitation(p_hash text,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv app.invitation; actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; inviter_role text; result app.member;
begin
 if not app_private.session_active() then raise exception 'UNAUTHORIZED';end if;
 select * into inv from app.invitation where token_hash=p_hash;
 if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from app.organization where id=inv.org_id for update;
 select * into inv from app.invitation where id=inv.id for update;
 if inv.state='accepted' and inv.accepted_by=actor then select * into result from app.member where org_id=inv.org_id and user_id=actor and active;if found then return to_jsonb(result);end if;raise exception 'NOT_FOUND';end if;
 if inv.state<>'pending' or inv.expires_at<=now() or lower(inv.email)<>lower(p_email)then raise exception 'NOT_FOUND';end if;
 select role into inviter_role from app.member where org_id=inv.org_id and user_id=inv.invited_by and active;
 if inviter_role is null or inviter_role='staff' or(inviter_role='admin' and inv.role<>'staff')then raise exception 'FORBIDDEN';end if;
 select * into result from app.member where org_id=inv.org_id and user_id=actor;
 if found and result.active then raise exception 'CONFLICT';end if;
 insert into app.member(org_id,user_id,role) values(inv.org_id,actor,inv.role) on conflict(org_id,user_id) do update set active=true,role=excluded.role,revision=app.member.revision+1 returning * into result;
 update app.invitation set state='accepted',accepted_by=actor,delivery_ciphertext=null,revision=revision+1 where id=inv.id;
 return to_jsonb(result);
end $$;
alter function app_private.accept_invitation(text,text) owner to jomcall_members;
revoke all on function app_private.change_member(uuid,uuid,int,text,boolean),app_private.accept_invitation(text,text) from public;
grant execute on function app_private.change_member(uuid,uuid,int,text,boolean),app_private.accept_invitation(text,text) to jomcall_app;
revoke create on schema app_private from jomcall_members;
create index outbox_pending on app.outbox(namespace,created_at) where delivered_at is null;
