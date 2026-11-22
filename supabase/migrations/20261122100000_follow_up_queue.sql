-- Follow-up queue (2026-11-22). Design:
-- docs/superpowers/specs/2026-11-22-follow-up-queue-design.md section 5.1.
--
-- One list of the items the agent leaves for people on real phone calls and
-- WhatsApp: messages, booking requests and handoffs. A follow-up is created
-- by the database when the agent's turn ends (completed, or for a call also
-- cut off by a hang-up, a crash or a failure: a proposal that survives such a
-- turn was recorded and is counted by the call log), holds a copy of the item's
-- details, and is the only place an item's state is written: the source
-- proposal's state is mirrored from it and the web role loses its update
-- grants on both proposal tables.
--
-- Rights, enforced here: every active member reads follow-ups; any active
-- member closes or reopens one; only owners and admins assign one, to an
-- active member of the same organization. The web role writes only through
-- follow_up_close, follow_up_reopen and follow_up_assign. Staff still read
-- nothing of what was said on a call (call_turn, call_tool_step,
-- call_proposal keep their owner and admin rule).

-- This migration locks both proposal tables, the turn tables and app.member
-- until the back-fill commits. Give up after 5 seconds rather than queue
-- behind a live call (and stall every query behind this one); a refused
-- apply changes nothing and can be run again when the lines are quiet.
set local lock_timeout='5s';

create table app.follow_up(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id)on delete cascade,
 namespace text not null,
 source text not null check(source in('call','whatsapp')),
 call_id uuid,call_proposal_id uuid unique,
 conversation_id uuid,conversation_proposal_id uuid unique,
 contact_id uuid,
 kind text not null check(kind in('booking','message','handoff')),
 details jsonb not null check(octet_length(details::text)<=8192),
 state text not null default 'open' check(state in('open','done','dismissed')),
 closed_by uuid,closed_at timestamptz,
 assignee_user_id uuid,due_at timestamptz,assigned_by uuid,assigned_at timestamptz,
 booking_id uuid,
 revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),
 -- Exactly one source proposal, with the call or conversation it came from.
 check((source='call' and call_proposal_id is not null and call_id is not null and conversation_proposal_id is null and conversation_id is null)
  or(source='whatsapp' and conversation_proposal_id is not null and conversation_id is not null and call_proposal_id is null and call_id is null)),
 -- An open item carries nothing from a close. A closed item may lack
 -- closed_by and closed_at: the back-fill does not know who closed it or when.
 check(state<>'open' or(closed_by is null and closed_at is null and booking_id is null)),
 -- A retried or cancelled agent turn deletes its proposal, and its follow-up with it.
 foreign key(org_id,call_proposal_id)references app.call_proposal(org_id,id)on delete cascade,
 foreign key(org_id,conversation_proposal_id)references app.conversation_proposal(org_id,id)on delete cascade,
 -- PDPA deletion of the contact deletes its follow-ups.
 foreign key(org_id,contact_id)references app.contact(org_id,id)on delete cascade,
 foreign key(org_id,booking_id)references app.booking(org_id,id)on delete set null(booking_id)
);
create index follow_up_list on app.follow_up(org_id,state,created_at);
create index follow_up_assignee on app.follow_up(org_id,assignee_user_id)where state='open';
create index follow_up_contact on app.follow_up(org_id,contact_id)where contact_id is not null;
create index follow_up_call on app.follow_up(org_id,call_id)where call_id is not null;
create index follow_up_conversation on app.follow_up(org_id,conversation_id)where conversation_id is not null;
create index follow_up_booking on app.follow_up(org_id,booking_id)where booking_id is not null;

alter table app.follow_up enable row level security;
alter table app.follow_up force row level security;
grant select on app.follow_up to jomcall_app;
create policy tenant_read on app.follow_up for select to jomcall_app
 using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);

-- The proposal side is written only by mirroring from here.
revoke update on app.call_proposal,app.conversation_proposal from jomcall_app;
drop policy manager_update on app.call_proposal;
drop policy member_update on app.conversation_proposal;

-- What the functions and triggers below (owned by jomcall_jobs) touch. Column
-- grants keep the call's billing columns and the channel's credentials out.
grant select,insert,update on app.follow_up to jomcall_jobs;
grant select on app.call_proposal,app.conversation_proposal to jomcall_jobs;
grant update(state,revision)on app.call_proposal,app.conversation_proposal to jomcall_jobs;
grant select(id,org_id,call_id,state)on app.call_turn to jomcall_jobs;
grant select(id,org_id,conversation_id,state,attempt)on app.conversation_turn to jomcall_jobs;
grant select(id,org_id,namespace,contact_id)on app.call to jomcall_jobs;
grant select(id,org_id,channel_id,contact_id,needs_attention,attention_reason,handoff_turn_id,revision)on app.conversation to jomcall_jobs;
grant update(needs_attention,attention_reason,revision)on app.conversation to jomcall_jobs;
grant select(id,org_id,namespace)on app.whatsapp_channel to jomcall_jobs;

grant create on schema app_private to jomcall_jobs;

-- Creation. A call turn's proposals become follow-ups when the turn ends:
-- completed, or cancelled or failed by call_end, maintain or turn_fail,
-- which keep the turn's proposals (turn_begin and turn_cancel delete a
-- turn's proposals before cancelling it, so they leave nothing to create).
-- For WhatsApp, only the proposals of the completed attempt (an earlier
-- failed attempt's proposals are never deleted, were never heard, and the
-- turn is tried again). A proposal that already has a follow-up is left alone.
create function app_private.follow_up_from_call_turn()returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into app.follow_up(org_id,namespace,source,call_id,call_proposal_id,contact_id,kind,details)
 select p.org_id,c.namespace,'call',p.call_id,p.id,c.contact_id,p.kind,p.details
  from app.call_proposal p join app.call c on c.org_id=p.org_id and c.id=p.call_id
  where p.org_id=new.org_id and p.turn_id=new.id
  order by p.step
 on conflict do nothing;
 return null;
end$$;
create function app_private.follow_up_from_conversation_turn()returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into app.follow_up(org_id,namespace,source,conversation_id,conversation_proposal_id,contact_id,kind,details)
 select p.org_id,h.namespace,'whatsapp',p.conversation_id,p.id,v.contact_id,p.kind,p.details
  from app.conversation_proposal p
  join app.conversation v on v.org_id=p.org_id and v.id=p.conversation_id
  join app.whatsapp_channel h on h.org_id=v.org_id and h.id=v.channel_id
  where p.org_id=new.org_id and p.turn_id=new.id and p.attempt=new.attempt
  order by p.step
 on conflict do nothing;
 return null;
end$$;

-- Mirroring: the source proposal follows the follow-up's state (open is
-- 'pending' on a call proposal, 'open' on a WhatsApp proposal).
create function app_private.follow_up_mirror()returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.source='call' then
  update app.call_proposal set state=case new.state when 'open' then 'pending' else new.state end,revision=revision+1
   where org_id=new.org_id and id=new.call_proposal_id;
 else
  update app.conversation_proposal set state=new.state,revision=revision+1
   where org_id=new.org_id and id=new.conversation_proposal_id;
 end if;
 return null;
end$$;

-- The chat's "needs attention" flag, when it was raised for an agent item,
-- clears once the chat's last open follow-up closes. HANDOFF_REQUESTED
-- clears only when it came from the agent's handoff: the chat's handoff turn
-- has a handoff follow-up (closing that one is what clears it). The
-- customer's own "staff" keyword sets the same reason with no item, and
-- closing an unrelated item must not wipe it. Any other reason (a STOP, a
-- failed send, a customer reply) is left for staff. The chat row is locked
-- first, so two last items closing at once still clear it.
create function app_private.follow_up_chat_flag()returns trigger language plpgsql security definer set search_path='' as $$begin
 perform 1 from app.conversation where org_id=new.org_id and id=new.conversation_id for update;
 if not exists(select 1 from app.follow_up f where f.org_id=new.org_id and f.conversation_id=new.conversation_id and f.state='open')then
  update app.conversation v set needs_attention=false,attention_reason=null,revision=v.revision+1
   where v.org_id=new.org_id and v.id=new.conversation_id and v.needs_attention
    and(v.attention_reason in('BOOKING_PROPOSED','MESSAGE_LEFT')
     or(v.attention_reason='HANDOFF_REQUESTED' and v.handoff_turn_id is not null and exists(
      select 1 from app.follow_up f join app.conversation_proposal p on p.org_id=f.org_id and p.id=f.conversation_proposal_id
       where f.org_id=v.org_id and f.conversation_id=v.id and f.kind='handoff' and p.turn_id=v.handoff_turn_id)));
 end if;
 return null;
end$$;

-- A deactivated member's open items go back to unassigned.
create function app_private.follow_up_member_inactive()returns trigger language plpgsql security definer set search_path='' as $$begin
 update app.follow_up set assignee_user_id=null,revision=revision+1,updated_at=now()
  where org_id=new.org_id and assignee_user_id=new.user_id and state='open';
 return null;
end$$;

-- Close an item as done or dismissed. Any active member. A booking item is
-- done only with the confirmed booking that closes it (p_booking).
create function app_private.follow_up_close(p_id uuid,p_revision int,p_state text,p_booking uuid default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid:=nullif(current_setting('app.org_id',true),'')::uuid;f app.follow_up;begin
 if v_org is null or app_private.active_role(v_org)is null then raise exception 'NOT_FOUND';end if;
 select * into f from app.follow_up where org_id=v_org and id=p_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_state is null or p_state not in('done','dismissed')then raise exception 'INVALID_STATE';end if;
 if f.revision is distinct from p_revision or f.state<>'open' then raise exception 'CONFLICT';end if;
 if p_booking is not null and(f.kind<>'booking' or p_state<>'done')then raise exception 'INVALID_STATE';end if;
 if f.kind='booking' and p_state='done' and p_booking is null then raise exception 'BOOKING_CONFIRM_REQUIRED';end if;
 update app.follow_up set state=p_state,closed_by=nullif(current_setting('app.user_id',true),'')::uuid,closed_at=now(),booking_id=p_booking,
  revision=revision+1,updated_at=now() where id=f.id returning * into f;
 return to_jsonb(f);
end$$;

-- Reopen a closed item (Undo, or from the Done list). Any active member.
-- A reopened WhatsApp item raises its chat's flag again when nothing else
-- holds it, with the reason the agent's item gave it (owner and the chat's
-- handoff turn are left as they are: the worker reads those).
create function app_private.follow_up_reopen(p_id uuid,p_revision int)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid:=nullif(current_setting('app.org_id',true),'')::uuid;f app.follow_up;begin
 if v_org is null or app_private.active_role(v_org)is null then raise exception 'NOT_FOUND';end if;
 select * into f from app.follow_up where org_id=v_org and id=p_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if f.revision is distinct from p_revision or f.state='open' then raise exception 'CONFLICT';end if;
 update app.follow_up set state='open',closed_by=null,closed_at=null,booking_id=null,revision=revision+1,updated_at=now()
  where id=f.id returning * into f;
 if f.source='whatsapp' then
  update app.conversation set needs_attention=true,revision=revision+1,
   attention_reason=case f.kind when 'handoff' then 'HANDOFF_REQUESTED' when 'booking' then 'BOOKING_PROPOSED' else 'MESSAGE_LEFT' end
   where org_id=f.org_id and id=f.conversation_id and not needs_attention;
 end if;
 return to_jsonb(f);
end$$;

-- Assign an open item to an active member (or to nobody) with a due time
-- (or none). Owners and admins only.
create function app_private.follow_up_assign(p_id uuid,p_revision int,p_assignee uuid,p_due timestamptz)returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid:=nullif(current_setting('app.org_id',true),'')::uuid;v_role text;f app.follow_up;begin
 if v_org is not null then v_role=app_private.active_role(v_org);end if;
 if v_role is null then raise exception 'NOT_FOUND';end if;
 select * into f from app.follow_up where org_id=v_org and id=p_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if v_role not in('owner','admin')then raise exception 'FORBIDDEN';end if;
 if f.revision is distinct from p_revision or f.state<>'open' then raise exception 'CONFLICT';end if;
 if p_assignee is not null and not exists(select 1 from app.member m where m.org_id=v_org and m.user_id=p_assignee and m.active)then
  raise exception 'INVALID_ASSIGNEE';
 end if;
 update app.follow_up set assignee_user_id=p_assignee,due_at=p_due,assigned_by=nullif(current_setting('app.user_id',true),'')::uuid,assigned_at=now(),
  revision=revision+1,updated_at=now() where id=f.id returning * into f;
 return to_jsonb(f);
end$$;

-- Back-fill: follow-ups for the proposals of ended turns that have none
-- (as the triggers: a call turn completed, cancelled or failed; a WhatsApp
-- turn completed, its completed attempt only), pending or open as open,
-- done and dismissed as they are, created_at kept
-- from the proposal so the oldest item stays first. The transaction-local
-- setting jomcall.follow_up_backfill is 'on' while it inserts, so later
-- alert triggers queue no email for back-filled items. Returns the number
-- of follow-ups created.
create function app_private.follow_up_backfill()returns int language plpgsql security definer set search_path='' as $$
declare v_calls int;v_chats int;begin
 perform set_config('jomcall.follow_up_backfill','on',true);
 insert into app.follow_up(org_id,namespace,source,call_id,call_proposal_id,contact_id,kind,details,state,created_at)
 select p.org_id,c.namespace,'call',p.call_id,p.id,c.contact_id,p.kind,p.details,case p.state when 'pending' then 'open' else p.state end,p.created_at
  from app.call_proposal p
  join app.call_turn t on t.org_id=p.org_id and t.id=p.turn_id
  join app.call c on c.org_id=p.org_id and c.id=p.call_id
  where t.state in('completed','cancelled','failed') and not exists(select 1 from app.follow_up f where f.call_proposal_id=p.id)
 on conflict do nothing;
 get diagnostics v_calls=row_count;
 insert into app.follow_up(org_id,namespace,source,conversation_id,conversation_proposal_id,contact_id,kind,details,state,created_at)
 select p.org_id,h.namespace,'whatsapp',p.conversation_id,p.id,v.contact_id,p.kind,p.details,p.state,p.created_at
  from app.conversation_proposal p
  join app.conversation_turn t on t.org_id=p.org_id and t.id=p.turn_id
  join app.conversation v on v.org_id=p.org_id and v.id=p.conversation_id
  join app.whatsapp_channel h on h.org_id=v.org_id and h.id=v.channel_id
  where t.state='completed' and p.attempt=t.attempt and not exists(select 1 from app.follow_up f where f.conversation_proposal_id=p.id)
 on conflict do nothing;
 get diagnostics v_chats=row_count;
 perform set_config('jomcall.follow_up_backfill','',true);
 return v_calls+v_chats;
end$$;

alter function app_private.follow_up_from_call_turn()owner to jomcall_jobs;
alter function app_private.follow_up_from_conversation_turn()owner to jomcall_jobs;
alter function app_private.follow_up_mirror()owner to jomcall_jobs;
alter function app_private.follow_up_chat_flag()owner to jomcall_jobs;
alter function app_private.follow_up_member_inactive()owner to jomcall_jobs;
alter function app_private.follow_up_close(uuid,int,text,uuid)owner to jomcall_jobs;
alter function app_private.follow_up_reopen(uuid,int)owner to jomcall_jobs;
alter function app_private.follow_up_assign(uuid,int,uuid,timestamptz)owner to jomcall_jobs;
alter function app_private.follow_up_backfill()owner to jomcall_jobs;
revoke create on schema app_private from jomcall_jobs;
revoke all on function app_private.follow_up_from_call_turn()from public;
revoke all on function app_private.follow_up_from_conversation_turn()from public;
revoke all on function app_private.follow_up_mirror()from public;
revoke all on function app_private.follow_up_chat_flag()from public;
revoke all on function app_private.follow_up_member_inactive()from public;
revoke all on function app_private.follow_up_close(uuid,int,text,uuid)from public;
revoke all on function app_private.follow_up_reopen(uuid,int)from public;
revoke all on function app_private.follow_up_assign(uuid,int,uuid,timestamptz)from public;
revoke all on function app_private.follow_up_backfill()from public;
grant execute on function app_private.follow_up_close(uuid,int,text,uuid),app_private.follow_up_reopen(uuid,int),
 app_private.follow_up_assign(uuid,int,uuid,timestamptz)to jomcall_app;

create trigger follow_up_from_call_turn after update of state on app.call_turn for each row
 when(new.state in('completed','cancelled','failed') and old.state is distinct from new.state)execute function app_private.follow_up_from_call_turn();
create trigger follow_up_from_conversation_turn after update of state on app.conversation_turn for each row
 when(new.state='completed' and old.state is distinct from 'completed')execute function app_private.follow_up_from_conversation_turn();
create trigger follow_up_mirror after update of state on app.follow_up for each row
 when(new.state is distinct from old.state)execute function app_private.follow_up_mirror();
create trigger follow_up_chat_flag after update of state on app.follow_up for each row
 when(new.source='whatsapp' and old.state='open' and new.state<>'open')execute function app_private.follow_up_chat_flag();
create trigger follow_up_member_inactive after update of active on app.member for each row
 when(old.active and not new.active)execute function app_private.follow_up_member_inactive();

-- Existing items of ended turns, once. No alerts.
select app_private.follow_up_backfill();
