-- Knowledge core: facts, rules, catalogue (with frozen sets), searchable units
-- and the gap log. Design: docs/superpowers/specs/2026-11-14-knowledge-core-design.md.
--
-- Written to be re-runnable (if not exists / drop policy if exists / guarded
-- text substitution), because the shared local database is patched with psql
-- while its migration history is ahead of main.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

alter table app.agent add column if not exists packs text[] not null default '{}'
  check (cardinality(packs) <= 9);

create table if not exists app.knowledge_fact(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 agent_id uuid not null,
 pack_id text check (pack_id ~ '^[a-z][a-z0-9-]{1,40}$'),
 field_key text check (field_key ~ '^[a-z][a-z0-9_]{1,60}$'),
 title text not null check (char_length(title) between 1 and 200),
 value jsonb not null check (octet_length(value::text) <= 4000),
 language text not null default 'mixed' check (language in ('ms','en','zh','mixed')),
 status text not null default 'confirmed' check (status in ('draft','confirmed')),
 source text not null default 'owner' check (source in ('owner','import','interview','gap')),
 revision int not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((pack_id is null) = (field_key is null)),
 unique (org_id, id),
 foreign key (org_id, agent_id) references app.agent(org_id, id) on delete cascade);
create unique index if not exists knowledge_fact_field on app.knowledge_fact(org_id, agent_id, pack_id, field_key) where field_key is not null;
create index if not exists knowledge_fact_agent on app.knowledge_fact(org_id, agent_id);

create table if not exists app.knowledge_rule(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 agent_id uuid not null,
 kind text not null check (kind in ('never','unknown','message','handoff','after_hours','always')),
 text text not null check (octet_length(text) between 1 and 1000),
 pack_id text check (pack_id ~ '^[a-z][a-z0-9-]{1,40}$'),
 pack_rule_id text check (pack_rule_id ~ '^[a-z][a-z0-9-]{1,60}$'),
 enabled boolean not null default true,
 status text not null default 'confirmed' check (status in ('draft','confirmed')),
 source text not null default 'owner' check (source in ('owner','import','interview','gap')),
 revision int not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((pack_id is null) = (pack_rule_id is null)),
 unique (org_id, id),
 foreign key (org_id, agent_id) references app.agent(org_id, id) on delete cascade);
create unique index if not exists knowledge_rule_override on app.knowledge_rule(org_id, agent_id, pack_id, pack_rule_id) where pack_rule_id is not null;
create index if not exists knowledge_rule_agent on app.knowledge_rule(org_id, agent_id);

create table if not exists app.catalogue_row(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 agent_id uuid not null,
 pack_id text check (pack_id ~ '^[a-z][a-z0-9-]{1,40}$'),
 item text not null check (char_length(item) between 1 and 200),
 aliases text[] not null default '{}' check (cardinality(aliases) <= 20),
 lookup_keys text[] not null default '{}' check (cardinality(lookup_keys) <= 40),
 search_text text not null check (char_length(search_text) <= 2000),
 price_sen bigint check (price_sen >= 0 and price_sen <= 100000000000),
 stock_note text not null default '' check (char_length(stock_note) <= 200),
 attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 4000),
 language text not null default 'mixed' check (language in ('ms','en','zh','mixed')),
 status text not null default 'confirmed' check (status in ('draft','confirmed')),
 source text not null default 'owner' check (source in ('owner','import','interview','gap')),
 revision int not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (org_id, id),
 foreign key (org_id, agent_id) references app.agent(org_id, id) on delete cascade);
create index if not exists catalogue_row_agent on app.catalogue_row(org_id, agent_id, created_at, id);

-- Frozen, immutable copies referenced from snapshots by id and content hash.
create table if not exists app.catalogue_set(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 agent_id uuid not null,
 hash text not null check (hash ~ '^[0-9a-f]{64}$'),
 row_count int not null check (row_count between 0 and 10000),
 created_at timestamptz not null default now(),
 unique (org_id, id),
 unique (org_id, agent_id, hash),
 foreign key (org_id, agent_id) references app.agent(org_id, id) on delete cascade);
create table if not exists app.catalogue_set_row(
 org_id uuid not null,
 set_id uuid not null,
 ordinal int not null check (ordinal between 0 and 9999),
 item text not null,
 aliases text[] not null,
 lookup_keys text[] not null,
 search_text text not null,
 price_sen bigint,
 stock_note text not null,
 attributes jsonb not null,
 language text not null,
 updated_at timestamptz not null,
 unit_hash text not null,
 primary key (set_id, ordinal),
 foreign key (org_id, set_id) references app.catalogue_set(org_id, id) on delete cascade);
create index if not exists catalogue_set_row_trgm on app.catalogue_set_row using gin (search_text extensions.gin_trgm_ops);
create index if not exists catalogue_set_row_keys on app.catalogue_set_row using gin (lookup_keys);

-- One searchable unit per fact, free-text chunk or catalogue row. Content
-- addressed, so equal text shares one embedding across drafts and versions.
-- Exact scan, no vector index: at 10,000 rows or fewer per business a scan on
-- the org key is fast enough and has perfect recall.
create table if not exists app.knowledge_unit(
 org_id uuid not null references app.organization(id) on delete cascade,
 hash text not null check (hash ~ '^[0-9a-f]{64}$'),
 source text not null check (source in ('fact','free','catalogue')),
 language text not null check (language in ('ms','en','zh','mixed')),
 title text not null check (char_length(title) <= 200),
 text text not null check (octet_length(text) <= 8000),
 embedding_model text check (embedding_model ~ '^[a-z0-9.:/_-]{1,80}$'),
 embedding_dims int check (embedding_dims = 768),
 embedding extensions.vector(768),
 created_at timestamptz not null default now(),
 primary key (org_id, hash),
 check ((embedding is null) = (embedding_model is null)));
create index if not exists knowledge_unit_pending on app.knowledge_unit(created_at) where embedding is null;

create table if not exists app.knowledge_gap(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references app.organization(id) on delete cascade,
 agent_id uuid not null,
 question_key text not null check (question_key ~ '^[0-9a-f]{64}$'),
 status text not null default 'open' check (status in ('open','resolved','ignored')),
 resolution text check (resolution in ('fact','rule','ignore')),
 resolved_ref uuid,
 resolved_at timestamptz,
 resolved_by uuid,
 ask_count int not null default 0,
 last_asked_at timestamptz not null default now(),
 revision int not null default 1,
 created_at timestamptz not null default now(),
 unique (org_id, id),
 unique (org_id, agent_id, question_key),
 foreign key (org_id, agent_id) references app.agent(org_id, id) on delete cascade);
-- Question text lives only here, so deleting a contact's asks removes it.
create table if not exists app.knowledge_gap_ask(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null,
 gap_id uuid not null,
 contact_id uuid,
 session_id uuid,
 question text not null check (octet_length(question) between 1 and 2000),
 language text not null check (language in ('ms','en','zh','mixed')),
 channel text not null check (channel in ('text','voice')),
 answer text not null default '' check (octet_length(answer) <= 4000),
 asked_at timestamptz not null default now(),
 foreign key (org_id, gap_id) references app.knowledge_gap(org_id, id) on delete cascade,
 foreign key (org_id, contact_id) references app.contact(org_id, id) on delete cascade,
 foreign key (org_id, session_id) references app.test_session(org_id, id) on delete set null (session_id));
create index if not exists knowledge_gap_ask_gap on app.knowledge_gap_ask(org_id, gap_id, asked_at desc);
create index if not exists knowledge_gap_ask_contact on app.knowledge_gap_ask(org_id, contact_id) where contact_id is not null;

-- A gap whose last ask is gone (contact deleted) is deleted with it.
create or replace function app_private.knowledge_gap_orphan() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from app.knowledge_gap g where g.org_id=old.org_id and g.id=old.gap_id
  and not exists(select 1 from app.knowledge_gap_ask a where a.org_id=old.org_id and a.gap_id=old.gap_id);
 return null;
end$$;
revoke all on function app_private.knowledge_gap_orphan() from public;
drop trigger if exists knowledge_gap_orphan on app.knowledge_gap_ask;
create trigger knowledge_gap_orphan after delete on app.knowledge_gap_ask for each row execute function app_private.knowledge_gap_orphan();

-- Web role: owners and admins manage knowledge; staff see nothing here.
grant select, insert, update, delete on app.knowledge_fact, app.knowledge_rule, app.catalogue_row to jomcall_app;
grant select, insert on app.catalogue_set, app.catalogue_set_row, app.knowledge_unit to jomcall_app;
grant select, update on app.knowledge_gap to jomcall_app;
grant select on app.knowledge_gap_ask to jomcall_app;
do $$ declare t text; begin
 foreach t in array array['knowledge_fact','knowledge_rule','catalogue_row','catalogue_set','catalogue_set_row','knowledge_unit','knowledge_gap','knowledge_gap_ask'] loop
  execute format('alter table app.%I enable row level security', t);
  execute format('alter table app.%I force row level security', t);
  execute format('drop policy if exists tenant_read on app.%I', t);
  execute format('create policy tenant_read on app.%I for select to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  if t not in ('knowledge_gap','knowledge_gap_ask') then
   execute format('drop policy if exists manager_insert on app.%I', t);
   execute format('create policy manager_insert on app.%I for insert to jomcall_app with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  end if;
  if t in ('knowledge_fact','knowledge_rule','catalogue_row','knowledge_gap') then
   execute format('drop policy if exists manager_update on app.%I', t);
   execute format('create policy manager_update on app.%I for update to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))with check(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  end if;
  if t in ('knowledge_fact','knowledge_rule','catalogue_row') then
   execute format('drop policy if exists manager_delete on app.%I', t);
   execute format('create policy manager_delete on app.%I for delete to jomcall_app using(org_id=nullif(current_setting(''app.org_id'',true),'''')::uuid and app_private.active_role(org_id)in(''owner'',''admin''))', t);
  end if;
 end loop;
end $$;

-- Agent jobs role (owner of the agent's security-definer functions).
grant usage on schema extensions to jomcall_agent_jobs;
grant select on app.catalogue_set, app.catalogue_set_row to jomcall_agent_jobs;
grant select, update (embedding_model, embedding_dims, embedding) on app.knowledge_unit to jomcall_agent_jobs;
grant select, insert, update on app.knowledge_gap to jomcall_agent_jobs;
grant select, insert, delete on app.knowledge_gap_ask to jomcall_agent_jobs;
do $$ declare t text; begin
 foreach t in array array['catalogue_set','catalogue_set_row','knowledge_unit','knowledge_gap','knowledge_gap_ask'] loop
  execute format('drop policy if exists agent_jobs on app.%I', t);
  execute format('create policy agent_jobs on app.%I to jomcall_agent_jobs using(true) with check(true)', t);
 end loop;
end $$;

-- The agent reaches the catalogue, units and gap log only through this
-- function, and only for a running turn whose lease it holds. Typed and
-- spoken turns both live in app.test_turn with a lease.
create or replace function app_private.agent_knowledge(p_action text,p_namespace text,p_turn uuid,p_lease uuid,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare s app.test_session;t app.test_turn;g app.knowledge_gap;v_set uuid;v_code text;v_item text;v_fits text;r jsonb;
begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 select * into t from app.test_turn where id=p_turn;
 if not found or t.state<>'running' or t.lease_token is distinct from p_lease or t.lease_until<=now() then raise exception 'TURN_CANCELLED';end if;
 select * into s from app.test_session where org_id=t.org_id and id=t.session_id and namespace=p_namespace;
 if not found or not app_private.agent_authorized(s) then raise exception 'AUTHORITY_REVOKED';end if;
 v_set=nullif(s.snapshot->'catalogue'->>'setId','')::uuid;
 if p_action='catalogue' then
  if v_set is null then return '[]';end if;
  v_code=upper(regexp_replace(left(coalesce(p_data->>'code',''),80),'[^[:alnum:]]','','g'));
  v_item=lower(left(coalesce(p_data->>'item',''),200));
  v_fits=lower(left(coalesce(p_data->>'fits',''),200));
  if v_code='' and btrim(v_item)='' and btrim(v_fits)='' then raise exception 'INVALID_TOOL';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc,x.ordinal),'[]') into r from(
   select y.* from(
    select c.ordinal,c.item,c.aliases,c.price_sen,c.stock_note,c.attributes,c.updated_at,
     case when v_code<>'' and v_code=any(c.lookup_keys) then 'code'
          when v_code<>'' and exists(select 1 from unnest(c.lookup_keys)k where extensions.similarity(v_code,k)>=0.5) then 'code'
          else 'trigram' end as match,
     round(greatest(
      case when v_code<>'' and v_code=any(c.lookup_keys) then 1.0 else 0 end,
      case when v_code<>'' then coalesce((select max(extensions.similarity(v_code,k))from unnest(c.lookup_keys)k),0)*0.9 else 0 end,
      case when btrim(v_item)<>'' or btrim(v_fits)<>'' then
       (case when btrim(v_item)<>'' then extensions.word_similarity(v_item,c.search_text) else 0 end+
        case when btrim(v_fits)<>'' then extensions.word_similarity(v_fits,c.search_text) else 0 end)/
       ((btrim(v_item)<>'')::int+(btrim(v_fits)<>'')::int)
      else 0 end)::numeric,3)::float8 as score
    from app.catalogue_set_row c where c.org_id=s.org_id and c.set_id=v_set)y
   where y.score>=0.3 order by y.score desc,y.ordinal limit 5)x;
  return r;
 elsif p_action='units' then
  if coalesce(p_data->>'model','')!~'^[a-z0-9.:/_-]{1,80}$' or jsonb_typeof(p_data->'hashes')<>'array' or jsonb_array_length(p_data->'hashes')>2000 then raise exception 'INVALID_TOOL';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc),'[]') into r from(
   select u.hash,u.source,u.title,u.text,round((1-(u.embedding OPERATOR(extensions.<=>) (p_data->>'vector')::extensions.vector(768)))::numeric,3)::float8 as score
   from app.knowledge_unit u
   where u.org_id=s.org_id and u.embedding_model=p_data->>'model'
    and(u.hash in(select jsonb_array_elements_text(p_data->'hashes'))
     or u.hash in(select c.unit_hash from app.catalogue_set_row c where c.org_id=s.org_id and c.set_id=v_set))
   order by u.embedding OPERATOR(extensions.<=>) (p_data->>'vector')::extensions.vector(768) limit 5)x;
  return r;
 elsif p_action='gap' then
  if coalesce(p_data->>'key','')!~'^[0-9a-f]{64}$' or octet_length(coalesce(p_data->>'question',''))not between 1 and 2000
   or coalesce(p_data->>'language','')not in('ms','en','zh','mixed') or coalesce(p_data->>'channel','')not in('text','voice')
   or octet_length(coalesce(p_data->>'answer',''))>4000 then raise exception 'INVALID_GAP';end if;
  insert into app.knowledge_gap(org_id,agent_id,question_key,ask_count)values(s.org_id,s.agent_id,p_data->>'key',1)
   on conflict(org_id,agent_id,question_key)do update set ask_count=app.knowledge_gap.ask_count+1,last_asked_at=now(),revision=app.knowledge_gap.revision+1
   returning * into g;
  insert into app.knowledge_gap_ask(org_id,gap_id,contact_id,session_id,question,language,channel,answer)
   values(s.org_id,g.id,s.contact_id,s.id,p_data->>'question',p_data->>'language',p_data->>'channel',coalesce(p_data->>'answer',''));
  delete from app.knowledge_gap_ask a where a.org_id=s.org_id and a.gap_id=g.id and a.id in(
   select b.id from app.knowledge_gap_ask b where b.org_id=s.org_id and b.gap_id=g.id order by b.asked_at desc,b.id offset 20);
  return jsonb_build_object('id',g.id);
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;

-- Maintenance for the embedding filler. Namespace-checked like the agent's
-- other maintenance work; returns unit text only to the agent role.
create or replace function app_private.agent_embeddings(p_action text,p_namespace text,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;n int=0;
begin
 if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;
 if coalesce(p_data->>'model','')!~'^[a-z0-9.:/_-]{1,80}$' then raise exception 'INVALID_EMBEDDING';end if;
 if p_action='pending' then
  return coalesce((select jsonb_agg(jsonb_build_object('orgId',u.org_id,'hash',u.hash,'title',u.title,'text',u.text))from(
   select * from app.knowledge_unit u where u.embedding_model is distinct from p_data->>'model' order by u.created_at limit least(greatest(coalesce((p_data->>'limit')::int,64),1),64))u),'[]');
 elsif p_action='store' then
  if jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items')>64 then raise exception 'INVALID_EMBEDDING';end if;
  for item in select * from jsonb_array_elements(p_data->'items') loop
   update app.knowledge_unit set embedding=(item->>'vector')::extensions.vector(768),embedding_model=p_data->>'model',embedding_dims=768
    where org_id=(item->>'orgId')::uuid and hash=item->>'hash';
   n=n+1;
  end loop;
  return jsonb_build_object('stored',n);
 end if;
 raise exception 'INVALID_AGENT_OPERATION';
end$$;

grant create on schema app_private to jomcall_agent_jobs;
alter function app_private.agent_knowledge(text,text,uuid,uuid,jsonb) owner to jomcall_agent_jobs;
alter function app_private.agent_embeddings(text,text,jsonb) owner to jomcall_agent_jobs;
revoke create on schema app_private from jomcall_agent_jobs;
revoke all on function app_private.agent_knowledge(text,text,uuid,uuid,jsonb), app_private.agent_embeddings(text,text,jsonb) from public;
grant execute on function app_private.agent_knowledge(text,text,uuid,uuid,jsonb), app_private.agent_embeddings(text,text,jsonb) to jomcall_agent;

-- The browser test worker may record lookup_catalogue. Rewritten from the
-- CURRENT body of agent_work (see 20261114180000_hosted_namespaces.sql), so a
-- body changed by a later or parallel migration is never reverted. Other
-- channels' functions keep their own allow-lists.
do $migration$
declare body text;hits int;
 old_text constant text=$o$'handoff_to_human')then raise exception 'INVALID_TOOL'$o$;
 new_text constant text=$n$'handoff_to_human','lookup_catalogue')then raise exception 'INVALID_TOOL'$n$;
begin
 select pg_get_functiondef('app_private.agent_work(text,text,uuid,uuid,uuid,jsonb)'::regprocedure) into body;
 if position('''lookup_catalogue''' in body)>0 then return;end if;
 hits=(length(body)-length(replace(body,old_text,'')))/length(old_text);
 if hits<>1 then raise exception 'agent_work: expected one tool allow-list, found %',hits;end if;
 execute replace(body,old_text,new_text);
end
$migration$;
