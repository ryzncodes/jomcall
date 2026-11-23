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
| 9 | **[OWNER]** Optional, later: phone line | A SIP trunk provider with a +60 number and SIP REFER, and a decision on where LiveKit's SIP service runs (step 11) | provider pricing, not checked | Not needed for the closed beta. Each is a new outbound service needing approval |

Expected hosting total before any customer: **about USD 75 to 87 a month** (design §1 plus USD 5 for Cloudflare Workers Paid; see the 2026-11-14 amendment at the end of the design).

On every account: turn on two-factor sign-in, set a spending alert, and accept the vendor's data processing addendum (design §6.3).

### B. Values to obtain, and where each goes

One file per service on the server, in `/etc/jomcall/` (`agent.env`, `engine.env`, `voice.env`, `livekit.env`, `caddy.env`, and `backup.env` for the backup job; root-owned, mode 0600). Compose sets `JOMCALL_MODE`, `JOMCALL_VOICE_BIND`, `JOMCALL_VOICE_TURN_URL` and the voice worker's internal `LIVEKIT_URL` itself; leave them out of the files. Web values go into Vercel, per environment. The release values stay on the owner's laptop. `infra/hosted/.env.hosted.example` lists every name with a one-line description.

| Value | Where it comes from | Goes to |
|---|---|---|
| `APP_ORIGIN` | The web domain you choose, e.g. `https://app.example.com` (staging: `https://staging.example.com`) | Vercel; `engine.env` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase dashboard, Project Settings, API | Vercel |
| Database pooler host | Supabase dashboard, Connect: the pooler host, e.g. `aws-0-ap-southeast-1.pooler.supabase.com` | `JOMCALL_DATABASE_HOSTS` everywhere |
| Database CA certificate | Supabase dashboard, Database settings, SSL: download the certificate. **Required** (checked 2026-11-14): the pooler's chain ends at "Supabase Root 2021 CA", which is not a public root, so without it every verified connection fails with `SELF_SIGNED_CERT_IN_CHAIN` (the migration runner reports `RELEASE_FAILED` after the schema push) | `JOMCALL_DATABASE_CA` (one line, `\n` for newlines) everywhere |
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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Only if `JOMCALL_MAIL_PROVIDER=smtp` (the fallback): the SMTP provider's values. Cloudflare's own SMTP endpoint also works here (`smtp.mx.cloudflare.net`, 465, `api_token`, a token) | `engine.env` On a DigitalOcean droplet outbound ports 465 and 587 are blocked: use `SMTP_PORT=2587` with Resend (STARTTLS). Check from the server with `timeout 6 bash -c "</dev/tcp/smtp.resend.com/2587" && echo open`. |
| `ANTHROPIC_API_KEY` (and `OPENROUTER_API_KEY` if used) | Vendor consoles | `agent.env` |
| `DEEPGRAM_API_KEY`, `GOOGLE_CLOUD_API_KEY` | Vendor consoles | `voice.env` |
| `JOMCALL_PAYMENT_PROVIDER`, `CURLEC_ENVIRONMENT`, `CURLEC_KEY_ID`, `CURLEC_KEY_SECRET`, `CURLEC_WEBHOOK_SECRET` | Only after the owner approves Curlec (section D): Curlec dashboard, Account & Settings → API Keys and → Webhooks | Vercel, per environment. `JOMCALL_PUBLIC_ORIGIN` is optional; Curlec's return and webhook use `APP_ORIGIN` |

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

C4. **Turnstile keys.** Cloudflare, Turnstile, Add widget, once per environment: hostname the environment's web host (`app.<domain>`, `staging.<domain>`), widget mode Managed. Copy the site key to `TURNSTILE_SITE_KEY` and the secret key to `TURNSTILE_SECRET_KEY`, both in Vercel for that environment only. Set both or neither: one alone makes every sign-in fail on purpose. The server also checks the hostname and the action (`login` or `signup`) that Cloudflare reports. Leave Supabase's own captcha setting (Authentication, Bot and Abuse Protection) **off**: the app already redeems the single-use token, so a second check in Supabase would fail every sign-in.

C5. **R2 bucket and token.** Cloudflare, R2: create `jomcall-backups-staging` and `jomcall-backups-prod` (location hint Asia-Pacific). On each bucket add a lifecycle rule that deletes objects after 30 days, and leave public access off. Under R2, Manage API tokens, create one token per bucket: **Object Read & Write**, applied to that bucket only. Copy the Access Key ID to `R2_ACCESS_KEY_ID` and the Secret Access Key to `R2_SECRET_ACCESS_KEY` (shown once) in that environment's `backup.env`. Recordings will later get their own bucket and token.

### D. Payments (Curlec) — [OWNER]; live on staging by the owner's choice, production not approved yet

**Owner decisions, 2026-11-14/15** (recorded here; they change D2, D4, D5 and D7 below):
- The owner already holds a Curlec merchant account under **Digitalize Plus Enterprise**. No new application is needed (D4 is done); only keys, the webhook and approvals remain.
- Digitalize Plus Enterprise is the operating business for JomCall for now.
- Staging uses **LIVE** Curlec keys, by the owner's explicit choice. Real money can move on staging.
- Vercel Deployment Protection was removed for the staging domain so Curlec's webhook can reach it. Staging is therefore **public**: anyone can open it and, without step 4d, sign up.
- Production approval of Curlec (D2 for production) is still pending.

Live keys on staging need one extra setting. Without it `npm run hosted:readiness -- --service web` fails, **and the running web app refuses payments**: the wallet shows payments as not connected, top-ups cannot start, and the Curlec webhook is refused (reason `LIVE_KEYS_ON_STAGING_UNACKNOWLEDGED`). The rule applies in hosted mode with `JOMCALL_QUEUE_NAMESPACE=staging` and a live key or `CURLEC_ENVIRONMENT=live`:
- `CURLEC_LIVE_ON_STAGING=1`, which says in writing that live keys on staging are intended.

Until 2026-11-20 a sign-up allow-list (`JOMCALL_SIGNUP_ALLOW`, step 4d) was required as well. The owner then opened sign-up on this environment, which is now the production one, so the list is optional: leave it unset for open sign-up, or set it to close sign-up to listed addresses and domains again.

The readiness check also fails when the key does not match `CURLEC_ENVIRONMENT` (a key starting `rzp_live_` needs `CURLEC_ENVIRONMENT=live`; `rzp_test_` needs `test` or empty). Curlec's documentation does not state these prefixes; they are the ones seen on the owner's accounts, so a key with another prefix is reported as `CURLEC_KEY_MODE_UNKNOWN`. The running app uses the same rules: a mismatched or unknown key leaves payments not connected.

**When this change is deployed to staging, the staging wallet stops taking payments until `CURLEC_LIVE_ON_STAGING=1` and `JOMCALL_SIGNUP_ALLOW` are set in Vercel's staging environment and staging is redeployed** (step 4d). Set them before, or together with, that deployment. The engine and the other server services do not read payment settings, so nothing changes in `/etc/jomcall`. The owner-run `npm run billing:reconcile` and `npm run billing:admin` apply the same rule when their settings say hosted mode on the staging namespace with live keys.


The owner chose Razorpay Curlec on 2026-11-14. Facts and sources: `docs/research/payment-providers-malaysia.md` sections 1, 3 and 6. For **production**, until D2 is done there, leave `JOMCALL_PAYMENT_PROVIDER` unset: the wallet screen shows "Not connected" and no payment call is made. Staging runs Curlec with live keys by the owner's choice (decisions above).

D1. **Ask Curlec in writing** whether a prepaid usage wallet for an AI phone-answering SaaS is acceptable. Its Terms prohibit credits convertible to digital services, name intangible services, and give "web-based telephony" as a legally unclear example (<https://curlec.com/s/terms-of-use/>).

D2. **Approve Curlec** as an outbound service (it is not approved in `AGENTS.md`).

D3. **Website pages Curlec verifies** before issuing live keys (up to 3 working days): About us, Contact us, Pricing, Terms and conditions, Privacy policy, Refund policy, a sample receipt, and a test login if paying needs one.

D4. **Sign up** at <https://curlec.com> as **Digitalize Plus Enterprise**: business name exactly as on SSM, business type **Proprietorship**, the SSM registration number (Curlec fetches the SSM profile from CTOS; upload the SSM certificate only if asked), category and sub-category, business and operating address, and a bank account in the business's name with the **first page of its latest bank statement** (a personal account needs Curlec's authorisation letter). Turn on two-factor sign-in. Before full activation the account is capped at RM30,000.

D5. **Test mode on staging.**
- Account & Settings → API Keys → Generate Key (test mode). Key Id → `CURLEC_KEY_ID`; Key Secret (shown once) → `CURLEC_KEY_SECRET`.
- Account & Settings → Webhooks → Add: URL `https://<staging host>/api/billing/webhook/curlec`; a secret you generate (`openssl rand -hex 32`) → `CURLEC_WEBHOOK_SECRET`; alert email; events `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`.
- Allow-list the staging domain for the checkout callback (`https://<staging host>/api/billing/return/curlec`).
- Account & Settings → Payments Capture: keep **automatic** capture.
- In Vercel (staging only): `JOMCALL_PAYMENT_PROVIDER=curlec`, `CURLEC_ENVIRONMENT=test`, the three `CURLEC_*` values. `JOMCALL_PUBLIC_ORIGIN` is not needed: hosted mode uses `APP_ORIGIN`.

D6. [CHECK] One test top-up with a mock FPX bank (choose Success on Curlec's mock page): the wallet is credited once, a receipt appears, and `npm run billing:reconcile` (run with the staging database settings) reports it. Then `npm run billing:admin -- refund <org> <top-up> 100 "test" "<your name>"` and check one refund row. DuitNow QR has no test mode.

D7. **Live.** After activation and website verification, generate live keys and a live webhook (same URL path on the production host, a new secret) and set them in Vercel (production only) with `CURLEC_ENVIRONMENT=live`. Keep the Curlec balance above zero: refunds are paid from it (RM0.50 each). Make one small real top-up and refund it.

D8. Set final prices as a new `billing_price` version (versions 1 and 2 are owner placeholders), and ask an accountant to confirm the e-invoice exemption (below RM3m) and the SST position (below RM500k).

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

2b. **Auth tables on hosted Supabase** (checked on a hosted free project, 2026-11-14): `postgres` holds `USAGE` on schema `auth` without the grant option, so it cannot pass that access to `jomcall_authz` or `jomcall_agent_jobs`; the grant only raises a warning. Migration `20261114220000_hosted_auth_reads.sql` therefore reads `auth.sessions` and `auth.users` through two definer functions owned by the migration login, and the runner does not apply `supabase/auth-grants.sql`. **If the runner stops with `AUTH_READS_UNAVAILABLE`**, the migration login cannot read those tables on this project or the two roles cannot call the functions. Do not work around it by hand; record the code and stop. The runner is safe to repeat.

2c. **[OWNER]** In the Supabase dashboard, Authentication:
- Site URL: the staging `APP_ORIGIN`.
- Redirect allow-list: `<APP_ORIGIN>/api/auth/confirm` and `<APP_ORIGIN>/api/auth/recovery`.
- SMTP: `smtp.mx.cloudflare.net`, port 465, user `api_token`, password the second Email Sending token from C3, sender `CLOUDFLARE_EMAIL_FROM`. [UNVERIFIED] that Supabase's SMTP form accepts implicit TLS on 465; if it does not, keep the SMTP fallback provider for Auth only.
- Email templates: under Authentication, Emails, paste `infra/hosted/email-templates/confirmation.html` into "Confirm signup" and `infra/hosted/email-templates/recovery.html` into "Reset password" (English then BM, ready to paste). Subjects: "Confirm your JomCall account / Sahkan akaun JomCall anda" and "Reset your JomCall password / Tetapkan semula kata laluan JomCall anda". Without this step the link in the email goes to the Supabase address and the owner lands on the home page signed out (seen on staging, 2026-11-19).
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

4d. **[OWNER] Limit sign-up on a public staging site.** Needed while Deployment Protection is off, and required by the readiness check while live Curlec keys are set.
1. If not done yet, run `npm run hosted:migrate` for staging. It adds the small database function that lets invited addresses sign up (migration `20261115120000_signup_invited.sql`). Until it runs, invited addresses that are not on the list are refused.
2. In Vercel, **staging environment only**, add `JOMCALL_SIGNUP_ALLOW`. The value is a comma-separated list. `name@example.com` allows one address. `@example.com` allows every address at exactly that domain (not its subdomains). Use your own addresses; never put them in git.
3. If live Curlec keys are set, also add `CURLEC_LIVE_ON_STAGING=1`.
4. Redeploy staging. Vercel applies changed variables only on the next deployment.
5. Check: `npm run hosted:readiness -- --service web --env-file <a local copy of the staging web values>` prints `web: ready`. Delete the local copy afterwards.

[CHECK]
- Sign-up with an address on the list sends the confirmation email.
- Sign-up with any other address shows "Sign-up is by invitation only for now" / "Pendaftaran kini hanya melalui jemputan", and no email is sent.
- An address invited from Settings → Team can sign up even if it is not on the list.
- Existing accounts still sign in. Creating a new workspace is refused for an address not on the list (invited members join their workspace instead).

Known limits, accepted for now (owner choices, not built):
- The sign-up answer tells a prober whether an address is listed or invited: listed or invited addresses get "check your email" (200), others get the refusal (403). The alternative (always answer 200 and send nothing) would show refused people a false "check your email". The rate limit (10 a minute per client address) slows probing; Turnstile would slow it more, but it is on only when both Turnstile keys are set, and no Cloudflare account is recorded in this repository, so do not count on it for staging.
- The Supabase publishable (anonymous) key is public by design, so an account can still be created straight against Supabase Auth. What stops an unlisted address is the workspace gate. Accounts and workspaces created while staging was public keep working; step 6 (manual review) is the only control for them. A Supabase "before user created" hook could refuse such accounts later.
- A public mail domain entry such as `@gmail.com` opens sign-up to everyone at that provider. List single addresses for public mail.
- Entries are ASCII only. An internationalised (IDN) domain in the list makes the whole value invalid, so every sign-up is refused (fails closed). Use the domain's `xn--` form if needed.

What the gate does not cover: it lives in the web app only. Supabase Auth itself still accepts sign-ups from anyone who holds the Supabase anonymous key. JomCall never sends that key to the browser, and an account made that way still cannot create a workspace or top up. Do not turn off "Allow new users to sign up" in Supabase: the web sign-up form, invitations included, would stop working. The engine and the other server services do not read `JOMCALL_SIGNUP_ALLOW`; nothing changes in `/etc/jomcall`.

6. Look through the accounts (Supabase → Authentication → Users) and workspaces created on staging since Deployment Protection came off. The list stops new sign-ups only; accounts that already exist keep signing in and can top up workspaces they already have.

[ROLLBACK] remove `JOMCALL_SIGNUP_ALLOW` and redeploy: sign-up is open again.

## Step 5. Voice on staging

Browser voice test end to end from Malaysia, on a laptop and on a phone, using the staging keys.

Not possible yet: the twenty-turn speed script (`npm run check:voice-speed`) drives the **local** stack only (it loads `.env.local` and the voice worker refuses a non-loopback turn URL outside hosted mode). Measuring staging speed needs a hosted variant of that tool; until then compare the browser test by ear and by the stage timings.

[UNVERIFIED] The voice container reaches LiveKit by its service name, but media candidates point at the server's public address (`use_external_ip: true`), so worker media may hairpin through the public IP. A failed or silent browser test is the symptom; check `docker compose logs livekit voice` first.

[CHECK] the browser test answers and speaks in each language; a test from a network that blocks UDP (if it fails, enable TURN: set `turn.enabled: true` with a TLS domain in `livekit/livekit.yaml`, open 3478/udp and 5349/tcp in the cloud firewall, redeploy); stage timings appear in the `voice-stages` volume; logs carry only codes and timestamps.

[ROLLBACK] set `JOMCALL_VOICE_PROVIDER=disabled` in Vercel staging and `agent.env`, then `docker compose up -d agent`. Typed tests keep working.

## Step 6. Hardening on staging — [OWNER] approves the scratch restore project

Run for a week. Then:
- Restore last night's backup into a scratch Supabase project; compare row counts; write down how long it took. Delete the scratch project.
- Encrypted off-site dump to R2 (second copy, beside Supabase's own daily backups). The job runs on the host, not in a container, so the server needs three extra things the Compose setup does not:
  - Node.js 24 (the version pinned in `infra/hosted/worker.Dockerfile`), then `cd /opt/jomcall && npm ci`.
  - `pg_dump` 17, matching the database: stock Ubuntu does not ship it. Add the PostgreSQL project's apt repository (PGDG, `apt.postgresql.org`), then `apt-get install postgresql-client-17`.
  - `/etc/jomcall/backup.env` (0600), written from the backup lines of `.env.hosted.example`.

  Alternatively, run it from the owner's laptop with the repository installed; the settings are the same. Then:

  ```bash
  npm run hosted:readiness -- --service backup --env-file /etc/jomcall/backup.env
  npm run hosted:backup -- --target staging --env-file /etc/jomcall/backup.env
  ```

  [CHECK] prints `Uploaded staging/jomcall-staging-<time>.dump.enc`; the object appears in the bucket. [UNVERIFIED] `pg_dump` as Supabase's `postgres` role may hit permission errors on Supabase-managed schemas; if it stops with `PG_DUMP_FAILED`, run `pg_dump` by hand with the same settings to see which schema, and record it before changing anything. Then prove a restore: download it, `npm run hosted:backup -- --decrypt <file> out.dump --target staging --env-file /etc/jomcall/backup.env`, and `pg_restore --list out.dump` lists the tables. Schedule it nightly (systemd timer or cron, 03:00 Asia/Kuala_Lumpur) only after that restore worked. [UNVERIFIED] none of this has run against a real database or bucket.
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

## Step 11. Phone line (optional, after the beta) — [OWNER], new outbound services

Full steps: `docs/research/phone-line-owner-steps.md`. Nothing here has been run against a carrier or a live SIP service.

1. **LiveKit's SIP service runs on this server** (owner decision 2026-11-18). The Compose file has three parts for it: `sip` (`livekit/sip` v1.25.0, Apache-2.0, on the host's network), `redis` (Valkey 8.1, BSD-3-Clause, the message bus between LiveKit and the SIP service, nothing kept on disk) and a `redis` block in `livekit/livekit.yaml`. Before the first start:
   - Create `/etc/jomcall/sip.env` (root, mode 0600) with `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, the same pair as in `voice.env`.
   - The SIP service listens on 5060 (UDP and TCP) and 10000-10200/udp (phone audio) on the server's public address. If a cloud firewall is in front of the server, open those ports there. LiveKit's signalling port 7880 and Valkey's 6379 are published on 127.0.0.1 only.
   - `docker compose up -d redis livekit sip`. LiveKit restarts, which ends any browser call in progress. [CHECK] `docker compose logs sip` shows "sip signaling listening on" for udp and tcp, and `docker compose logs livekit` shows "connecting to redis".
   - Who may call: an inbound trunk accepts calls only for the numbers listed on it. Add the carrier's signalling addresses (`--allowed`) or a username and password; whether a self-hosted server enforces the address list was not verified, so test it with a call from another address.
   - Checked on 2026-11-18 on a development machine only: the three containers start and connect, and a trunk and a dispatch rule can be created through LiveKit's API. No call has gone through it.
2. **[OWNER]** Buy a +60 number from a SIP trunk provider with REFER, point its origination at the SIP service, use PCMU/PCMA and an IP allow-list.
3. Publish the agent; add the number on the Phone numbers screen of this environment.
4. Generate the trunk and dispatch rule (`npm run telephony:sip-config -- --allowed <provider IPs>`, against this environment's database) and apply them with `lk sip inbound create` and `lk sip dispatch create`.
5. Set `JOMCALL_TELEPHONY_PROVIDER=livekit_sip` in Vercel and `agent.env`, and add `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to `agent.env` (the agent checks the SIP caller and starts transfers). Optional: `JOMCALL_SIP_TRANSFER_URI`, `JOMCALL_MAX_CONCURRENT_CALLS`, `JOMCALL_CALL_CAP_SECONDS`. Compose already sets `JOMCALL_PHONE_URL` for the voice worker. The phone endpoint uses the same private bind and `JOMCALL_VOICE_SERVICE_SECRET` as the browser voice endpoint, on port 54635 (never published).
6. `docker compose up -d agent voice`; the Phone numbers screen should say "Phone line connected". Prewarm the `Kore` voice and the agent's voice.

Staging, 2026-11-19 (Twilio, owner's choice that day): steps 1, 2, 3 and 5 are done except the Vercel redeploy, and step 4 was done another way. What differed from the steps above:

- Step 4: `npm run telephony:sip-config` refuses a hosted database and the server has no `lk` command line. The trunk and dispatch rule were created with `livekit-server-sdk` from inside the agent container (`SipClient.createSipInboundTrunk` with the number and Twilio's signalling ranges, then `createSipDispatchRule` with a callee rule, room prefix `call-`, `randomize`, and a room configuration that dispatches the agent `jomcall-voice` with metadata `{"channel":"phone"}`). Valkey keeps nothing on disk: after a restart of the `redis` container, create both again. Since 2026-11-20 there is a command for it, safe to repeat (it creates only what is missing and never changes or deletes a trunk): `docker compose exec -T -w /app agent node --import tsx scripts/hosted/sip-apply.ts --numbers <number in E.164> --allowed <carrier address ranges, comma separated>`.
- Step 5: the agent needs the build from pull request #56 or later. Earlier builds stop at start with `LOCAL_DATABASE_REQUIRED` when the phone line is on. In `agent.env`, `LIVEKIT_URL=ws://livekit:7880` works.
- Twilio: Elastic SIP Trunking, one origination URI `sip:<server>:5060;transport=tcp`, Secure Trunking off, the number attached under the trunk's Numbers. A trial account failed both test calls at Twilio (`21264`) with a verified caller; plan on an upgraded account.
- Port 5060 was probed by scanners within a day. Put the cloud firewall in place before leaving the line on. The rules, with the supplier's address ranges, are in `infra/hosted/firewall.md`.
- The agent logs `PHONE_SIP_CONFIG_MISSING reason=NO_SIP_TRUNK` or `reason=NO_DISPATCH_RULE` at start and every five minutes while LiveKit has no trunk or rule (after a Valkey restart), and `PHONE_SIP_CONFIG_OK` once when they are back. Run the command above when it appears.

### A phone number for a customer (operator, costs money)

`scripts/hosted/phone-provision.ts` finds, buys and wires one Twilio number. It is for an operator only; no customer screen calls it. Buying bills the Twilio account every month until the number is released, and releasing gives the number up for good, so each `--buy` and `--release` needs the owner's yes.

One-time setup, **[OWNER]**:

1. In Twilio, create a Standard API key (Account, API keys and tokens). Note the key SID and its secret.
2. Find the SIDs of the approved bundle (`BU...`), its address (`AD...`), the trunk `jomcall-staging` (`TK...`) and the account (`AC...`).
3. On the server, write `/etc/jomcall/twilio.env` (root, mode 0600) with `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_BUNDLE_SID`, `TWILIO_ADDRESS_SID`, `TWILIO_TRUNK_SID`, and optionally `TWILIO_MAX_NUMBERS` (default 5: the command refuses to buy past it). No service reads this file; it is loaded only for a run of the command.

Each run, from `/opt/jomcall/infra/hosted`, with the values taken from the file and never typed on the command line:

```bash
set -a; . /etc/jomcall/twilio.env; set +a
T="-e TWILIO_ACCOUNT_SID -e TWILIO_API_KEY_SID -e TWILIO_API_KEY_SECRET -e TWILIO_BUNDLE_SID -e TWILIO_ADDRESS_SID -e TWILIO_TRUNK_SID -e TWILIO_MAX_NUMBERS"
RUN="docker compose exec -T $T -w /app agent node --import tsx scripts/hosted/phone-provision.ts"
```

- `$RUN --search` lists up to ten Malaysian local numbers Twilio offers (`--contains +603` narrows it). Costs nothing.
- `$RUN --list` shows the numbers the account holds and the limit. Costs nothing.
- `$RUN --buy <number> --label "<customer>" --allowed <the supplier ranges from firewall.md, comma separated>` buys it on the trunk and adds it to LiveKit's inbound trunk. Safe to repeat for the same number: it is not bought twice.
- `$RUN --release <number>` releases it at Twilio.

Then add the number to the customer's workspace (the command does not write to JomCall's database), and switch it off on their Phone numbers screen after a release. In hosted mode the server refuses a number added from the app (every number sits on one shared trunk, so a workspace that could add any number could answer another business's callers), so the operator adds the row, as the database owner in the SQL editor, with the owner's yes each time:

```sql
insert into app.phone_number(org_id, location_id, agent_id, e164, label)
select o.id,
       (select l.id from app.location l where l.org_id = o.id and l.primary_location and l.archived_at is null),
       (select a.id from app.agent a where a.org_id = o.id order by a.created_at limit 1),
       '<the number, +60...>', '<label>'
from app.organization o where o.id = '<workspace id from the request email>';
```

#### How a customer asks (migration `20261120100000_phone_number_request.sql`)

An owner or admin on a plan that includes a number presses "Request my number" on the Phone numbers screen, with the area they would like and, optionally, their existing business number. The screen then says the number is being set up, usually within 2 working hours. Every five minutes the engine reads the open requests: it logs `PHONE_NUMBER_REQUESTED open=<n>` and, when `JOMCALL_OPERATOR_EMAIL` is set in `engine.env`, emails that address the workspace name and id, the area, the existing number and who asked, and again every 4 hours while the request stays open. **Set `JOMCALL_OPERATOR_EMAIL`, or nobody is told.** The insert above answers the request by itself (a trigger marks it ready when the number is active), and the engine then emails the workspace's owners that the number is ready (tried up to three times; a third failure logs `PHONE_REQUEST_READY_UNSENT`), with a link to the forwarding steps on the Phone numbers screen. The area is a wish only: a number's prefix must match the locality of the Twilio bundle's address.

Deploy order: apply the migration first (the web reads the new table as soon as it is deployed, and Vercel deploys on merge), then rebuild the engine.

Open requests, read only: `select r.created_at, o.name, r.area, r.forward_from from app.phone_number_request r join app.organization o on o.id = r.org_id where r.state = 'open' order by 1;`

Not known: whether Twilio allows numbers bought under the operator's own bundle to serve other businesses. Twilio's pages define the bundle's end user as the one who answers the calls and do not answer this for a platform; ask Twilio before selling numbers widely. A number's prefix must also match the locality of the bundle's address, which Twilio checks at purchase.

[CHECK] the first test call checklist in the owner-steps document: disclosure first, read-back before a booking, transfer and ring-out, the call log, a second caller hearing the busy line.

[ROLLBACK] set `JOMCALL_TELEPHONY_PROVIDER=disabled` in Vercel and `agent.env`, `docker compose up -d agent`; point the provider's number back at the owner's phone.

## Step 12. Setup document reader (optional) — [OWNER], applies migrations and switches on an outbound service

Branch `feat/setup-import`. Owners can bring a price-list photo, PDF, CSV file or pasted text into `/app/setup`; the agent process sends it to Anthropic (`claude-haiku-5-5`; `claude-sonnet-5-5` only as a fallback for text and CSV) and drafts prices and facts for the owner to confirm. Nothing here has run on hosted staging or production. Approved by the owner on 2026-11-14 and again on 2026-11-15, for setup's document reading only.

1. **[OWNER]** Apply the two new migrations to staging, from a clean release folder: `npm run hosted:migrate -- --target staging --env-file ~/secure/release-staging.env`. They are `20261116110000_setup_uploads.sql` (upload tables) and `20261116110100_setup_read_worker.sql` (the read worker's functions).
2. **[OWNER]** Confirm the agent's database role bypasses row-level security. Run the query from Step 2's checks in the SQL editor: `select rolname, rolbypassrls, rolcanlogin from pg_roles where rolname like 'jomcall%' order by 1;`. The row for `jomcall_agent_jobs` must show `rolbypassrls = true`, as it already must for the agent and WhatsApp work. Do not rely on the reader on that environment until it does.
3. **[OWNER]** Set `JOMCALL_SETUP_READER=anthropic` in both places: the web service (Vercel, staging environment) and the agent (`agent.env` on the server). The web service gets no key. If `ANTHROPIC_API_KEY` is not already set for the agent, add it to `agent.env`; the reader needs it even when voice is off. Rebuild and restart: redeploy on Vercel, then `docker compose up -d --build agent` on the server.
4. Leave the switch unset, or `disabled`, to keep the reader off: uploading is refused with a message that the reader is not available, and the interview still works.
5. **[OWNER]** Reading limits (branch `feat/reading-limits`, owner decision 2026-11-16: reading stays free, with lower caps). Apply the third migration the same way: `20261116140000_setup_read_limits.sql` (a service-wide daily ceiling, a fair queue across organizations, the ceiling notice, a ceiling on stored upload bytes, and deletion of file bytes after 7 days). Optionally set `JOMCALL_OPERATOR_EMAIL` (one address) in `engine.env` and restart the engine (`docker compose up -d engine`); `npm run hosted:readiness -- --service engine` checks the address when it is set. Without it the engine only logs `SETUP_READ_CEILING` with the counts.
   - The ceiling is `app.setup_read_limit.daily_reads`, default 300: at most 300 files start reading in any 24 hours across all workspaces, each up to four model calls (two reads per try, at most two tries), so at most 1,200 model calls. When it is reached, files stay queued (nothing fails) and start again as earlier reads age out of the 24-hour window. The engine checks once an hour, so the email comes within about an hour, at most once per Kuala Lumpur day; a failed send is logged as `SETUP_READ_CEILING_MAIL_FAILED` and not retried that day.
   - To change the ceiling, run as the database owner in the SQL editor: `update app.setup_read_limit set daily_reads = <n>, updated_at = now();` (0 to 100,000; 0 pauses reading). Check it with `select daily_reads, noticed_day from app.setup_read_limit;`.
   - Each workspace may add 10 files in 24 hours (was 20); each setup still holds up to 5.
   - Stored uploads (owner decision 2026-11-16): `app.setup_read_limit.stored_bytes_max`, default 157286400 (150 MiB), caps the declared sizes of all files whose bytes are still held, across all workspaces. A new file or pasted text that would go over it is refused ("JomCall cannot take new files right now…"); the interview still works. The free Supabase database holds 500 MB in all, so keep the ceiling well under that. From 80 percent the engine logs `SETUP_BYTES_CEILING` with the two numbers and, when `JOMCALL_OPERATOR_EMAIL` is set, emails once per Kuala Lumpur day. To change it, as the database owner in the SQL editor: `update app.setup_read_limit set stored_bytes_max = <bytes>, updated_at = now();` (0 refuses every new file). Check it, and what is held now, with `select stored_bytes_max, bytes_noticed_day, (select coalesce(sum(bytes), 0) from app.setup_upload where bytes_deleted_at is null and state <> 'removed') as stored from app.setup_read_limit;`.

Uploads are stored in the database, not in object storage. Each setup holds up to 5 files of 10 MB each (pasted text up to 20,000 characters). A file's bytes are deleted 7 days after it was added (was 30 until the owner's decision of 2026-11-16; the migration moved files already held to 7 days), whether or not setup was saved, or at once with Remove. Remove on a file also deletes its unconfirmed and removed rows. Rows and details read from a file stay in the setup's staging table after the setup is saved: confirmed ones become catalogue rows, and the staged copies remain until the agent or organization is deleted. On the free staging database (500 MB) this is fine for testing and too small for many customers; the stored-uploads ceiling above refuses new files before it fills. The owner deferred moving originals out of the database (Supabase Storage) on 2026-11-16 until there is real volume or a paid plan.

[CHECK] after the switch: on the Setup screen the "bring a document" stage shows the Anthropic notice and accepts a made-up price list; with no queue, the file reads within about 30 seconds; the review page lists the prices. Use made-up documents only. A file still queued after two minutes shows "Reading is busy right now".

[ROLLBACK] unset `JOMCALL_SETUP_READER` in both places and redeploy; the migrations stay (they only add tables and functions).

## Step 13. Plan picker — [OWNER], applies a migration; the engine then charges plan fees every hour

Branch `feat/plan-picker`. Owners pick a plan on `/app/billing`; a first paid plan starts at once with the full fee. The engine visits the organizations whose plan is due every hour and charges each in its own transaction. Nothing here has run on hosted staging or production.

**Warning.** The first hourly pass after the rebuild charges or downgrades every organization that has a plan row, including ones with no traffic yet. An organization whose current period began more than 7 days ago and whose wallet does not hold the fee falls back to pay as you go at once, without an email. Run the query in step 1 first and top up or change plans where needed.

1. **[OWNER]** Read-only check, in the staging SQL editor, before anything else. It lists each plan row with its balance and whether a period covers now (no names, no emails):

   ```sql
   select op.org_id, op.plan_code, op.pending_plan_code, op.anchor_date,
          (select coalesce(sum(l.amount_sen), 0) from app.wallet_ledger l where l.org_id = op.org_id) as balance_sen,
          pp.org_id is not null as has_current_period,
          pp.state as current_period_state
     from app.org_plan op
     left join app.plan_period pp
       on pp.org_id = op.org_id and pp.starts_at <= now() and pp.ends_at > now()
    order by op.anchor_date;
   ```

   Rows with no current period, or with `current_period_state = 'unpaid'`, are the ones the engine visits. A paid plan with `balance_sen` at least the fee is charged; a short one starts unpaid with 7 days' grace from the period start, so a period that began more than 7 days ago is downgraded at once. A `payg` row with a paid plan waiting starts that plan only if the wallet holds the fee, and otherwise drops it.
2. **[OWNER]** Apply the migration to staging first, from a clean release folder: `npm run hosted:migrate -- --target staging --env-file ~/secure/release-staging.env`. It is `20261116120000_plan_picker.sql`. The engine must not be rebuilt before this: the new engine calls `app_private.plan_orgs_due`, which the migration adds.
   - Branch `feat/plan-leftovers` adds a second migration, `20261116130000_plan_notices.sql` (owner emails about the fee: due soon, unpaid, plan stopped), applied by the same command; apply it before rebuilding the engine too, because the new engine calls `app_private.queue_plan_notices` after each hourly run (without it the run logs `PLAN_NOTICE_RUN_FAILED` and sends no fee emails). Each email is checked again when it is about to be sent and skipped when it is no longer true. The first hourly run after deploy emails the owners of every organization whose plan is unpaid and in grace, and of those whose plan stopped in the last two days. Do not roll the engine back to a build from before this change while plan notices are queued: the old sender does not know the `plan` channel.
3. **[OWNER]** Rebuild and restart on the server: `docker compose up -d --build engine agent`. Redeploy the web service on Vercel for the plan card.

[CHECK] with a made-up workspace: the wallet screen shows "Choose a plan"; with enough credit, Start Starter charges the fee once; the engine log shows no `PLAN_CHARGE_RUN_FAILED` (a failure logs only the ok and failed counts and retries after five minutes).

[ROLLBACK] rebuild the previous engine image (once `20261116130000_plan_notices.sql` is in, not one from before it while plan notices are queued; see step 2); the migration stays (it replaces functions and adds one). Fees already debited stay in the ledger; refund them with an operator adjustment if needed.

---

## Step 14. WhatsApp re-check of a connected number, [OWNER], applies a migration

Branch `feat/whatsapp-recheck`. Saving a connected number again keeps it connected while it is checked again. Done on hosted staging on 2026-11-18 (migration, then merge, then rebuild).

1. **[OWNER]** Apply the migration first: `npm run hosted:migrate -- --target staging --env-file ~/secure/release-staging.env`. It is `20261118100000_whatsapp_recheck.sql`. Do this before the web is deployed and before the agent is rebuilt. Vercel deploys the web from `main` on merge, so apply the migration before the merge reaches `main`; otherwise the WhatsApp settings screen and the channel save fail until it is applied (the new web reads columns the migration adds).
2. **[OWNER]** Then rebuild the agent: `docker compose up -d --build agent`. An agent from before this change keeps working after the migration: it connects first-time numbers as before and never claims a re-check, so the screen says "Checking" until the agent is rebuilt.

[ROLLBACK] the migration stays; an older web or agent build runs against it.

---

## Step 15. Connect WhatsApp through Meta's popup (Embedded Signup), [OWNER], applies a migration and gives the agent the Meta app secret

Owners connect a number by pressing "Connect WhatsApp" and finishing Meta's popup, instead of pasting two IDs and a token. Built and tested against a stand-in only: nothing here has run against Meta. Until Meta grants Advanced Access (App Review), only businesses with a role on the JomCall Meta app can finish the popup.

What it adds to the outbound picture: on the WhatsApp settings page, and only after the owner presses the button, the browser loads Meta's script from `connect.facebook.net` and opens a Facebook window. The agent process makes two new kinds of call to Meta (code exchange and number registration) and for that also holds the Meta app secret, which until now only the web held.

Order matters: the migration, then the agent, then the web settings.

1. **[OWNER]** Meta app dashboard, Facebook Login for Business, Configurations: create a configuration with the WhatsApp Embedded Signup variation. Note its configuration ID. In the app's Facebook Login for Business settings, add the site's origin to the allowed domains for the JavaScript SDK.
2. **[OWNER]** Apply `supabase/migrations/20261119100000_whatsapp_embedded_signup.sql` to the database (one transaction, then record it as the other migrations were).
3. **[OWNER]** In `/etc/jomcall/agent.env` add `WHATSAPP_APP_ID` (the app's ID) and `WHATSAPP_APP_SECRET` (the same value the web already has). Rebuild the agent.
4. **[OWNER]** In the web's environment add `WHATSAPP_APP_ID` and `WHATSAPP_SIGNUP_CONFIG_ID`, then redeploy. Without both, the button is not shown and the pasted-values form is the only way, as before. If the web has them and the agent does not, every attempt fails with `SIGNUP_NOT_CONFIGURED` and the owner must start again.
5. Leave `WHATSAPP_SIGNUP_COEXISTENCE` unset. It lets a business keep its number on the WhatsApp Business app; whether Malaysia is supported is not confirmed, and a number treated wrongly would not be registered.

[CHECK] With a number you control: press Connect WhatsApp, then Continue to Facebook, finish the popup. The page says "Finishing the connection" and then Connected within a few seconds. Send the number a message and confirm the agent answers. Then press Connect again and close the Facebook window: the number must stay connected. Add a payment method for the business in WhatsApp Manager.

Agent log lines: `WHATSAPP_CHECK_FAILED step=exchange|verify|subscribe|register reason=… provider=…` (codes only), and `WHATSAPP_SIGNUP_RESULT_DROPPED` when the owner disconnected or saved other values while Meta was being asked.

Known limits: the two-step PIN JomCall sets when it registers a number is stored sealed with the token and is not shown to the owner; if a registration reached Meta but its result was lost, the business resets the PIN in WhatsApp Manager. One agent process is assumed: two would both try to exchange the same code.

## Step 16. Submit a message template to WhatsApp from JomCall, [OWNER], applies a migration

Staff press "Submit to WhatsApp" on a template; the agent process creates it in the business account with the stored token. Built and tested against a stand-in only: the request to Meta has never run.

Order matters: the migration, then the agent, then the web (which deploys when the change is merged).

1. **[OWNER]** Apply `supabase/migrations/20261119110000_whatsapp_template_submit.sql` to the database (one transaction, then record it as the other migrations were).
2. **[OWNER]** Rebuild the agent.
3. Merge the change so the web deploys.

[CHECK] On a connected number: add a template, press Submit to WhatsApp. Within a few seconds the page shows "Status from WhatsApp" with Meta's status, and the template is listed in WhatsApp Manager. Press it for a template that already exists at Meta with the same name and language: the page says WhatsApp did not accept it.

Agent log lines: `WHATSAPP_TEMPLATE_SUBMIT_FAILED reason=… provider=…` (codes only), `WHATSAPP_TEMPLATE_SUBMIT_CLAIM_FAILED`, `WHATSAPP_TEMPLATE_SUBMIT_RESULT_FAILED`.

Known limits: a body with placeholders is sent with made-up sample values ("Example 1"), which Meta may refuse; a request the provider did not answer is tried again once after five minutes, and if the first attempt did create the template the retry is refused and the next status check finds it by name and language.

## Step 17. Server check, load log and outside uptime check, [OWNER] once

What it is: `infra/hosted/monitor.sh`, run by cron every five minutes on the server. Each run appends one line to `/var/log/jomcall/monitor.log` with the 1- and 5-minute load, CPU, available memory, swap, disk and each container's CPU and memory, so the effect of simultaneous calls can be read later (`grep -v PROBLEM /var/log/jomcall/monitor.log | tail`). It emails `JOMCALL_OPERATOR_EMAIL` through the engine's SMTP settings (both read from `/etc/jomcall/engine.env`, never printed) when a Compose service stops or turns unhealthy, when the agent reports `PHONE_SIP_CONFIG_MISSING` (a Valkey restart wiped the trunk: run the `sip-apply.ts` command in step 11), when available memory drops under 150 MB, when the 5-minute load passes 1.5 (the server has one CPU) or when the disk passes 85 percent; again every 6 hours while a problem lasts, and once when it clears. It restarts nothing. Limits can be changed with `MEM_MIN_MB`, `LOAD_MAX`, `DISK_MAX` and `REPEAT_SECONDS` on the cron line.

Install, once, after the change is on `main`:

1. `cd /opt/jomcall && git pull --ff-only`
2. `infra/hosted/monitor.sh --test-mail` prints `sent` and the email arrives.
3. `printf '*/5 * * * * root /opt/jomcall/infra/hosted/monitor.sh\n' > /etc/cron.d/jomcall-monitor`
4. `printf '/var/log/jomcall/monitor.log {\n  weekly\n  rotate 8\n  compress\n  missingok\n  notifempty\n}\n' > /etc/logrotate.d/jomcall-monitor`

Outside check: `.github/workflows/uptime.yml` fetches `https://staging.jomcall.com/` (the web app on Vercel) and `https://livekit.staging.jomcall.com/` (LiveKit behind Caddy, which answers only while the server is up) every 10 minutes. A failed run is emailed by GitHub to whoever last changed the schedule. It covers what the server check cannot: the whole server down. It does not reach the SIP port, which the firewall limits to the carrier.

Simultaneous calls: `JOMCALL_MAX_CONCURRENT_CALLS` in `agent.env` (default 1, at most 20) caps live phone calls and browser voice tests together, for the whole service; a caller over the cap hears the busy message. It was set to 2 on 2026-11-20 with the server at 1 vCPU and 2 GB. Before raising it, read the load log during busy hours; refused calls are counted with `select count(*) from app.call where refusal='LINES_BUSY'`. Changing it needs the agent recreated: `JOMCALL_IMAGE_TAG=<agent tag> docker compose up -d --no-deps --no-build agent`.

## Step 18. Follow-up queue, [OWNER], applies two migrations; the engine then emails owners and admins about new items

Branch `feat/follow-up-queue`. Every request the agent leaves for staff on a real phone call or WhatsApp chat (message, callback, booking request, handoff) becomes an item on `/app/follow-ups`, and new items email the owner and every active admin. Nothing here has run on hosted staging or production. Applying migrations is a production change: do it only with the owner's explicit yes, given for this step.

Order matters. Vercel deploys the web from `main` on merge, and the new web reads `app.follow_up` inside call detail and the WhatsApp chat, so a web deployed before the migrations breaks the call page and the chat. Apply both migrations **before the pull request is merged to `main`** (as in step 14). The web now on `main` should keep working against the migrated database: it never writes the proposal tables whose `update` grant the migration removes (read from the code, not run). Do the steps below in one sitting.

1. **[OWNER]** Check that no call is live: `select count(*) from app.call where state = 'active';` must return 0. The first migration locks both proposal tables, the call and chat turn tables and `app.member` until its back-fill commits; it sets `lock_timeout` to 5 seconds, so instead of waiting behind a call it stops with a lock timeout. Then wait and run it again. Not checked here: whether `supabase db push` rolls back a file that stopped part way; if a second run fails with `already exists`, stop and ask.
2. **[OWNER]** On the server, stop the engine: `cd /opt/jomcall && docker compose stop engine`. The server check (step 17) then emails that the engine stopped; that is expected, and it emails again once the engine is back. An engine from before this change, still running after the migrations, claims `follow_up.alert` outbox rows (the second migration adds the kind to `claim_outbox`), cannot read them, fails the jobs and leaves the alerts `queued`. While it is stopped, privacy jobs, invitation and billing emails and plan charges wait in the database and run when the new engine starts.
3. **[OWNER]** Apply both migrations to staging from a clean release folder on the branch: `npm run hosted:migrate -- --target staging --env-file ~/secure/release-staging.env`. They are `20261122100000_follow_up_queue.sql` and then `20261122100100_follow_up_alerts.sql`.
   - On first apply the back-fill turns the existing agent proposals of ended turns (call turns completed, or cut off by a hang-up, a crash or a failure; WhatsApp turns completed) into follow-ups. It sends no email.
   - The web role loses `update` on `app.call_proposal` and `app.conversation_proposal`; their state now mirrors from `app.follow_up`.
4. **[OWNER]** Merge the pull request. Vercel then deploys the web from `main`.
5. **[OWNER]** On the server: `cd /opt/jomcall && git pull --ff-only && docker compose up -d --build engine agent`.
6. **[OWNER]** If the engine ran by mistake between steps 3 and 5, alerts can be left `queued` while their outbox row is already marked delivered (the old engine claimed it and failed the job), so nothing will send them. Fifteen minutes after step 5, count them: `select count(*) from app.follow_up_alert a where a.state = 'queued' and a.created_at < now() - interval '15 minutes' and not exists(select 1 from app.outbox o where o.kind = 'follow_up.alert' and o.resource_id = a.id and (o.delivered_at is null or o.created_at > now() - interval '15 minutes'));`. If it is not 0, queue them again (the engine checks each alert again before sending, so one for a closed item is skipped; an alert whose earlier job is still being retried may be emailed twice):

```sql
insert into app.outbox(org_id, namespace, kind, resource_id)
select a.org_id, a.namespace, 'follow_up.alert', a.id
from app.follow_up_alert a
where a.state = 'queued' and a.created_at < now() - interval '15 minutes'
  and not exists(select 1 from app.outbox o where o.kind = 'follow_up.alert' and o.resource_id = a.id and (o.delivered_at is null or o.created_at > now() - interval '15 minutes'));
```

[CHECK] with a made-up workspace: a typed or browser test (text or voice) creates no items, because those tests write `app.test_session`, `app.test_turn` and `app.test_proposal`, which the follow-up triggers do not read (only phone call turns and WhatsApp turns create items; read from the code, no test asserts it); a made-up call or chat that leaves a message adds an item at `/app/follow-ups`; the owner gets one email with no caller name, number or message text; Done then Undo returns the item to Open.

[ROLLBACK] Do not roll the engine back to a build from before this change while `follow_up.alert` rows are queued: an older engine fails those jobs and leaves the alerts queued (then use step 6). Check first: `select count(*) from app.follow_up_alert where state = 'queued';`. The migrations stay (they add tables and functions).

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
- **Auth-schema grants on hosted Supabase**: settled on 2026-11-14, see step 2b (definer functions, migration `20261114220000`).
- **Database certificate.** Settled on 2026-11-14: the Supabase root certificate is required in `JOMCALL_DATABASE_CA` (section B).
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
