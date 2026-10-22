# Implementation notes

## 2026-10-22 — product rename

- Deviation: renamed `supabase/roles.sql` to `supabase/auth-grants.sql`. The Supabase CLI applies a file at exactly `supabase/roles.sql` automatically when it creates a new database, before migrations run. The file grants on roles that migrations create, so every fresh `npm run local:start` failed with `role "..._authz" does not exist`. Existing developer databases were created before the file was added, which hid the bug. `scripts/local/migrate.mjs` and `migration-check.mjs` already apply the grants after migrations, so only the file name changed.
