alter table app.invitation add column delivery_operation_id uuid not null default gen_random_uuid();
grant insert on app.audit_log to jomcall_members;
create or replace function app_private.accept_invitation(p_hash text,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id) values(inv.org_id,actor,'invitation.accepted','member',result.id);
 return to_jsonb(result);
end $$;
