-- WhatsApp worker access. The web process stores verified webhook events
-- through app_private.whatsapp_intake. The agent process does everything else
-- through app_private.whatsapp_work: turning events into messages and turns,
-- running turns under a lease, and claiming and settling outbound sends.
-- Lock order everywhere: contact (share), conversation, then turn or message.
grant select,insert,update,delete on app.whatsapp_event,app.conversation,app.conversation_turn,app.message,app.conversation_tool_step,app.conversation_proposal to jomcall_agent_jobs;
grant select,update on app.whatsapp_channel to jomcall_agent_jobs;
grant select on app.whatsapp_template,app.agent,app.agent_version,app.consent_record to jomcall_agent_jobs;
grant insert on app.contact,app.consent_record to jomcall_agent_jobs;
grant create on schema app_private to jomcall_agent_jobs;

create function app_private.whatsapp_intake(p_namespace text,p_events jsonb)returns integer language plpgsql security definer set search_path='' as $$
declare e jsonb;n integer:=0;c integer;begin
 if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>500 then raise exception 'INVALID_EVENTS';end if;
 for e in select * from jsonb_array_elements(p_events)loop
  insert into app.whatsapp_event(namespace,dedupe_key,phone_number_id,kind,payload)
  values(p_namespace,e->>'key',e->>'phoneNumberId',e->>'kind',e->'payload')
  on conflict(namespace,dedupe_key)do nothing;
  get diagnostics c=row_count;n:=n+c;
 end loop;
 return n;
end$$;

create function app_private.whatsapp_status_rank(p_status text)returns integer language sql immutable set search_path='' as $$
 select case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end
$$;

create function app_private.whatsapp_work(p_action text,p_namespace text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare
 ev app.whatsapp_event;ch app.whatsapp_channel;c app.conversation;t app.conversation_turn;m app.message;
 p app.conversation_proposal;k app.contact;tpl app.whatsapp_template;
 r jsonb;v_id uuid;v_wa text;v_body text;v_kind text;v_status text;v_type text;v_at timestamptz;
 v_step int;v_resource uuid;v_days int;v_start timestamptz;v_version uuid;v_snapshot jsonb;v_location uuid;
 v_count int:=0;v_flag boolean;
begin
 if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;

 if p_action='maintain' then
  for t in select q.* from app.conversation_turn q join app.conversation x on(x.org_id=q.org_id and x.id=q.conversation_id)join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)
   where h.namespace=p_namespace and q.state='running' and q.lease_until<now() order by q.created_at limit 100 for update of q skip locked loop
   update app.conversation_turn set state='failed',error_code='TURN_INTERRUPTED',lease_token=null,lease_until=null,completed_at=now() where id=t.id;
   update app.conversation set needs_attention=true,attention_reason='AGENT_FAILED',revision=revision+1 where org_id=t.org_id and id=t.conversation_id;
  end loop;
  -- A send whose outcome was never recorded is never sent again.
  for m in select q.* from app.message q join app.conversation x on(x.org_id=q.org_id and x.id=q.conversation_id)join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)
   where h.namespace=p_namespace and q.status='sending' and q.lease_until<now() order by q.created_at limit 100 for update of q skip locked loop
   update app.message set status='unknown',status_at=now(),lease_until=null where id=m.id;
   update app.conversation set needs_attention=true,attention_reason='SEND_UNKNOWN',revision=revision+1,
    disclosure_message_id=case when disclosure_message_id=m.id then null else disclosure_message_id end where org_id=m.org_id and id=m.conversation_id;
  end loop;
  delete from app.whatsapp_event where id in(select id from app.whatsapp_event where namespace=p_namespace and state<>'pending' and processed_at<now()-interval '7 days' limit 1000);
  return '{}';

 elsif p_action='ingest' then
  for ev in select * from app.whatsapp_event where namespace=p_namespace and state='pending' order by received_at,id limit 50 for update skip locked loop
   v_count:=v_count+1;
   select * into ch from app.whatsapp_channel where namespace=p_namespace and phone_number_id=ev.phone_number_id and state='connected';
   if not found then
    update app.whatsapp_event set state='ignored',payload='{}',processed_at=now() where id=ev.id;continue;
   end if;

   if ev.kind='status' then
    select * into m from app.message where org_id=ch.org_id and provider_message_id=ev.payload->>'id' and direction='outbound';
    if not found then
     -- The status can overtake the record of the send. Try again later, then give up.
     if ev.attempts>=5 and ev.received_at<now()-interval '10 minutes' then
      update app.whatsapp_event set state='orphaned',payload='{}',processed_at=now() where id=ev.id;
     else update app.whatsapp_event set attempts=attempts+1 where id=ev.id;end if;
     continue;
    end if;
    select * into c from app.conversation where org_id=m.org_id and id=m.conversation_id for update;
    select * into m from app.message where id=m.id for update;
    v_status:=ev.payload->>'status';
    if v_status in('sent','delivered','read')then
     -- Deliveries arrive in any order; a status only ever moves forward.
     if m.status in('sent','delivered','read')and app_private.whatsapp_status_rank(v_status)>app_private.whatsapp_status_rank(m.status)then
      update app.message set status=v_status,status_at=now() where id=m.id;
     end if;
    elsif v_status='failed' and m.status='sent' then
     update app.message set status='failed',status_at=now(),error_code=case when ev.payload->>'errorCode'~'^[0-9]{1,9}$' then 'META_'||(ev.payload->>'errorCode')else 'META_FAILED' end where id=m.id;
     update app.conversation set needs_attention=true,attention_reason='SEND_FAILED',revision=revision+1,
      disclosure_message_id=case when disclosure_message_id=m.id then null else disclosure_message_id end where id=c.id;
    end if;
    update app.whatsapp_event set state='done',payload='{}',processed_at=now() where id=ev.id;continue;
   end if;

   v_wa:=ev.payload->>'from';
   if v_wa is null or v_wa!~'^[1-9][0-9]{1,14}$' or coalesce(ev.payload->>'id','')='' then
    update app.whatsapp_event set state='ignored',payload='{}',processed_at=now() where id=ev.id;continue;
   end if;
   perform pg_advisory_xact_lock(hashtextextended(ch.id::text||v_wa,0));
   if exists(select 1 from app.message where org_id=ch.org_id and provider_message_id=ev.payload->>'id')then
    update app.whatsapp_event set state='done',payload='{}',processed_at=now() where id=ev.id;continue;
   end if;
   select * into k from app.contact where org_id=ch.org_id and phone_e164='+'||v_wa order by created_at,id limit 1 for share;
   if found and k.deletion_pending then
    update app.whatsapp_event set state='ignored',payload='{}',processed_at=now() where id=ev.id;continue;
   end if;
   if k.id is null then
    insert into app.contact(org_id,name,phone_e164)values(ch.org_id,coalesce(nullif(left(btrim(coalesce(ev.payload->>'name','')),120),''),'+'||v_wa),'+'||v_wa)returning * into k;
   end if;
   select * into c from app.conversation where org_id=ch.org_id and channel_id=ch.id and wa_id=v_wa and state='open' for update;
   -- A message after a day of silence starts a new conversation, answered by
   -- the agent again and opened with the AI disclosure again.
   if found and coalesce(c.last_inbound_at,c.created_at)<now()-interval '24 hours' then
    update app.conversation_turn set state='cancelled',completed_at=now() where org_id=c.org_id and conversation_id=c.id and state='queued';
    update app.conversation set state='closed',closed_at=now(),revision=revision+1 where id=c.id;
    c:=null;
   end if;
   if c.id is null then
    insert into app.conversation(org_id,channel_id,contact_id,wa_id)values(ch.org_id,ch.id,k.id,v_wa)returning * into c;
   end if;
   v_type:=coalesce(ev.payload->>'type','');
   v_body:=left(coalesce(ev.payload->>'text',ev.payload->'media'->>'caption',''),2000);
   v_kind:=case when v_type='text' and btrim(v_body)<>'' then 'text' when v_type in('image','audio','video','document','sticker')then 'media' else 'unsupported' end;
   v_at:=least(coalesce(to_timestamp(nullif(ev.payload->>'timestamp','')::double precision),now()),now());
   insert into app.message(org_id,conversation_id,direction,author,kind,body,media,provider_message_id,status,provider_timestamp)
   values(ch.org_id,c.id,'inbound','customer',v_kind,v_body,case when v_kind='media' then ev.payload->'media' end,ev.payload->>'id','received',v_at)returning * into m;
   update app.conversation set last_inbound_at=greatest(coalesce(last_inbound_at,v_at),v_at),last_message_at=now(),revision=revision+1 where id=c.id returning * into c;

   if v_kind='text' and lower(btrim(v_body))in('stop','unsubscribe','berhenti','henti','batal langganan','退订','停止')then
    -- The customer's own words withdraw consent on this channel.
    insert into app.consent_record(org_id,contact_id,channel,purpose,granted,source,evidence,actor_id)
    select ch.org_id,k.id,'whatsapp',x,false,'customer_message','WhatsApp message '||m.id::text,null from unnest(array['service','marketing'])x;
    update app.conversation_turn set state='cancelled',completed_at=now() where org_id=c.org_id and conversation_id=c.id and state='queued';
    insert into app.conversation_turn(org_id,conversation_id,kind,input)values(c.org_id,c.id,'notice_opt_out','');
    update app.conversation set needs_attention=true,attention_reason='OPTED_OUT' where id=c.id;
   elsif c.owner='staff' or not ch.agent_enabled then
    update app.conversation set needs_attention=true,attention_reason='CUSTOMER_REPLIED' where id=c.id;
   elsif v_kind='text' then
    select * into t from app.conversation_turn where org_id=c.org_id and conversation_id=c.id and state='queued' for update;
    if found and t.kind='agent' then
     -- Several quick messages are answered once.
     if octet_length(t.input)+octet_length(v_body)+1<=4000 then update app.conversation_turn set input=input||E'\n'||v_body where id=t.id;end if;
    elsif found then
     update app.conversation_turn set kind='agent',input=left(v_body,1000) where id=t.id;
    else
     insert into app.conversation_turn(org_id,conversation_id,kind,input)values(c.org_id,c.id,'agent',left(v_body,1000));
    end if;
   else
    update app.conversation set needs_attention=true,attention_reason='UNSUPPORTED_MESSAGE' where id=c.id;
    if not exists(select 1 from app.conversation_turn where org_id=c.org_id and conversation_id=c.id and state='queued')then
     insert into app.conversation_turn(org_id,conversation_id,kind,input)values(c.org_id,c.id,'notice_unsupported','');
    end if;
   end if;
   update app.whatsapp_event set state='done',payload='{}',processed_at=now() where id=ev.id;
  end loop;
  return jsonb_build_object('processed',v_count);

 elsif p_action='verify_claim' then
  select jsonb_build_object('id',h.id,'revision',h.revision,'phoneNumberId',h.phone_number_id,'wabaId',h.waba_id,'credentials',h.credentials)into r
  from app.whatsapp_channel h where h.namespace=p_namespace and h.state='pending' order by h.updated_at,h.id limit 1;
  return r;
 elsif p_action='verify_result' then
  update app.whatsapp_channel set state=case when(p_data->>'ok')::boolean then 'connected' else 'failed' end,
   state_reason=case when(p_data->>'ok')::boolean then null when p_data->>'reason'~'^[A-Z0-9_]{1,60}$' then p_data->>'reason' else 'VERIFICATION_FAILED' end,
   display_phone_e164=case when p_data->>'displayPhone'~'^\+[1-9][0-9]{1,14}$' then p_data->>'displayPhone' else display_phone_e164 end,
   revision=revision+1,updated_at=now()
  where id=p_id and namespace=p_namespace and state='pending' and revision=(p_data->>'revision')::int;
  return jsonb_build_object('applied',found);

 elsif p_action='turn_claim' then
  select q.id into v_id from app.conversation_turn q join app.conversation x on(x.org_id=q.org_id and x.id=q.conversation_id)join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)
  where h.namespace=p_namespace and q.state='queued'
  and not exists(select 1 from app.conversation_turn b where b.org_id=q.org_id and b.conversation_id=q.conversation_id and b.state='running')
  order by q.created_at,q.id limit 1;
  if v_id is null then return null;end if;
  select x.* into c from app.conversation x join app.conversation_turn q on(q.org_id=x.org_id and q.conversation_id=x.id)where q.id=v_id;
  select * into k from app.contact where org_id=c.org_id and id=c.contact_id for share;
  select * into c from app.conversation where id=c.id for update;
  select * into t from app.conversation_turn where id=v_id and state='queued' for update;
  if not found then return jsonb_build_object('skipped',true);end if;
  select * into ch from app.whatsapp_channel where org_id=c.org_id and id=c.channel_id;
  if k.id is null or k.deletion_pending or c.state<>'open' or ch.state<>'connected' then
   update app.conversation_turn set state='skipped',error_code='CONVERSATION_UNAVAILABLE',completed_at=now() where id=t.id;return jsonb_build_object('skipped',true);
  end if;
  if t.kind='agent' then
   -- A person has the conversation: the agent stays silent.
   if c.owner='staff' or not ch.agent_enabled then
    update app.conversation_turn set state='skipped',error_code='AGENT_PAUSED',completed_at=now() where id=t.id;
    update app.conversation set needs_attention=true,attention_reason='CUSTOMER_REPLIED' where id=c.id;return jsonb_build_object('skipped',true);
   end if;
   select a.published_version_id,a.location_id into v_version,v_location from app.agent a where a.org_id=ch.org_id and a.id=ch.agent_id;
   if v_version is not null then select v.snapshot into v_snapshot from app.agent_version v where v.org_id=ch.org_id and v.agent_id=ch.agent_id and v.id=v_version;end if;
   if v_snapshot is null then
    update app.conversation_turn set state='skipped',error_code='AGENT_NOT_PUBLISHED',completed_at=now() where id=t.id;
    update app.conversation set needs_attention=true,attention_reason='AGENT_NOT_PUBLISHED',revision=revision+1 where id=c.id;return jsonb_build_object('skipped',true);
   end if;
  end if;
  update app.conversation_turn set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',agent_version_id=v_version where id=t.id returning * into t;
  return jsonb_build_object('turn',to_jsonb(t),
   'conversation',jsonb_build_object('id',c.id,'org_id',c.org_id,'owner',c.owner,'disclosed',c.disclosure_message_id is not null),
   'contact',jsonb_build_object('id',k.id,'preferred_language',k.preferred_language),
   'session',jsonb_build_object('org_id',c.org_id,'location_id',coalesce(v_location,ch.location_id),'snapshot',v_snapshot,'agent_version_id',v_version),
   'history',coalesce((select jsonb_agg(jsonb_build_object('input',h.input,'answer',h.answer)order by h.created_at,h.id)from(select h.id,h.created_at,h.input,h.answer from app.conversation_turn h where h.org_id=c.org_id and h.conversation_id=c.id and h.kind='agent' and h.state='completed' and h.answer is not null order by h.created_at desc,h.id desc limit 6)h),'[]'),
   'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=c.org_id and b.location_id=coalesce(v_location,ch.location_id)and b.active),'[]'));

 elsif p_action in('turn_context','turn_availability','turn_record','turn_complete','turn_fail')then
  select x.* into c from app.conversation x join app.conversation_turn q on(q.org_id=x.org_id and q.conversation_id=x.id)join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)where q.id=p_id and h.namespace=p_namespace;
  if not found then return null;end if;
  perform id from app.contact where org_id=c.org_id and id=c.contact_id for share;
  select * into c from app.conversation where id=c.id for update;
  select * into t from app.conversation_turn where id=p_id for update;
  if not found or t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=now()then return null;end if;
  select * into ch from app.whatsapp_channel where org_id=c.org_id and id=c.channel_id;
  select a.location_id into v_location from app.agent a where a.org_id=ch.org_id and a.id=ch.agent_id;
  v_location:=coalesce(v_location,ch.location_id);
  if p_action='turn_fail' then
   update app.conversation_turn set state='failed',error_code=case when p_data->>'code'~'^[A-Z0-9_]{1,60}$' then p_data->>'code' else 'TURN_FAILED' end,lease_token=null,lease_until=null,completed_at=now() where id=t.id;
   update app.conversation set needs_attention=true,attention_reason='AGENT_FAILED',revision=revision+1 where id=c.id;
   return '{}';
  elsif p_action='turn_context' then
   return jsonb_build_object('session',jsonb_build_object('org_id',c.org_id,'location_id',v_location,
    'snapshot',(select v.snapshot from app.agent_version v where v.org_id=c.org_id and v.id=t.agent_version_id)),
    'resources',coalesce((select jsonb_agg(b)from app.booking_resource b where b.org_id=c.org_id and b.location_id=v_location and b.active),'[]'));
  elsif p_action='turn_availability' then
   v_resource=(p_data->>'resourceId')::uuid;v_days=(p_data->>'days')::int;
   if v_days<1 or v_days>7 or(p_data->>'fromDate')!~'^\d{4}-\d{2}-\d{2}$'then raise exception 'INVALID_TOOL';end if;
   v_start=((p_data->>'fromDate')||'T00:00:00+08:00')::timestamptz;
   if not exists(select 1 from app.booking_resource b where b.org_id=c.org_id and b.id=v_resource and b.location_id=v_location and b.active)then raise exception 'NOT_FOUND';end if;
   return jsonb_build_object('resource',(select to_jsonb(b)from app.booking_resource b where b.org_id=c.org_id and b.id=v_resource),'schedule',(select to_jsonb(b)from app.location_schedule b where b.org_id=c.org_id and b.location_id=v_location),'occupied',coalesce((select jsonb_agg(b)from(select start_at,end_at from app.booking where org_id=c.org_id and resource_id=v_resource and status='confirmed' and start_at<v_start+v_days*interval '1 day' and end_at>v_start limit 10000)b),'[]'));
  elsif p_action='turn_record' then
   v_step=(p_data->>'step')::int;
   if v_step<0 or v_step>3 or octet_length(p_data::text)>65536 then raise exception 'TOOL_LIMIT';end if;
   select result into r from app.conversation_tool_step where org_id=c.org_id and turn_id=t.id and attempt=t.attempt and step=v_step;
   if found then return r;end if;
   if(p_data->'call'->>'name')not in('search_knowledge','check_availability','book_slot','take_message','handoff_to_human')then raise exception 'INVALID_TOOL';end if;
   r=p_data->'effect';
   if r->>'kind'='proposal'then
    insert into app.conversation_proposal(org_id,conversation_id,turn_id,attempt,step,kind,details)values(c.org_id,c.id,t.id,t.attempt,v_step,r->'proposal'->>'kind',r->'proposal'->'details')returning * into p;
    -- A proposal is work for a person. A handoff also silences the agent.
    update app.conversation set needs_attention=true,revision=revision+1,
     attention_reason=case p.kind when 'handoff' then 'HANDOFF_REQUESTED' when 'booking' then 'BOOKING_PROPOSED' else 'MESSAGE_LEFT' end,
     owner=case when p.kind='handoff' then 'staff' else owner end,
     handoff_turn_id=case when p.kind='handoff' then t.id else handoff_turn_id end where id=c.id;
    r=jsonb_build_object('kind','proposal','proposal',to_jsonb(p)||jsonb_build_object('session_id',c.id,'applied_booking_id',null));
   end if;
   insert into app.conversation_tool_step(org_id,conversation_id,turn_id,attempt,step,tool,input,result)values(c.org_id,c.id,t.id,t.attempt,v_step,p_data->'call'->>'name',p_data->'call'->'args',r);
   return r;
  else
   if octet_length(coalesce(p_data->>'text',''))not between 1 and 4000 or octet_length(coalesce(p_data->>'disclosure',''))>1000 or jsonb_typeof(coalesce(p_data->'citations','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'citations','[]'))>5 then raise exception 'MODEL_OUTPUT_INVALID';end if;
   -- A person took over while the agent was thinking: its answer is dropped.
   if t.kind='agent' and(c.state<>'open' or(c.owner='staff' and c.handoff_turn_id is distinct from t.id))then
    update app.conversation_turn set state='cancelled',lease_token=null,lease_until=null,completed_at=now() where id=t.id;
    return jsonb_build_object('cancelled',true);
   end if;
   -- The first message the business sends in a conversation states that an AI is answering.
   v_flag:=c.disclosure_message_id is null and coalesce(p_data->>'disclosure','')<>'';
   insert into app.message(org_id,conversation_id,direction,author,kind,body,status,turn_id)
   values(c.org_id,c.id,'outbound',case when t.kind='agent' then 'agent' else 'system' end,'text',case when v_flag then(p_data->>'disclosure')||E'\n\n'||(p_data->>'text')else p_data->>'text' end,'queued',t.id)returning * into m;
   update app.conversation set last_message_at=now(),revision=revision+1,disclosure_message_id=case when v_flag then m.id else disclosure_message_id end where id=c.id;
   update app.conversation_turn set state='completed',answer=p_data->>'text',citations=coalesce(p_data->'citations','[]'),usage=coalesce(p_data->'usage','[]'),
    model_identity=left(p_data->>'model',200),lease_token=null,lease_until=null,completed_at=now() where id=t.id;
   return jsonb_build_object('messageId',m.id,'disclosed',v_flag);
  end if;

 elsif p_action='send_claim' then
  select q.id into v_id from app.message q join app.conversation x on(x.org_id=q.org_id and x.id=q.conversation_id)join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)
  where h.namespace=p_namespace and q.status='queued' order by q.created_at,q.id limit 1;
  if v_id is null then return null;end if;
  select x.* into c from app.conversation x join app.message q on(q.org_id=x.org_id and q.conversation_id=x.id)where q.id=v_id;
  select * into k from app.contact where org_id=c.org_id and id=c.contact_id for share;
  select * into c from app.conversation where id=c.id for update;
  select * into m from app.message where id=v_id and status='queued' for update;
  if not found then return jsonb_build_object('skipped',true);end if;
  select * into ch from app.whatsapp_channel where org_id=c.org_id and id=c.channel_id;
  if m.template_id is not null then select * into tpl from app.whatsapp_template where org_id=m.org_id and id=m.template_id;end if;
  update app.message set status='sending',status_at=now(),lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=m.id returning * into m;
  return jsonb_build_object(
   'message',jsonb_build_object('id',m.id,'kind',m.kind,'body',m.body,'author',m.author,'lease_token',m.lease_token,'template_variables',m.template_variables),
   'channel',jsonb_build_object('id',ch.id,'state',ch.state,'phoneNumberId',ch.phone_number_id,'credentials',ch.credentials),
   'contact',jsonb_build_object('id',k.id,'doNotContact',coalesce(k.do_not_contact,true),'deletionPending',coalesce(k.deletion_pending,true)),
   'conversation',jsonb_build_object('id',c.id,'waId',c.wa_id,'state',c.state,'lastInboundAt',c.last_inbound_at),
   'consent',jsonb_build_object(
    'service',(select g.granted from app.consent_record g where g.org_id=c.org_id and g.contact_id=c.contact_id and g.channel='whatsapp' and g.purpose='service' order by g.created_at desc,g.id desc limit 1),
    'marketing',(select g.granted from app.consent_record g where g.org_id=c.org_id and g.contact_id=c.contact_id and g.channel='whatsapp' and g.purpose='marketing' order by g.created_at desc,g.id desc limit 1)),
   'template',case when tpl.id is null then null else jsonb_build_object('id',tpl.id,'name',tpl.name,'language',tpl.language,'category',tpl.category,'status',tpl.status,'variables',tpl.variables)end,
   'now',now());

 elsif p_action='send_result' then
  select x.* into c from app.conversation x join app.message q on(q.org_id=x.org_id and q.conversation_id=x.id)join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)where q.id=p_id and h.namespace=p_namespace;
  if not found then return null;end if;
  select * into c from app.conversation where id=c.id for update;
  select * into m from app.message where id=p_id for update;
  -- A late result may still settle a send that maintenance marked unknown.
  if m.status not in('sending','unknown')or m.lease_token is distinct from p_lease then return null;end if;
  v_status:=p_data->>'outcome';
  if v_status='sent' then
   if coalesce(p_data->>'providerMessageId','')='' then raise exception 'INVALID_SEND_RESULT';end if;
   update app.message set status='sent',status_at=now(),provider_message_id=left(p_data->>'providerMessageId',256),lease_token=null,lease_until=null where id=m.id;
   update app.conversation set last_message_at=now() where id=c.id;
  elsif v_status in('failed','blocked','unknown')then
   update app.message set status=v_status,status_at=now(),error_code=case when p_data->>'code'~'^[A-Z0-9_]{1,60}$' then p_data->>'code' end,
    lease_token=case when v_status='unknown' then lease_token end,lease_until=null where id=m.id;
   update app.conversation set needs_attention=true,attention_reason='SEND_'||upper(v_status),revision=revision+1,
    disclosure_message_id=case when disclosure_message_id=m.id then null else disclosure_message_id end where id=c.id;
  else raise exception 'INVALID_SEND_RESULT';end if;
  return '{}';
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;

alter function app_private.whatsapp_intake(text,jsonb)owner to jomcall_agent_jobs;
alter function app_private.whatsapp_status_rank(text)owner to jomcall_agent_jobs;
alter function app_private.whatsapp_work(text,text,uuid,uuid,jsonb)owner to jomcall_agent_jobs;
revoke all on function app_private.whatsapp_intake(text,jsonb),app_private.whatsapp_status_rank(text),app_private.whatsapp_work(text,text,uuid,uuid,jsonb)from public;
-- The web process may only add events; the agent process does the rest.
grant execute on function app_private.whatsapp_intake(text,jsonb)to jomcall_app;
grant execute on function app_private.whatsapp_work(text,text,uuid,uuid,jsonb)to jomcall_agent;
revoke create on schema app_private from jomcall_agent_jobs;
