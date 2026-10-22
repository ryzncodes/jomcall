create table app.privacy_job(
 id uuid primary key default gen_random_uuid(), org_id uuid not null references app.organization(id) on delete cascade,
 contact_id uuid, target_id uuid not null, kind text not null check(kind in('export','deletion')),
 state text not null default 'pending' check(state in('pending','completed','failed','expired')),
 requested_by uuid not null, namespace text not null, attempts int not null default 0, error_code text,
 manifest_version int, expires_at timestamptz, created_at timestamptz not null default now(), completed_at timestamptz,
 foreign key(org_id,contact_id) references app.contact(org_id,id) on delete set null(contact_id));
alter table app.privacy_job enable row level security;alter table app.privacy_job force row level security;
create policy manager_read on app.privacy_job for select to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id) in('owner','admin'));
grant select on app.privacy_job to jomcall_app;
do $$begin if not exists(select from pg_roles where rolname='jomcall_jobs')then create role jomcall_jobs nologin noinherit bypassrls;end if;end $$;
grant jomcall_jobs to postgres;
grant usage on schema app,app_private to jomcall_jobs,jomcall_worker;
grant create on schema app_private to jomcall_jobs;
grant select,insert,update on app.privacy_job,app.outbox to jomcall_jobs;
grant select,update on app.invitation to jomcall_jobs;
grant select on app.member to jomcall_jobs;
grant select,update,delete on app.contact to jomcall_jobs;
grant select,delete on app.contact_note,app.consent_record,app.command_receipt to jomcall_jobs;
grant insert on app.audit_log to jomcall_jobs;
grant execute on function app_private.active_role(uuid) to jomcall_jobs;
grant jomcall_queue to postgres;
create schema pgboss authorization jomcall_queue;
revoke jomcall_queue from postgres;
create function app_private.request_privacy(p_org uuid,p_contact uuid,p_revision int,p_kind text,p_namespace text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c app.contact; j app.privacy_job;begin
 if app_private.active_role(p_org) is null then raise exception 'NOT_FOUND';end if;
 if app_private.active_role(p_org) not in('owner','admin')then raise exception 'FORBIDDEN';end if;
 if p_kind not in('export','deletion') or p_namespace !~ '^(local|test_[a-f0-9-]{36})$' then raise exception 'FORBIDDEN';end if;
 select * into c from app.contact where org_id=p_org and id=p_contact for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if c.deletion_pending or c.revision<>p_revision then raise exception 'CONFLICT';end if;
 if p_kind='deletion' then update app.contact set deletion_pending=true,revision=revision+1 where id=c.id;end if;
 insert into app.privacy_job(org_id,contact_id,target_id,kind,requested_by,namespace)values(p_org,c.id,c.id,p_kind,nullif(current_setting('app.user_id',true),'')::uuid,p_namespace)returning * into j;
 insert into app.outbox(org_id,namespace,kind,resource_id)values(p_org,p_namespace,'privacy.process',j.id);
 return to_jsonb(j);
end $$;
create function app_private.retry_privacy(p_org uuid,p_job uuid,p_namespace text)returns jsonb language plpgsql security definer set search_path='' as $$
declare j app.privacy_job;begin
 if app_private.active_role(p_org) is null then raise exception 'NOT_FOUND';end if;
 if app_private.active_role(p_org) not in('owner','admin')then raise exception 'FORBIDDEN';end if;
 select * into j from app.privacy_job where org_id=p_org and id=p_job and namespace=p_namespace for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if j.state<>'failed' or j.contact_id is null then raise exception 'CONFLICT';end if;
 update app.privacy_job set state='pending',attempts=0,error_code=null where id=j.id returning * into j;
 insert into app.outbox(org_id,namespace,kind,resource_id)values(j.org_id,j.namespace,'privacy.process',j.id);
 return to_jsonb(j);
end $$;
create function app_private.claim_outbox(p_namespace text,p_limit int) returns setof app.outbox language sql security definer set search_path='' as $$
 update app.outbox set lease_until=now()+interval '30 seconds',attempts=attempts+1 where id in(
 select id from app.outbox where namespace=p_namespace and delivered_at is null and (lease_until is null or lease_until<now()) order by created_at,id for update skip locked limit least(greatest(p_limit,1),20))returning *
$$;
create function app_private.ack_outbox(p_id uuid,p_namespace text)returns void language sql security definer set search_path='' as $$update app.outbox set delivered_at=now(),lease_until=null where id=p_id and namespace=p_namespace$$;
create function app_private.process_privacy(p_id uuid,p_namespace text)returns text language plpgsql security definer set search_path='' as $$
declare j app.privacy_job;c app.contact;begin
 select * into j from app.privacy_job where id=p_id and namespace=p_namespace for update;
 if not found then return 'gone';end if;
 if j.state<>'pending' then return j.state;end if;
 select * into c from app.contact where id=j.contact_id and org_id=j.org_id for update;
 if not found or(j.kind='export' and c.deletion_pending)then update app.privacy_job set state='expired',completed_at=now() where id=j.id;return 'expired';end if;
 if j.kind='deletion' then
 delete from app.contact_note where org_id=j.org_id and contact_id=c.id;
 delete from app.consent_record where org_id=j.org_id and contact_id=c.id;
 update app.privacy_job set state='expired',expires_at=now() where org_id=j.org_id and target_id=c.id and kind='export';
 delete from app.contact where id=c.id and org_id=j.org_id;
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id)values(j.org_id,j.requested_by,'privacy.deleted','privacy_job',j.id);
 else
 insert into app.audit_log(org_id,actor_id,action,target_type,target_id)values(j.org_id,j.requested_by,'privacy.prepared','privacy_job',j.id);
 end if;
 update app.privacy_job set state='completed',attempts=attempts+1,error_code=null,completed_at=now(),manifest_version=case when kind='export' then 1 end,expires_at=case when kind='export' then now()+interval '24 hours' end where id=j.id;
 return 'completed';
end $$;
create function app_private.fail_work(p_id uuid,p_namespace text)returns void language plpgsql security definer set search_path='' as $$begin
 update app.privacy_job set attempts=attempts+1,state=case when attempts+1>=5 then 'failed' else state end,error_code='PROCESSING_FAILED' where id=p_id and namespace=p_namespace and state='pending';
end $$;
create function app_private.invitation_payload(p_outbox uuid,p_namespace text)returns jsonb language plpgsql security definer set search_path='' as $$
declare i app.invitation;o app.outbox;r text;begin
 select * into o from app.outbox where id=p_outbox and namespace=p_namespace and kind='invitation.deliver';if not found then return null;end if;
 select * into i from app.invitation where id=o.resource_id and org_id=o.org_id and delivery_operation_id=o.operation_id for update;if not found then return null;end if;
 select role into r from app.member where org_id=i.org_id and user_id=i.invited_by and active;
 if i.state<>'pending' or i.expires_at<=now() or r is null or r='staff' or(r='admin' and i.role<>'staff')then
 update app.invitation set delivery_ciphertext=null,delivery_state='cancelled' where id=i.id;return null;end if;
 if i.delivery_ciphertext is null then return null;end if;
 return jsonb_build_object('id',i.id,'orgId',i.org_id,'email',i.email,'ciphertext',i.delivery_ciphertext,'operationId',o.operation_id);
end $$;
create function app_private.ack_invitation(p_outbox uuid,p_namespace text,p_failed boolean)returns void language sql security definer set search_path='' as $$
 update app.invitation i set delivery_ciphertext=case when p_failed then i.delivery_ciphertext else null end,delivery_state=case when p_failed then 'failed' else 'sent' end
 from app.outbox o where o.id=p_outbox and o.namespace=p_namespace and o.kind='invitation.deliver' and i.id=o.resource_id and i.org_id=o.org_id and i.delivery_operation_id=o.operation_id and i.state='pending'
$$;
create function app_private.maintain_jobs(p_namespace text)returns void language plpgsql security definer set search_path='' as $$begin
 update app.invitation i set delivery_ciphertext=null,delivery_state='expired' where i.expires_at<=now() and i.delivery_ciphertext is not null and exists(select 1 from app.outbox o where o.resource_id=i.id and o.namespace=p_namespace);
 update app.privacy_job set state='expired' where namespace=p_namespace and kind='export' and state='completed' and expires_at<=now();
 delete from app.command_receipt r where expires_at<=now() and exists(select 1 from app.outbox o where o.org_id=r.org_id and o.namespace=p_namespace);
end $$;
do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in('request_privacy','retry_privacy','claim_outbox','ack_outbox','process_privacy','fail_work','invitation_payload','ack_invitation','maintain_jobs')loop execute format('alter function %s owner to jomcall_jobs',f);execute format('revoke all on function %s from public',f);end loop;end $$;
grant execute on function app_private.request_privacy(uuid,uuid,int,text,text),app_private.retry_privacy(uuid,uuid,text) to jomcall_app;
grant execute on function app_private.claim_outbox(text,int),app_private.ack_outbox(uuid,text),app_private.process_privacy(uuid,text),app_private.fail_work(uuid,text),app_private.invitation_payload(uuid,text),app_private.ack_invitation(uuid,text,boolean),app_private.maintain_jobs(text) to jomcall_worker;
revoke create on schema app_private from jomcall_jobs;
