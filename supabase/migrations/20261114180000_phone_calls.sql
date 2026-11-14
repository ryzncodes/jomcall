-- Inbound phone calls (milestone B). A dialled number maps to one business,
-- location and agent; a real call answers from the agent's PUBLISHED version
-- and is stored apart from test sessions. The agent process starts, runs and
-- ends calls through app_private.agent_call, holding only a per-call token
-- whose SHA-256 is stored here. Design:
-- docs/superpowers/specs/2026-11-14-phone-line-design.md
alter table app.organization add column calls_suspended_at timestamptz;

create table app.phone_number(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id)on delete cascade,
 location_id uuid not null,agent_id uuid not null,
 e164 text not null check(e164~'^\+[1-9][0-9]{6,14}$'),
 label text not null default '' check(length(label)<=80),
 transfer_e164 text check(transfer_e164 is null or transfer_e164~'^\+[1-9][0-9]{6,14}$'),
 active boolean not null default true,revision integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),foreign key(org_id,location_id)references app.location(org_id,id),
 foreign key(org_id,agent_id)references app.agent(org_id,id)
);
-- One dialled number reaches exactly one business, across all organizations.
create unique index phone_number_active_e164 on app.phone_number(e164)where active;

create table app.call(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references app.organization(id)on delete cascade,
 namespace text not null default 'local',
 phone_number_id uuid,location_id uuid not null,agent_id uuid not null,agent_version_id uuid,
 snapshot jsonb not null default '{}' check(octet_length(snapshot::text)<=2097152),
 direction text not null default 'inbound' check(direction='inbound'),
 caller_e164 text check(caller_e164 is null or caller_e164~'^\+[1-9][0-9]{1,14}$'),
 dialled_e164 text not null check(dialled_e164~'^\+[1-9][0-9]{1,14}$'),
 contact_id uuid,
 sip_call_id text not null check(length(sip_call_id)between 1 and 200),
 room text not null check(length(room)between 1 and 200),
 participant_identity text not null check(length(participant_identity)between 1 and 200),
 state text not null default 'active' check(state in('active','ended','refused')),
 refusal text check(refusal is null or refusal~'^[A-Z_]{1,40}$'),
 outcome text check(outcome is null or outcome in('answered','booking_proposed','message','handoff','transferred','transfer_failed','refused','abandoned')),
 end_reason text check(end_reason is null or end_reason~'^[A-Za-z_]{1,40}$'),
 language text check(language is null or language in('ms','en','manglish','zh')),
 voice text check(voice is null or length(voice)<=40),
 recording_enabled boolean not null default false,after_hours boolean not null default false,do_not_contact boolean not null default false,
 transfer_result text check(transfer_result is null or transfer_result in('transferred','failed')),
 disclosure_played_at timestamptz,started_at timestamptz not null default now(),answered_at timestamptz,ended_at timestamptz,
 duration_seconds integer check(duration_seconds is null or duration_seconds>=0),
 token_hash text check(token_hash is null or token_hash~'^[0-9a-f]{64}$'),token_expires_at timestamptz,
 pending_readback jsonb check(pending_readback is null or octet_length(pending_readback::text)<=2048),pending_readback_turn uuid,
 revision integer not null default 1,
 unique(org_id,id),unique(sip_call_id),
 foreign key(org_id,phone_number_id)references app.phone_number(org_id,id)on delete set null(phone_number_id),
 foreign key(org_id,location_id)references app.location(org_id,id),
 foreign key(org_id,agent_id)references app.agent(org_id,id),
 foreign key(org_id,agent_id,agent_version_id)references app.agent_version(org_id,agent_id,id),
 -- Deleting a contact (PDPA) deletes that caller's calls and everything under them.
 foreign key(org_id,contact_id)references app.contact(org_id,id)on delete cascade
);
create index call_timeline on app.call(org_id,started_at desc,id desc);
create index call_live on app.call(namespace,token_expires_at)where state='active';
create index call_caller on app.call(org_id,caller_e164,started_at);
create index call_contact on app.call(org_id,contact_id);

create table app.call_turn(
 id uuid primary key default gen_random_uuid(),org_id uuid not null,call_id uuid not null,
 client_turn_id uuid not null,input text not null check(octet_length(input)between 1 and 4000),
 answer text check(octet_length(answer)<=4000),
 state text not null default 'running' check(state in('running','completed','failed','cancelled')),
 lease_token uuid,lease_until timestamptz,error_code text,
 timings jsonb not null default '{}' check(octet_length(timings::text)<=8192),
 evidence jsonb not null default '[]' check(octet_length(evidence::text)<=8192),
 usage jsonb not null default '[]' check(octet_length(usage::text)<=8192),
 revision integer not null default 1,created_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,call_id,id),unique(org_id,call_id,client_turn_id),
 foreign key(org_id,call_id)references app.call(org_id,id)on delete cascade
);
create unique index call_one_active_turn on app.call_turn(org_id,call_id)where state='running';
create table app.call_tool_step(
 id uuid primary key default gen_random_uuid(),org_id uuid not null,call_id uuid not null,turn_id uuid not null,
 step integer not null check(step between 0 and 3),tool text not null,input jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,turn_id,step),
 foreign key(org_id,call_id,turn_id)references app.call_turn(org_id,call_id,id)on delete cascade
);
create table app.call_proposal(
 id uuid primary key default gen_random_uuid(),org_id uuid not null,call_id uuid not null,turn_id uuid not null,
 step integer not null,kind text not null check(kind in('booking','message','handoff')),
 details jsonb not null check(octet_length(details::text)<=8192),
 state text not null default 'pending' check(state in('pending','done','dismissed')),
 revision integer not null default 1,created_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,turn_id,step),
 foreign key(org_id,call_id,turn_id)references app.call_turn(org_id,call_id,id)on delete cascade
);

-- Row-level security. Every member reads phone numbers and the call list
-- (the staff's daily screen); only owners and admins read what was said
-- (turns, tool steps, proposals) and change numbers.
do $$declare t text;begin foreach t in array array['phone_number','call','call_turn','call_tool_step','call_proposal']loop
 execute format('alter table app.%I enable row level security',t);execute format('alter table app.%I force row level security',t);
 execute format('grant select on app.%I to jomcall_app',t);
end loop;
foreach t in array array['phone_number','call']loop
 execute format('create policy tenant_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)is not null)',t);
end loop;
foreach t in array array['call_turn','call_tool_step','call_proposal']loop
 execute format('create policy manager_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))',t);
end loop;end$$;
grant insert on app.phone_number to jomcall_app;
grant update(label,transfer_e164,active,location_id,agent_id,revision,updated_at)on app.phone_number to jomcall_app;
grant update(state,revision)on app.call_proposal to jomcall_app;
create policy manager_insert on app.phone_number for insert to jomcall_app with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));
create policy manager_update on app.phone_number for update to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'))with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));
create policy manager_update on app.call_proposal for update to jomcall_app using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'))with check(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)in('owner','admin'));

grant select on app.organization,app.agent,app.agent_version,app.phone_number to jomcall_agent_jobs;
grant select,insert,update on app.call,app.call_turn to jomcall_agent_jobs;
grant select,insert,delete on app.call_tool_step,app.call_proposal to jomcall_agent_jobs;
grant insert on app.contact to jomcall_agent_jobs;
grant create on schema app_private to jomcall_agent_jobs;

create function app_private.agent_call(p_action text,p_namespace text,p_call uuid default null,p_token_hash text default null,p_turn uuid default null,p_lease uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare c app.call;t app.call_turn;old app.call_turn;n app.phone_number;a app.agent;v app.agent_version;p app.call_proposal;
 r jsonb;v_settings jsonb;v_contact uuid;v_dnc boolean:=false;v_at timestamptz;v_local timestamp;v_sched app.location_schedule;
 v_open boolean;v_refusal text;v_live int;v_max int;v_cap int;v_step int;v_prev uuid;v_caller text;begin
 if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;

 if p_action='call_start' then
  v_caller=nullif(p_data->>'caller','');
  if coalesce(p_data->>'dialled','')!~'^\+[1-9][0-9]{1,14}$' or(v_caller is not null and v_caller!~'^\+[1-9][0-9]{1,14}$')
   or length(coalesce(p_data->>'sipCallId',''))not between 1 and 200 or length(coalesce(p_data->>'room',''))not between 1 and 200
   or length(coalesce(p_data->>'identity',''))not between 1 and 200 or coalesce(p_data->>'tokenHash','')!~'^[0-9a-f]{64}$' then raise exception 'INVALID_CALL_START';end if;
  v_max=least(greatest(coalesce((p_data->>'maxConcurrent')::int,1),1),20);
  v_cap=least(greatest(coalesce((p_data->>'capSeconds')::int,600),60),3600);
  v_at=coalesce((p_data->>'at')::timestamptz,now());
  -- One lock for every call start: the duplicate and concurrency checks below
  -- cannot interleave between two simultaneous calls.
  perform pg_advisory_xact_lock(hashtextextended('jomcall.call_start',0));
  if exists(select 1 from app.call where sip_call_id=p_data->>'sipCallId')then raise exception 'DUPLICATE_CALL';end if;
  select * into n from app.phone_number where e164=p_data->>'dialled' and active;
  if not found then raise exception 'UNKNOWN_NUMBER';end if;
  select * into a from app.agent where org_id=n.org_id and id=n.agent_id;
  -- The caller's number becomes (or finds) a contact, so PDPA deletion of that
  -- contact removes the call. A withheld number has no contact.
  if v_caller is not null then
   select id,do_not_contact into v_contact,v_dnc from app.contact where org_id=n.org_id and phone_e164=v_caller and not deletion_pending order by created_at,id limit 1;
   if v_contact is null then
    insert into app.contact(org_id,name,phone_e164)values(n.org_id,'Caller '||v_caller,v_caller)returning id into v_contact;v_dnc=false;
   end if;
  end if;
  if a.published_version_id is not null then
   select * into v from app.agent_version where org_id=n.org_id and agent_id=a.id and id=a.published_version_id;
  end if;
  v_settings=coalesce(v.snapshot->'settings','{}');
  if(select calls_suspended_at from app.organization where id=n.org_id)is not null then v_refusal='CALLS_SUSPENDED';
  elsif v.id is null then v_refusal='AGENT_UNPUBLISHED';
  elsif btrim(coalesce(v_settings->>'aiDisclosure',''))='' or(coalesce((v_settings->>'recordingEnabled')::boolean,false)and btrim(coalesce(v_settings->>'recordingDisclosure',''))='')then v_refusal='DISCLOSURE_REQUIRED';
  elsif v_caller is not null and(select count(*)from app.call x where x.org_id=n.org_id and x.caller_e164=v_caller and x.started_at>v_at-interval '1 hour')>=6 then v_refusal='CALLER_LIMIT';
  else
   -- Both live phone calls and browser voice tests draw on the same speech quota.
   select(select count(*)from app.call x where x.namespace=p_namespace and x.state='active' and x.token_expires_at>now())
    +(select count(*)from app.test_session s where s.namespace=p_namespace and s.channel='voice' and s.voice_expires_at>now())into v_live;
   if v_live>=v_max then v_refusal='LINES_BUSY';end if;
  end if;
  select * into v_sched from app.location_schedule where org_id=n.org_id and location_id=n.location_id;
  v_open=true;
  if found and v_sched.timezone='Asia/Kuala_Lumpur' then
   v_local=v_at at time zone 'Asia/Kuala_Lumpur';
   if exists(select 1 from jsonb_array_elements(v_sched.closures)x where x->>'date'=to_char(v_local,'YYYY-MM-DD'))then v_open=false;
   else
    v_open=exists(select 1 from jsonb_array_elements(v_sched.weekdays->(extract(isodow from v_local)::int-1))x
     where v_local::time>=(x->>'start')::time and(x->>'end'='24:00' or v_local::time<(x->>'end')::time));
   end if;
  end if;
  insert into app.call(org_id,namespace,phone_number_id,location_id,agent_id,agent_version_id,snapshot,caller_e164,dialled_e164,contact_id,sip_call_id,room,participant_identity,
   state,refusal,outcome,recording_enabled,after_hours,do_not_contact,token_hash,token_expires_at,started_at,ended_at,duration_seconds)
  values(n.org_id,p_namespace,n.id,n.location_id,n.agent_id,v.id,case when v_refusal is null then coalesce(v.snapshot,'{}')else '{}' end,v_caller,p_data->>'dialled',v_contact,p_data->>'sipCallId',p_data->>'room',p_data->>'identity',
   case when v_refusal is null then 'active' else 'refused' end,v_refusal,case when v_refusal is null then null else 'refused' end,
   coalesce((v_settings->>'recordingEnabled')::boolean,false),not v_open,coalesce(v_dnc,false),
   case when v_refusal is null then p_data->>'tokenHash' end,case when v_refusal is null then now()+(v_cap+60)*interval '1 second' end,
   now(),case when v_refusal is not null then now() end,case when v_refusal is not null then 0 end)returning * into c;
  if v_refusal is not null then return jsonb_build_object('callId',c.id,'refusal',v_refusal);end if;
  return jsonb_build_object('callId',c.id,'refusal',null,'settings',v_settings,'afterHours',c.after_hours,'doNotContact',c.do_not_contact,
   'recordingEnabled',c.recording_enabled,'transfer',n.transfer_e164 is not null,'capSeconds',v_cap);
 elsif p_action='maintain' then
  update app.call_turn q set state='failed',error_code='TURN_INTERRUPTED',revision=q.revision+1,lease_token=null,lease_until=null
   where q.id in(select x.id from app.call_turn x join app.call y on y.org_id=x.org_id and y.id=x.call_id where y.namespace=p_namespace and x.state='running' and x.lease_until<now()limit 100);
  update app.call set state='ended',end_reason='expired',outcome=coalesce(outcome,'abandoned'),ended_at=now(),
   duration_seconds=greatest(0,extract(epoch from now()-coalesce(answered_at,started_at))::int),token_hash=null,revision=revision+1
   where id in(select id from app.call where namespace=p_namespace and state='active' and token_expires_at<=now()limit 100);
  return '{}';
 end if;

 -- Everything below acts on one call and needs its token.
 select * into c from app.call where id=p_call and namespace=p_namespace;
 if not found then raise exception 'VOICE_UNAUTHORIZED';end if;
 if c.contact_id is not null then perform id from app.contact where org_id=c.org_id and id=c.contact_id for share;end if;
 select * into c from app.call where org_id=c.org_id and id=c.id for update;
 if not found or c.state<>'active' or c.token_hash is null or c.token_hash is distinct from p_token_hash then raise exception 'VOICE_UNAUTHORIZED';end if;
 if c.token_expires_at<=now()then raise exception 'VOICE_EXPIRED';end if;

 if p_action='call_answered' then
  update app.call set answered_at=coalesce(answered_at,now()),disclosure_played_at=coalesce(disclosure_played_at,now()),revision=revision+1 where id=c.id;
  return '{}';
 elsif p_action='call_end' then
  if coalesce(p_data->>'reason','')!~'^[A-Za-z_]{1,40}$' then raise exception 'INVALID_CALL_END';end if;
  update app.call_turn set state='cancelled',lease_token=null,lease_until=null,revision=revision+1 where org_id=c.org_id and call_id=c.id and state='running';
  update app.call set state='ended',end_reason=p_data->>'reason',ended_at=now(),token_hash=null,revision=revision+1,
   language=case when p_data->>'language' in('ms','en','manglish','zh')then p_data->>'language' else language end,
   duration_seconds=greatest(0,extract(epoch from now()-coalesce(answered_at,started_at))::int),
   outcome=case when transfer_result='transferred' then 'transferred'
    when exists(select 1 from app.call_proposal q where q.org_id=c.org_id and q.call_id=c.id and q.kind='booking')then 'booking_proposed'
    when exists(select 1 from app.call_proposal q where q.org_id=c.org_id and q.call_id=c.id and q.kind='handoff')then 'handoff'
    when exists(select 1 from app.call_proposal q where q.org_id=c.org_id and q.call_id=c.id and q.kind='message')then 'message'
    when transfer_result='failed' then 'transfer_failed'
    when answered_at is null then 'abandoned' else 'answered' end
   where id=c.id;
  return '{}';
 elsif p_action='turn_begin' then
  if octet_length(coalesce(p_data->>'input',''))not between 1 and 4000 or coalesce(p_data->>'clientTurnId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_VOICE_INPUT';end if;
  if(select count(*)from app.call_turn q where q.org_id=c.org_id and q.call_id=c.id)>=80 then raise exception 'TURN_LIMIT';end if;
  for old in select * from app.call_turn q where q.org_id=c.org_id and q.call_id=c.id and q.state='running' for update loop
   delete from app.call_proposal where org_id=c.org_id and turn_id=old.id;
   delete from app.call_tool_step where org_id=c.org_id and turn_id=old.id;
   update app.call_turn set state='cancelled',revision=revision+1,lease_token=null,lease_until=null where id=old.id;
   if c.pending_readback_turn=old.id then update app.call set pending_readback=null,pending_readback_turn=null where id=c.id;end if;
  end loop;
  insert into app.call_turn(org_id,call_id,client_turn_id,input,state,lease_token,lease_until)
   values(c.org_id,c.id,(p_data->>'clientTurnId')::uuid,p_data->>'input','running',gen_random_uuid(),now()+interval '65 seconds')returning * into t;
  return jsonb_build_object(
   'session',jsonb_build_object('id',c.id,'org_id',c.org_id,'location_id',c.location_id,'snapshot',c.snapshot,'snapshot_hash',null),
   'call',jsonb_build_object('afterHours',c.after_hours,'doNotContact',c.do_not_contact,'transfer',exists(select 1 from app.phone_number x where x.org_id=c.org_id and x.id=c.phone_number_id and x.transfer_e164 is not null),'room',c.room,'identity',c.participant_identity),
   'turn',to_jsonb(t),
   'history',coalesce((select jsonb_agg(jsonb_build_object('input',h.input,'answer',h.answer,'evidence',h.evidence)order by h.created_at,h.id)from(select h.id,h.created_at,h.input,h.answer,h.evidence from app.call_turn h where h.org_id=c.org_id and h.call_id=c.id and h.state='completed' and h.answer is not null and(h.created_at,h.id)<(t.created_at,t.id)order by h.created_at desc,h.id desc limit 6)h),'[]'),
   'recorded',coalesce((select jsonb_agg(jsonb_build_object('kind',q.kind,'details',q.details)order by u.created_at,u.id,q.step)from app.call_proposal q join app.call_turn u on u.org_id=q.org_id and u.id=q.turn_id where q.org_id=c.org_id and q.call_id=c.id and u.state='completed'),'[]'),
   'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=c.org_id and b.location_id=c.location_id and b.active),'[]'));
 end if;

 -- Turn actions: the turn must be this call's running turn with a live lease.
 select * into t from app.call_turn where org_id=c.org_id and call_id=c.id and id=p_turn for update;
 if not found or t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=now()then return null;end if;
 if p_action='turn_complete' then
  if octet_length(coalesce(p_data->>'answer',''))not between 1 and 4000 or jsonb_typeof(coalesce(p_data->'timings','{}'))<>'object' or jsonb_typeof(coalesce(p_data->'evidence','[]'))<>'array' or jsonb_typeof(coalesce(p_data->'usage','[]'))<>'array' or octet_length(coalesce(p_data->'timings','{}')::text)>8192 or octet_length(coalesce(p_data->'evidence','[]')::text)>8192 or octet_length(coalesce(p_data->'usage','[]')::text)>8192 then raise exception 'MODEL_OUTPUT_INVALID';end if;
  update app.call_turn set state='completed',answer=p_data->>'answer',timings=coalesce(p_data->'timings','{}'),evidence=coalesce(p_data->'evidence','[]'),usage=coalesce(p_data->'usage','[]'),revision=revision+1,lease_token=null,lease_until=null where id=t.id;
  return '{}';
 elsif p_action='turn_fail' then
  update app.call_turn set state='failed',revision=revision+1,error_code=case when p_data->>'code'~'^[A-Z_]{1,60}$' then p_data->>'code' else 'TURN_FAILED' end,lease_token=null,lease_until=null where id=t.id;
  return '{}';
 elsif p_action='turn_cancel' then
  delete from app.call_proposal where org_id=c.org_id and turn_id=t.id;
  delete from app.call_tool_step where org_id=c.org_id and turn_id=t.id;
  update app.call_turn set state='cancelled',revision=revision+1,lease_token=null,lease_until=null where id=t.id;
  if c.pending_readback_turn=t.id then update app.call set pending_readback=null,pending_readback_turn=null where id=c.id;end if;
  return '{}';
 elsif p_action='context' then
  return jsonb_build_object('session',jsonb_build_object('snapshot',c.snapshot,'location_id',c.location_id),
   'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=c.org_id and b.location_id=c.location_id and b.active),'[]'));
 elsif p_action='availability' then
  if coalesce((p_data->>'days')::int,0)not between 1 and 7 or coalesce(p_data->>'fromDate','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_TOOL';end if;
  if not exists(select 1 from app.booking_resource b where b.org_id=c.org_id and b.id=(p_data->>'resourceId')::uuid and b.location_id=c.location_id and b.active)then raise exception 'NOT_FOUND';end if;
  return jsonb_build_object('resource',(select to_jsonb(b)from app.booking_resource b where b.org_id=c.org_id and b.id=(p_data->>'resourceId')::uuid),
   'schedule',(select to_jsonb(b)from app.location_schedule b where b.org_id=c.org_id and b.location_id=c.location_id),
   'occupied',coalesce((select jsonb_agg(b)from(select start_at,end_at from app.booking where org_id=c.org_id and resource_id=(p_data->>'resourceId')::uuid and status='confirmed'
     and start_at<((p_data->>'fromDate')||'T00:00:00+08:00')::timestamptz+(p_data->>'days')::int*interval '1 day' and end_at>((p_data->>'fromDate')||'T00:00:00+08:00')::timestamptz limit 10000)b),'[]'));
 elsif p_action='record' then
  v_step=(p_data->>'step')::int;
  if v_step is null or v_step<0 or v_step>3 or octet_length(p_data::text)>65536 then raise exception 'TOOL_LIMIT';end if;
  select result into r from app.call_tool_step where org_id=c.org_id and turn_id=t.id and step=v_step;
  if found then return r;end if;
  if(p_data->'call'->>'name')not in('search_knowledge','check_availability','book_slot','take_message','handoff_to_human')then raise exception 'INVALID_TOOL';end if;
  r=p_data->'effect';
  if r->>'kind'='proposal' and r->'proposal'->>'kind'='booking' then
   -- Read-back before a booking, enforced here: a booking is recorded only when
   -- the call's pending read-back has the same details, was stored by the
   -- latest completed turn, and the caller said yes in this turn (judged by
   -- the agent process and passed as `confirmed`). Otherwise these details
   -- become the pending read-back and nothing is recorded.
   select id into v_prev from app.call_turn where org_id=c.org_id and call_id=c.id and state='completed' and(created_at,id)<(t.created_at,t.id)order by created_at desc,id desc limit 1;
   if c.pending_readback is not distinct from(r->'proposal'->'details')and c.pending_readback_turn is not distinct from v_prev and v_prev is not null and coalesce((p_data->>'confirmed')::boolean,false)then
    update app.call set pending_readback=null,pending_readback_turn=null where id=c.id;
   else
    update app.call set pending_readback=r->'proposal'->'details',pending_readback_turn=t.id where id=c.id;
    r=jsonb_build_object('kind','readback_required','details',r->'proposal'->'details');
   end if;
  end if;
  if r->>'kind'='proposal' then
   insert into app.call_proposal(org_id,call_id,turn_id,step,kind,details)values(c.org_id,c.id,t.id,v_step,r->'proposal'->>'kind',r->'proposal'->'details')returning * into p;
   r=jsonb_build_object('kind','proposal','proposal',jsonb_build_object('id',p.id,'kind',p.kind,'details',p.details,'state',p.state));
  elsif r->>'kind'='transfer' then
   update app.call set transfer_result=case when(r->>'ok')::boolean then 'transferred' else 'failed' end where id=c.id;
  end if;
  insert into app.call_tool_step(org_id,call_id,turn_id,step,tool,input,result)values(c.org_id,c.id,t.id,v_step,p_data->'call'->>'name',coalesce(p_data->'call'->'args','{}'),r);
  return r;
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;
alter function app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)owner to jomcall_agent_jobs;
revoke all on function app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)from public;
grant execute on function app_private.agent_call(text,text,uuid,text,uuid,uuid,jsonb)to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
