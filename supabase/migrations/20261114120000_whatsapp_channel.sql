-- WhatsApp channel: one channel per organization, its message templates,
-- conversations, messages, agent turns on those conversations and the raw
-- webhook inbox. Design: docs/superpowers/specs/2026-11-14-whatsapp-channel-design.md.
-- Signed-in users reach these tables through row-level security as jomcall_app.
-- The agent worker reaches them only through app_private.whatsapp_work (next
-- migration). Channel credentials are stored encrypted and jomcall_app holds
-- no SELECT privilege on that column, so no API response can carry them.

create table app.whatsapp_channel(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id)on delete cascade,
 namespace text not null default 'local',
 location_id uuid not null,agent_id uuid not null,
 provider text not null default 'cloud' check(provider in('cloud')),
 state text not null default 'not_connected' check(state in('not_connected','pending','connected','failed','disabled')),
 state_reason text check(state_reason is null or state_reason~'^[A-Z0-9_]{1,60}$'),
 phone_number_id text check(phone_number_id is null or phone_number_id~'^[0-9]{5,30}$'),
 waba_id text check(waba_id is null or waba_id~'^[0-9]{5,30}$'),
 display_phone_e164 text check(display_phone_e164 is null or display_phone_e164~'^\+[1-9][0-9]{1,14}$'),
 credentials jsonb check(credentials is null or octet_length(credentials::text)<=8192),
 credentials_set_at timestamptz,
 agent_enabled boolean not null default true,
 revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id),
 foreign key(org_id,location_id)references app.location(org_id,id),
 foreign key(org_id,agent_id)references app.agent(org_id,id),
 check(state not in('pending','connected') or phone_number_id is not null)
);
-- A phone number belongs to one organization. Webhooks are routed by it.
create unique index whatsapp_channel_number on app.whatsapp_channel(namespace,phone_number_id)where phone_number_id is not null;

create table app.whatsapp_template(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,channel_id uuid not null,
 name text not null check(name~'^[a-z0-9_]{1,512}$'),
 language text not null check(language~'^[a-z]{2,3}(_[A-Z]{2})?$'),
 category text not null check(category in('utility','marketing','authentication')),
 purpose text not null default 'other' check(purpose in('reengage','missed_call','booking_confirmation','owner_summary','other')),
 status text not null default 'draft' check(status in('draft','pending','approved','rejected','paused','disabled')),
 body text not null check(octet_length(body)between 1 and 4096),
 variables integer not null default 0 check(variables between 0 and 10),
 revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,channel_id,name,language),
 foreign key(org_id,channel_id)references app.whatsapp_channel(org_id,id)on delete cascade
);

create table app.conversation(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,channel_id uuid not null,contact_id uuid not null,
 wa_id text not null check(wa_id~'^[1-9][0-9]{1,14}$'),
 state text not null default 'open' check(state in('open','closed')),
 owner text not null default 'agent' check(owner in('agent','staff')),
 handoff_turn_id uuid,
 needs_attention boolean not null default false,
 attention_reason text check(attention_reason is null or attention_reason~'^[A-Z0-9_]{1,60}$'),
 last_inbound_at timestamptz,last_message_at timestamptz not null default now(),
 disclosure_message_id uuid,
 revision integer not null default 1,
 created_at timestamptz not null default now(),closed_at timestamptz,
 unique(org_id,id),
 foreign key(org_id,channel_id)references app.whatsapp_channel(org_id,id)on delete cascade,
 foreign key(org_id,contact_id)references app.contact(org_id,id)on delete cascade
);
create unique index conversation_one_open on app.conversation(org_id,channel_id,wa_id)where state='open';
create index conversation_timeline on app.conversation(org_id,last_message_at desc,id desc);
create index conversation_contact on app.conversation(org_id,contact_id);

create table app.conversation_turn(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,conversation_id uuid not null,
 kind text not null default 'agent' check(kind in('agent','notice_opt_out','notice_unsupported','notice_handoff')),
 input text not null check(octet_length(input)<=4000),
 state text not null default 'queued' check(state in('queued','running','completed','failed','skipped','cancelled')),
 attempt integer not null default 1,
 lease_token uuid,lease_until timestamptz,
 answer text check(octet_length(answer)<=4000),
 citations jsonb not null default '[]',usage jsonb not null default '[]',
 agent_version_id uuid,model_identity text,
 error_code text check(error_code is null or error_code~'^[A-Z0-9_]{1,60}$'),
 created_at timestamptz not null default now(),completed_at timestamptz,
 unique(org_id,id),unique(org_id,conversation_id,id),
 foreign key(org_id,conversation_id)references app.conversation(org_id,id)on delete cascade
);
-- At most one waiting and one running turn per conversation. Messages that
-- arrive while a turn waits are folded into it.
create unique index conversation_turn_one_queued on app.conversation_turn(org_id,conversation_id)where state='queued';
create unique index conversation_turn_one_running on app.conversation_turn(org_id,conversation_id)where state='running';
create index conversation_turn_queue on app.conversation_turn(created_at,id)where state='queued';

create table app.message(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,conversation_id uuid not null,
 direction text not null check(direction in('inbound','outbound')),
 author text not null check(author in('customer','agent','staff','system')),
 kind text not null check(kind in('text','template','media','unsupported')),
 body text not null default '' check(octet_length(body)<=8192),
 media jsonb check(media is null or octet_length(media::text)<=8192),
 template_id uuid,template_variables jsonb not null default '[]' check(jsonb_typeof(template_variables)='array' and octet_length(template_variables::text)<=4096),
 provider_message_id text check(provider_message_id is null or octet_length(provider_message_id)between 1 and 256),
 status text not null check(status in('received','queued','sending','sent','delivered','read','failed','blocked','unknown')),
 status_at timestamptz not null default now(),
 error_code text check(error_code is null or error_code~'^[A-Z0-9_]{1,60}$'),
 turn_id uuid,actor_id uuid,
 lease_token uuid,lease_until timestamptz,
 provider_timestamp timestamptz,
 created_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,conversation_id)references app.conversation(org_id,id)on delete cascade,
 foreign key(org_id,template_id)references app.whatsapp_template(org_id,id),
 check((direction='inbound')=(author='customer')),
 check(direction='outbound' or status='received'),
 check(direction='inbound' or status<>'received'),
 check(kind<>'template' or template_id is not null)
);
-- The provider's message id is the idempotency key for inbound deliveries
-- and the lookup key for status updates.
create unique index message_provider_id on app.message(org_id,provider_message_id)where provider_message_id is not null;
create index message_thread on app.message(org_id,conversation_id,created_at,id);
create index message_send_queue on app.message(created_at,id)where status='queued';

create table app.conversation_tool_step(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,conversation_id uuid not null,turn_id uuid not null,
 attempt integer not null,step integer not null,tool text not null,input jsonb not null,result jsonb not null,
 unique(org_id,id),unique(org_id,turn_id,attempt,step),
 foreign key(org_id,conversation_id,turn_id)references app.conversation_turn(org_id,conversation_id,id)on delete cascade
);
create table app.conversation_proposal(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,conversation_id uuid not null,turn_id uuid not null,
 attempt integer not null,step integer not null,
 kind text not null check(kind in('booking','message','handoff')),
 details jsonb not null check(octet_length(details::text)<=8192),
 state text not null default 'open' check(state in('open','done','dismissed')),
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,turn_id,attempt,step),
 foreign key(org_id,conversation_id,turn_id)references app.conversation_turn(org_id,conversation_id,id)on delete cascade
);
create index conversation_proposal_thread on app.conversation_proposal(org_id,conversation_id,created_at);

-- Raw webhook inbox. No tenant is known when a delivery arrives, so no
-- signed-in user can read this table. The payload is cleared once processed.
create table app.whatsapp_event(
 id uuid primary key default gen_random_uuid(),
 namespace text not null,
 dedupe_key text not null check(octet_length(dedupe_key)between 3 and 400),
 phone_number_id text not null check(phone_number_id~'^[0-9]{5,30}$'),
 kind text not null check(kind in('message','status')),
 payload jsonb not null check(octet_length(payload::text)<=65536),
 state text not null default 'pending' check(state in('pending','done','ignored','orphaned','failed')),
 attempts integer not null default 0,
 not_before timestamptz not null default now(),
 error_code text check(error_code is null or error_code~'^[A-Z0-9_]{1,60}$'),
 received_at timestamptz not null default now(),processed_at timestamptz,
 unique(namespace,dedupe_key)
);
create index whatsapp_event_queue on app.whatsapp_event(namespace,kind,not_before,received_at,id)where state='pending';

-- A customer's own opt-out message is recorded as a consent record with no
-- staff actor.
alter table app.consent_record alter column actor_id drop not null;

do $$declare t text;begin
 foreach t in array array['whatsapp_channel','whatsapp_template','conversation','conversation_turn','message','conversation_tool_step','conversation_proposal','whatsapp_event']loop
  execute format('alter table app.%I enable row level security',t);
  execute format('alter table app.%I force row level security',t);
 end loop;
 -- Every active member works the inbox, so every member may read.
 foreach t in array array['whatsapp_channel','whatsapp_template','conversation','conversation_turn','message','conversation_tool_step','conversation_proposal']loop
  execute format('create policy tenant_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)is not null)',t);
 end loop;
 -- Only owners and admins change the channel and its templates.
 foreach t in array array['whatsapp_channel','whatsapp_template']loop
  execute format('create policy manager_insert on app.%I for insert to jomcall_app with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))',t);
  execute format('create policy manager_update on app.%I for update to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))',t);
 end loop;
end$$;
create policy manager_delete on app.whatsapp_template for delete to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));
-- Members take over, hand back, resolve and reopen conversations.
create policy member_update on app.conversation for update to jomcall_app
 using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null)
 with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
create policy member_update on app.conversation_proposal for update to jomcall_app
 using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null)
 with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
-- A member may only queue their own outbound message. Sending, and every
-- rule checked before it, belongs to the worker.
create policy staff_queue on app.message for insert to jomcall_app with check(
 org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null
 and direction='outbound' and author='staff' and status='queued' and provider_message_id is null
 and actor_id=nullif(current_setting('app.user_id',true),'')::uuid);

-- Column grants: jomcall_app never reads channel credentials.
grant select(id,org_id,namespace,location_id,agent_id,provider,state,state_reason,phone_number_id,waba_id,display_phone_e164,credentials_set_at,agent_enabled,revision,created_at,updated_at)on app.whatsapp_channel to jomcall_app;
grant insert(org_id,namespace,location_id,agent_id,state,state_reason,phone_number_id,waba_id,display_phone_e164,credentials,credentials_set_at,agent_enabled)on app.whatsapp_channel to jomcall_app;
grant update(state,state_reason,phone_number_id,waba_id,display_phone_e164,credentials,credentials_set_at,agent_enabled,revision,updated_at)on app.whatsapp_channel to jomcall_app;
grant select,insert,delete on app.whatsapp_template to jomcall_app;
grant update(category,purpose,status,body,variables,revision,updated_at)on app.whatsapp_template to jomcall_app;
grant select on app.conversation,app.conversation_turn,app.message,app.conversation_tool_step,app.conversation_proposal to jomcall_app;
grant update(state,owner,handoff_turn_id,needs_attention,attention_reason,revision,closed_at)on app.conversation to jomcall_app;
grant update(state,revision)on app.conversation_proposal to jomcall_app;
grant insert(org_id,conversation_id,direction,author,kind,body,template_id,template_variables,status,actor_id)on app.message to jomcall_app;
