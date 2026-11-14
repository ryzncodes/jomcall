-- Hosted namespaces: `staging` and `prod` become legal beside `local` and
-- `test_<uuid>` in every function that checks the queue namespace. Staging and
-- production are separate databases; the label keeps logs and audits honest.
--
-- Each function is rewritten from its CURRENT definition, so this migration
-- never reverts a body changed by a later or parallel migration. Every expected
-- text must appear exactly once, or the migration stops. CREATE OR REPLACE keeps
-- each function's owner and grants. Column defaults stay 'local': every insert
-- in the application passes the namespace explicitly.
do $migration$
declare
  item record;
  body text;
  hits int;
begin
  for item in
    select *
    from (values
      ('app_private.agent_work(text,text,uuid,uuid,uuid,jsonb)',
       $old$if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;$old$,
       $new$if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;$new$),
      ('app_private.agent_voice(text,text,uuid,text,uuid,uuid,jsonb)',
       $old$if p_namespace<>'local' and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;$old$,
       $new$if p_namespace not in('local','staging','prod') and p_namespace!~'^test_[a-f0-9-]{36}$' then raise exception 'INVALID_NAMESPACE';end if;$new$),
      ('app_private.request_privacy(uuid,uuid,integer,text,text)',
       $old$p_namespace !~ '^(local|test_[a-f0-9-]{36})$'$old$,
       $new$p_namespace !~ '^(local|staging|prod|test_[a-f0-9-]{36})$'$new$)
    ) as t(fn, old_text, new_text)
  loop
    body := pg_get_functiondef(item.fn::regprocedure);
    hits := (length(body) - length(replace(body, item.old_text, ''))) / length(item.old_text);
    if hits <> 1 then
      raise exception 'HOSTED_NAMESPACE_MIGRATION: % has % copies of the expected check', item.fn, hits;
    end if;
    execute replace(body, item.old_text, item.new_text);
  end loop;
end
$migration$;
