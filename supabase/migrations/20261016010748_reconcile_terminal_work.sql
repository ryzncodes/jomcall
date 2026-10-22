-- Reconcile queue outcomes without granting the business worker access to queue tables.
-- Cursor rotation bounds each pass; only the latest delivered operation is eligible.
create function app_private.unsettled_outbox(p_namespace text,p_after uuid,p_limit int)
returns setof app.outbox language sql security definer set search_path='' as $$
 select o.* from app.outbox o
 left join app.privacy_job j on o.kind='privacy.process' and j.id=o.resource_id and j.org_id=o.org_id
 left join app.invitation i on o.kind='invitation.deliver' and i.id=o.resource_id and i.org_id=o.org_id
 where o.namespace=p_namespace and o.delivered_at is not null
 and (p_after is null or o.id>p_after)
 and (
   (j.state='pending' and j.namespace=p_namespace and not exists(
     select 1 from app.outbox newer where newer.namespace=o.namespace and newer.resource_id=o.resource_id
     and newer.kind=o.kind and (newer.created_at,newer.id)>(o.created_at,o.id)))
   or (i.state='pending' and i.delivery_state='pending' and i.delivery_operation_id=o.operation_id)
 ) order by o.id limit least(greatest(p_limit,1),20)
$$;
create function app_private.fail_terminal_outbox(p_outbox uuid,p_namespace text)
returns void language plpgsql security definer set search_path='' as $$
declare o app.outbox;j app.privacy_job;begin
 select * into o from app.outbox where id=p_outbox and namespace=p_namespace and delivered_at is not null;
 if not found then return;end if;
 if o.kind='privacy.process' then
   select * into j from app.privacy_job where id=o.resource_id and org_id=o.org_id and namespace=p_namespace for update;
   if not found or j.state<>'pending' then return;end if;
   -- An explicit retry creates a new operation; an old terminal result cannot poison it.
   if exists(select 1 from app.outbox newer where newer.namespace=o.namespace and newer.resource_id=o.resource_id
     and newer.kind=o.kind and (newer.created_at,newer.id)>(o.created_at,o.id))then return;end if;
   update app.privacy_job set state='failed',attempts=greatest(attempts,5),error_code='PROCESSING_FAILED' where id=j.id;
 elsif o.kind='invitation.deliver' then
   perform app_private.ack_invitation(o.id,p_namespace,true);
 end if;
end $$;
grant create on schema app_private to jomcall_jobs;
alter function app_private.unsettled_outbox(text,uuid,int) owner to jomcall_jobs;
alter function app_private.fail_terminal_outbox(uuid,text) owner to jomcall_jobs;
revoke all on function app_private.unsettled_outbox(text,uuid,int),app_private.fail_terminal_outbox(uuid,text) from public;
grant execute on function app_private.unsettled_outbox(text,uuid,int),app_private.fail_terminal_outbox(uuid,text) to jomcall_worker;
revoke create on schema app_private from jomcall_jobs;
