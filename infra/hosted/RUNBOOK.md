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
| 1 | **[OWNER]** Domain registrar | One domain, e.g. `example.com` | about 1 (unverified) | Needed for the web app, LiveKit and email |
| 2 | **[OWNER]** Vercel | Upgrade the existing team to **Pro** | 20 | Hobby is not allowed for commercial use and has no DPA |
| 3 | **[OWNER]** Supabase, paid org | **Pro**, production project in **Singapore (ap-southeast-1)**, Postgres **17** | 25 | Daily backups, 7 days |
| 4 | **[OWNER]** Supabase, staging | Separate **free** org, staging project in Singapore, Postgres 17 | 0 (pauses after a week idle) or 10 as a second paid Micro | Design §8 item 13 |
| 5 | **[OWNER]** DigitalOcean (or AWS Lightsail) | Region **SGP1**. Staging: 2 GB droplet. Production: 4 GB / 2 vCPU droplet. Ubuntu LTS, SSH key login | 12 staging + 24 production | Create servers only at steps 3 and 8 |
| 6 | **[OWNER]** Transactional email provider | Any with SMTP, a DPA and a free tier | 0 at first | Owner decision (design §8 item 9) |
| 7 | **[OWNER]** Speech and model vendors | Separate **staging** and **production** keys at Deepgram, Anthropic, Google Cloud (Gemini TTS), and OpenRouter if the typed path stays on it | usage only | Set a spending cap and usage alert on each |
| 8 | **[OWNER]** Optional monitoring | One uptime service (Better Stack or UptimeRobot free) and one error tracker (Sentry free) | 0 | Each is a new outbound service needing approval |

Expected hosting total before any customer: **about USD 70 to 82 a month** (design §1).

On every account: turn on two-factor sign-in, set a spending alert, and accept the vendor's data processing addendum (design §6.3).

### B. Values to obtain, and where each goes

One file per service on the server, in `/etc/jomcall/` (root-owned, mode 0600). Web values go into Vercel, per environment. The release values stay on the owner's laptop. `infra/hosted/.env.hosted.example` lists every name with a one-line description.

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
| `LIVEKIT_DOMAIN`, `ACME_EMAIL` | e.g. `livekit.example.com`, and an inbox you read | `livekit.env`; public `LIVEKIT_URL=wss://livekit.example.com` in Vercel |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email provider dashboard | `engine.env`, and Supabase Auth SMTP settings |
| `ANTHROPIC_API_KEY` (and `OPENROUTER_API_KEY` if used) | Vendor consoles | `agent.env` |
| `DEEPGRAM_API_KEY`, `GOOGLE_CLOUD_API_KEY` | Vendor consoles | `voice.env` |

Plain settings per environment: `JOMCALL_MODE=hosted`, `JOMCALL_QUEUE_NAMESPACE=staging` (or `prod`), `JOMCALL_MODEL_PROVIDER`, `JOMCALL_VOICE_PROVIDER=hosted`, `HOSTED_TARGET=staging` (or `prod`).

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
d=$(mktemp -d); for n in agent engine voice livekit; do : > "$d/$n.env"; done
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
- SMTP: the email provider's values.
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

3d. **[OWNER]** Write `/etc/jomcall/agent.env`, `engine.env`, `voice.env` and `livekit.env` from section B (staging values, `JOMCALL_QUEUE_NAMESPACE=staging`). Before copying them up, check each on your laptop:

```bash
for s in agent engine voice livekit; do npm run -s hosted:readiness -- --service $s --env-file ~/secure/staging/$s.env; done
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

Browser voice test end to end from Malaysia, then the scripted caller **with staging keys only** (it calls Deepgram, Anthropic and Google):

```bash
npm run check:voice-speed
```

[CHECK] compare with the local numbers in `docs/qa/2026-11-14-voice-milestone-a.md`; a test from a network that blocks UDP (if it fails, enable TURN: set `turn.enabled: true` with a TLS domain in `livekit/livekit.yaml`, open 3478/udp and 5349/tcp in the cloud firewall, redeploy); stage timings appear in the `voice-stages` volume; logs carry only codes and timestamps.

[ROLLBACK] set `JOMCALL_VOICE_PROVIDER=disabled` in Vercel staging and `agent.env`, then `docker compose up -d agent`. Typed tests keep working.

## Step 6. Hardening on staging — [OWNER] approves the scratch restore project

Run for a week. Then:
- Restore last night's backup into a scratch Supabase project; compare row counts; write down how long it took. Delete the scratch project.
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

## Known gaps in this kit

- **Login rate limit (launch blocker, design §5.7).** Hosted mode keys the counter by client address instead of one global bucket, but counters still live in each server instance's memory. They must move to Postgres before real users.
- **Auth-schema grants on hosted Supabase** are unverified (step 2b).
- **Database certificate.** Whether the Supabase pooler's certificate chains to a public root is unverified; `JOMCALL_DATABASE_CA` exists for the case it does not.
- **Serverless pooler safety** (design §5.4) is unverified: no session settings or named prepared statements were audited on the web path.
- **Health is reported, not acted on.** Docker restarts exited containers only.
- **Concurrency limit and Deepgram retention opt-out** (design §5.6) are not built.
- **Voice image licence** (design §6.5): build on the server; never push publicly.
- **Engine heartbeat to an uptime service** (design §5.9) is not built; the loopback health listener exists.
