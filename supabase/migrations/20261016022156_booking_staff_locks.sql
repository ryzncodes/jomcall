do $$begin if not exists(select from pg_roles where rolname='jomcall_booking_locker')then create role jomcall_booking_locker nologin noinherit bypassrls;end if;end$$;
grant jomcall_booking_locker to postgres;
grant usage on schema app,app_private to jomcall_booking_locker;
grant select on app.location,app.booking_resource to jomcall_booking_locker;
grant update(id) on app.location,app.booking_resource to jomcall_booking_locker;
grant execute on function app_private.active_role(uuid) to jomcall_booking_locker;
grant create on schema app_private to jomcall_booking_locker;
create function app_private.lock_booking_resource(p_org uuid,p_resource uuid)returns void language plpgsql security definer set search_path='' as $$
declare loc uuid;begin
 if p_org is distinct from nullif(current_setting('app.org_id',true),'')::uuid or app_private.active_role(p_org)is null then raise exception 'NOT_FOUND';end if;
 select location_id into loc from app.booking_resource where org_id=p_org and id=p_resource;
 if loc is null then raise exception 'NOT_FOUND';end if;
 perform id from app.location where org_id=p_org and id=loc and archived_at is null for update;
 if not found then raise exception 'NOT_FOUND';end if;
 perform id from app.booking_resource where org_id=p_org and id=p_resource for update;
end$$;
alter function app_private.lock_booking_resource(uuid,uuid)owner to jomcall_booking_locker;
revoke all on function app_private.lock_booking_resource(uuid,uuid)from public;
grant execute on function app_private.lock_booking_resource(uuid,uuid)to jomcall_app;
revoke create on schema app_private from jomcall_booking_locker;
