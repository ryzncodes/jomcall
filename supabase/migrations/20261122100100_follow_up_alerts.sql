-- Follow-up alerts (2026-11-22). Design:
-- docs/superpowers/specs/2026-11-22-follow-up-queue-design.md section 5.3, D2, D4.
--
-- The database queues the emails; the engine sends them. A new follow-up
-- queues one alert for every active owner and admin; assigning an item to
-- someone other than the person assigning it queues one alert for the new
-- assignee. Each alert gets one outbox row of kind follow_up.alert in the
-- same transaction. The back-fill queues nothing.
--
-- Alert rows hold no customer data: ids, the recipient's user id, the
-- reason, the state. The payload the engine reads carries the recipient's
-- email, the item's kind, source and time and its id, and nothing of what
-- the caller or customer said, nor the organization's name (D4).

create table app.follow_up_alert(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id)on delete cascade,
 namespace text not null,
 follow_up_id uuid not null,
 user_id uuid not null,
 reason text not null check(reason in('new','assigned')),
 -- The follow-up's revision when the event happened: one assignment event
 -- per revision, so a later reassignment to the same person is a new alert.
 event_revision integer not null,
 state text not null default 'queued' check(state in('queued','sent','skipped','failed')),
 -- Payloads handed out for sending (the engine's retries).
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(follow_up_id,user_id,reason,event_revision),
 foreign key(org_id,follow_up_id)references app.follow_up(org_id,id)on delete cascade,
 -- Recipients are members of the item's organization.
 foreign key(org_id,user_id)references app.member(org_id,user_id)on delete cascade
);
create index follow_up_alert_user on app.follow_up_alert(org_id,user_id);

alter table app.follow_up_alert enable row level security;
alter table app.follow_up_alert force row level security;
grant select,insert,update on app.follow_up_alert to jomcall_jobs;

grant create on schema app_private to jomcall_jobs;

-- New item: one alert per active owner and active admin. Inserts made by
-- app_private.follow_up_backfill run with the transaction-local setting
-- jomcall.follow_up_backfill='on' and queue nothing (the setting is null in
-- a session that never set it, so the test is "= 'on'" in the body).
create function app_private.follow_up_alert_new()returns trigger language plpgsql security definer set search_path='' as $$begin
 if current_setting('jomcall.follow_up_backfill',true)='on' then return null;end if;
 with a as(
  insert into app.follow_up_alert(org_id,namespace,follow_up_id,user_id,reason,event_revision)
  select new.org_id,new.namespace,new.id,m.user_id,'new',new.revision
   from app.member m where m.org_id=new.org_id and m.active and m.role in('owner','admin')
   order by m.user_id
  on conflict(follow_up_id,user_id,reason,event_revision)do nothing
  returning id)
 insert into app.outbox(org_id,namespace,kind,resource_id)select new.org_id,new.namespace,'follow_up.alert',a.id from a;
 return null;
end$$;

-- Assignment: one alert for the new assignee, unless they assigned it to
-- themselves. Unassigning (null) and re-saving the same assignee queue nothing.
create function app_private.follow_up_alert_assigned()returns trigger language plpgsql security definer set search_path='' as $$
declare v uuid;begin
 insert into app.follow_up_alert(org_id,namespace,follow_up_id,user_id,reason,event_revision)
 values(new.org_id,new.namespace,new.id,new.assignee_user_id,'assigned',new.revision)
 on conflict(follow_up_id,user_id,reason,event_revision)do nothing returning id into v;
 if v is not null then
  insert into app.outbox(org_id,namespace,kind,resource_id)values(new.org_id,new.namespace,'follow_up.alert',v);
 end if;
 return null;
end$$;

-- Engine: what to send for one claimed alert, checked again at send time.
-- Null when there is nothing to send. Marks the alert skipped (no email)
-- when the item is no longer open, the recipient is no longer an active
-- member or has no email address, or, for an assignment, is no longer the
-- assignee. Each payload handed out counts one attempt.
create function app_private.follow_up_alert_payload(p_outbox uuid,p_namespace text)returns jsonb language plpgsql security definer set search_path='' as $$
declare o app.outbox;a app.follow_up_alert;f app.follow_up;v_email text;begin
 select * into o from app.outbox where id=p_outbox and namespace=p_namespace and kind='follow_up.alert';if not found then return null;end if;
 select * into a from app.follow_up_alert where id=o.resource_id and org_id=o.org_id for update;
 if not found or a.state<>'queued' then return null;end if;
 select * into f from app.follow_up where org_id=a.org_id and id=a.follow_up_id;
 if found and f.state='open'
  and exists(select 1 from app.member m where m.org_id=a.org_id and m.user_id=a.user_id and m.active)
  and(a.reason<>'assigned' or f.assignee_user_id is not distinct from a.user_id)then
  v_email=app_private.auth_user_email(a.user_id);
 end if;
 if v_email is null then
  update app.follow_up_alert set state='skipped' where id=a.id;
  return null;
 end if;
 update app.follow_up_alert set attempts=attempts+1 where id=a.id;
 return jsonb_build_object('operationId',o.operation_id,'email',v_email,'reason',a.reason,'kind',f.kind,'source',f.source,
  'createdAt',f.created_at,'followUpId',f.id);
end$$;

-- Engine: the alert was sent (p_failed false) or gave up (true). Only a
-- queued alert changes; a gone or skipped one is left as it is.
create function app_private.ack_follow_up_alert(p_outbox uuid,p_namespace text,p_failed boolean)returns void language sql security definer set search_path='' as $$
 update app.follow_up_alert a set state=case when p_failed then 'failed' else 'sent' end,sent_at=case when p_failed then null else now() end
 from app.outbox o where o.id=p_outbox and o.namespace=p_namespace and o.kind='follow_up.alert' and a.id=o.resource_id and a.org_id=o.org_id and a.state='queued'
$$;

alter function app_private.follow_up_alert_new()owner to jomcall_jobs;
alter function app_private.follow_up_alert_assigned()owner to jomcall_jobs;
alter function app_private.follow_up_alert_payload(uuid,text)owner to jomcall_jobs;
alter function app_private.ack_follow_up_alert(uuid,text,boolean)owner to jomcall_jobs;
revoke create on schema app_private from jomcall_jobs;
revoke all on function app_private.follow_up_alert_new()from public;
revoke all on function app_private.follow_up_alert_assigned()from public;
revoke all on function app_private.follow_up_alert_payload(uuid,text)from public;
revoke all on function app_private.ack_follow_up_alert(uuid,text,boolean)from public;
grant execute on function app_private.follow_up_alert_payload(uuid,text),app_private.ack_follow_up_alert(uuid,text,boolean)to jomcall_worker;

create trigger follow_up_alert_new after insert on app.follow_up for each row
 when(new.state='open')execute function app_private.follow_up_alert_new();
create trigger follow_up_alert_assigned after update of assignee_user_id on app.follow_up for each row
 when(new.state='open' and new.assignee_user_id is not null and new.assignee_user_id is distinct from old.assignee_user_id
  and new.assignee_user_id is distinct from new.assigned_by)
 execute function app_private.follow_up_alert_assigned();

-- The engine claims the new kind with the others. Rewritten from the
-- current body; the expected text must be found exactly once.
do $migration$
declare body text;
 old text:=$o$kind in('privacy.process','invitation.deliver','billing.refusal_notice')and$o$;
 new text:=$n$kind in('privacy.process','invitation.deliver','billing.refusal_notice','follow_up.alert')and$n$;
begin
 select pg_get_functiondef('app_private.claim_outbox(text,integer)'::regprocedure) into body;
 if position('follow_up.alert' in body)>0 then return;end if;
 if (length(body)-length(replace(body,old,'')))/length(old)<>1 then raise exception 'claim_outbox: anchor not found once';end if;
 execute replace(body,old,new);
end
$migration$;
