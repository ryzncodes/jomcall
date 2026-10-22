create table app.test_session(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id)on delete cascade,
 agent_id uuid not null,location_id uuid not null,contact_id uuid,creator_id uuid not null,auth_session_id uuid not null,
 snapshot jsonb not null check(octet_length(snapshot::text)<=2097152),snapshot_hash text not null,
 source text not null check(source in('draft','published')),agent_version_id uuid,model_digest text,
 state text not null default 'open' check(state in('open','closed')),revision integer not null default 1,
 expires_at timestamptz not null default now()+interval '24 hours',created_at timestamptz not null default now(),
 unique(org_id,id),foreign key(org_id,agent_id)references app.agent(org_id,id),
 foreign key(org_id,location_id)references app.location(org_id,id),
 foreign key(org_id,contact_id)references app.contact(org_id,id)on delete cascade,
 foreign key(org_id,agent_id,agent_version_id)references app.agent_version(org_id,agent_id,id)
);
create table app.test_turn(
 id uuid primary key default gen_random_uuid(),org_id uuid not null,session_id uuid not null,
 client_turn_id uuid not null,request_hash text not null,input text not null check(octet_length(input)<=4000),
 answer text check(octet_length(answer)<=4000),citations jsonb not null default '[]',
 state text not null default 'queued' check(state in('queued','running','completed','failed','cancelled')),
 revision integer not null default 1,attempt integer not null default 1,
 operation_id uuid not null default gen_random_uuid(),lease_token uuid,lease_until timestamptz,error_code text,
 created_at timestamptz not null default now(),unique(org_id,id),unique(org_id,session_id,id),unique(org_id,session_id,client_turn_id),
 foreign key(org_id,session_id)references app.test_session(org_id,id)on delete cascade
);
create unique index test_one_active_turn on app.test_turn(org_id,session_id)where(state in('queued','running'));
create table app.test_proposal(
 id uuid primary key default gen_random_uuid(),org_id uuid not null,session_id uuid not null,turn_id uuid not null,
 attempt integer not null,step integer not null,kind text not null check(kind in('booking','message','handoff')),
 details jsonb not null check(octet_length(details::text)<=8192),revision integer not null default 1,applied_booking_id uuid,
 unique(org_id,id),unique(org_id,turn_id,attempt,step),
 foreign key(org_id,session_id,turn_id)references app.test_turn(org_id,session_id,id)on delete cascade,
 foreign key(org_id,applied_booking_id)references app.booking(org_id,id)
);
create table app.test_tool_step(
 id uuid primary key default gen_random_uuid(),org_id uuid not null,session_id uuid not null,turn_id uuid not null,
 attempt integer not null,step integer not null,tool text not null,input jsonb not null,result jsonb not null,
 unique(org_id,id),unique(org_id,turn_id,attempt,step),
 foreign key(org_id,session_id,turn_id)references app.test_turn(org_id,session_id,id)on delete cascade
);
do $$declare t text;begin foreach t in array array['test_session','test_turn','test_proposal','test_tool_step']loop
 execute format('alter table app.%I enable row level security',t);execute format('alter table app.%I force row level security',t);
 execute format('grant select,insert,update,delete on app.%I to jomcall_app',t);
 execute format('create policy manager_all on app.%I for all to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))',t);
end loop;end$$;
create index test_session_contact on app.test_session(org_id,contact_id);
create index test_session_expiry on app.test_session(expires_at);
