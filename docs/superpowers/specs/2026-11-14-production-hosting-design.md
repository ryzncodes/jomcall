# Production hosting and deployment: design

Date: 2026-11-14. Status: draft for the owner's review. Nothing in this document has been done. No account, project, DNS record, deployment or hosted setting was created or changed while writing it.

This is a plan. It answers spec §10 "Hosting and region" and "Data residency", and it lists the code that must change before JomCall can run anywhere other than the owner's Mac.

How to read the evidence labels:

- **Checked** means the figure was read on the vendor's or regulator's own page on 2026-11-14 (sources in §9).
- **Unverified** means it came from a secondary source, from arithmetic on a checked figure, or from memory. Each one is marked.
- Code facts come from a read-only survey of branch `feat/voice-milestone-a` at commit `8b05a18` and carry `file:line` references. That branch (PR #7, stacked on #5 and #6) is not merged, so line numbers will move.

Two sibling sessions are writing related plans at the same time: one for the CI pipeline and one for the Malaysian phone line (SIP). This document states what hosting needs from each and leaves the detail to them.

## 1. Summary

**Recommended: Option 1.** Web on Vercel Pro (functions pinned to Singapore), Postgres and Auth on Supabase Pro in Singapore, and one small virtual server in Singapore running the agent worker, the engine worker, the voice worker and a self-hosted LiveKit server under Docker Compose.

|               | Hosting per month (USD) | Speech and model usage per month (USD) |
| ------------- | ----------------------- | -------------------------------------- |
| 0 customers   | about 70 to 82          | about 0                                |
| 10 customers  | about 92                | about 78                               |
| 100 customers | about 125 to 155        | about 780                              |

Usage is the same in every option; it scales with call minutes, not with the host. The assumptions behind these numbers are in §4.1.

Three things matter more than the choice of host:

1. **Google's text-to-speech limit of about eleven requests a minute** on the owner's project breaks first in every option. One caller fits; two at once may not. No hosting choice fixes it.
2. **"Production" at first launch means owners signing up and running typed and browser voice tests.** Real callers need the phone line (milestone B) and a settled PDPA position. This plan gets the product online; it does not by itself make it ready for real customer calls.
3. **The code refuses to run off loopback today, on purpose.** About a dozen guards must gain a deliberate hosted mode (§5). That work is larger than the hosting setup.

## 2. What "production" has to run

| Piece                                                          | What it is today                                                                                                                                                                         | What it needs in production                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web app** (`web/`, Next.js)                                  | `next start` on `127.0.0.1:4182`; reads Postgres directly with the constrained `jomcall_app` role; mints LiveKit tokens; holds no provider keys                                          | HTTPS on a real domain; a database connection that works from serverless functions or a long-running container; Secure cookies; a fixed origin for CSRF; build-time mode selection                                          |
| **Agent worker** (`engine/src/agent/index.ts`)                 | Long-running Node process; polls a Postgres queue once a second; serves the voice turn endpoint on `127.0.0.1:54633` over plain HTTP; holds `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` | A container that is always on; a private network path from the voice worker; outbound HTTPS to Anthropic and OpenRouter; database access as `jomcall_agent` and `jomcall_queue`                                             |
| **Engine worker** (`engine/src/index.ts`)                      | Long-running Node process; privacy jobs, outbox, invitation email through local Mailpit                                                                                                  | Always on; a real SMTP provider; database access as `jomcall_worker` and `jomcall_queue`                                                                                                                                    |
| **Voice worker** (`voice/`, Python 3.13, LiveKit Agents 1.6.0) | Runs in `dev` mode; one job per call; streams audio to Deepgram, text to Gemini text-to-speech; holds those two keys and no database credential; caches filler audio on disk             | Always on; `start` mode; low-latency path to LiveKit; a persistent volume for the audio cache; graceful drain so a deploy does not cut a call                                                                               |
| **LiveKit server**                                             | Docker image `v1.13.11` pinned by digest, all ports forced to loopback                                                                                                                   | Public WebSocket over TLS, plus media ports open to the internet: TCP 7881 and either one UDP port (7882) or the range 50000 to 60000 (checked). Optional TURN on 3478/UDP and 5349/TLS for callers behind strict firewalls |
| **Postgres and Auth**                                          | Supabase CLI stack in Docker: Postgres 17, Auth, gateway, PostgREST, Mailpit                                                                                                             | Managed backups, TLS, the ten existing roles, custom SMTP for Auth email, the same Postgres major version                                                                                                                   |
| **Queue**                                                      | pg-boss inside the same Postgres, schema owned by `jomcall_queue`                                                                                                                        | Nothing new. It needs a session-capable connection (not a transaction pooler). No Redis                                                                                                                                     |
| **Secrets**                                                    | `.env.local`, `web/.env.local`, `.env.hosted`, mode 0600, gitignored                                                                                                                     | One store per runtime (§6.1); separate keys for staging and production                                                                                                                                                      |
| **Logs**                                                       | `console.*` and Python `logging` with code-only messages; no PII found in logs                                                                                                           | Shipped off the machine; structured; an alert when a worker stops                                                                                                                                                           |
| **Later: SIP**                                                 | Not built                                                                                                                                                                                | LiveKit's SIP service needs port 5060 and RTP 10000 to 20000 open, and a Redis-compatible store (checked). Use Valkey (BSD) because current Redis licences are not on the allowed list                                      |

`engine`, `agent` and `voice` cannot run on serverless functions (spec §2). LiveKit media cannot run on any host that lacks inbound UDP. Railway and Render do not offer it (Railway from its own feedback board; Render from community posts, unverified), so they are out.

## 3. Where things should sit

Singapore is the right region. Supabase, Vercel, DigitalOcean, AWS Lightsail, Fly.io and Hetzner all have it (checked). Round trip between Kuala Lumpur and Singapore is quoted at 6 to 16 ms by network vendors (vendor claims only; no neutral measurement found). That is small against the measured 2.27 s median for a spoken answer (voice spec §2.3).

AWS has a Malaysia region and Lightsail lists it (checked), but it gains little: the database would still be in Singapore, and audio and text already leave the country for Deepgram, Anthropic and Google. Google Cloud's Malaysia region is not confirmed live.

None of the speech or model vendors can process in Malaysia or Singapore (checked):

| Vendor                       | Nearest processing                                                               | Note                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Deepgram                     | United States by default; regional endpoints in the EU, Australia and India only | No Southeast Asia endpoint                                                 |
| Anthropic API                | `global` (default) or `us` at 1.1 times the price                                | No Asia option                                                             |
| Google Gemini text-to-speech | Global endpoint                                                                  | No region selector found on the Gemini API (unverified); Vertex AI has one |

So hosting in Singapore shortens the caller's leg, not the vendor legs. Whether calls get faster or slower from a Singapore data centre than from the owner's home network is **not measured** and is a staging check (§7, step 5).

## 4. Hosting options

### 4.1 Assumptions behind every cost table

- One customer is one small business taking 300 answered calls a month at 2 minutes each: 600 call minutes. Ten customers are 6,000 minutes; a hundred are 60,000. This is a planning guess. No real customer data exists yet.
- Speech and model cost about USD 0.013 per call minute. This comes from the measured USD 0.04 for a three-minute call (voice spec §2.1) and agrees with list prices checked today: Deepgram Nova-3 multilingual streaming USD 0.0058 a minute; Gemini 3.8 Flash Lite text-to-speech about USD 0.009 per minute of generated audio (derived from USD 6.00 per million audio tokens at 25 tokens a second); Claude Haiku 5.5 USD 0.10 in and USD 0.50 out per million tokens, with cached reads at USD 0.01.
- **Gemini 3.8 text-to-speech prices double on 1 January 2027** (checked). Usage then rises to roughly USD 0.016 a minute.
- At 100 customers, calls concentrate in business hours. Average concurrency is about 4 and a busy peak is perhaps 12 (estimate).
- Not included anywhere: phone numbers and per-minute trunk charges, WhatsApp fees, payment fees, the domain name's annual fee (about USD 1 a month for a `.com`, unverified), tax, and currency conversion. Prices are in USD because every vendor bills in USD or EUR.
- Monitoring uses free tiers (§4.6).

### 4.2 Option 1: Vercel, Supabase and one Singapore server (recommended)

| Part                                         | Where                                                                                 | Plan                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web                                          | Vercel Pro, functions in `sin1`                                                       | USD 20 a seat a month, includes USD 20 usage credit and 1 TB transfer (checked). Hobby is not allowed for commercial use (terms snippet, unverified) and is not covered by Vercel's data processing addendum (checked) |
| Postgres, Auth                               | Supabase Pro, `ap-southeast-1`                                                        | USD 25 a month including one Micro instance; daily backups kept 7 days (checked)                                                                                                                                       |
| Agent, engine, voice, LiveKit, reverse proxy | One DigitalOcean droplet in SGP1, Docker Compose                                      | 4 GB / 2 vCPU: USD 24 a month with 4,000 GiB transfer (checked). AWS Lightsail Singapore is the same price for 4 GB (checked) and is an equal choice                                                                   |
| Staging                                      | Second Supabase project, a 2 GB droplet, Vercel preview environment on a fixed domain | Supabase: USD 0 in a separate free organisation (pauses after a week idle) or USD 10 as a second Micro in the paid one; droplet USD 12 (checked)                                                                       |

**Monthly hosting cost (USD)**

|                                        | 0 customers        | 10 customers | 100 customers                                           |
| -------------------------------------- | ------------------ | ------------ | ------------------------------------------------------- |
| Vercel Pro                             | 20                 | 20           | 20                                                      |
| Supabase                               | 25                 | 25           | 30 (Small instance)                                     |
| Production server                      | 24                 | 24           | about 48 (8 GB / 4 vCPU; price from memory, unverified) |
| Staging                                | 0 to 12            | 22           | 22                                                      |
| Error tracking, offsite backup storage | 0                  | 0            | 5 to 35                                                 |
| **Hosting total**                      | **about 70 to 82** | **about 92** | **about 125 to 155**                                    |
| Speech and model usage                 | about 0            | about 78     | about 780                                               |

- **Latency to Malaysian callers.** Media goes caller to Singapore and back: 6 to 16 ms added round trip (vendor figures). The voice worker and LiveKit share one machine, and the voice worker reaches the agent's turn endpoint over a private Docker network, so those hops cost nothing measurable.
- **Burden for one person.** Low for web and database (both managed, with one-click rollback and managed backups). Moderate for the server: operating-system updates, Docker, a firewall, TLS renewal (automatic with Caddy), and LiveKit upgrades. Roughly an hour or two a month when nothing is wrong. The server holds no customer data, so losing it means rebuilding from the repository, not restoring.
- **What breaks first.**
  1. Google's text-to-speech request limit (every option).
  2. The one server is a single point of failure for calls and tests. The website and data stay up, but no agent answers until it is back. Spec §3 expects the SIP trunk to forward to the owner's number in that case; that depends on the trunk supplier.
  3. A deploy that restarts the voice worker mid-call, unless draining is set up (§5.6).
  4. Memory on the voice worker as concurrent calls grow. How many calls a 4 GB machine carries is **not measured**; it needs the load test in spec §13.
  5. Database connections from serverless functions (§5.4), if a pooler setting is wrong.

### 4.3 Option 2: one server for everything

Everything in Docker Compose on one Singapore machine: web, agent, engine, voice, LiveKit, and a self-managed Postgres with Supabase Auth, the gateway and PostgREST. This is the self-hoster layout from spec §8.

**Monthly hosting cost (USD)**

|                                      | 0 customers                                     | 10 customers | 100 customers                |
| ------------------------------------ | ----------------------------------------------- | ------------ | ---------------------------- |
| Production server                    | 24 (4 GB, tight) to about 48 (8 GB, unverified) | about 48     | about 96 (16 GB, unverified) |
| Server backups at 20% (checked rate) | 5 to 10                                         | 10           | 19                           |
| Offsite database dumps               | about 1                                         | about 1      | about 5                      |
| Staging server                       | 12                                              | 12           | 24                           |
| **Hosting total**                    | **about 42 to 71**                              | **about 71** | **about 144**                |
| Speech and model usage               | about 0                                         | about 78     | about 780                    |

- **Latency.** Same as Option 1 for calls. Web pages are served from Singapore without a content network; fine for Malaysia.
- **Burden for one person.** High. The owner becomes the database administrator: backups, restore drills, Postgres and Auth upgrades, disk-full incidents, and TLS for the Auth endpoint. A web deploy and a call share one machine's memory and processor.
- **What breaks first.** After the Google limit: an untested backup on the day it is needed; one disk or host failure taking the website, sign-in, data and calls down together; memory pressure, because nine containers share 4 GB.
- **Verdict.** It saves about USD 30 to 40 a month at zero customers and nothing by 100 customers. The saving is not worth owning the database. It remains the right shape for self-hosters and should be kept working for spec §9 sub-project 7.

A middle path, if USD 20 a month matters: Option 1 but with the web app in a container on the same server instead of Vercel. It removes the serverless database question (§5.4) and the Vercel bill. It loses the content network, per-deployment rollback and the existing pull-request previews, and it puts web traffic on the machine that carries calls.

### 4.4 Option 3: LiveKit Cloud plus small containers

Vercel and Supabase as in Option 1. LiveKit Cloud replaces the self-hosted LiveKit server. The agent, engine and voice workers run as Fly.io machines in Singapore and talk over Fly's private network. No inbound UDP is needed because LiveKit Cloud carries the media.

LiveKit Cloud plans (checked): Build is free with 5,000 WebRTC participant minutes, 1,000 agent session minutes, 1,000 SIP minutes and 5 concurrent agent sessions. Ship is from USD 50 with 150,000 participant minutes, 5,000 agent session minutes and 5,000 SIP minutes, then USD 0.0005, USD 0.01 and USD 0.004 a minute. Scale is from USD 500. A call has two participants (caller and agent), so participant minutes are twice call minutes.

**Monthly hosting cost (USD)**

|                                                                                                                                                   | 0 customers        | 10 customers                                       | 100 customers                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| Vercel Pro and Supabase                                                                                                                           | 45                 | 45                                                 | 50                                                                   |
| LiveKit Cloud                                                                                                                                     | 0 (Build)          | 50 (Ship: 12,000 participant minutes exceed Build) | 50, plus about 220 for 55,000 SIP minutes once calls arrive by phone |
| Fly.io Singapore: 1 GB for agent and engine (USD 8.50, checked), 2 GB for voice (about USD 17, computed from the regional multiplier, unverified) | about 26           | about 26                                           | about 60                                                             |
| Staging                                                                                                                                           | 0 to 10            | about 15                                           | about 15                                                             |
| **Hosting total**                                                                                                                                 | **about 71 to 81** | **about 136**                                      | **about 175 browser-only, about 395 with phone calls**               |
| Speech and model usage                                                                                                                            | about 0            | about 78                                           | about 780                                                            |

One figure is open: whether LiveKit bills "agent session minutes" (USD 0.01 a minute over the allowance) for agents that JomCall hosts itself, or only for agents deployed on LiveKit Cloud. If it applies, add up to about USD 550 a month at 100 customers. Unverified; ask LiveKit before choosing this option.

- **Latency.** Unknown. LiveKit's documentation lists no Singapore region for hosted agents (nearest is Mumbai) and no Singapore group for region pinning, which needs the Scale plan anyway (checked). Whether callers' media enters at a Singapore edge is not stated. If it does not, expect tens of milliseconds more each way (estimate).
- **Burden for one person.** Lowest. No media server, no UDP firewall, no TURN, and LiveKit runs the SIP service later.
- **What breaks first.** After the Google limit: the bill once phone minutes arrive; five concurrent agent sessions on the free plan; no control over where media is processed, which weakens the PDPA position (§6.3).
- **Verdict.** A good fallback if running LiveKit, and later its SIP service, proves too much for one person. Not the first choice for a cost-sensitive launch with a data-location question open.

### 4.5 Why not the others

| Host                               | Reason                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Hetzner Singapore                  | Dearer than it looks: EUR 15.99 for 1 vCPU / 2 GB (checked), low traffic allowance, and prices rose in June 2026      |
| Railway, Render                    | No inbound UDP, so no self-hosted LiveKit                                                                             |
| Exabytes and other Malaysian hosts | "As low as" prices tied to long terms (checked on the vendor page); no gain while the database and vendors are abroad |
| Supabase Free for production       | Pauses after a week idle, no backups                                                                                  |
| Vercel Hobby for production        | Non-commercial terms; no data processing addendum                                                                     |

### 4.6 Supporting services (all options)

| Need                  | Suggested                                                                                                                 | Cost |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| Container images      | GitHub Container Registry; public images are free (checked). See §6.5 before publishing the voice image                   |
| CI                    | GitHub Actions; standard runners are free for public repositories (checked)                                               |
| Uptime and heartbeats | Better Stack free: 10 monitors and heartbeats (checked), or UptimeRobot free: 50 monitors at 5-minute intervals (checked) |
| Logs                  | Grafana Cloud free: 50 GB logs, 14-day retention (checked), or Better Stack free: 3 GB kept 3 days (checked)              |
| Errors                | Sentry free: one user, 5,000 errors (checked); Team at USD 29 a month later                                               |
| Secrets               | No extra service at first (§6.1). Doppler's free tier covers 3 users if wanted (checked)                                  |
| Transactional email   | A provider with SMTP, SPF and DKIM. Not priced here; owner decision (§8)                                                  |

Each of these is a new outbound service. Under `AGENTS.md` each needs the owner's approval.

## 5. What must change in the code first

The local guards are deliberate and tested. The plan is to add a third mode, `hosted`, with its own strict checks, and to leave `mock` and `local` exactly as they are. Nothing below should weaken a loopback check when the mode is `local`.

### 5.1 Mode selection

| Today                                                                                                                                                                               | Change                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseMode` allows `mock` and `local` only (`packages/contracts/src/core.ts:41-45`; duplicate in `scripts/local/guard.mjs:18-21`; build check in `web/next.config.ts:2-6`)          | Add `hosted`                                                                                                                                                                        |
| `requireLocal()` returns 503 unless mode is `local`; applied to every `/api/v1` route (`web/lib/server/config.ts:8-10`, `web/lib/server/api.ts:21`, `web/lib/server/services.ts:6`) | Accept `local` or `hosted`; rename to say what it means                                                                                                                             |
| Engine exits with `LOCAL_ONLY` unless mode is `local` (`engine/src/index.ts:3`)                                                                                                     | Accept `hosted`                                                                                                                                                                     |
| `NEXT_PUBLIC_JOMCALL_MODE` is fixed at build time (`web/next.config.ts:21`)                                                                                                         | On Vercel: Production builds `hosted`; Preview builds on pull requests stay `mock`; the staging environment builds `hosted` against staging. Set per environment, never by fallback |
| Unset mode means `mock`                                                                                                                                                             | Keep. A hosted error must never fall back to mock records (`AGENTS.md`)                                                                                                             |

### 5.2 Origins, URLs and database guards

| Today                                                                                                                                                                                                                      | Change in hosted mode                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `localConfig()` demands `http:` and host `127.0.0.1` for `LOCAL_ORIGIN` and `SUPABASE_URL` (`web/lib/server/config.ts:13-19`), so an HTTPS origin is impossible                                                            | New `APP_ORIGIN`; require `https:`; require `SUPABASE_URL` to be `https:`                                                         |
| Database guards demand `127.0.0.1:54622`: web (`packages/db/src/index.ts:15-17`), agent (`engine/src/agent/repository.ts:12-14`), queue (`engine/src/agent/runner.ts:53-55`), migrations (`scripts/local/migrate.mjs:5-8`) | Require TLS and a host that matches an expected value from configuration, so a typo cannot point production at the wrong database |
| Invitation link is the literal `http://127.0.0.1:4182/invite?token=` (`engine/src/engine.ts:162`)                                                                                                                          | Build from `APP_ORIGIN`                                                                                                           |
| Auth redirects use `LOCAL_ORIGIN` (`web/lib/server/auth.ts:94-96`)                                                                                                                                                         | Use `APP_ORIGIN`                                                                                                                  |
| `web/package.json` starts Next with `--hostname 127.0.0.1`                                                                                                                                                                 | No effect on Vercel. For Option 2 the container must listen on its own interface behind the proxy                                 |

### 5.3 The `local` namespace

`JOMCALL_QUEUE_NAMESPACE` labels queue jobs. Only `local` and `test_<uuid>` are legal today, in three TypeScript places (`packages/domain/src/authorization.ts:6-11`, `engine/src/engine.ts:28-34`, `engine/src/agent/runner.ts:43-50,68`), one literal (`new AgentRepository("local")`, `engine/src/agent/index.ts:16`), two column defaults and five SQL functions that raise `INVALID_NAMESPACE`.

Staging and production are separate databases, so the label does not need to differ for safety. Two choices:

- **Recommended:** a forward migration that also allows `staging` and `prod`, and reading the value from the environment everywhere. Small, and no production row is ever labelled "local".
- **Shortcut:** keep `local` in production. No migration. Confusing in logs and audits.

### 5.4 Database on a hosted provider

This is the highest-risk area. Check every row on staging before production exists.

| Topic                                | Today                                                                                                                                                        | Risk and change                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applying migrations                  | `supabase db push --local --yes` (`scripts/local/migrate.mjs:11`); 19 migration files                                                                        | Use a linked push to the hosted project, run by the release job or the owner with an admin connection that no service holds                                                                                                                                                                                                             |
| Auth-schema grants                   | `supabase/auth-grants.sql` is piped into the database container as `supabase_admin` (`migrate.mjs:20-44`)                                                    | **Hosted Supabase gives no `supabase_admin` login.** Whether the `postgres` role may grant `select` on `auth.sessions` and `auth.users` to `jomcall_authz` and `jomcall_agent_jobs` is unverified. Fallback: definer functions owned by a role that can already read those tables                                                       |
| Roles that bypass row-level security | Six no-login roles own definer functions                                                                                                                     | Whether hosted `postgres` may create `BYPASSRLS` roles is unverified. Test first                                                                                                                                                                                                                                                        |
| Role passwords                       | `alter role … password` with generated values (`migrate.mjs:47-57`)                                                                                          | Generate per environment, store in the secret stores, and keep them out of command output                                                                                                                                                                                                                                               |
| Serverless connections               | Web uses `pg` directly                                                                                                                                       | Vercel has no outbound IPv6 and Supabase's direct connection is IPv6-only without a paid add-on (price not checked). Use Supabase's transaction pooler for web. Identity is transaction-local already, which suits it; confirm there are no session-level settings, session advisory locks or named prepared statements on the web path |
| Workers and the queue                | pg-boss on the queue role                                                                                                                                    | Use a session-mode connection from the server, not the transaction pooler                                                                                                                                                                                                                                                               |
| Public data API                      | PostgREST runs locally but only the web server uses it                                                                                                       | Hosted Supabase exposes it to the internet with the anonymous key. Confirm that `anon` and `authenticated` have no grants on application schemas, remove those schemas from the exposed list, and run the security advisor                                                                                                              |
| Auth settings                        | `supabase/config.toml`: site URL and redirects on `127.0.0.1:4182`, local SMTP, email templates that say "local account" and "local inbox", 2 emails an hour | Set site URL, redirect allow-list, custom SMTP and neutral templates on the hosted project. These are hosted settings and need the owner's approval                                                                                                                                                                                     |
| Postgres version                     | 17 locally                                                                                                                                                   | Choose 17 on hosted                                                                                                                                                                                                                                                                                                                     |
| Clean replay                         | `npm run db:verify-migrations`                                                                                                                               | Run in CI on every pull request that touches `supabase/`                                                                                                                                                                                                                                                                                |

Migrations are forward-only. So that a web or worker rollback never needs a database rollback, every migration must work with both the previous and the new application version (add first, switch, remove later).

### 5.5 The voice turn endpoint

| Today                                                                                                                                                                                                    | Change                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bind host is typed as the literal `"127.0.0.1"` and checked at run time (`LOOPBACK_REQUIRED`, `engine/src/agent/voice-server.ts:75-78`); port 54633 is fixed (`engine/src/agent/index.ts:6`); plain HTTP | Allow a bind address from configuration that must be loopback or a private address. In Options 1 and 2 the agent and voice containers share a private Docker network and the port is **never published** on the host or the firewall |
| Voice worker default URL `http://127.0.0.1:54633`; any URL is accepted (`voice/jomcall_voice/config.py:58,83-84`)                                                                                        | Set `JOMCALL_VOICE_TURN_URL=http://agent:54633`. In hosted mode refuse a public host unless it is `https:`                                                                                                                           |
| Authentication is already real: a per-call bearer token, stored only as a hash, expiring after 300 s, at most 60 turns (`voice-server.ts:13,85,110`; migration `20261113160000`)                         | Keep. Add a second, static service key header between the two workers as defence in depth, so a leaked call token alone is not enough from elsewhere on the network                                                                  |
| No TLS                                                                                                                                                                                                   | Not needed on a single-host private network. Required if the two workers ever sit on different machines without an encrypted private network (Fly's private network in Option 3 is encrypted)                                        |
| The agent ignores `JOMCALL_MODE`                                                                                                                                                                         | Make it read the mode like the engine does                                                                                                                                                                                           |

### 5.6 Voice worker and LiveKit

| Today                                                                                                     | Change                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker runs only as `python -m jomcall_voice dev` (`package.json:40`)                                     | Add a production start (`python -m jomcall_voice start`) and confirm its behaviour on livekit-agents 1.6.0                                                                                     |
| Health server on `127.0.0.1:54634`                                                                        | Keep loopback; a container health check runs inside the container                                                                                                                              |
| Filler audio cache in `voice/.cache/`; stage timings in `output/voice`                                    | Mount a volume for the cache and run `voice:prewarm` as a release step (it is rate-limited to 8 requests a minute and resumable). Send stage timings to standard output or a volume            |
| No drain behaviour defined                                                                                | On deploy, stop taking new jobs and let running calls finish. A call is capped at 300 s, so give the container at least 330 s to stop. Option names in livekit-agents 1.6.0 are unverified     |
| No limit on concurrent jobs                                                                               | Set one from the load test, so an overloaded worker refuses a call instead of degrading all of them                                                                                            |
| LiveKit config forces loopback and bans host networking (`scripts/local/livekit-common.mjs:39,56-84`)     | Leave the local script alone. Add a separate production config: external IP discovery on, TCP 7881, UDP 7882 or the range, the WebSocket port behind the TLS proxy, keys from the secret store |
| `LIVEKIT_URL` is one value used by the browser, the web server and the worker (`voice-session.ts:49,128`) | Public value becomes `wss://…`. Allow a separate internal URL for the worker on the same machine                                                                                               |
| No TURN                                                                                                   | Enable LiveKit's built-in TURN over TLS on staging and test from an office network that blocks UDP                                                                                             |
| Deepgram requests join its model-improvement programme by default (checked)                               | Send `mip_opt_out=true` on every request. Whether `livekit-plugins-deepgram` 1.6.0 exposes that setting is unverified; if not, a small custom adapter is needed                                |

### 5.7 Sessions, CSRF and rate limits

| Today                                                                                                                                           | Change                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookies are `HttpOnly; SameSite=Lax` with no `Secure` (`web/lib/server/http.ts:103-112`)                                                        | Add `Secure` in hosted mode; consider the `__Host-` prefix                                                                                                                                                                              |
| A mutation needs an `origin` header exactly equal to `LOCAL_ORIGIN`, plus a CSRF token (`web/lib/server/csrf.ts:19-28`)                         | Compare with `APP_ORIGIN`. Each environment has exactly one origin. Pull-request previews have changing addresses, which is one more reason they stay in mock mode                                                                      |
| Rate limits live in process memory and are keyed by action only: one bucket of 10 a minute for all logins (`web/lib/server/auth.ts:71,104-112`) | **Must change before launch.** On the internet, one person failing ten logins a minute locks every user out, and on serverless each instance has its own counter. Key by client address and account, and store the counters in Postgres |
| Cookie names start with `ca_local_`                                                                                                             | Rename for hosted mode; no real users exist yet                                                                                                                                                                                         |
| User text mentions "the local inbox" (`auth.ts:148`)                                                                                            | Neutral text in English and BM                                                                                                                                                                                                          |

### 5.8 Email

Nodemailer is wired to literals: `127.0.0.1:54625`, no TLS, no login, sender `workspace@example.invalid`, message IDs at `jomcall.local` (`engine/src/engine.ts:52-59`). The `SMTP_HOST` and `SMTP_PORT` variables are checked but not used. Hosted mode needs host, port, user, password and sender from configuration, TLS on, and SPF, DKIM and DMARC records on the sending domain. Supabase Auth needs the same provider configured for its own emails.

### 5.9 Health checks and logs

| Service | Today                                                                       | Add                                                                                    |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Web     | No health route; `/api/v1/agent-tests/readiness` reports configuration only | `/api/health`: mode, and one database round trip                                       |
| Agent   | `/voice/health` returns a fixed `ok` (`voice-server.ts:151-153`)            | Include a database check; expose to the container health check only                    |
| Engine  | None                                                                        | A heartbeat to the uptime service on each successful loop, so silence raises an alert  |
| Voice   | Library health server                                                       | Use it for the container health check; alert when no worker is registered with LiveKit |
| LiveKit | Root path probe                                                             | External monitor on the public endpoint                                                |

Logs: keep the rule that no transcript, answer, key or token is logged. Emit JSON lines with a service name and a request or call ID. One specific leak to close: Vercel's own request logs record full paths, and the invitation, confirmation and recovery links carry their token in the query string. Next's logger already excludes those routes (`web/next.config.ts:14-17`); the platform's logs do not. Either accept it because the tokens are single-use and short-lived, or exchange the token by POST.

### 5.10 Environment handling

`scripts/local/env.mjs` generates every value and writes two files; that stays for local use. Hosted mode needs:

- A written list of every variable per service (the survey's list is the start), with which are secret. `.env.example` is stale: it lacks `AGENT_DATABASE_URL`, the `LIVEKIT_*` values and `JOMCALL_MODEL_PROVIDER`.
- A start-up check in each service that fails fast and names the missing variable, never its value.
- `JOMCALL_VOICE_PROVIDER` set for web in hosted environments. Today `env.mjs` never writes it to `web/.env.local`, so voice is off in web unless set by hand.
- A pinned Node version (`.nvmrc` and `engines`); none exists. Python is already pinned to 3.13.

### 5.11 Build and start commands

No Dockerfile, Compose file or workflow exists today.

| Service       | Build                                                                                                                                                  | Start                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Web on Vercel | Root directory `web`; install `cd .. && npm ci` (already in `web/vercel.json`); build `next build` with `JOMCALL_MODE=hosted`; functions region `sin1` | Managed by Vercel                                                            |
| Engine        | `npm ci` in a Node image                                                                                                                               | `node --import tsx engine/src/index.ts`                                      |
| Agent         | Same image as engine                                                                                                                                   | `node --import tsx engine/src/agent/index.ts`                                |
| Voice         | `uv sync --frozen --no-dev` in a Python 3.13 image                                                                                                     | `python -m jomcall_voice start`                                              |
| LiveKit       | None; image `livekit/livekit-server` v1.13.11 by digest                                                                                                | `--config` pointing at the production file                                   |
| Reverse proxy | None; Caddy (Apache-2.0)                                                                                                                               | TLS for the LiveKit WebSocket host                                           |
| Migrations    | None                                                                                                                                                   | Release job: linked database push, grants, role passwords, then verification |

Running TypeScript through `tsx` in production is acceptable to start (it is how the workers run today and it is pinned). Compiling ahead of time is a later improvement.

### 5.12 CI pipeline (requirements; detail belongs to the sibling plan)

- On every pull request: `npm run typecheck`, `npm run test:guards`, `npm run check:core` against a throwaway Supabase stack, `cd voice && uv run pytest`, both web builds (`mock` and `hosted`), a clean migration replay, a dependency licence check and a secret scan.
- Tests that call paid models (`check:hosted-model`, `check:voice-model`) run on demand or nightly, not on every pull request. They cost money and vary by a case or two between runs.
- On merge to `main`: build images tagged with the commit hash.
- Deploys are manual jobs behind GitHub Environments with the owner as required reviewer. That makes the `AGENTS.md` approval rule a mechanism, not a habit.
- The repository is public. Workflows from forks must never receive secrets.

### 5.13 Project rules

`AGENTS.md` says all runtime services stay local unless the owner changes that. Approving this plan is that change; the file must be updated in the same pull request that adds hosted mode, naming each hosted service the way the OpenRouter exception is named.

## 6. Security and compliance

### 6.1 Where each key lives

| Secret                                     | Web (Vercel)                                                   | Engine | Agent | Voice | LiveKit | Release job |
| ------------------------------------------ | -------------------------------------------------------------- | ------ | ----- | ----- | ------- | ----------- |
| Supabase URL and anonymous key             | yes                                                            |        |       |       |         |             |
| `APP_DATABASE_URL` (`jomcall_app`)         | yes                                                            |        |       |       |         |             |
| `WORKER_DATABASE_URL` (`jomcall_worker`)   |                                                                | yes    |       |       |         |             |
| `AGENT_DATABASE_URL` (`jomcall_agent`)     |                                                                |        | yes   |       |         |             |
| `QUEUE_DATABASE_URL` (`jomcall_queue`)     |                                                                | yes    | yes   |       |         |             |
| `CSRF_SECRET`                              | yes                                                            |        |       |       |         |             |
| `INVITATION_KEY`                           | yes                                                            | yes    |       |       |         |             |
| LiveKit API key and secret                 | yes                                                            |        |       | yes   | yes     |             |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`  |                                                                |        | yes   |       |         |             |
| `DEEPGRAM_API_KEY`, `GOOGLE_CLOUD_API_KEY` |                                                                |        |       | yes   |         |             |
| SMTP login                                 |                                                                | yes    |       |       |         |             |
| Database admin connection, role passwords  |                                                                |        |       |       |         | yes         |
| Supabase service key                       | nowhere: only tests use it today (`tests/helpers/local.ts:10`) |        |       |       |         |             |

Storage: Vercel's encrypted environment variables for web, scoped per environment. On the server, one root-owned file per service, mode 0600, outside the repository, mounted only into its own container. Deploy credentials in GitHub Environment secrets. A copy of everything in the owner's password manager, because the server is disposable.

Rules: different keys for staging and production; a spending cap and usage alert on every vendor account; rotate after any suspected exposure and on a fixed schedule; never a key in a `NEXT_PUBLIC_` variable, an image layer, a log line or a chat.

### 6.2 Least privilege for the existing database roles

The role design carries over unchanged and is the main protection if one service is compromised.

| Role                                                                                                                    | Used by                                             | Can it bypass row-level security                 |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| `jomcall_app`                                                                                                           | Web                                                 | No. Tenant tables have forced row-level security |
| `jomcall_worker`                                                                                                        | Engine                                              | No. Narrow functions for outbox and privacy jobs |
| `jomcall_agent`                                                                                                         | Agent                                               | No. Narrow functions for agent work              |
| `jomcall_queue`                                                                                                         | Engine, agent                                       | Owns only the `pgboss` schema                    |
| `jomcall_authz`, `jomcall_bootstrap`, `jomcall_members`, `jomcall_jobs`, `jomcall_booking_locker`, `jomcall_agent_jobs` | Nobody logs in as these; they own definer functions | Yes, inside those functions only                 |

Additions for a hosted database: the `postgres` admin role is used only by the release job; no long-running service holds it. Require TLS on every connection. Set a connection limit per login role so one runaway service cannot starve the others. Confirm the public data API reaches no application table (§5.4). Supabase's network restrictions can limit direct connections to the server's address, but Vercel's addresses are not fixed, so the pooler stays open to the internet and relies on the role passwords.

The six known advisor warnings about pg-boss helper functions (`infra/local/README.md`) will reappear on hosted Supabase; re-check that the `pgboss` schema still has no grant to the application or public roles.

### 6.3 PDPA: where personal data crosses the border

Not legal advice. The legal points below come mostly from law-firm summaries of the Personal Data Protection (Amendment) Act 2024 and the Commissioner's Cross Border Personal Data Transfer Guidelines of 29 April 2025; only the wording of section 129 and the biometric definition was read in the Act itself. The Commissioner's own guideline text was not retrieved. A Malaysian privacy lawyer should confirm before real callers are served.

| Data                                                           | Goes to                      | Where                                         | Vendor terms (checked)                                        |
| -------------------------------------------------------------- | ---------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Account data, contacts, consent records, transcripts, bookings | Supabase                     | Singapore                                     | Data processing addendum with standard clauses                |
| Pages and API requests in transit; request logs                | Vercel                       | Singapore functions; log location not checked | Addendum covers Pro, not Hobby                                |
| Live call audio (not stored)                                   | Self-hosted LiveKit          | Singapore server                              | Own infrastructure                                            |
| Caller audio                                                   | Deepgram                     | United States by default                      | Retains audio for model improvement unless `mip_opt_out=true` |
| Conversation text, knowledge excerpts                          | Anthropic                    | Global                                        | Deleted within 30 days by default; not used for training      |
| The agent's reply text                                         | Google Gemini text-to-speech | Global                                        | Paid tier not used to improve products                        |
| Typed test text                                                | OpenRouter, then Anthropic   | Global                                        | Prompts not logged by default                                 |
| Invitation and account emails                                  | Email provider               | To be chosen                                  | To be checked                                                 |

What the law asks, in short:

- Since 1 April 2025 there is no approved-country list. A transfer abroad is allowed if the destination has substantially similar law or adequate protection, shown by a Transfer Impact Assessment valid for up to three years, or under an exception such as consent, necessity for a contract, or "reasonable precautions and due diligence". Contract clauses, binding corporate rules and certification count toward the last one.
- The practical route for a small company: sign each vendor's data processing addendum, keep one written transfer assessment per vendor, name the recipients and purposes in the privacy notice, and have each business customer accept a data processing agreement, since the business is the controller of its callers' data and JomCall is its processor.
- Processors are directly bound by the Security Principle since 1 April 2025. A breach must be reported to the Commissioner within 72 hours, and to affected people within 7 days where significant harm is likely, since 1 June 2025.
- A data protection officer is required above 20,000 data subjects. A hundred customers at 300 callers a month could pass that within a year.
- "Biometric data" is now sensitive personal data. JomCall makes no voiceprints and milestone A stores no audio. Whether a plain call recording counts is unsettled in the sources found; it matters when recording arrives in milestone B.

Ways to shrink the exposure: opt out of Deepgram's retention on every request; drop OpenRouter from production so text goes to one model vendor instead of two (the typed path would have to pass the 48-case gate again on the direct API); keep the existing in-product warnings, in English and BM, that say where audio and text go.

### 6.4 Backups and what is stored where

| Store                        | Contents                                                                                                                                                                                 | Protection                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Postgres, Singapore | Everything durable: tenants, agents and versions, contacts, consent, bookings, test sessions and turns (transcripts; 24-hour expiry for tests), the voice answer cache, audit log, queue | Daily backups kept 7 days on Pro. Add an encrypted database dump to separate storage from the first paying customer. Point-in-time recovery is USD 100 a month for 7 days (checked); buy it when billing goes live or by 100 customers |
| Server, Singapore            | Filler audio cache (fixed lines only, regenerable), stage timings (timestamps only), configuration, secrets files                                                                        | No backup needed; rebuild from the repository and the password manager. Disk encryption is not offered by default on small droplets (unverified); treat the secrets files as the sensitive part                                        |
| Vercel                       | Build output, request logs                                                                                                                                                               | Nothing durable                                                                                                                                                                                                                        |
| Vendors                      | As in §6.3                                                                                                                                                                               | Their retention terms                                                                                                                                                                                                                  |
| Audio                        | Not stored anywhere in milestone A                                                                                                                                                       | Recording storage and retention are a milestone B design question                                                                                                                                                                      |

A backup that has never been restored is not a backup. The staging rollout includes a restore drill (§7, step 6), repeated quarterly.

PDPA export and delete already work at the database level and are unaffected by hosting, with one addition: deletion must also be honoured in any offsite dump within its retention period, so keep that period short (14 to 30 days) and say so in the privacy notice.

### 6.5 Licence point for container images

The voice worker's `av` dependency bundles FFmpeg builds that include GPL code (`voice/README.md`). The repository does not redistribute them today. **Publishing the voice image to a public registry would.** Until the owner decides that open question, build the voice image on the server or keep it in a private registry.

### 6.6 Network exposure on the server (Options 1 and 2)

| Port                               | Open to                                                           | Purpose                                         |
| ---------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| 22/TCP                             | Owner only, key login, no passwords                               | Administration                                  |
| 80, 443/TCP                        | Internet                                                          | Certificates and the LiveKit WebSocket over TLS |
| 7881/TCP                           | Internet                                                          | Media fallback over TCP                         |
| 7882/UDP (or 50000 to 60000/UDP)   | Internet                                                          | Media                                           |
| 3478/UDP, 5349/TCP                 | Internet, if TURN is enabled                                      | Callers behind strict firewalls                 |
| 54633, 54634                       | Never published                                                   | Voice turn endpoint, worker health              |
| Later: 5060 and 10000 to 20000/UDP | The SIP trunk's addresses only, where the supplier publishes them | Phone calls                                     |

## 7. Staged rollout

Every step that creates or changes something hosted needs the owner's explicit approval at that step; approval of this document is not approval of any step. "Owner does" marks actions only the owner can take: creating accounts, entering payment details, accepting terms and pasting keys.

**Step 0. Decisions and code.** Owner settles §8 items 1 to 3. PRs #5, #6 and #7 merge. The changes in §5 land behind `hosted` mode with tests; CI is green; `AGENTS.md` is updated.

- Check: `local` and `mock` behave exactly as before (`npm run check:phase2`, `npm run test:guards`); a hosted-mode build succeeds with dummy values.
- Rollback: revert the pull requests. Nothing hosted exists yet.
- Approval: normal pull-request review.

**Step 1. Accounts and domain.** Owner does: register the domain; create Supabase, DigitalOcean (or Lightsail) and email-provider accounts; upgrade Vercel to Pro; set spending alerts everywhere; accept each vendor's data processing addendum.

- Check: two-factor sign-in on every account; alerts tested.
- Rollback: close the accounts.
- Approval: owner, each account.

**Step 2. Staging database.** Create the staging Supabase project in Singapore on Postgres 17. Apply the 19 migrations, the Auth grants and the role passwords. Configure Auth: site URL, redirect list, SMTP, templates.

- Check: migration list matches the repository; all ten roles exist with the expected attributes; the grant and bypass questions from §5.4 are answered; security advisor shows only the known pg-boss warnings; an anonymous request to the public data API reaches no application table; the database test suite passes against staging.
- Rollback: delete the staging project. It holds only test data.
- Approval: owner, to create the project and to change Auth settings.

**Step 3. Staging server.** Create a 2 GB server in Singapore. Firewall as in §6.6. Install Docker. Point `livekit.staging.<domain>` at it. Start LiveKit, the proxy, agent, engine and voice with staging keys. Prewarm the filler audio.

- Check: every container reports healthy; the certificate is valid; LiveKit's connection test passes from a Malaysian home line and a mobile network; a port scan from outside shows only the ports in §6.6; the voice worker is registered; the engine heartbeat arrives.
- Rollback: destroy the server.
- Approval: owner, to create the server and DNS records.

**Step 4. Staging web.** Add a staging environment on Vercel on a fixed domain, built in `hosted` mode with staging values, functions in `sin1`.

- Check: sign up, confirm by real email, sign in, invite a second member, reset a password; cookies carry `Secure`; a forged-origin POST is refused; ten failed logins from one address do not block another; `/api/health` is green; a typed test turn completes; the client bundle contains no secret.
- Rollback: remove the environment or promote the previous deployment.
- Approval: owner, to change Vercel settings.

**Step 5. Voice on staging.** Run a browser voice test end to end, then the twenty-turn script (`npm run check:voice-speed`) from Malaysia.

- Check: the voice spec §8 speed and correctness goals, compared with the local numbers; a test from a network that blocks UDP (TURN); stage timings arrive; nothing about the call appears in logs except codes and timestamps.
- Rollback: set `JOMCALL_VOICE_PROVIDER=disabled`; typed tests keep working.
- Approval: none beyond step 3, as only staging keys are used.

**Step 6. Hardening on staging.** Run for a week. Restore last night's backup into a scratch project and compare row counts. Run concurrent synthetic calls until the worker degrades, and record the limit. Deploy a new image during a live call to prove draining. Stop the server on purpose to see the alerts fire.

- Check: restore succeeds and the time it took is written down; the concurrency limit is set from the measurement; every alert reached the owner's phone.
- Rollback: not applicable.
- Approval: owner, for the restore project (a short-lived paid resource).

**Step 7. Production database.** Same as step 2, on a new project, with production secrets generated fresh.

- Check: as step 2, plus backups are scheduled.
- Rollback: delete the project while it is still empty. After real data exists, rollback means a forward migration or, as a last resort with data loss, a backup restore.
- Approval: owner. This is a production database write.

**Step 8. Production server.** Same as step 3 on a 4 GB server with production keys and vendor spending caps.

- Check: as step 3.
- Rollback: redeploy the previous image tag; or destroy and rebuild, since the server holds no customer data.
- Approval: owner. This is a production deploy.

**Step 9. Production web and DNS.** Set Vercel production variables, build in `hosted` mode, attach the domain.

- Check: as steps 4 and 5 with the owner's own account; mock previews on pull requests still build and still show only fictional data.
- Rollback: promote the previous Vercel deployment (instant); DNS back to the placeholder.
- Approval: owner. Production deploy and DNS change.

**Step 10. Closed beta.** Invite a handful of owners for typed and browser voice tests only.

- Check each week: error rate, speed medians, vendor spend against §4.1, backup success.
- Rollback: pause sign-ups; disable voice; in the worst case put up a maintenance page.
- Approval: owner, before each widening. Real callers wait for the phone line, the Google limit and the PDPA sign-off.

Routine releases afterwards: merge to `main`, CI builds images by commit hash, staging deploys, checks pass, the owner approves the production job. Migrations run before the new code and stay compatible with the old.

## 8. Open decisions for the owner

Most important first. Each has a recommendation.

1. **Leave local-only and choose the hosting shape.** Recommend Option 1 at about USD 70 to 82 a month before any customer. This also amends the local-only rule in `AGENTS.md`.
2. **What first launch covers, and the PDPA position.** Recommend a closed beta of typed and browser voice tests only, with the existing "do not speak real customer details" warning, while a Malaysian privacy lawyer reviews the transfer assessments, the privacy notice and the customer data processing agreement. No real callers before that.
3. **Google's eleven-requests-a-minute voice limit.** Recommend treating it as a launch blocker for any paying customer: get a written quota from Google, or benchmark a second voice provider. Also budget for the price doubling on 1 January 2027.
4. **Supabase hosted or self-managed Postgres.** Recommend hosted Pro in Singapore. Self-managing saves about USD 25 a month and makes the owner the database administrator.
5. **LiveKit self-hosted or LiveKit Cloud.** Recommend self-hosted on the same server now. Revisit when the SIP service arrives or the measured concurrency limit is near; ask LiveKit about Singapore media and self-hosted agent billing before then.
6. **Web on Vercel Pro or on the server.** Recommend Vercel Pro. Moving web to the server saves USD 20 a month and is the fallback if the serverless database connection proves troublesome.
7. **Server provider.** Recommend DigitalOcean SGP1; AWS Lightsail Singapore is equal on price. Malaysia-region hosting brings no real benefit yet.
8. **Direct Anthropic or OpenRouter for the typed path.** Recommend direct, to remove one data recipient and the 5.5% credit fee (checked). It requires re-running the 48-case gate on the direct API.
9. **Transactional email provider and sending domain.** Recommend any provider with SMTP, a data processing addendum and a free tier that covers a few hundred emails a month; decide alongside the domain name.
10. **Deepgram retention.** Recommend opting out on every request and staying on the default endpoint; the India endpoint is the only one in Asia and has not been measured.
11. **Namespace.** Recommend the small migration that allows `staging` and `prod`, over keeping `local` in production.
12. **Voice image and the bundled GPL FFmpeg.** Recommend building that image on the server and not publishing it until the licence question in `AGENTS.md` is closed.
13. **Staging cost.** Recommend an always-on staging server (USD 12) and a free-organisation staging database until the first customer, then a paid Micro (USD 10) so it never pauses.
14. **Backups beyond the daily 7 days.** Recommend an encrypted nightly dump to separate storage from the first paying customer, and point-in-time recovery when billing goes live.
15. **Monitoring vendors.** Recommend one uptime and heartbeat service and one error tracker on free tiers. Each is a new outbound service to approve.
16. **A data protection officer.** Not required yet. Recommend naming who it will be before 20,000 data subjects, which a hundred customers could reach within a year.

## 9. Sources

All fetched on 2026-11-14 unless marked.

Hosting and tools:

- Vercel: `vercel.com/pricing`, `vercel.com/docs/plans/hobby`, `vercel.com/docs/regions`, `vercel.com/legal/dpa`. Hobby commercial-use wording from a search snippet of `vercel.com/legal/terms` (unverified).
- Supabase: `supabase.com/pricing`, `supabase.com/docs/guides/platform/regions`, `supabase.com/legal/dpa`.
- LiveKit: `livekit.com/pricing`, `docs.livekit.io/deploy/admin/regions/endpoints/`, `docs.livekit.io/deploy/admin/regions/region-pinning/`, `docs.livekit.io/home/self-hosting/ports-firewall/`, `docs.livekit.io/home/self-hosting/sip-server/`, `livekit.com/legal/data-processing-addendum`.
- Fly.io: `docs.fly.io/about/pricing`, `docs.fly.io/networking/udp-and-tcp`. Singapore prices other than the 1 GB example are computed from the published regional multiplier (unverified).
- DigitalOcean: `digitalocean.com/pricing/droplets`. The 8 GB and 16 GB prices are from memory (unverified).
- AWS Lightsail: `aws.amazon.com/lightsail/pricing/`.
- Hetzner: `hetzner.com/cloud-singapore/`, `docs.hetzner.com/cloud/billing/faq/`.
- Railway: `docs.railway.com/reference/regions`, `station.railway.com/feedback/adding-inbound-udp-fad19847`. Render: `render.com/docs/regions`; UDP from community posts (unverified).
- Exabytes: `exabytes.my/servers/ssd-vps`.
- Latency: `cloud.zenlayer.com/datacenters/kuala-lumpur` (vendor claim); two further vendor snippets (unverified).
- Monitoring: `betterstack.com/pricing`, `grafana.com/pricing/`, `sentry.io/pricing/`, `uptimerobot.com/pricing/`.
- GitHub: `docs.github.com/en/billing/concepts/product-billing/github-actions`, `…/github-packages`.
- Secrets: `doppler.com/pricing`, `infisical.com/pricing`.

Usage and data handling:

- Deepgram: `deepgram.com/pricing`, `developers.deepgram.com/reference/regional-endpoints`, `developers.deepgram.com/trust-security/your-data`, `developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program`.
- Anthropic: `platform.claude.com/docs/en/about-claude/pricing`, `platform.claude.com/docs/en/manage-claude/data-residency`, `privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data`, `privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training`.
- Google: `aistudio.google.com/docs/pricing`, `aistudio.google.com/docs/speech-generation`. Region control from a terms snippet (unverified).
- OpenRouter: `openrouter.ai/docs/faq`.

PDPA:

- Act A1727 text, hosted at `christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf`.
- Commencement: `dfdl.com/insights/legal-and-tax-updates/malaysia-implementation-of-the-personal-data-protection-amendment-act-2024/`.
- Cross-border guidelines: `skrine.com/insights/alerts/april-2025/cross-border-personal-data-transfer-guidelines-lau`, `hlc.com/en/publications/malaysias-groundbreaking-cross-border-data-transfer-guidelines-explained`, `mayerbrown.com/en/insights/publications/2025/07/from-legislative-reform-to-practical-guidance-key-amendments-to-malaysias-pdpa-and-the-launch-of-cross-border-transfer-guidelines`.
- Breach notice and officer thresholds: `privacymatters.dlapiper.com/2025/03/malaysia-guidelines-issued-on-data-breach-notification-and-data-protection-officer-appointment/`.

## 10. What this plan did not verify

- Any latency or speed number from a Singapore data centre. All speed figures are from the owner's home network.
- How many concurrent calls one server carries.
- Hosted Supabase behaviour for the Auth-schema grants and the roles that bypass row-level security.
- That the web database path is safe behind a transaction pooler.
- LiveKit Agents 1.6.0 option names for production start, draining and concurrency limits, and whether its Deepgram plugin can send the retention opt-out.
- LiveKit Cloud's media location for Malaysian callers and its billing for self-hosted agents.
- Prices marked unverified in §4 and §9, and every MYR conversion.
- The Commissioner's guideline text itself; the PDPA section rests on law-firm summaries.
- The sibling CI and phone-line plans, which were not available when this was written.
