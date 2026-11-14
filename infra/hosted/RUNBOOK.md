# JomCall hosted rollout runbook

Status (2026-11-14): this kit has been **built and validated offline only**. Nothing in it has run against a real Vercel, Supabase, DigitalOcean, LiveKit or email account. No account, project, server, DNS record or deployment exists. `AGENTS.md` still says all runtime services stay local; that rule stands until the owner approves hosting.

Design: `docs/superpowers/specs/2026-11-14-production-hosting-design.md` (Option 1: Vercel Pro in `sin1`, Supabase Pro in Singapore, one Singapore server running agent, engine, voice, LiveKit and Caddy).

Marks used below:

- **[OWNER]** only the owner can do it: create an account, enter payment details, accept terms, change DNS, paste a secret, approve a production change.
- **[CHECK]** what must be true before going on.
- **[ROLLBACK]** how to undo the step.
- **[UNVERIFIED]** this kit assumes it; nobody has tried it on the real service yet.

Never paste a key into a chat, an issue, a commit or a command line that is logged. Every secret goes into a password manager first, then into its one destination.

---

## Owner checklist (do these in order)

Monthly costs are the design's figures, checked on vendor pages on 2026-11-14, in USD, before tax. Usage (speech and model) is extra: about USD 0 with no customers, about USD 0.013 per call minute.

### A. Accounts to create

| # | Account | What to choose | Monthly cost | Notes |
|---|---|---|---|---|
| 1 | **[OWNER]** Domain | One domain, e.g. `example.com`, registered at Cloudflare Registrar or moved onto Cloudflare nameservers | about 1 (unverified) | Cloudflare Email Service needs the domain on Cloudflare DNS |
| 2 | **[OWNER]** Vercel | Upgrade the existing team to **Pro** | 20 | Hobby is not allowed for commercial use and has no DPA |
| 3 | **[OWNER]** Supabase, paid org | **Pro**, production project in **Singapore (ap-southeast-1)**, Postgres **17** | 25 | Daily backups, 7 days |
| 4 | **[OWNER]** Supabase, staging | Separate **free** org, staging project in Singapore, Postgres 17 | 0 (pauses after a week idle) or 10 as a second paid Micro | Design §8 item 13 |
| 5 | **[OWNER]** DigitalOcean (or AWS Lightsail) | Region **SGP1**. Staging: 2 GB droplet. Production: 4 GB / 2 vCPU droplet. Ubuntu LTS, SSH key login | 12 staging + 24 production | Create servers only at steps 3 and 8 |
| 6 | **[OWNER]** Cloudflare (one account for staging and production) | DNS, Turnstile, R2 and Email Service. **Workers Paid** is required to send email to arbitrary recipients | 5 (Workers Paid). Email: 3,000 a month included, then 0.35 per 1,000. R2: 10 GB-month included, then 0.015 per GB-month. DNS and Turnstile: 0 (Turnstile free-plan limits not checked) | Decided 2026-11-14 (design amendment). Email Sending is in **beta**. Replaces a separate email provider. Section C |
| 7 | **[OWNER]** Speech and model vendors | Separate **staging** and **production** keys at Deepgram, Anthropic, Google Cloud (Gemini TTS), and OpenRouter if the typed path stays on it | usage only | Set a spending cap and usage alert on each |
| 8 | **[OWNER]** Optional monitoring | One uptime service (Better Stack or UptimeRobot free) and one error tracker (Sentry free) | 0 | Each is a new outbound service needing approval |

Expected hosting total before any customer: **about USD 75 to 87 a month** (design §1 plus USD 5 for Cloudflare Workers Paid; see the 2026-11-14 amendment at the end of the design).

On every account: turn on two-factor sign-in, set a spending alert, and accept the vendor's data processing addendum (design §6.3).

### B. Values to obtain, and where each goes

One file per service on the server, in `/etc/jomcall/` (`agent.env`, `engine.env`, `voice.env`, `livekit.env`, `caddy.env`, and `backup.env` for the backup job; root-owned, mode 0600). Compose sets `JOMCALL_MODE`, `JOMCALL_VOICE_BIND`, `JOMCALL_VOICE_TURN_URL` and the voice worker's internal `LIVEKIT_URL` itself; leave them out of the files. Web values go into Vercel, per environment. The release values stay on the owner's laptop. `infra/hosted/.env.hosted.example` lists every name with a one-line description.

| Value | Where it comes from | Goes to |
|---|---|---|
| `APP_ORIGIN` | The web domain you choose, e.g. `https://app.example.com` (staging: `https://staging.example.com`) | Vercel; `engine.env` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase dashboard, Project Settings, API | Vercel |
| Database pooler host | Supabase dashboard, Connect: the pooler host, e.g. `aws-0-ap-southeast-1.pooler.supabase.com` | `JOMCALL_DATABASE_HOSTS` everywhere |
| Database CA certificate | Supabase dashboard, Database settings, SSL: download the certificate **[UNVERIFIED]** that it is needed; the services check certificates | `JOMCALL_DATABASE_CA` (one line, `\n` for newlines) everywhere |
| Four role passwords | **[OWNER]** generate: `openssl rand -hex 32` four times | `release.env`, and inside the four database URLs |
| `APP_DATABASE_URL` | `postgresql://jomcall_app.<project-ref>:<password>@<pooler host>:6543/postgres` (transaction pooler; the `role.project-ref` user format is [UNVERIFIED] for custom roles) | Vercel |
| `WORKER_DATABASE_URL`, `QUEUE_DATABASE_URL`, `AGENT_DATABASE_URL` | Same host, port **5432** (session pooler), roles `jomcall_worker`, `jomcall_queue`, `jomcall_agent` | `engine.env` (worker + queue), `agent.env` (agent + queue) |
| `HOSTED_ADMIN_DATABASE_URL` | Supabase `postgres` connection string, session pooler, port 5432 | `release.env` only |
| `CSRF_SECRET`, `INVITATION_KEY` | **[OWNER]** generate: `openssl rand -hex 32` each | Vercel; `INVITATION_KEY` also `engine.env` |
| `JOMCALL_VOICE_SERVICE_SECRET` | **[OWNER]** generate: `openssl rand -hex 32` | `agent.env` and `voice.env` (same value) |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | **[OWNER]** generate: `echo API$(openssl rand -hex 8)` and `openssl rand -hex 32` | Vercel and `voice.env`; `LIVEKIT_KEYS="<key>: <secret>"` in `livekit.env` |
| `LIVEKIT_DOMAIN`, `ACME_EMAIL` | e.g. `livekit.example.com`, and an inbox you read | `caddy.env`; public `LIVEKIT_URL=wss://livekit.example.com` in Vercel |
| `JOMCALL_MAIL_PROVIDER=cloudflare` | Plain setting | `engine.env` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard, account home, Account ID (32 hex) | `engine.env`; `backup.env` |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Cloudflare, My Profile or Account API Tokens: custom token with only **Email Sending: Edit** (C3) | `engine.env` |
| `CLOUDFLARE_EMAIL_FROM` | An address on the onboarded domain, e.g. `hello@example.com` (staging: `staging@example.com`) | `engine.env` |
| Supabase Auth SMTP | Host `smtp.mx.cloudflare.net`, port `465`, user `api_token`, password: a **second** token with only Email Sending: Edit, sender as above | Supabase dashboard only (step 2c) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare, Turnstile, the widget for this environment (C4) | Vercel (both; the site key is read at runtime, not build time) |
| `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare, R2: the bucket name and an R2 API token (C5) | `backup.env` |
| `BACKUP_ENCRYPTION_KEY` | **[OWNER]** generate: `openssl rand -hex 32`. Keep a second copy offline (password manager): without it no backup can be restored | `backup.env`, and offline |
| `BACKUP_DATABASE_URL` | The `postgres` session connection (port 5432), as `HOSTED_ADMIN_DATABASE_URL` | `backup.env` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Only if `JOMCALL_MAIL_PROVIDER=smtp` (the fallback): the SMTP provider's values. Cloudflare's own SMTP endpoint also works here (`smtp.mx.cloudflare.net`, 465, `api_token`, a token) | `engine.env` |
| `ANTHROPIC_API_KEY` (and `OPENROUTER_API_KEY` if used) | Vendor consoles | `agent.env` |
| `DEEPGRAM_API_KEY`, `GOOGLE_CLOUD_API_KEY` | Vendor consoles | `voice.env` |

Plain settings per environment: `JOMCALL_MODE=hosted`, `JOMCALL_QUEUE_NAMESPACE=staging` (or `prod`), `JOMCALL_MODEL_PROVIDER`, `JOMCALL_VOICE_PROVIDER=hosted`, `HOSTED_TARGET=staging` (or `prod`), `BACKUP_ENABLED=1` in `backup.env`.

### C. Cloudflare setup — [OWNER]

Product facts below were read in Cloudflare's documentation on 2026-11-14. Nothing here has been done.

C1. **Account.** One Cloudflare account, two-factor sign-in on. Subscribe to **Workers Paid** (USD 5 a month); Email Sending to arbitrary recipients is not available on the free plan. Set a billing notification.

C2. **Domain and DNS records.** Add the domain (or register it at Cloudflare Registrar). If it was registered elsewhere, change the registrar's nameservers to the two Cloudflare gives you. Then add, per environment:

| Record | Name | Value | Proxy |
|---|---|---|---|
| CNAME | `app` (production web) | the target Vercel shows when you add the domain | DNS only (grey cloud); Vercel issues the certificate |
| CNAME | `staging` (staging web) | the target Vercel shows | DNS only |
| A | `livekit` | production server address | DNS only (WebRTC and Caddy's certificate need the real address) |
| A | `livekit.staging` | staging server address | DNS only |
| MX, TXT (SPF, DKIM) on `cf-bounce.<domain>`, TXT `_dmarc.<domain>` | added by Cloudflare in C3 | — | — |

Values go to: `APP_ORIGIN` (Vercel, `engine.env`), `LIVEKIT_DOMAIN` (`caddy.env`), `LIVEKIT_URL=wss://livekit.<domain>` (Vercel).

C3. **Email Service sender verification (SPF, DKIM, DMARC).** Cloudflare dashboard, Compute, Email Service, Email Sending, **Onboard Domain**, choose the domain, review and accept the records Cloudflare adds: MX and an SPF TXT on the `cf-bounce` subdomain, a DKIM TXT, and a DMARC TXT on `_dmarc`. If a DMARC record already exists, keep one. [CHECK] the domain shows as verified (usually 5 to 15 minutes). Create two API tokens, each with only **Email Sending: Edit**: one for the engine (`CLOUDFLARE_EMAIL_API_TOKEN` in `engine.env`), one for Supabase Auth's SMTP password (step 2c). New accounts start with a small daily sending quota that grows with reputation; send only to people who expect the mail.

C4. **Turnstile keys.** Cloudflare, Turnstile, Add widget, once per environment: hostname the environment's web host (`app.<domain>`, `staging.<domain>`), widget mode Managed. Copy the site key to `TURNSTILE_SITE_KEY` and the secret key to `TURNSTILE_SECRET_KEY`, both in Vercel for that environment only. Set both or neither: one alone makes every sign-in fail on purpose. The server also checks the hostname and the action (`login` or `signup`) that Cloudflare reports.

C5. **R2 bucket and token.** Cloudflare, R2: create `jomcall-backups-staging` and `jomcall-backups-prod` (location hint Asia-Pacific). On each bucket add a lifecycle rule that deletes objects after 30 days, and leave public access off. Under R2, Manage API tokens, create one token per bucket: **Object Read & Write**, applied to that bucket only. Copy the Access Key ID to `R2_ACCESS_KEY_ID` and the Secret Access Key to `R2_SECRET_ACCESS_KEY` (shown once) in that environment's `backup.env`. Recordings will later get their own bucket and token.

---

## Step 0. Code and decisions

- Owner settles design §8 items 1 to 3 (leave local-only; launch scope and PDPA; the Google text-to-speech limit).
- Merge this branch through its pull request after review.

[CHECK] on the owner's laptop, in the repository:

```bash
npm ci
npm run typecheck
npm run test:guards
npm run check:core
cd voice && uv run pytest && cd ..
npm run build:mock
npm run build:hosted
docker compose -f infra/hosted/docker-compose.yml config --quiet
```

`docker compose ... config` needs the four env files; for a dry check point it at empty files:

```bash
d=$(mktemp -d); for n in agent engine voice livekit caddy; do : > "$d/$n.env"; done
JOMCALL_ENV_DIR="$d" docker compose -f infra/hosted/docker-compose.yml config --quiet
```

[ROLLBACK] revert the pull request. Nothing hosted exists.

## Step 1. Accounts and domain — [OWNER]

Do section A rows 1 to 7. Nothing in the repository changes.

[CHECK] two-factor sign-in on every account; each spending alert sends a test notice.
[ROLLBACK] close the accounts.

## Step 2. Staging database — [OWNER] creates the project and changes Auth settings

2a. **[OWNER]** Create the staging Supabase project (Singapore, Postgres 17). Collect the values in section B. Write `release-staging.env` on your laptop from the release lines of `.env.hosted.example`, then check it:

```bash
npm run hosted:readiness -- --service release --env-file ~/secure/release-staging.env
```

[CHECK] prints `release: ready`.

Apply migrations, grants and role passwords. The runner asks you to type the target and host:

```bash
npm run hosted:migrate -- --target staging --env-file ~/secure/release-staging.env
```

2b. **If it stops with `AUTH_GRANTS_OWNER_STEP`** [UNVERIFIED path]: hosted Supabase gives no `supabase_admin` login, and it is not known whether `postgres` may grant `select` on `auth.sessions` and `auth.users` to `jomcall_authz` and `jomcall_agent_jobs` (design §5.4). Do not work around it by hand. Record the exact error code and stop; the fallback (definer functions owned by a role that can already read those tables) needs a new migration and review. Re-run the runner after that migration lands: it is safe to repeat.

2c. **[OWNER]** In the Supabase dashboard, Authentication:
- Site URL: the staging `APP_ORIGIN`.
- Redirect allow-list: `<APP_ORIGIN>/api/auth/confirm` and `<APP_ORIGIN>/api/auth/recovery`.
- SMTP: `smtp.mx.cloudflare.net`, port 465, user `api_token`, password the second Email Sending token from C3, sender `CLOUDFLARE_EMAIL_FROM`. [UNVERIFIED] that Supabase's SMTP form accepts implicit TLS on 465; if it does not, keep the SMTP fallback provider for Auth only.
- Email templates: paste `supabase/templates/confirmation.html` and `recovery.html`, replacing the words "local account" and "local inbox" with neutral English and BM text.
- Data API: remove `app` and `app_private` from the exposed schemas if listed.

[CHECK]
- The runner printed `Verified: N migrations recorded, 10 jomcall roles present`.
- Security advisor shows only the six known pg-boss warnings (`infra/local/README.md`).
- An anonymous call to the public data API reaches no application table:
  `curl -s "$SUPABASE_URL/rest/v1/organization" -H "apikey: $SUPABASE_ANON_KEY"` returns an error, not rows. (Load the two values from your password manager into the shell; do not type the key into a logged command line.)
- In the SQL editor: `select rolname, rolbypassrls, rolcanlogin from pg_roles where rolname like 'jomcall%' order by 1;` shows the ten roles; only the four service roles can log in.

[ROLLBACK] delete the staging project. It holds only test data.

## Step 3. Staging server — [OWNER] creates the server and the DNS record

3a. **[OWNER]** Create a 2 GB droplet in SGP1 with your SSH key. Point `livekit.staging.<domain>` (A record) at its address.

3b. **[OWNER]** Firewall. Docker publishes ports past `ufw`, so use the **DigitalOcean Cloud Firewall** (outside the server) with exactly: 22/tcp from your own address only; 80/tcp, 443/tcp, 7881/tcp and 7882/udp from anywhere. Nothing else (design §6.6).

3c. On the server, as root:

```bash
apt-get update && apt-get -y upgrade
apt-get -y install docker.io docker-compose-v2 git
git clone https://github.com/ryzncodes/jomcall.git /opt/jomcall
install -d -m 0700 /etc/jomcall
```

3d. **[OWNER]** Write `/etc/jomcall/agent.env`, `engine.env`, `voice.env`, `livekit.env` and `caddy.env` from section B (staging values, `JOMCALL_QUEUE_NAMESPACE=staging`). Before copying them up, check each on your laptop:

```bash
for s in agent engine voice livekit caddy; do npm run -s hosted:readiness -- --service $s --env-file ~/secure/staging/$s.env --compose; done
```

Then on the server: `chmod 0600 /etc/jomcall/*.env`.

3e. Build and start (images are built on the server; the voice image is never pushed to a public registry, design §6.5):

```bash
cd /opt/jomcall/infra/hosted
JOMCALL_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
```

3f. Prewarm the filler audio into the volume. **This sends fixed text to Google with the staging key.**

```bash
docker compose run --rm voice python -m jomcall_voice.prewarm
```

[CHECK]
- `docker compose ps` shows agent, engine and voice `healthy`, caddy and livekit `running`.
- `docker compose exec agent node --import tsx scripts/hosted/readiness.ts --service agent` prints `agent: ready` (same for `engine`).
- `curl -sI https://livekit.staging.<domain>` returns a valid certificate.
- LiveKit connection test (`https://livekit.io/connection-test`, with a token minted for the staging keys) passes from a Malaysian home line and a mobile network.
- From another machine, `nmap -Pn -p 1-65535 <server>` shows only 22, 80, 443, 7881; `nmap -sU -p 7882 <server>` shows 7882.
- `docker compose logs voice` shows the worker registered; no transcript, key or token appears in any log.

Note: Docker restarts a container that exits, not one marked unhealthy. Watch `docker compose ps`, and use the uptime service (section A row 8) on `https://<APP_ORIGIN>/api/health`.

[ROLLBACK] `docker compose down` (keeps volumes), or destroy the droplet. It holds no customer data.

## Step 4. Staging web on Vercel — [OWNER] changes Vercel settings

4a. **[OWNER]** Vercel project settings: root directory `web`; framework Next.js. The install command and the `sin1` region come from `web/vercel.json`. Confirm the Functions region shows Singapore (`sin1`).

4b. **[OWNER]** Environment variables, per environment. `JOMCALL_MODE` is never set in `vercel.json`:
- **Preview** (pull requests): `JOMCALL_MODE=mock`, nothing else. Previews show fictional data only.
- **Staging** (custom environment on a fixed domain, e.g. `staging.<domain>`): `JOMCALL_MODE=hosted` and every `[web]` line of `.env.hosted.example` with staging values, `JOMCALL_QUEUE_NAMESPACE=staging`, `LIVEKIT_URL=wss://livekit.staging.<domain>`.
- **Production**: leave empty until step 9.

4c. Deploy the staging environment from `main`.

[CHECK]
- `curl -s https://staging.<domain>/api/health` returns `{"ok":true,"mode":"hosted","database":true}`.
- Sign up, confirm by real email, sign in, invite a second member, reset a password.
- Browser dev tools: cookies are `__Host-jomcall_*`, `Secure`, `HttpOnly`.
- A POST with a forged `Origin` returns 403 `CSRF_REJECTED`.
- Ten failed logins from one address do not block a login from another network. [UNVERIFIED] that Vercel's `x-forwarded-for` / `x-real-ip` identify the client; the counters are per function instance, so this is weaker than the design asks (see "Known gaps").
- A typed test turn completes.
- The client bundle holds no secret: `grep -r "sk-\|-----BEGIN" web/.next-hosted/static` on a local `npm run build:hosted` finds nothing.

[ROLLBACK] promote the previous deployment, or remove the staging environment.

## Step 5. Voice on staging

Browser voice test end to end from Malaysia, on a laptop and on a phone, using the staging keys.

Not possible yet: the twenty-turn speed script (`npm run check:voice-speed`) drives the **local** stack only (it loads `.env.local` and the voice worker refuses a non-loopback turn URL outside hosted mode). Measuring staging speed needs a hosted variant of that tool; until then compare the browser test by ear and by the stage timings.

[UNVERIFIED] The voice container reaches LiveKit by its service name, but media candidates point at the server's public address (`use_external_ip: true`), so worker media may hairpin through the public IP. A failed or silent browser test is the symptom; check `docker compose logs livekit voice` first.

[CHECK] the browser test answers and speaks in each language; a test from a network that blocks UDP (if it fails, enable TURN: set `turn.enabled: true` with a TLS domain in `livekit/livekit.yaml`, open 3478/udp and 5349/tcp in the cloud firewall, redeploy); stage timings appear in the `voice-stages` volume; logs carry only codes and timestamps.

[ROLLBACK] set `JOMCALL_VOICE_PROVIDER=disabled` in Vercel staging and `agent.env`, then `docker compose up -d agent`. Typed tests keep working.

## Step 6. Hardening on staging — [OWNER] approves the scratch restore project

Run for a week. Then:
- Restore last night's backup into a scratch Supabase project; compare row counts; write down how long it took. Delete the scratch project.
- Encrypted off-site dump to R2 (second copy, beside Supabase's own daily backups). On the server, install a `pg_dump` matching the database's major version (17) and write `/etc/jomcall/backup.env` (0600) from the backup lines of `.env.hosted.example`, then:

  ```bash
  npm run hosted:readiness -- --service backup --env-file /etc/jomcall/backup.env
  npm run hosted:backup -- --target staging --env-file /etc/jomcall/backup.env
  ```

  [CHECK] prints `Uploaded staging/jomcall-staging-<time>.dump.enc`; the object appears in the bucket. Then prove a restore: download it, `npm run hosted:backup -- --decrypt <file> out.dump --target staging --env-file /etc/jomcall/backup.env`, and `pg_restore --list out.dump` lists the tables. Schedule it nightly (systemd timer or cron, 03:00 Asia/Kuala_Lumpur) only after that restore worked. [UNVERIFIED] none of this has run against a real database or bucket.
- Concurrent synthetic calls until the voice worker degrades; record the limit and set a job limit from it (not built yet).
- Deploy a new image during a live call: `docker compose up -d --build voice` and confirm the call finishes (the worker drains for up to 320 s).
- Stop the server on purpose; confirm every alert reaches your phone.

[ROLLBACK] not applicable.

## Step 7. Production database — [OWNER], production database write

As step 2, on the production project, with **fresh** values (new role passwords, new keys) in `release-prod.env` and `HOSTED_TARGET=prod`:

```bash
npm run hosted:readiness -- --service release --env-file ~/secure/release-prod.env
npm run hosted:migrate -- --target prod --env-file ~/secure/release-prod.env
```

[CHECK] as step 2, plus backups show as scheduled in the dashboard.
[ROLLBACK] delete the project while it is empty. After real data exists, only a forward migration, or a backup restore with data loss.

## Step 8. Production server — [OWNER], production deploy

As step 3 on a **4 GB** droplet, DNS `livekit.<domain>`, production values, `JOMCALL_QUEUE_NAMESPACE=prod`, vendor spending caps set.

[CHECK] as step 3.
[ROLLBACK] check out the previous commit in `/opt/jomcall` and run `JOMCALL_IMAGE_TAG=<previous> docker compose up -d --build`; or destroy and rebuild (no customer data on the server).

## Step 9. Production web and DNS — [OWNER], production deploy and DNS change

Set the Vercel **Production** variables (`JOMCALL_MODE=hosted`, production values, `JOMCALL_QUEUE_NAMESPACE=prod`, `LIVEKIT_URL=wss://livekit.<domain>`), deploy, attach the domain.

[CHECK] as steps 4 and 5 with your own account; open a pull request and confirm its preview still builds `mock` and shows only fictional data.
[ROLLBACK] promote the previous Vercel deployment (instant); point DNS back at the placeholder.

## Step 10. Closed beta — [OWNER] before each widening

Typed and browser voice tests only. Real callers wait for the phone line, the Google limit and the PDPA sign-off. Weekly: error rate, speed medians, vendor spend, backup success.

[ROLLBACK] pause sign-ups; disable voice; maintenance page.

---

## Moving web to Cloudflare Workers later — NOT DONE

Web stays on Vercel. It is kept swappable: application code uses no Vercel-only API; mode and origin come from `JOMCALL_MODE` and `APP_ORIGIN`; the client address comes from `x-real-ip` / `x-forwarded-for`. The only Vercel-specific lines are build settings (`web/vercel.json`, and `distDir` in `web/next.config.ts` keyed on `VERCEL`). A move would need, and none of it is built or tested:

1. A Next.js adapter for Workers (Cloudflare documents OpenNext and vinext; pick after checking support for this Next.js version).
2. **Hyperdrive** (or an equivalent pooler) in front of Supabase for `APP_DATABASE_URL`: Workers open a new TCP connection per request, and the web path uses `pg`. The `JOMCALL_DATABASE_HOSTS` allow-list and TLS checks would have to accept the Hyperdrive host or binding.
3. Node compatibility for `pg`, `node:crypto` and the Supabase client under `nodejs_compat`, checked by running `tests/hosting/web.test.ts` against the Workers runtime.
4. Client address from `CF-Connecting-IP` instead of `x-real-ip` (one line in `web/lib/server/auth.ts`).
5. Secrets as Worker secrets, a staging and a production Worker, DNS switched from Vercel's CNAME to the Worker route, and a rollback that points DNS back at Vercel.

## Known gaps in this kit

- **Login rate limit (launch blocker, design §5.7).** Hosted mode keys the counter by client address instead of one global bucket, but counters still live in each server instance's memory. They must move to Postgres before real users.
- **Auth-schema grants on hosted Supabase** are unverified (step 2b).
- **Database certificate.** Whether the Supabase pooler's certificate chains to a public root is unverified; `JOMCALL_DATABASE_CA` exists for the case it does not.
- **Serverless pooler safety** (design §5.4) is unverified: no session settings or named prepared statements were audited on the web path.
- **Health is reported, not acted on.** Docker restarts exited containers only.
- **Concurrency limit and Deepgram retention opt-out** (design §5.6) are not built.
- **Voice image licence** (design §6.5): build on the server; never push publicly.
- **Engine heartbeat to an uptime service** (design §5.9) is not built; the loopback health listener exists.
- **LiveKit and Caddy** have never been started by this kit and have no container health checks.
- **Staging speed measurement**: the twenty-turn script is local-only (step 5).
- **Cloudflare Email Sending is in beta** and starts with a small daily quota. The SMTP sender remains as the fallback (`JOMCALL_MAIL_PROVIDER=smtp`).
- **Backup size.** The backup job holds the dump in memory and uploads one PUT, so it refuses dumps over 4 GiB (`BACKUP_TOO_LARGE`). Multipart upload is not built.
- **Backup scheduling** is a runbook step, not part of the Compose file; the server needs a matching `pg_dump`. Supabase's daily backups stay the primary copy.
