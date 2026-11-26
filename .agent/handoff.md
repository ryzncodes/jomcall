# Handoff

## 2026-11-26: AI call summaries (branch `feat/call-summary`, pull request not yet open, not merged)

Design: `docs/superpowers/specs/2026-11-26-call-summary-design.md`. Plan: `docs/superpowers/plans/2026-11-26-call-summary.md`. One migration: `20261126100000_call_summary.sql`. Deviations: `NOTES.md`.

**What changed**
- A worker in the agent process (`engine/src/agent/call-summary.ts`) summarizes each answered real phone call of 15 s or more with 2 or more completed turns, or 1 when the outcome is `transferred`, `transfer_failed`, `handoff`, `message` or `booking_proposed` with `claude-haiku-5-5`: reason, outcome, next step, each in English and Bahasa Melayu. Switch `JOMCALL_CALL_SUMMARY` (`disabled` default, `anthropic`); agent process only, web gets no key; allowed on staging and production. Free: no billing.
- Queued by an `after update of state on app.call` trigger; lease 60 s, 3 attempts, then `failed`; `TOO_SHORT` and `NO_TURNS` are skipped. Code guards in `packages/inference/src/call-summary.ts` reject a quote of the caller, a personal detail and a "booking confirmed" or "message sent" claim.
- Call page: Summary block for every member, "Written by AI" / "Edited"; call list shows the reason; owners and admins Edit and Clear (`updateCallSummary`); PDPA contact export carries `summary` per call; deleted with the call.
- Paid check script `npm run check:call-summary` (`--dry` sends nothing, `--paid` spends) with 16 made-up cases in `scripts/calls/summary-cases.json`.
- Final-review fixes (2026-11-26): false-success guard by English and BM phrase families with request, pending and negated wording exempt; paid check fails a case on any `forbidden` caller detail (names, streets, estates, email local parts) in any of the six fields and records the result's model; tighter reason keywords; one-turn calls with a staff outcome are summarized; a summary that arrives while the worker closes is still written; `max_tokens` 1000 and a dates-in-words prompt line; the export carries `edited_at`; clearly fake IC and phone numbers in tests and cases. Known limit: names and addresses are kept out of real summaries by the prompt alone (`NOTES.md`).

**Verified (2026-11-26, local database and fakes only)**
- `typecheck` passes; `test:guards` 69 of 69; `test:offline` 472 tests, 471 pass, 1 skipped (after the final-review fixes); `check:core` 1442 of 1442 (one run); `db:verify-migrations` passes (63 tables with row-level security); `build:local`, `build:mock`, `build:hosted` pass.
- Browser (controller, local app, 375 px, made-up workspace, SQL-seeded fake calls): EN light list and call page, owner edit and clear, BM dark writing, failed and clear, staff sees the summary without Edit or Clear.

**Not verified**
- The paid check (`npm run check:call-summary -- --paid`) has NOT run: it spends on Anthropic and awaits the owner's go-ahead. The QA record in `docs/qa/` is not written. No real model call has been made.
- No person has read summaries of real calls. Not seen in a browser: EN dark, BM light, desktop width. Nothing on staging.

**Next**
- Owner: say go for the paid check (about 16 model calls), read the 16 outputs, record them in `docs/qa/`.
- Owner: `infra/hosted/RUNBOOK.md` step 19 (migration before merge, rebuild the agent, then the switch).
- Owner: add AI summaries to the privacy and terms text (legal text is the owner's).
- Open the pull request (the controller does it after the final review).

## 2026-11-26: phone calls in the PDPA contact export (branch `fix/export-phone-calls`)

- `packages/domain/src/privacy.ts`: the export download gains `calls`, each with `turns` and `proposals`; named columns only (no snapshot, tokens, SIP identifiers, billing columns, timings or tool steps). The knowledge-gap comment now says gaps come from calls and chats too. No migration: owners and admins already read these tables.
- Test: `tests/engine/privacy.test.ts` "contact export lists the contact's phone calls…" (another contact's call is left out; secrets and billing values are absent). typecheck, guards 69 of 69 and `check:core` 1411 of 1411 pass.
- Not verified: no person has downloaded an export with a real call; nothing on staging until merged (web only, Vercel deploys it).
- Next from the CRM gap report: AI summary on each call; contact fields and CSV import.

## 2026-11-24: contact timeline (branch `feat/contact-timeline`, pull request #91)

Design: `docs/superpowers/specs/2026-11-24-contact-timeline-design.md` (all decisions are the builder's best guess, at the owner's request; build note at the end). No migration.

**What changed**
- New read command `contactTimeline` (`GET /contacts/:id/timeline`): calls, WhatsApp chats, bookings, notes, consent and follow-ups for one contact, newest first, 30 per page, plus the open follow-ups on page one. Calls carry summary columns only; follow-ups hidden while PDPA deletion is pending.
- Contact panel: "Still open", Appointments (moved up), "History" / "Sejarah" with View links, then notes, consent and privacy as before.

**Verified (2026-11-24, local database only)**
- `typecheck` passes; `test:guards` 69 of 69; `check:core` 1410 of 1410 before the last fix (closed follow-up links, page reset); after it contacts, timeline, domain and privacy tests 478 of 478, guards 69 of 69, typecheck and three builds pass; `build:local`, `build:mock`, `build:hosted` (test `APP_ORIGIN`) pass.
- Browser (controller, local app, made-up workspace, staff account): History at 375 px in English, new note at the top after saving, "Still open", BM with dark theme at 375 px, View links to the call and to the chat (Inbox opens with WhatsApp not connected), a closed follow-up linking to its call.

**Not verified**
- No person has used it; owner view, a consent entry, a chat with messages and "Show older" not seen in a browser (API and unit tests cover them); not measured on a large contact; nothing on staging.

**Next**
- Open the pull request; once merged, Vercel deploys the web (no migration, no engine change).
- Possible follow-ups: contact link on the call page; contact filters on the call and chat lists.

## 2026-11-23: follow-up queue on staging (pull request #89 merged as `ca599fa`)

- With the owner's yes, runbook step 18 was run in one sitting: no live call; engine stopped; both migrations applied (the owner typed the confirmation; 49 migrations recorded, back-fill 2 items, 0 alerts, web role lost `update` on `app.call_proposal`); pull request merged by the owner (the Claude Code permission check refused `gh pr merge`); `git pull` and `docker compose up -d --build engine agent` on the server at `ca599fa`.
- Checked after: engine and agent healthy and `ready`; one `ENGINE_TICK_FAILED` at the engine's first tick, none in the next two minutes; queued alerts 0, stuck 0; Vercel staging deploy of `ca599fa` succeeded; `/api/health` gave one 503 then 200 three times; `/app/follow-ups` answers 200.
- Not checked: no person has opened `/app/follow-ups` on staging; no follow-up email sent there (staging has no phone line or WhatsApp to make a new item).
- Runbook step 18 named the wrong folder for Compose (`/opt/jomcall`; it is `/opt/jomcall/infra/hosted`); fixed on branch `docs/runbook-step18-folder`.

## 2026-11-22: follow-up queue (branch `feat/follow-up-queue`, pull request not yet open, not merged)

Design: `docs/superpowers/specs/2026-11-22-follow-up-queue-design.md` (build note in section 10). Plan: `docs/superpowers/plans/2026-11-22-follow-up-queue.md`. Two migrations: `20261122100000_follow_up_queue.sql`, `20261122100100_follow_up_alerts.sql`.

**What changed**
- Agent proposals from real call turns that ended (completed, or cut off by a hang-up, a crash or a failure: the proposals those turns keep) and from completed WhatsApp turns become follow-up items. New page `/app/follow-ups` (Open, Mine, Done; Undo; assign and due time for owners and admins; Confirm booking / Decline for booking requests, confirmed into JomCall's own calendar). Counts on Home and the sidebar; items and buttons on the call page and the WhatsApp chat.
- New items email the owner and every active admin; an assignment emails the assignee. Emails carry no customer data. The engine sends them (`engine/src/follow-up-alert.ts`).
- The web role lost `update` on the two proposal tables; state mirrors from `app.follow_up`. First apply back-fills existing proposals and sends no email.
- Final review fixes (2026-11-23): items from cut-off call turns (and in the back-fill); the customer's own "staff" keyword flag is no longer cleared by closing an unrelated item (`HANDOFF_REQUESTED` clears only when the chat's handoff turn has a handoff item); reopening a WhatsApp item raises the chat flag again; the cancel question names the booking's own time (`booking_start_at`; plain Reopen once the booking is no longer confirmed); a confirm refused for the time says to agree a new time, add it in Bookings and decline; audit `booking.cancel`; BM "Tiada tarikh akhir"; the migration sets a 5-second `lock_timeout`; the runbook order is fixed (below).

**Verified (2026-11-22, local database and fakes only)**
- After the final review fixes (2026-11-23): `npm run typecheck` passes; `test:guards` 69 of 69; `check:core` 1402 of 1402 on the first run (the flickering `tests/local/model.test.mjs` guard passed); `db:verify-migrations` 62 RLS tables; `build:local`, `build:mock`, `build:hosted` (test `APP_ORIGIN`) pass. Changed functions were applied to the shared local database with psql.
- Browser (controller, local app, made-up workspace): list in English, Done and Undo (Undo driven through an in-page script, not a tap), Confirm booking and clash message, BM at 375 px, dark at 375 px, assign to staff, call page item, "Cancel booking and reopen" on a confirmed booking.

**Not verified**
- No person has used it. The new confirm-refusal text was not seen in a browser. Seen on 2026-11-23 as staff in the local app: the staff list (no assign menu), Mine tab, the WhatsApp chat item (Done, then Reopen raises the chat flag), `?item=` highlight at 375 px, the no-contact booking item's Bookings link in BM, and a confirmed item's booking time. No real email sent. Nothing on hosted staging. Agent gates not re-run (prompts unchanged).

**Next**
- Owner step (production change, needs an explicit yes), in one sitting, `infra/hosted/RUNBOOK.md` step 18: check no call is live, stop the engine, apply both migrations to staging BEFORE the pull request is merged (Vercel deploys the web from `main` on merge, and the new web reads `app.follow_up` in call detail and the chat; the web now on `main` should keep working on the migrated database, read from the code, not run), merge, then pull and rebuild engine and agent. Step 18 has a requeue query for alerts an old engine left queued. Do not roll the engine back past this change while `follow_up.alert` rows are queued.
- Known limits are in design section 10 (duplicate email if an ack fails, demoted admin still gets a queued `new` email, no polling of the sidebar count, assignee shown by email, an email link opens the active workspace, reopen after a reschedule cancels the moved booking, a failed call turn's request may be recorded twice, and others). Re-saving an unchanged assignment emails nobody (it only bumps the revision).
- The branch also edits `packages/domain/src/privacy.ts`, which `fix/privacy-export-calls` edits too: expect a merge conflict.

## 2026-11-21: public pages and SEO (branch `feat/public-pages-seo`, pull request #86, not merged)

**What changed**
- 25 public pages in English (`/…`) and Bahasa Melayu (`/ms/…`), all static: home, pricing (with an estimator), how it works, call forwarding, languages, FAQ, six industry pages and their index, four comparison pages and their index, trust, three guides and their index, privacy, terms. New "Kaunter" design on the public shell, dark theme, a sample call card on home.
- Per-page title, description, canonical, hreflang and Open Graph; JSON-LD; `robots.txt`, `sitemap.xml` and `llms.txt` (hosted build only). Indexing turns on only when the hosted origin's host is `jomcall.com` (`isIndexable()` in `web/lib/site.ts`); `staging.jomcall.com` stays `noindex` with robots disallowing everything. A hosted build fails without `APP_ORIGIN`.
- Old `?lang=ms` public links redirect (301) to `/ms/…` and keep `?theme`. BM pages are built with `<html lang="en">` (one root layout) and carry `main[lang=ms]`, `Content-Language: ms` and a pre-paint script that sets `lang="ms"` (see `NOTES.md`, Task 10).
- A claims guard (`web/content/public/claims.ts`) fails the tests on banned claims (never miss a call, unlimited, recording, free trial, PDPA compliant, Tamil, calendar sync, WhatsApp as available, a stated wait for the number).
- Sign-up and log-in side panel lists the same six steps as the in-app checklist; the old marketing screens were removed.
- Last task: a BM wording pass (house term "temu janji", "menyambungkan" for a transfer, plainer phrasing; meaning and claims unchanged) and a type fix in `tests/hosting/auth-panel.test.ts`.

**Verified (2026-11-21, local only)**
- After merging `main` (#85, #87) on 2026-11-21: `npm run typecheck` 0 errors; `npm run test:guards` 69 of 69; `npm run check:core` 1341 of 1341; `build:hosted` (test `APP_ORIGIN`), `build:mock` and `build:local` pass. (Earlier runs on this branch showed 13 typecheck errors in `tests/`; they came from this branch, not `main`: see `NOTES.md`.)
- `build:mock`, `build:local` and `build:hosted` (with `APP_ORIGIN=https://example.test`) pass; every public route in the hosted route table is static (○ or ●).
- Hosted build served with `next start` on 127.0.0.1, headless Chrome: all 50 routes answer 200 with no horizontal scroll at 360 px and the right `main[lang]`; home, pricing, clinics and FAQ seen at 390 and 1280 px in English, BM, light and dark (32 full-page screenshots, every one looked at); estimator moves by keyboard and the figures and announcement follow; mobile menu opens (keyboard and pointer), Escape closes it and focus returns to the menu button; `/?lang=ms` and `/pricing?lang=ms&theme=dark` redirect 301 and the theme is kept; a visible focus ring on the first 45 tab stops of `/` (light and dark), the estimator slider and three FAQ disclosures; reduced motion stops the call card cycling. No JavaScript exceptions, but the console check fails: every page logs the session check described below (pre-existing).
- Throttled mobile (4x CPU, 150 ms latency, 1.6 Mbps, 390 px) on `/`, three runs: LCP median 872 ms (target under 2.5 s), CLS 0.0004 (target under 0.1). Served from localhost, so network cost is understated.

**Not verified**
- No native BM speaker has read the copy. Nothing ran on Vercel or on the hosted environment. No real search engine, Lighthouse or screen reader was used.
- Every public page asks `GET /api/v1/session` to choose the header button; for a signed-out visitor 401 is expected from the code but was not observed (locally it answered 500, because there is no Supabase); either way Chrome logs a console error. Pre-existing (#81); left for the final review.

**Next**
- Final whole-branch review done and its fixes re-reviewed clean; pull request #86 open, waiting for the owner. Hosting tests 270 of 270 after the fix wave; the full `check:core` was not re-run after the last test fix.
- Owner steps: confirm `APP_ORIGIN` is set for builds in Vercel's environment; indexing turns on only when that origin is `jomcall.com`, so pointing it there is the owner's call; fix the privacy and terms text that says calls "may be recorded" and "Payments are not live yet" (the public pages say calls are not recorded, and legal text was left frozen), and `web/messages/legal.ts:64` (EN and BM), which says businesses use JomCall for "phone calls and WhatsApp messages" and conflicts with WhatsApp waiting for Meta; before indexing moves to jomcall.com, check Search Console for staging (it served `index, follow` from 2026-11-15, and with `Disallow: /` Google cannot recrawl to see noindex), and at the switch 301 staging to jomcall.com; confirm the SST wording on pricing ("before SST"); decide the concurrency default (`JOMCALL_MAX_CONCURRENT_CALLS` is 1, the spec says 2; the copy states no number); have a native BM speaker read the copy; re-record the four demo greetings without "this call may be recorded" (the call card skips line 0 until then). Once they are re-recorded, change the two sample lines that say "Janji temu" in `web/content/public/home.ts` (lines 47 and 373) to "Temu janji"; they stay as they are now because they must match the recordings.

## 2026-11-21: first-run checklist built (branch `feat/first-run-checklist`, not merged)

Design: `docs/superpowers/specs/2026-11-21-first-run-design.md` (pull request #84). Plan: `docs/superpowers/plans/2026-11-21-first-run-checklist.md`. No migration.

**What changed**
- New read `firstRun` (`GET /first-run`, managers only): setup applied, tested, published, plan, phone, and the first answered real call.
- Home's checklist gains step six, "Take your first real call", shown only when a phone line is offered. Home goes live only after that call. The first time, a line links to the call.
- One step list (`web/components/core/home/steps.tsx`) in three places: Home, the setup live page, and a "Getting started: N of M" link in the sidebar.
- After a new workspace is created, the app opens setup. The business-type page asks the owner to confirm the type they picked.
- Review page: a "Your links" card (website, Facebook, Instagram, TikTok, LinkedIn, Google Maps) saved into the `social_links` fact. JomCall checks the text only; it never opens the links.
- The Phone numbers link now goes to `/app/phone-numbers` (it was a dead `/app/phones`).

**Verified (local database, made-up workspace)**
- Typecheck; guards 69 of 69; new and changed tests pass.
- Browser at 375 px, EN and BM, light and dark:
  - a new workspace opens setup on the confirmation heading;
  - the links card saves and survives a reload, and a typed test answered with the stored links;
  - publish, then the live page list;
  - the sidebar link counting up;
  - Home through plan, number (added on the local Phone numbers screen) and a faked answered call (SQL, since deleted);
  - "Show me how" opens the forwarding codes.
- Browser-pass fixes are in commit `868afb5`.

**Not verified**
- No person has used it. Nothing is on hosted staging.
- A real forwarded call has not completed step six.
- The BM links card was not seen in a browser.

**Next**
- Merge needs the owner's yes, through the orchestrating session.
- Website reading (F12) is a separate, later pull request. It is approved with safety guards. When it ships, it goes on the AGENTS.md outbound list.

## 2026-11-20 (afternoon): staging is now production

Owner decision. Read the entry "Staging is production" in `AGENTS.md` before touching the hosted environment: there is no second environment any more, no backups, and every write there is a production change.

- Launch is phone first, by invitation. WhatsApp shows "waiting for Meta's approval" until `WHATSAPP_WAITING_FOR_META` in `web/lib/launch.ts` is set to false.
- Still to build for launch: an operator command that buys a Twilio number and wires it (not started; first check whether Twilio allows numbers under the Digitalize Plus bundle to serve other businesses), prompt fixes from the test call (needs the owner's go for a paid gate run), `jomcall.com` email aliases (Cloudflare Email Routing is already on; the owner's Cloudflare account is not the one connected to the agent's tools).

## 2026-11-20 (midday): Meta App Review submitted

**Submitted** about 11:45 (Asia/Kuala_Lumpur). Status "Review in progress", three permissions. Up to 20 days by Meta's own estimate. Watch the app's contact email and the Alert Inbox in the developer console.

**Do not change until Meta answers**
- The reviewer account (an Admin of the staging workspace, on a plus-address of the owner's mailbox) and its password.
- The staging workspace: Growth plan, WhatsApp test number connected, agent published.
- `https://staging.jomcall.com` reachable; privacy and terms pages at `www.jomcall.com`.

**What was sent**
- Data handling: five processors (Supabase, DigitalOcean, Vercel, OpenRouter, Anthropic), responsible entity Digitalize Plus Enterprise, Malaysia, "No" on national security requests, "None of the above" on policies. The provider names and countries were entered from memory and read by the owner, not checked against the providers' terms.
- Two permission descriptions and reviewer instructions; the wording is in `drafts/meta-app-review.md` (not committed).
- Two videos, kept in `output/meta/` (not committed). Both are step captures without the browser's address bar.

**If Meta sends it back**
- For the videos: the owner records the screen (Cmd+Shift+5) while the steps are driven in the browser; about two minutes each.
- For a number to message: connect a real number through "Connect WhatsApp", or add the reviewer's number to the test number's allowed list.

**Staging state the same day**
- Templates at Meta: `jomcall_reply_request` (ms) and `jomcall_reply_en` (en), both `PENDING`.
- Voice cache: 88 lines for each of Kore, Achird, Charon, Leda, Sulafat (Kore has 90 files). The job that did it is `/root/prewarm-all.sh`, log `/var/log/jomcall-prewarm.log`; run it again after a voice cache volume is lost.
- Firewall: 5060/tcp to Twilio's ranges, no 5060/udp, 10000-10200/udp to `168.86.128.0/18`. If a call connects with no sound, widen that last rule first.
- Twilio account upgraded from trial by the owner. Auto-recharge and a usage alert are the owner's to set.

**Next**
1. One real call that stays on the line: confirms audio through the firewall and whether fillers are heard.
2. Prompt fixes from the test call (the transfer contradiction, the repeated booking offer, shorter WhatsApp replies): one paid gate run for all, on the owner's go.
3. Place names for the speech recogniser; why a booking became a message; first-sound timing on phone calls; a warning when the SIP trunk or dispatch rule is missing.
4. Production: paid database with backups, Curlec approval, the PDPA decision. These, with Meta's answer, are what stands between staging and a paying customer.

## 2026-11-20: first answered phone call

**What happened**
- The owner upgraded the Twilio account. The trial had been the only block (`21264` on 19 Nov with a verified caller).
- 09:54:12 (Asia/Kuala_Lumpur): a call to `+6042253068` was answered on staging. `app.call`: `ended`, `answered`, `hangup`, 63 s, 5 turns, `ms`, disclosure played, `billed_seconds` 63, `usage_state` `billed`. No errors in the voice or agent logs.
- Pull request #58 merged as `7d01e6a`; agent rebuilt on it and healthy; Vercel staging deployed.

**After a restart of the `redis` (Valkey) container**, run on the server, in `/opt/jomcall/infra/hosted`:
`docker compose exec -T -w /app agent node --import tsx scripts/hosted/sip-apply.ts --numbers +6042253068 --allowed 54.169.127.128/30,54.65.63.192/30,54.252.254.64/30,54.172.60.0/30,54.244.51.0/30,54.171.127.192/30,35.156.191.128/30,177.71.206.192/30`
It printed "already there" for both on 20 Nov.

**Next**
1. Owner: cloud firewall for 5060 and 10000-10200/udp. The port is open and was probed on 19 Nov.
2. Owner: Twilio auto-recharge off, usage alert on.
3. Test on real calls: booking with read-back, transfer (needs "Call Transfer (SIP REFER)" and PSTN transfer on the Twilio trunk, and a staff number on the JomCall number), the busy line with two callers, an after-hours call.
4. Listen for delay and cut-offs; the only speed numbers are from the browser path.
5. Something should notice a missing trunk or dispatch rule (today a lost Valkey silently rejects every call).

**Not verified**
- The two screen changes in #58 in a browser. The create path of the SIP command against LiveKit.

## 2026-11-19 (evening): template submit live, phone line switched on, no call answered yet

**Merged that day**: #53 `c8d66cb` (submit a template to WhatsApp), #54 `e9bd321` (Home channel line, invitation message), #56 `2fef3c1` (call repository connects in hosted mode). Open: #55 (Twilio plan, see the correction below).

**Staging now**
- Database: 46 migrations recorded, latest `20261119110000`.
- Images: agent `jomcall-worker:2fef3c1`, engine `jomcall-worker:9e0af3f`, voice `jomcall-voice:66a5b3e`. All healthy at 23:00 (Asia/Kuala_Lumpur).
- `/etc/jomcall/agent.env` has `JOMCALL_TELEPHONY_PROVIDER=livekit_sip`, `LIVEKIT_URL=ws://livekit:7880` and the LiveKit key pair (copied from `voice.env`, never printed). Backup of the file from before: `agent.env.bak-20261119-phone`. `agent.env.phone-attempt` is a copy of the current content.
- LiveKit: inbound trunk `ST_LhsjeYrVVz9K` for `+6042253068`, dispatch rule `SDR_Muu3nfdD7CR4`. Created with `livekit-server-sdk` from inside the agent container (`docker compose exec -T -w /app agent node --input-type=module -`), because the server has no `lk` command line and `npm run telephony:sip-config` refuses any database but the local one. They are lost if the `redis` (Valkey) container restarts: create them again the same way.
- Twilio (trial account): number `+6042253068`, trunk `jomcall-staging`, one origination URI to the server over TCP, recording off, no termination.
- Vercel staging: `JOMCALL_TELEPHONY_PROVIDER=livekit_sip` saved, not deployed.
- Staging workspace `f918361d-014a-499f-9fe1-8c21d3a61012`: Growth plan, WhatsApp test number connected, the Twilio number added, agent published on 19 Nov with hours, 29 facts and one reply rule; two members (owner, reviewer as admin).

**What failed and why**
- First start with the phone line on: the agent stopped with `LOCAL_DATABASE_REQUIRED` and restarted in a loop for about two minutes. Fixed in #56.
- Two test calls: Twilio marked them Failed with 0 seconds and the server's SIP log shows no request from Twilio. First call's error: `21264 From number not verified`, although the caller is a Verified Caller ID. Twilio's pages do not say whether a trial account can send calls to a SIP trunk; the two tests say it cannot.

**Next**
1. Owner: upgrade the Twilio account (card and identity check), then call again.
2. Owner: DigitalOcean cloud firewall for 5060/tcp, 5060/udp and 10000-10200/udp, Twilio's ranges only. Scanners are already probing 5060.
3. Redeploy Vercel staging (choose the staging deployment, not Production).
4. On the first call that reaches the server: read `docker compose logs sip voice agent` and `app.call`. The phone code has never taken a real call.
5. Make the trunk and dispatch rule survive a Valkey restart (a volume, or a script that creates them at start).
6. Meta App Review: owner records two videos, ticks the three agreements, types the reviewer login, answers the Facebook Login question, submits.
7. Owner checks the suggested agent facts and fills refund terms, SST and the summary WhatsApp number.

**Correction to pull request #55** (`docs/research/twilio-staging-plan.md`): its first blocker, "staging has no SIP service", is wrong. The SIP service and Valkey have run on the server since #46. Its other points (the generator refusing staging, the trial account) held.

**Defects seen, not fixed**
- The publish page shows the previous "Published. Your agent now uses these changes." banner before Publish is pressed.
- WhatsApp replies are long unless the workspace adds its own rule; a product-wide change needs a prompt change and a paid gate run.
- `telephony:sip-config` cannot read a hosted database.

**Not verified**
- Any answered phone call. The invitation message for a signed-out visitor in a browser. The reviewer account opening WhatsApp settings. Meta's decision on the submitted template.

## 2026-11-18: WhatsApp re-check of a connected number

Pull request #43, squash-merged to `main` as `5688b5a` on 2026-11-18. Live on hosted staging the same day.

**Done on staging (each step with the owner's yes, 2026-11-18)**
- Migration `20261118100000_whatsapp_recheck.sql` applied before the merge, through Supabase SQL in one transaction with its `schema_migrations` row inserted by hand (44 recorded), not through `npm run hosted:migrate`.
- Vercel staging deployed `5688b5a`; the droplet's agent, engine and voice were rebuilt to image `5688b5a` and are healthy.
- Round trip after the rebuild: inbound stored 20:58:11, agent reply created 20:58:13, `delivered` 20:58:17 (Asia/Kuala_Lumpur).
- Re-check: the owner pressed "Save and check again" with the token blank at 20:59; the channel stayed `connected`, revision 10 to 11, the flag was cleared, no failed reason, no `WHATSAPP_CHECK_FAILED` line. The flag was not observed while set, and the "Checking" text was not seen.

**Changed**
- Saving a connected number again (same phone number ID) keeps it `connected` and sets `recheck_wanted`; the worker checks it again through `app_private.whatsapp_verify`. A failed re-check leaves replies on and stores a reason and time, shown as a warning on the WhatsApp settings screen. A first connect that fails still ends `failed`.
- The worker logs `WHATSAPP_CHECK_FAILED step=<verify|subscribe> reason=... provider=...` (never the token) and, when the check step itself throws, `WHATSAPP_CHECK_STEP_FAILED kind=...`; the tick goes on to replies and sends.
- Migration `20261118100000_whatsapp_recheck.sql` (three columns, the verify function for the agent role only; no constraint ties the flag to the state, so an older web build's Disconnect never fails).
- `SUBSCRIBE_FAILED` text now points at the system user's two assets; go-live notes section 12 records the 2026-11-18 lasting token findings.

**Verified (local database and the fake provider only, 2026-11-18)**
- `npm run typecheck`; `npm run test:guards` 69 of 69; `npm run check:core` 1035 of 1035; `npm run db:verify-migrations` (59 tables with row-level security); `npm run build:hosted`.

**Not verified**
- A failed re-check has not happened on staging, so the warning and its time have not been seen in a browser. Bahasa Melayu text not seen.

**Open**
- Open: a failed re-check has no email and no automatic retry; the screen does not poll.

## 2026-11-18: WhatsApp on hosted staging, first real round trip

Branch `feat/whatsapp-subscribe`, pull request to follow, not merged.

**Done on staging (owner approved D1 for hosted staging on 2026-11-17)**
- `JOMCALL_WHATSAPP_PROVIDER=cloud` plus the three WhatsApp secrets in Vercel staging (owner pasted) and the provider switch plus credentials key in `/etc/jomcall/agent.env` (piped from the owner's file; backup `agent.env.bak-20261117`); agent restarted, `agent: ready`.
- Meta: verified portfolio "Digitalize Plus Enterprise", app "JomCall" (now published), test number, webhook `https://staging.jomcall.com/api/whatsapp/webhook` verified, `messages` subscribed, app subscribed to the business account by hand (`subscribed_apps`).
- Staging workspace: operator credit RM 129.00 and Growth plan started by SQL (audit row written); WhatsApp agent entitlement on.
- Round trip at 12:49 on 2026-11-18 (Asia/Kuala_Lumpur): inbound text stored, agent turn completed in about 3 s, reply `sent`, one status event, one usage window.

**Changed in code (this branch)**
- The worker subscribes the app to the business account after the number check; a failure leaves the channel failed with `SUBSCRIBE_FAILED`, `META_190` or `PROVIDER_UNREACHABLE`, explained on the settings page in EN and BM.
- The WhatsApp settings form opts out of password managers and autofill; the token field is a CSS-masked text input; pasted tokens are trimmed.
- Go-live notes section 12 records what was seen against Meta.

**Verified**
- Implementer and fixer: `npm run typecheck`; `npm run test:guards` 69 of 69; `npm run check:core` 1022 of 1022; `npm run build:hosted`. Independent review: no critical issue; its one important finding (raw Meta code shown for a missing permission) is fixed.

**Not verified**
- The automatic subscribe has not run against Meta. The form change has not been seen in a browser with a password manager.
- Against Meta: templates, `listTemplates`, STOP and staff keywords, media, inbox staff replies. Reply wording was seen by the owner only.

**Next**
- Owner: a system user token (the stored one is short-lived and will fail with Meta error 190); decide whether a failed re-check should stop ignoring incoming messages; Tech Provider registration and App Review before other businesses can connect.
- After merge: rebuild the agent on the server and let Vercel redeploy.

## 2026-11-17: gates and second browser check after the agent page merge

`main` at `7888aaf`. Records only; no code change.

**Done**
- Typed gate (`npm run check:hosted-model`): 47 of 48, no safety flag; miss `en-07` (English request answered in Bahasa Melayu after tools). Spoken gate (`npm run check:voice-model`): 47 of 48, no safety flag; miss `manglish-07` (asked before recording, per the read-back rule). One run each, paid.
- The gate fixtures carry no opening hours: the hours block was not in any gate prompt.
- Browser, local app, made-up workspace: skip a question, Answered tab, knowledge and More views, restore, closed date, second branch, staff account (published summary and read-only hours only; billing refused for staff). Owner plan card in its "choose a plan" state. WhatsApp settings in practice mode (fake provider): connect form, "Checking the number", template section and add-template form.

**Not done**
- No model turn asked the opening hours.
- Plan card: unpaid warning, stopped notice and top-up retry not seen. Setup import limits ("Reading is busy", store full) not seen.
- WhatsApp: synced template states, switch off and on, and media lines in the inbox not seen (they need the agent worker running against the fake provider).
- No person has used any of it; nothing on hosted staging.

**Next**
- Owner: staging catch-up (pull `main`, `npm run hosted:migrate`, a plan for every workspace, rebuild web, agent, engine, voice).
- Small fixes seen in the browser and left: language switch drops the view hash; "Saved to local workspace." after a restore; the recording checkbox's accessible name.
- Local leftovers: workspace "Kedai Contoh QA" (owner and staff test accounts, two branches, a connected practice WhatsApp number) in the shared local database; launch entries `agent-page-local`, `agent-page-mock`, `agent-page-local-wa` in the main checkout's `.claude/launch.json` (ignored by git).

## 2026-11-17: one-page agent screen (item 17)

Pull request #37, squash-merged to `main` on 2026-11-17 as commit `7624890` (5 of 5 checks passing). Nothing on hosted staging yet. No migration.

**Changed**
- `/app/agent` is one page for owners and admins: home, `#questions`, `#knowledge`, `#hours`, `#greeting`, `#more`, `#publish` (`web/components/core/agent/`). Settings autosave through `web/lib/core/save-queue.ts`.
- Opening hours frozen into published versions and draft tests and written into the prompt (`packages/domain/src/knowledge/hours.ts`); old snapshots unchanged.
- `agentChanges` read and a change token checked by `publish` (`packages/domain/src/agent-changes.ts`); `CHANGES_MOVED` (409).
- Gap list: `status` filter, channels, saved answer.
- `/app/hours` redirects to `/app/agent#hours` outside the mock preview. Branch editing moved to Settings, Business. Old `agent.tsx` and the local hours screen deleted.
- Next 16.4.1 to 16.4.6 (owner instruction; 16.4.1 stopped its own build with a security notice). The worktree has a real `node_modules`, not a symlink.

**Verified (2026-11-17, local database and fakes only, at `6079064`)**
- `npm run typecheck`; `npm run test:guards` 69 of 69; `npm run check:core` 1008 of 1009 (known flickering `tests/local/model.test.mjs` "runtime ownership" only; passed alone 2 of 2); `npm run db:verify-migrations` (59 tables with row-level security); `npm run build:local`, `npm run build:mock`, `npm run build:hosted`.
- Browser, local app, 390 px, made-up workspace, owner account: first publish; greeting autosave; missing-disclosure message; hours change named on the publish sheet; stale publish refused then accepted; stale second tab told and its typed text kept; `/app/hours` redirect; mock hours page unchanged; Bahasa Melayu and dark theme on home and hours; audit list; a seeded question answered, kept across a view change, saved and listed for publish.

**Not verified**
- No person has used it. Staff view, knowledge and More views, restore, "+ Branch", closed dates, skipped and answered tabs, a real phone keypad and a screen reader were not seen in a browser.
- No published test turn was asked the opening hours (paid model call).
- Typed and spoken 48-case gates not re-run.

**Next**
- Owner: rebuild web, agent, engine and voice on staging; no migration. The two paid gates (design section 11) were not run before the merge, by the owner's choice, and are still owed.
- Known limits and every deviation: `NOTES.md` (2026-11-17) and the build note in `docs/superpowers/specs/2026-11-16-agent-page-design.md` section 13.
- Local leftovers: a made-up workspace "Kedai Contoh QA" with two seeded questions in the shared local database; launch entries `agent-page-local` and `agent-page-mock` in the main checkout's `.claude/launch.json` (ignored by git).

## 2026-11-16 — WhatsApp template check after review

Branch `feat/whatsapp-sync`, pull request not yet open, not merged. Nothing on hosted staging. Fake WhatsApp provider only; the Cloud API is still not approved and nothing reached Meta.

**Changed**
- Controller's SQL (`20261116150000_whatsapp_template_sync.sql`, commit `ae7658c`): a missing template is flagged `NOT_FOUND`, not disabled (a short list must not silently stop the fallback; sending a deleted one fails in the open); a result applies only to its own claim (`wabaId` + `revision`, else `TEMPLATE_SYNC_STALE`); duplicates or over 1000 items `TEMPLATE_LIST_INVALID`; status names must be upper case; `whatsapp_template.disabled_by_staff`.
- Worker: sends `wabaId`/`revision` back in every result; 20 s deadline on the whole list (`TEMPLATE_LIST_TIMEOUT`, injectable timer); sync moved to the end of `tick()`. Cloud client: abort signal stops paging; one malformed item fails the whole list; no upper-casing.
- PATCH: `disabled` always allowed (sets `disabled_by_staff`); any other status on a staff-disabled template switches it on (synced: provider's last mapped status via `providerStatusMap`, `NOT_FOUND`/unmapped stays disabled; unsynced: status asked for). The web role cannot update `whatsapp_channel.templates_synced_at` (checked with `has_column_privilege`), so switching on waits for the next hourly check. Read returns `disabled_by_staff`.
- Screen: Switch off / Matikan (confirm in place), Switched off by your team / Dimatikan oleh pasukan anda, Switch on / Hidupkan, Checking with WhatsApp… / Sedang menyemak dengan WhatsApp…, reworded NOT_FOUND line, "Not listed by WhatsApp…" / "Tidak disenaraikan oleh WhatsApp…". Rules in `web/lib/core/whatsapp-template-rules.ts`.
- Customer file names cleaned (control and bidi characters; `cleanFileName` shared with setup uploads) at parse time and on read (inbox, PDPA export).
- Reactions are ignored, so a reaction no longer counts as the customer's last message for the 24-hour window; unverified whether Meta counts it.

**Verified (2026-11-16, local database and fakes only)**
- `npm run typecheck` passes; `npm run test:guards` 69 of 69 on the rerun (first run 68 of 69, only the known flickering `tests/local/model.test.mjs` runtime-ownership guard); `tests/domain/whatsapp.test.ts` 16 of 16, `tests/domain/whatsapp-template-rules.test.ts` 2 of 2, `tests/engine/whatsapp-flow.test.ts` 37 of 37, `tests/engine/privacy.test.ts` 1 of 1; `npm run check:core` 871 of 871; `npm run db:verify-migrations` passes (59 tables with row-level security); `npm run build:local`, `npm run build:mock` and `npm run build:hosted` pass.

**Next**
- Owner: apply the amended migration on staging (never applied there yet), rebuild `agent` and web.
- No browser check of the new screen states; nothing against Meta.

## 2026-11-16 — WhatsApp template status sync and media in the inbox

Branch `feat/whatsapp-sync`, pull request not yet open, not merged. Nothing on hosted staging. Built and tested against the fake WhatsApp provider only; the Cloud API is still not approved and `listTemplates` has never reached Meta.

**Changed**
- Migration `20261116150000_whatsapp_template_sync.sql` (controller's; applied to the shared local database): template and channel sync columns and `app_private.whatsapp_template_sync` (agent login role only).
- Provider port `listTemplates`; Cloud client reads `GET /<WABA_ID>/message_templates` (UNCONFIRMED; cursor paging built locally; more than 10 pages or 1000 templates is a failure); fake `setTemplates` / `failTemplates`.
- Worker `syncTemplatesOne()` from `tick()`, at most once a minute per process; logs `WHATSAPP_TEMPLATE_SYNC_<code>` only.
- Absent-template rule: a template never seen at the provider and missing from its list is left as staff set it; one seen there before and now gone becomes `disabled` with `provider_status` `NOT_FOUND` (screen: "No longer found at WhatsApp" / "Tidak lagi ditemui di WhatsApp") and is mapped normally if a later list has it. `claim` sets reason `TEMPLATE_SYNC_PENDING` until `result` clears it or replaces it with the failure code.
- Settings screen: "Status from WhatsApp, checked …" / "Status daripada WhatsApp, disemak …"; "WhatsApp says: …" / "WhatsApp menyatakan: …" for an unmapped name; manual approve/reject hidden for synced templates; "Checked with WhatsApp …" / "Disemak dengan WhatsApp …" or "Could not check with WhatsApp. Statuses below may be out of date." / "Tidak dapat menyemak dengan WhatsApp. Status di bawah mungkin sudah lapuk." Manual PATCH on a synced template answers 409 `CONFLICT`.
- Webhook parser drops reactions and keeps `media.kind`; conversation read and PDPA export carry media `{kind, filename}` only (`packages/domain/src/whatsapp/media-sql.ts`); inbox labels media (Photo/Gambar, Voice or audio message/Mesej suara atau audio, Video/Video, Document: name/Dokumen: name, Sticker/Pelekat), one "does not download files" line, and "Message type JomCall cannot show" / "Jenis mesej yang JomCall tidak dapat paparkan".
- Docs: AGENTS.md, WhatsApp design (§3, §5, O4, O8, §14 as built), go-live step 11.

**Verified (2026-11-16, local database and fakes only)**
- typecheck: pass. guards: 69 of 69. `tests/domain/whatsapp.test.ts` 13 of 13; `tests/engine/whatsapp-flow.test.ts` 31 of 31. check:core: 860 of 860. verify-migrations: pass (59 RLS tables). build:local, build:mock, build:hosted: pass.
- The mock bundle contains the new settings and inbox text, as it already contains the existing WhatsApp settings and inbox screens (static imports in `web/components/core/local-app.tsx`; setup is the only screen gated out). Not changed here. `tests/local/whatsapp-guard.test.mjs` passes (web never imports the Cloud client).

**Next**
- Owner: apply migration `20261116150000_whatsapp_template_sync.sql` on staging (`npm run hosted:migrate`), then rebuild `agent` and web.
- A channel saved without an access token is never synced (claim needs stored credentials).
- No browser check of the settings or inbox changes yet; nothing against Meta.

## 2026-11-16 — stored-upload ceiling and 7-day deletion

Branch `feat/reading-limits`, pull request #35, not merged. Nothing on hosted staging. Owner decision 2026-11-16: uploads stay in Postgres for now (Supabase Storage waits for real volume or a paid plan); instead a ceiling on stored upload bytes and deletion of file bytes after 7 days (was 30).

**Changed**
- Migration `20261116140000_setup_read_limits.sql` (controller's): `app.setup_read_limit.stored_bytes_max` (default 157286400, 150 MiB), `app_private.setup_upload_room(bytes)` (web role), `app_private.setup_bytes_notice()` (worker role), retention 7 days (existing rows moved).
- `createSetupUpload` and `pasteSetupText` (`packages/domain/src/setup/uploads.ts`): after the per-setup and per-workspace caps, refuse with `UPLOAD_STORE_FULL` (503) when there is no room. Advisory: two racing uploads may both pass.
- Screen (`web/components/core/setup/rules.ts`): EN "JomCall cannot take new files right now. Answer the questions instead, or try again tomorrow." / BM "JomCall tidak dapat menerima fail baharu buat masa ini. Jawab soalan dahulu, atau cuba lagi esok."; the review page drops the first half of the offer ("… Try again tomorrow." / "… Cuba lagi esok."). No Retry button.
- Bring stage Anthropic notice: 7 days / 7 hari.
- Engine: `noticeBytesCeiling` beside `noticeReadCeiling` (own timer, same hourly cadence and retry); logs `SETUP_BYTES_CEILING stored=… max=…`; emails `JOMCALL_OPERATOR_EMAIL` (operation id `setup-bytes-ceiling-<day>`); `SETUP_BYTES_CEILING_CHECK_FAILED` / `SETUP_BYTES_CEILING_MAIL_FAILED`. Mail text in `engine/src/read-ceiling.ts`; MB are whole numbers rounded down.
- Tests: API ceiling test (commits a lowered `stored_bytes_max` for the one test and restores it in `finally`; test files run one at a time), DB notice test (rolled back), engine notice tests, 7-day retention test (kept at 6 days, swept after 7).
- Docs: AGENTS.md, setup flow design (decision 1 and reading limits), RUNBOOK step 12 item 5.

**Verified (2026-11-16, local database and fakes only)**
- typecheck: pass. guards: 69 of 69. check:core: 844 of 844 on the rerun (first run 843 of 844, only the known flickering `tests/local/model.test.mjs` runtime-ownership guard). verify-migrations: pass (59 RLS tables). build:local, build:mock, build:hosted: pass; the mock bundle has none of the new screen text.

**Next**
- Owner: apply the migration on staging; optionally set `JOMCALL_OPERATOR_EMAIL`; change the ceiling with SQL if needed (RUNBOOK step 12).
- No browser check and no real email yet.

## 2026-11-16 — document reading limits

Branch `feat/reading-limits`, pull request not yet open, not merged. Nothing on hosted staging. Owner decision 2026-11-16: reading stays free, with lower caps.

**Changed**
- Migration `20261116140000_setup_read_limits.sql` (controller's): `app.setup_read_limit` (one row, `daily_reads` default 300), a ceiling check at claim (files stay `queued`), fair order (fewest reads started in the last hour first), `first_claimed_at`, and `app_private.setup_read_ceiling_notice()` for the engine (worker role only).
- Workspace cap 20 to 10 files in 24 hours (`UPLOAD_LIMITS.perOrgPerDay`); the bring stage and refusal copy read the number from the constant.
- Engine: hourly ceiling check as its own step after the plan charge pass (`noticeReadCeiling` in `engine/src/engine.ts`, mail text in `engine/src/read-ceiling.ts`); always logs `SETUP_READ_CEILING started=… ceiling=… waiting=…`; emails `JOMCALL_OPERATOR_EMAIL` (new optional engine setting, validated at start and by `hosted:readiness`) once per Kuala Lumpur day; send failure logs `SETUP_READ_CEILING_MAIL_FAILED`, not retried that day; check failure logs `SETUP_READ_CEILING_CHECK_FAILED` and retries after 5 minutes.
- Setup screens: a file this browser has seen queued for more than 2 minutes says "Reading is busy right now. Your file is in the queue; you can answer the questions meanwhile." (BM: "Bacaan sedang sibuk sekarang. Fail anda dalam giliran; anda boleh jawab soalan dahulu."); the review page drops the offer. Uses the browser's own first-seen time, not the server's `createdAt`; a reload restarts the two minutes.
- Docs: AGENTS.md, setup flow design §12, RUNBOOK step 12 item 5.

**Verified (2026-11-16, local database and fakes only)**
- typecheck: pass. guards: 69 of 69. check:core: 836 of 837 after merging `main` (the known flickering `tests/local/model.test.mjs` runtime-ownership test, in both full runs; passes alone). verify-migrations: pass (59 RLS tables). build:local, build:mock, build:hosted: pass.

**Next**
- Owner: apply the migration on staging; optionally set `JOMCALL_OPERATOR_EMAIL` in `engine.env`.
- Known limit: while the ceiling holds, a queued file whose setup was saved stays queued (counted in `waiting`) until the next claim fails it `SESSION_CLOSED`.
- Uploads still live in the database; Supabase Storage is a separate change. No browser check and no real email yet.

## 2026-11-16 — plan picker leftovers

Branch `feat/plan-leftovers`, pull request not yet open, not merged. Nothing on hosted staging.

**Changed**
- Migration `20261116130000_plan_notices.sql` (by the controller): `queue_plan_notices` queues owner emails about the fee (`PLAN_FEE_DUE`, `PLAN_FEE_UNPAID`, `PLAN_STOPPED`) on the refusal-email queue; `billing_notice_payload` carries plan, amount, balance and dates; `plan_entitlements` follows the late-clock rule.
- After an independent review: unpaid is queued only while the wallet is short and grace has not ended; stopped only while on pay as you go and within two days of grace ending; fee due at the price in force on the due day; one organization's failed insert does not stop the others. `billing_notice_payload` checks each plan notice again at send time and marks it `skipped` when no longer true; the email carries the plan, fee and balance true then, plus `whatsappAgent`. Emails name WhatsApp only when the plan includes it, name the page Billing / Bil & penggunaan, and the BM wording was revised.
- Engine: the hourly run calls `queue_plan_notices` after its charging pass (failure logs `PLAN_NOTICE_RUN_FAILED`, stops nothing); `engine/src/billing-notice.ts` parses the payload with zod and writes the three emails, English then BM, RM amounts, "16 Dec 2026" / "16 Dis 2026".
- Operator `plan` command (`scripts/billing/plan-admin.ts`) mirrors `choose_plan`: starts a first paid plan today with the fee, refuses a short wallet with exit 1 and no change, schedules changes from a paid plan. Tests compare it with `choose_plan` side by side.
- Tests: `tests/billing/plan-notices.test.ts`, `tests/billing/plan-admin.test.ts`, `tests/engine/billing-notice.test.ts`, late-clock admission in `tests/billing/plans.test.ts`, notify timing in `tests/engine/plan-charge.test.ts`.
- Docs: AGENTS.md, billing design §13 (leftovers note, operator command), RUNBOOK step 13.

**Verified (2026-11-16, local database, Mailpit and fakes only)**
- After the review changes: typecheck: pass. guards: 69 of 69. plan-notices + engine billing-notice tests: 20 of 20. check:core: 814 of 815 on two runs (intermittent `tests/local/model.test.mjs` "runtime ownership"; passed alone 2 of 2). verify-migrations: pass (58 RLS tables). build:hosted: pass (build:mock not re-run).

**Next**
- Owner: apply migration `20261116130000_plan_notices.sql` on staging BEFORE rebuilding the engine (RUNBOOK step 13); without it the hourly run logs `PLAN_NOTICE_RUN_FAILED` and sends no fee emails.
- The first hourly run after deploy emails owners whose plan is unpaid in grace, and those whose plan stopped in the last two days. Do not roll the engine back to a build from before this change while plan notices are queued (the old sender does not know the `plan` channel).
- No real mail service was used and no person has read the emails; someone should read all three in both languages.
- Open the pull request.

## 2026-11-16 — plan picker, after review

Branch `feat/plan-picker`, pull request not yet open, not merged. Nothing on hosted staging.

**Changed**
- Migration `20261116120000_plan_picker.sql`: a first paid plan starts now with the full fee and a new monthly date, or not at all on a short wallet (`wallet_short`); changes between plans wait for the next period; a credited top-up retries an unpaid fee; `charge_plan_period` never creates a period before the monthly date and a paid plan waiting on a payg row starts only with the fee (`billing.plan_start_skipped` otherwise); new `plan_orgs_due` for the engine.
- Engine: lists due organizations hourly and charges each with `charge_plan_period` in its own transaction (1 s lock timeout, 25 per tick, rest carried over; failures log `PLAN_CHARGE_RUN_FAILED ok=<n> failed=<n>` and retry after 5 minutes). `charge_due_plans` is manual only.
- Web: plan card on `/app/billing` (one idempotency key per plan code, kept only when no answer came from JomCall; a paid plan with no period yet shows the first-fee line), BM wording fixes, link on setup's finish stage.
- Docs: AGENTS.md, billing design §12 and §13 (plan picker note), RUNBOOK step 13, web README.

**Verified (2026-11-16, local database and fakes only)**
- typecheck: pass. guards: 69 of 69. check:core: 788 of 788. verify-migrations: pass (58 RLS tables). build:local, build:mock, build:hosted: pass.
- Browser check by the controller at 390 px (English, BM, dark) before this review's card changes; those changes are unit-tested only.

**Next**
- Owner: apply the migration on staging BEFORE the engine is rebuilt (the new engine calls `plan_orgs_due`); RUNBOOK step 13 has a read-only query to run first.
- **Warning for the owner:** the first hourly pass after deploy charges or downgrades every organization that has a plan row, including ones with no traffic yet. An organization whose period began more than 7 days ago with a short wallet falls back to pay as you go at once, without an email.
- Open the pull request; a person should try the unpaid warning, the stopped-plan notice, the top-up retry and the staff view.

## 2026-11-16 — billing follow-ups after the channel metering review

Branch `claude/billing-followups`, pull request open (not merged). Pull request #26 is merged (`99b9b43`) and its migration is on staging, so `20261115123000_channel_metering.sql` must not be edited.

**Changed**
- Migration `20261116100000_channel_admission_timeout.sql` (re-runnable, guarded on the function's `lock_timeout` setting): `channel_admission` gets `lock_timeout = 500ms`, scoped to the function. A held `wallet:` lock now costs other organizations' call starts at most about 500 ms; the waiting call is answered as `BILLING_CHECK_FAILED` (owner decision A) when its period is due, or normally when the charged period can still be read.
- Voice worker: the background answer report is cancelled at call end, not awaited (it could add about 10 s to a quick hang-up's bill and keep the line busy).
- `tests/db/signup-invited.test.ts` checks for the function itself, not only a migration record.
- Billing design §4 and §13: WhatsApp re-check after the window (awaiting the owner), what staff can and cannot see, new known limits with bounds.

**Every organization needs a plan.** Since pull request #26, an organization without a plan is refused on the phone line (`NO_PHONE_ENTITLEMENT`) and gets no WhatsApp agent replies (`NO_WHATSAPP_ENTITLEMENT`), and its owners get one email a day per reason, until an operator sets a plan: locally `npm run billing:admin -- plan <org id> <starter|growth|payg> "<operator>"`; on staging the owner runs the equivalent SQL from pull request #26 as the database owner (the script refuses any database but the local one).

**Verified (2026-11-16, local database and fakes only)**
- typecheck: pass.
- guards: 55 of 55 (after merging main at 71b2bb2).
- check:billing: 63 of 63 (3 new in `admission-timeout.test.ts`).
- check:core: 569 of 569 (after merging main at 71b2bb2).
- verify-migrations: pass (scratch replay, 56 RLS tables).
- build:hosted: pass.
- voice pytest: 295 passed (1 new).
- The new migration is applied to the shared local database with psql (no `schema_migrations` row) and was run twice to check it is re-runnable. Without it, the new timeout tests fail (call starts take about 6.7 s).

**Not verified**
- Not applied to hosted staging (owner step: `npm run hosted:migrate`).
- No carrier or real call; the worker change is covered by a fake call only.

**Awaiting the owner**
- WhatsApp thread unanswered after its window ends on an exhausted wallet or removed entitlement.
- Allowance not reserved for calls in progress (bound RM3.20 at one line and 600 s); period-boundary calls billed as overage; window-edge WhatsApp send opens a 15 sen window unchecked.

## 2026-11-15 — setup document import door

Branch `feat/setup-import` (pull request not yet open; the controller opens it). Plan: `docs/superpowers/plans/2026-11-15-setup-flow-import.md`. Reading evidence: `docs/qa/2026-11-15-setup-reader.md`. Design note: end of `docs/superpowers/specs/2026-11-14-setup-flow-design.md`.

**Changed**
- Migrations `20261116110000_setup_uploads.sql` and `20261116110100_setup_read_worker.sql` (re-runnable).
- Upload commands (create, chunk put and get, finish, paste text, remove); uploads kept in Postgres in chunks. A file's bytes are deleted 30 days after it was added, or at once with Remove; Remove on a file also deletes its unconfirmed and removed rows. Rows and details read from a file stay in the setup's staging table after the setup is saved: confirmed ones become catalogue rows, and the staged copies remain until the agent or organization is deleted.
- The reader (`packages/inference/src/setup-reader.ts`): photos and PDFs read twice, disagreements flagged; CSV and pasted text read once; no .xlsx (owner decision).
- The read worker in the agent process (`engine/src/agent/setup-reader.ts`), behind the new switch `JOMCALL_SETUP_READER` (`disabled` default, `anthropic`).
- Price rows through the review page and apply (one planner, `packages/domain/src/setup/rows.ts`); the bring stage and price table in `web/components/core/setup/`.
- `npm run check:setup-reader` (needs `--paid` for any model call) with 15 made-up documents.
- Final review fixes (2026-11-16): main merged in; the two migrations renamed to sort after `20261116100000`; an import fact flagged for checking no longer hides its interview question or fills its fact; a fact edit cannot set `uploadId`; Remove on a file deletes that file's unconfirmed and removed rows; a delimited file over 1 MiB is refused at finish (`UPLOAD_TOO_LONG`) before it is read; uploads still queued or being read when setup is saved fail `SESSION_CLOSED`; a database error on storing a read releases the upload for another try (only a refusal fails it). Screen: senders stop when setup is saved; the save question is asked again when a named file finishes or more prices would be saved; this window's own Remove is not "changed in another window"; the reader's fixed reasons are shown in Bahasa Melayu; refusals after leaving the bring stage are named on the interview and review pages; `check:setup-reader --out` must point inside `output/setup-reader/`.

**Verified (2026-11-15; commands re-run 2026-11-16)**
- Verified on 2026-11-16 after merging `main`: `npm run typecheck`, `npm run test:guards` (69 of 69), `npm run check:core` (762 of 762), `npm run db:verify-migrations` (58 tables with row-level security), `npm run build:local`, `npm run build:mock`, `npm run build:hosted`.
- Browser check, local app, 390 px, English, reader on, fake workspace: three documents (a photo, a CSV and pasted text) were all read within about 30 seconds; review page, double tap, price edit, Remove and Undo, apply question; a draft test answered a price from the new rows.
- Three paid reading runs on 15 made-up documents, 57 model calls. In run 1, two documents had real wrong prices with no flag (three rows); the script counted four. Run 3 was clean: no wrong or unsure price unflagged; 34 of 250 rows flagged.

**Not verified**
- No person has used it. No real phone photo, handwriting or blur. Each paid run was done once, so how often a wrong price recurs is unknown. The double read's catch of a slipped line is shown by unit test only. Two reads that slip the same way are not caught. CSV and pasted text are read once.
- None of the fix-wave screen changes (Bahasa Melayu reasons, notices after leaving the bring stage, "Back to your answers", stopping uploads at save) was checked in a browser.
- Bahasa Melayu and dark theme on the new pages, View file, bulk remove, file-group remove, conflicts, duplicates, a real phone, upload interruption and retry, the feel of the half-second tap guard.
- Nothing ran on hosted staging. The 48-case gates were not re-run.
- Whether uploads must be covered by PDPA export and delete (a lawyer's question). No screen removes uploads after setup is applied (the server allows it).

**Next (owner steps; never run by us)**
1. Apply the two new migrations to staging from the clean release folder: `npm run hosted:migrate` (see `infra/hosted/RUNBOOK.md` step 12).
2. Confirm in the SQL editor, with the runbook's role query, that `jomcall_agent_jobs` has `rolbypassrls = true` before relying on the reader there.
3. Set `JOMCALL_SETUP_READER=anthropic` for the web service in Vercel staging and for the agent on the server; if `ANTHROPIC_API_KEY` is not already set for the agent, add it. Then rebuild.
4. Try the bring stage on staging with made-up documents only.
5. Decide about the deferred items in the ledger (see the design note), for example a prompt line "each quantity tier is its own row", and a real-photo check.

## 2026-11-15 — WhatsApp inbox review fixes

Branch `claude/whatsapp-inbox-341dbf`, pull request #25 (not merged). All 15 review points; list in `docs/superpowers/plans/2026-11-15-whatsapp-inbox.md` ("Review fixes").

**Changed**
- `replyConversation` refuses hard refusals before storing (`DO_NOT_CONTACT`, `OPTED_OUT`, `CONSENT_REQUIRED`, `CONTACT_UNAVAILABLE`, `REPLY_REQUEST_SENT`, 409); the worker stays the final gate. Owner may overrule.
- Outlook SQL shared with `send_claim` (`packages/domain/src/whatsapp/send-facts-sql.ts`, drift guard), database clock; messages gain `reply_request`.
- Screen: one idempotency key per draft, last-four masking, poll sequence counter, byte counter, header errors, caps notes, Back returns to the list, BM wording. Pure rules in `web/lib/core/inbox-rules.ts`.
- `tests/engine/whatsapp-flow.test.ts`: the no-consent staff reply now expects a 409 `CONSENT_REQUIRED` instead of a stored blocked message.

**Verified (2026-11-15)**
- `npm run typecheck` pass; `npm run test:guards` 45 of 45; `npm run build:local`, `build:mock`, `build:hosted` pass.
- `tests/domain/whatsapp-inbox-rules.test.ts` 6 of 6. `tests/api/whatsapp-inbox.test.ts` 10 of 12 subtests: the two failing need an agent reply and fail on the shared database's metering migration (as before).

**Not verified**
- `tests/engine/whatsapp-flow.test.ts`: its edited subtest cannot reach the edited lines on the shared database (an earlier agent-reply subtest fails on metering and leaves do-not-contact on). Covered instead by the inbox API test's `CONSENT_REQUIRED` refusal.
- Merge step: after the metering pull request (26) merges, rebase and call `entitle()` for the inbox test's organization.

## 2026-11-15 — WhatsApp inbox screen

Branch `claude/whatsapp-inbox-341dbf`, pull request #25 (not merged). Plan and deviations: `docs/superpowers/plans/2026-11-15-whatsapp-inbox.md`.

**Changed**
- `conversation` read (`packages/domain/src/whatsapp/routes.ts`, type in `packages/contracts/src/whatsapp.ts`): adds `compliance` (do-not-contact, pending deletion, latest WhatsApp consent for service and marketing), `reply_outlook` (`decideSend` on the facts the worker's `send_claim` reads) and per-message `notice` and `disclosure`. No new command, no migration, no engine change.
- `web/components/core/inbox.tsx`: the inbox at `/app/inbox` in the local and hosted apps. The Inbox sidebar entry is hidden unless `channels.whatsapp` is true.
- Tests: `tests/api/whatsapp-inbox.test.ts` (10 cases), `tests/local/whatsapp-inbox.test.mjs` (8 guards).

**Verified (2026-11-15)**
- At the final commit: `npm run typecheck` pass; `npm run test:guards` 42 of 42; `npm run build:local`, `build:mock` and `build:hosted` pass.
- `npm run check:core`: 443 of 492, 49 failing, all on the shared local database after the usage-metering session applied its `20261115123000_channel_metering.sql` there directly (functions `channel_admission`, `call_bill`, `conversation_bill`, not in this branch; its note says a WhatsApp agent reply or a phone call on an org without a plan now fails). The failures are phone-line, core-tools and WhatsApp agent-reply tests; two are in `tests/api/whatsapp-inbox.test.ts` (the two subtests that need an agent reply). That file passed 10 of 10 at commit `3c3b258`, before the metering migration was on the database. Whichever branch merges second must give the inbox test's org a plan (the metering branch adds `entitle()` in `tests/helpers/billing.ts`).
- Browser, built-in pane, local app on 4182 with `JOMCALL_WHATSAPP_PROVIDER=fake`, the agent process with `JOMCALL_MODEL_PROVIDER=disabled`, a fake workspace and three fake customers sent with `npm run whatsapp:simulate`: the not-connected state; the list in the server's order with needs-staff reasons; a chat with the handoff and AI introduction system lines; a staff reply inside the window (sent); the outside-window outlook with Send disabled (window aged with SQL on the local database); a reply blocked by the agent process with `WINDOW_CLOSED` (agent paused, reply queued, window aged, agent restarted); STOP with the opt-out line and consent shown as opted out; take over and hand back; resolve with its confirm step and the resolved state; the contact link. Combinations seen: list in English at desktop and BM at 375 px; chat in English at desktop and BM at 375 px; reply inside the window, outside-window outlook and the `WINDOW_CLOSED` refusal in English at desktop and in BM at 375 px (outlook and refusal only; no BM send); opt-out in BM at 375 px and English at desktop; take over and hand back in BM at 375 px; resolve in English at desktop; one dark-theme look in English at desktop. No console errors; no horizontal scroll at 375 px.

**Not verified**
- No person has used the screen. The empty inbox, loading and error-with-retry states, the 403 message and the open-proposals line were not seen in a browser (guard tests and API tests cover their wording and behaviour). The fallback template replacing a reply was tested by API only, not in the browser. No agent reply from a model was seen (the model was disabled; the agent was not published).
- Nothing ran on hosted staging.

**Next**
- Calls in the same Inbox timeline (`screens.md`), acting on agent proposals from a chat, unread tracking if owners ask for it.

## 2026-11-15 — usage metering and plan entitlements on the real channels

Branch `claude/usage-metering-e13eb4`, pull request #26 (not merged). Design: billing design section 13. Revised after review, then for four owner decisions (A-D), the same day.

**Changed**
- Migration `20261115123000_channel_metering.sql` (re-runnable). It patches `app_private.agent_call`, `app_private.whatsapp_work` and `app_private.claim_outbox`, and adds `channel_admission`, `call_bill`, `whatsapp_window_bill`, `queue_billing_notice`, `billing_notice_payload`, `ack_billing_notice` and the tables `app.whatsapp_usage_window` and `app.billing_notice`.
- **Phone:** bills `voice_second` once per call (`call:<id>`) when it ends, through `call_end` or `maintain`, priced at the answer.
  - A lost answer report is covered: the first turn sets `answered_at`, and the voice worker retries the report three times in the background.
  - A crashed call stops at the end of its last turn (`call_turn.completed_at`).
- **WhatsApp (decision D):** bills `whatsapp_conversation` once per customer (contact and channel) per 24 hours. The window starts when an agent message's `sent` is recorded while none is open; key `wa:<channel>:<contact>:<start seconds>`; resolve and reopen inside it does not bill again.
- **Admission** runs after every other refusal and never raises.
  - Refusals: no entitlement, then wallet unfunded or exhausted. Phone: refused silently. WhatsApp: turn skipped, conversation flagged, nothing sent.
  - **Decision A:** a failed check admits; `BILLING_CHECK_FAILED` goes on `app.call.billing_check` or `app.conversation_turn.billing_check` and in a database warning; still metered.
  - **Decision B:** phone is admitted while a charged period has unused included minutes, whatever the wallet. WhatsApp unchanged.
  - **Decision C:** the four plan or wallet refusals queue one owner email per org, reason and KL day through the engine outbox (kind `billing.refusal_notice`; `engine/src/billing-notice.ts`). The agent process never sends mail and its login role gained nothing.
- **Roles:** the agent login role lost `record_usage`, `wallet_state` and `plan_entitlements`. The web role lost the billing columns on `app.call` (column grants) and has no access to the two new tables. `app.conversation` grants are unchanged.
- **Operator commands:** `npm run billing:admin -- plan <org> <code> "<operator>"` (the only way to give a workspace a plan until the plan picker, branch `feat/plan-picker`, 2026-11-16); `usage-pending` (owed calls and windows, plus check-failed calls and turns of 7 days) and `usage-retry <call or window id>`. All local only; on staging the owner uses the SQL in the pull request body.

**Verified (2026-11-15, fakes, local engine, local mail catcher and local database only)**
- typecheck: pass.
- guards: 34 of 34.
- check:core: 506 of 506.
- check:billing: 59 of 59 (phone-metering 21, whatsapp-metering 12).
- verify-migrations: pass (scratch replay, 56 RLS tables).
- build:hosted: pass.
- voice pytest: 287 passed.
- The migration is applied to the shared local database with psql, with no `schema_migrations` row. The earlier version was reverted by text first.

**Not verified**
- No carrier, Meta, payment provider or real mail service was called.
- Not applied to hosted staging (owner step: `npm run hosted:migrate`).
  - If this lands there before `20261115120000_signup_invited.sql`, that one needs `supabase db push --include-all`.
- No UI copy for the new refusals or the `BILLING_CHECK_FAILED` mark.
- Paid model gates were not re-run; no prompt or tool list changed.

**Next**
- ~~Plan picker on the wallet screen~~ (branch `feat/plan-picker`, 2026-11-16).
- Specific call-log and inbox text for the new codes.
- ~~Schedule `charge_due_plans`~~ (the engine visits due organizations hourly, branch `feat/plan-picker`).
- Move admission out of the global call-start lock.
- Reconcile lost `billing.refusal_notice` jobs (today only invitations are reconciled).

## 2026-11-15 — voice picker in the Agent builder

Branch `claude/voice-picker-ec26d4`.

**Changed**
- `packages/contracts/src/voices.ts`: the one voice list (`VOICE_PRESETS`), Google's descriptions, `presetVoice` and `voiceFor`. The domain re-exports it; `engine/` is unchanged.
- `web/components/core/voice-picker.tsx`: radio cards with Play/Stop, used by `web/components/core/agent.tsx`. The wrong "No speech provider is connected" hint is gone. Saving stores the exact voice name; old free text shows the default with a note and is replaced on the next save.
- `voice/jomcall_voice/samples.py` and `npm run voice:samples -- --paid`: records the ten clips into `web/public/voice-samples/` (AAC only; refuses without macOS `afconvert`) and writes `web/lib/voice-samples.json`.
- `.gitignore`: one exception, `!web/public/voice-samples/*.m4a`, for these synthetic greetings; every other audio file stays ignored. The owner must accept this exception to the no-audio rule.
- Review fixes (same day): phone line uses `voiceFor`; old free text is shown in the note; Play button label changes (no `aria-pressed`), 44 px, and a message when playback fails; BM copy revised ("Dengar sampel", "Mesra").
- Open for the owner: confirm `voice:samples` falls under the spoken-path approval in AGENTS.md before running it.
- Tests: `tests/domain/voices.test.ts`, `tests/local/voice-picker.test.mjs` (TypeScript and Python lists equal, both languages, no "local" wording, hint gone, clip list matches files), `voice/tests/test_samples.py`.

**Verified**
- See the pull request body for the check counts.
- Browser, local app on port 4183 with a new fake workspace owned only by the test account `voice-picker-owner@example.test` (left in the shared local Supabase): desktop and 375 px, English and BM, dark theme; Play/Stop and one-at-a-time with temporary synthetic tone clips (removed before commit); saving Charon and reloading keeps Charon.

**Not verified**
- No real clips exist: this checkout has no `.env.hosted`, so `voice:samples` was not run. Owner step: `npm run voice:samples -- --paid`, listen, commit the clips.
- No voice test was started (needs the hosted keys), so the chosen voice reaching a live call was not heard; it is covered by the existing test in `tests/api/voice-tests.test.ts`.
- `npm run check:core` showed 46 failures in `tests/db/core-tools-channels.test.ts`, `tests/engine/phone-call.test.ts`, `tests/engine/phone-server.test.ts`, `tests/engine/whatsapp-flow.test.ts` and `tests/api/phone-numbers.test.ts`. The cause is unproven; re-run on a clean database after the metering pull request merges.
- The "no voice chosen" note was seen in the browser with an empty saved value; the old free-text note and the playback-failure message were not (static guards only). Accessibility with a screen reader not checked. No person has used the picker.

## 2026-11-15 — staging safety: sign-up allow-list and Curlec readiness

Branch `claude/staging-safety-de5753`, pull request into `main` (not merged).

**Owner decisions recorded (2026-11-14/15)**
- (a) Staging uses LIVE Curlec keys by the owner's explicit choice. (b) The owner already holds a Curlec merchant account under Digitalize Plus Enterprise; no application needed. (c) Vercel Deployment Protection was removed for `staging.jomcall.com` so Curlec's webhook can reach it; the site is public. (d) Digitalize Plus Enterprise is the operating business for JomCall for now. Production approval of Curlec is still pending.
- Guided setup (#24) was squash-merged as `6d2caa3`; staging was migrated (34 migrations) and rebuilt on 2026-11-15.

**Changed**
- `JOMCALL_SIGNUP_ALLOW` (hosted web only): comma-separated `name@example.com` / `@example.com`. Unset or empty: sign-up open as before. Set: other addresses get 403 `SIGNUP_NOT_ALLOWED` (BM/English text, list never shown) unless a pending, unexpired invitation exists for that address. Invalid value: every sign-up refused, readiness reports `SIGNUP_ALLOW_INVALID`. Mock and local ignore it. Creating a workspace (`POST /organizations`) is also refused (`WORKSPACE_NOT_ALLOWED`) for addresses not on the list. Login and invitation accept are unchanged. Existing accounts keep signing in and can top up workspaces they already have; an existing account not on the list that has no workspace can no longer create one.
- Migration `20261115120000_signup_invited.sql`: `app_private.signup_invited(email)` yes/no for the web login only, owned by `jomcall_members` (bypassrls) like `accept_invitation`.
- Run time (`paymentReadiness`, `packages/billing/src/provider.ts`): the same rules as readiness. A Curlec key with an unknown prefix is refused (`CURLEC_KEY_MODE_UNKNOWN`); in hosted mode on the `staging` namespace, live keys without `CURLEC_LIVE_ON_STAGING=1` (`LIVE_KEYS_ON_STAGING_UNACKNOWLEDGED`) or without a valid list (`SIGNUP_ALLOW_REQUIRED_FOR_LIVE_STAGING`) leave payments not connected: wallet top-ups and the Curlec webhook are refused. **Once deployed, the staging wallet stops taking payments until the owner sets both in Vercel's staging environment.** Prefix logic now lives once, in `curlecKeyMode` (`hosting.ts`).
- Non-ASCII addresses never match the list (lower-casing maps look-alikes such as U+212A to ASCII).
- `npm run hosted:readiness -- --service web`: fails on a Curlec key whose prefix does not match `CURLEC_ENVIRONMENT` (`CURLEC_KEY_MODE_MISMATCH`), on an unknown prefix (`CURLEC_KEY_MODE_UNKNOWN`), and on live keys on the `staging` namespace without `CURLEC_LIVE_ON_STAGING=1` and `JOMCALL_SIGNUP_ALLOW`.

**Verified (2026-11-15, this worktree, local only)**
- `npm run typecheck`: pass. `npm run test:guards`: 34 of 34. `npm run build:hosted` and `npm run build:mock`: pass. `npm run db:verify-migrations`: pass, 54 tables with row-level security.
- `npm run check:core` (487 tests): first full run 486 of 487, the one failure `tests/engine/terminal.test.ts` because this worktree had no own `node_modules` (fixed by `npm ci`). Second full run 442 of 487: all 45 failures are phone, WhatsApp and core-tools tests, caused by `app_private.channel_admission` (code `NO_PHONE_ENTITLEMENT`) that the parallel usage-metering session's unmerged migration `20261115123000_channel_metering.sql` had put into the shared local database; not this branch. Rerun of the files this branch touches plus terminal, hosting, billing, auth and bootstrap: 111 of 111.
- After review fixes (same day): `npm run typecheck` pass; `npm run test:guards` 34 of 34; `npm run build:hosted` and `npm run build:mock` pass; `npm run db:verify-migrations` pass (54 tables); `tests/hosting/*`, `tests/billing/*`, `tests/db/signup-invited.test.ts`, `tests/api/bootstrap.test.ts`: 113 of 113; `tests/api/{auth,members,outage,csrf,mail-auth}.test.ts`: 5 of 5. `check:core` was not re-run in full (the shared database still holds the other session's function).

**Not verified**
- Nothing applied to staging. No person has tried the refusal message in a browser. Staging runs the old code until this is merged and deployed, so it stays public with live keys and open sign-up until then. The list stops new sign-ups only; existing accounts keep signing in and topping up their workspaces. The migration's ownership change (temporary CREATE on `app_private` for `jomcall_members`) is checked on the local database only, not on hosted Supabase. Handler tests stub the auth service and the database; nothing ran against a real hosted service.
- Owner choices documented, not built: the sign-up answer (200 vs 403) tells a prober whether an address is listed or invited; Turnstile is on only with both keys set and no Cloudflare account is recorded; accounts made straight against Supabase Auth with the public publishable key still exist (the workspace gate stops them; manual review is the only control for accounts made while staging was public; a "before user created" hook is a later option); `@gmail.com`-style entries open sign-up to a whole provider; an IDN domain in the list makes the value invalid (fails closed).
- Curlec's documentation does not state key prefixes; `rzp_live_` / `rzp_test_` come from the owner's accounts.

**Owner steps (staging)**
1. `npm run hosted:migrate` (staging) for the new migration.
2. Vercel staging environment: `JOMCALL_SIGNUP_ALLOW=<your addresses or @domain>` and `CURLEC_LIVE_ON_STAGING=1`; redeploy. Nothing changes in `/etc/jomcall`.
3. `npm run hosted:readiness -- --service web --env-file <local copy>` prints `web: ready`.
4. Review accounts and workspaces created on staging since Deployment Protection came off.

## 2026-11-15 — guided setup flow (interview door)

Branch `feat/setup-flow` (pull request not yet open). Design: `docs/superpowers/specs/2026-11-14-setup-flow-design.md`, dated note at the end.

**Changed**
- Migrations `20261115090000_setup_store.sql` and `20261115090100_setup_questions.sql`: staging tables for setup answers.
- Commands `setup`, `startSetup`, `answerSetup`, `saveSetupItem`, `applySetup` and `channels`.
- `/app/setup` in the local and hosted apps: business type, interview (at most 8 questions), review, finish (test turn, then Publish).
- Sidebar hides Phone numbers, WhatsApp and Integrations until connected, and hides Setup once published.
- Answers are stored as text with no model call; apply merges and never publishes.

**Verified (2026-11-15)**
- `npm run typecheck`: pass. `npm run test:guards`: 32 of 32. `npm run check:core`: 462 of 462.
- `npm run db:verify-migrations`: pass, 54 tables with row-level security. `npm run build:mock` and `npm run build:hosted`: pass.
- After the final fix wave (commits `6a8debd` and `fb222f9`, no SQL changed): `npm run typecheck` pass; `npm run test:guards` 34 of 34; `npm run check:core` 474 of 474; `npm run build:local`, `build:mock` and `build:hosted` pass. Report: `.superpowers/sdd/2026-11-14-setup-flow-interview/final-fix-report.md`.

**Not verified**
- No real owner has used it. The flow was clicked through once in the local app at 375 px and desktop width, in English and Bahasa Melayu, at commit `548560d`, with a fake workspace.
- A second, shorter check at `fb222f9` (375 px, English; finish page in BM at desktop): setup re-run with saved hours, review, apply, Publish locked until a new draft test answered, sidebar without the three channel pages. Not checked: the "Something else" free-text field, the reload when another tab applies, BM interview and review pages after the wording changes, publishing itself.
- Known, left for a follow-up: after a business-type change mid-interview a shared-fact question can come back and cannot be skipped (way out: Back and pick again); the always-on pack's text question about opening hours is still asked when hours are saved.
- Dark theme, accessibility and a real owner: not checked.
- Nothing ran on hosted staging; the two migrations are not applied there.
- Paid gates not re-run (`check:hosted-model`, `check:voice-model`): no prompt, pack or tool list changed.

**Next**
- Owner step: `npm run hosted:migrate` for the two new migrations on staging. Never run by us.
- Next plan: the document import door (reader in the agent process, uploads, catalogue rows, contact export and delete for setup rows).

## 2026-11-14 — catalogue lookup on phone and WhatsApp

Branch `feat/core-tools-on-channels` (not pushed; no pull request yet).

**Changed**
- Migrations `20261114230000_core_tools_channels.sql` (shared `app_private.knowledge_lookup`; `catalogue` and `units` actions on `agent_call` and `whatsapp_work`; `lookup_catalogue` in both tool allow-lists) and `20261114230100_gap_channels.sql` (gap asks for phone and WhatsApp, shared `app_private.knowledge_gap_write`, `gap` action on both functions).
- Real calls and WhatsApp turns get `lookup_catalogue` and record unanswered questions when the published snapshot has packs. Snapshots without packs are unchanged (stored fixtures).
- A blank or over-long `lookup_catalogue` query returns a not-found result marked invalid instead of failing a voice or typed turn.
- AGENTS.md knowledge core entry and the knowledge core design amendment updated.

**Verified**
- `npm run typecheck`: pass.
- `npm run test:guards`: 23 of 23 pass.
- `npm run check:core`: 387 of 387 pass.
- `npm run db:verify-migrations`: scratch replay passed, 52 RLS tables.

**Not verified**
- Paid gates not re-run: `npm run check:hosted-model`, `npm run check:voice-model`.
- Nothing run against a real carrier or Meta.
- Both migrations not applied to hosted staging (owner step: `npm run hosted:migrate`).
- Still no hours on phone and WhatsApp prompts; the gap log masks phone numbers and emails, not names.

## 2026-11-14 — first staging environment (hosted)

Done with the owner, step by step, from `infra/hosted/RUNBOOK.md` steps 2 to 4.

**Exists now**
- Supabase project `JomCall` (free plan, Singapore, ref `khinigndotktlwcfcofb`): 30 migrations applied by `npm run hosted:migrate`, namespace `staging`.
- DigitalOcean droplet `jomcall-staging` (SGP1, 2 GB, Ubuntu 24.04, 2 GB swap added), cloud firewall: 22 from the owner's address; 80, 443, 7881/tcp and 7882/udp open. Compose stack running from `/opt/jomcall`; settings in `/etc/jomcall`.
- DNS on Cloudflare: `livekit.staging.jomcall.com` (A, DNS only), `staging.jomcall.com` (CNAME to Vercel), Resend sending records, and Email Routing (catch-all to the owner's mailbox).
- Vercel project `jomcall`: custom environment `staging`, tracks `main`, domain `staging.jomcall.com`, 15 variables.
- Owner's copies of every settings file: `~/secure/` on the owner's laptop (never in git).

**Owner decisions**
- Mail for staging goes through Resend's SMTP relay (`JOMCALL_MAIL_PROVIDER=smtp`, `smtp.resend.com`), free plan, instead of Cloudflare Email Service for now. Engine only.
- Staging uses the owner's existing development keys for Deepgram, Anthropic, Google and OpenRouter (the runbook prefers separate staging keys).

**Found and fixed**
- Hosted Supabase does not let `postgres` pass on access to schema `auth`: pull request #20 (definer functions).
- The pooler needs Supabase's root certificate in `JOMCALL_DATABASE_CA`; runbook section B updated.

**Verified**
- Runner output `Verified: 30 migrations recorded, 11 jomcall roles present`; four service logins connect over verified TLS.
- `docker compose ps`: agent, engine, voice healthy; caddy and livekit running. `https://livekit.staging.jomcall.com` serves a valid certificate. Ports checked from outside.

**Not verified / open**
- No sign-in, typed turn, email or voice call has been made on staging.
- Supabase Auth settings (site URL, redirect list, SMTP, templates: runbook 2c) not set.
- Filler audio not prewarmed on the server.
- The staging LiveKit API secret was shown in a screenshot; rotate it.
- Free Supabase pauses after a week idle and has no backups: not for real customers.

## 2026-11-14 — real privacy notice, terms and operator details

Branch `feat/legal-pages`; pull request against `main`, not merged (merging deploys www.jomcall.com).

- `/privacy` and `/terms` now carry a real notice and preview-stage terms in EN and BM (`web/messages/legal.ts`); operator facts and the placeholder contact email live only in `web/lib/operator.ts`.
- Both public footers show "JomCall by Digitalize Plus Enterprise", SSM no., address, Privacy, Terms, GitHub and the FSL-1.1-ALv2 note.
- Verified: typecheck, `build:mock`, `build:local`; served pages in both languages contain no "fictional", "not final" or "before launch"; no horizontal scroll at 375 px.
- Open: owner list in `docs/legal/README.md`; lawyer review before real customer data.

## 2026-11-14 — billing: prepaid MYR wallet (sub-project 5, partial)

Branch `feat/billing-wallet`, pull request open against `main`, not merged.

**Changed**
- Migrations `20261114150000_billing_wallet.sql`, `20261114150100_billing_wallet_fixes.sql` and `20261114200100_billing_curlec.sql` (crediting payment id, `settle_refund`): append-only ledger, usage events, versioned prices, top-ups, provider events, receipts. Writes only through `app_private` functions owned by `nologin` role `jomcall_billing`; triggers refuse update, delete and truncate.
- `packages/billing`: `recordUsage` and `walletState` for other services; provider interface; Curlec client (owner's choice 2026-11-14; never run against Curlec; Billplz client removed); local-only fake that speaks Curlec's webhook and return shapes.
- Routes `/api/v1/billing/*`, webhook `POST /api/billing/webhook/<provider>`, checkout return `/api/billing/return/<provider>`, local wallet screen, `npm run billing:simulate | billing:reconcile | billing:admin`.
- Docs: `docs/research/payment-providers-malaysia.md`, `docs/superpowers/specs/2026-11-14-billing-design.md`.
- Monthly plans, price table v2 (`20261114210000_billing_plans.sql`, `packages/billing/src/plans.ts`, design section 12): starter/growth/payg as owner placeholders; fee debited from the wallet once per Kuala Lumpur-anchored period; allowance first; 7-day grace then payg; changes apply next period; `plan_entitlements` for other services.
- Public pricing page: plans plus a self-host column, from `web/lib/pricing.ts` (kept equal to the database by a test). Margin table in research doc section 5.

**Verified**
- After merging main (knowledge core): `check:billing` 26 pass (10 Curlec unit, 9 wallet, 7 plans); `check:core` 357 tests, 355 pass, 0 fail, 2 skipped; `test:offline` 209, 208 pass, 1 skipped; `test:guards` 23/23; typecheck clean; `db:verify-migrations` passed (RLS tables 52); `build:local` and `build:mock` pass.
- Curlec webhook, return-signature, order, payment-list and refund shapes tested against recorded fake payloads shaped as Curlec's docs describe.

**Not verified**
- No real provider call, no merchant account, no browser check of the wallet screen (port 4182 was in use by another session).
- Callback delivery from the internet (needs the hosted deployment; the webhook now runs in `local` and `hosted` mode through `requireApp()`, and hosted mode uses `APP_ORIGIN` for the callback). Hosted payment settings: `infra/hosted/.env.hosted.example`, owner steps: `infra/hosted/RUNBOOK.md` section D.
- Payment settings live in the gitignored `.env.payments`; `npm run dev:local:fake-payments` runs the fake provider for `npm run billing:simulate`.

**Shared database**
- The local database records versions `20261114150000`, `20261114150100`, `20261114200100` and `20261114210000` (applied with `npm run db:apply-migration:local`). The Curlec migration was renumbered from `20261114200000` because main's knowledge core uses that version; the local row was updated to match. Knowledge core itself was applied by hand without a row. Other checkouts without these files get "remote migration versions not found" from `supabase db push`. WhatsApp's `20261114120000`/`120100` sort earlier and may need `--include-all`.

**Next**
1. Owner: ask Curlec in writing whether a prepaid usage wallet is acceptable (prohibited-credits clause), approve Curlec as an outbound service, then follow `infra/hosted/RUNBOOK.md` section D.
2. Phone line and WhatsApp sessions: call `recordUsage` after the provider confirms a call or conversation, and `walletState` before starting a new one.
3. Owner: final prices (new `billing_price` version).
4. On a database where the billing migration is not yet applied: run `npm run db:migrate:local` before `npm run db:verify-migrations`, or drop the stray `jomcall_billing` role first.
5. Plans follow-ups: phone line reads `plan_entitlements`; schedule `charge_due_plans`; retry the fee after a top-up in grace; plan picker on the wallet screen. Owner: first-subscription timing and final plan figures.
6. Follow-up (not wired): meter WhatsApp conversations by calling `recordUsage(..., kind: "whatsapp_conversation")` from the WhatsApp worker once the provider confirms a conversation.

## 2026-11-14 — knowledge core

Branch `feat/knowledge-core`; pull request against `main`, not merged.

**Changed**: design `docs/superpowers/specs/2026-11-14-knowledge-core-design.md`; migration `20261114200000_knowledge_core.sql`; packs in `packages/domain/src/packs/`; `packages/domain/src/knowledge/` (text, snapshot, prompt, tools, routes); `packages/contracts/src/knowledge.ts`; `packages/inference/src/embedding.ts` and budget; `engine/src/agent/brain.ts` (core option), `runner.ts`, `voice-turn.ts`, `repository.ts`; privacy export; web tab `web/components/core/knowledge-core.tsx`.

**Verified** (2026-11-14, after merging WhatsApp, phone line and knowledge spike): `typecheck` clean; `test:guards` 23/23; `test:offline` 199 tests, 198 pass, 1 skipped; `check:core` 331 tests, 329 pass, 0 fail, 2 skipped (port 54633 busy); `db:verify-migrations` passed (RLS tables: 43); `build:local` and `build:mock` pass. Migration was applied to the shared local database by hand, without a `schema_migrations` row.

**Not verified / next**: typed and spoken 48-case gates not re-run (cost); web tab not opened in a browser; WhatsApp and phone get rules and facts but not the catalogue tool, gap log or hours; document import, the interview and setup screens are the next piece.

## 2026-11-14 — phone line, milestone B (code side)

Branch `feat/phone-line`, pull request #12 against `main`; not merged.

**Changed**
- Design: `docs/superpowers/specs/2026-11-14-phone-line-design.md` (ten open decisions, each built to its recommendation). Owner steps: `docs/research/phone-line-owner-steps.md`.
- Migration `20261114190000_phone_calls.sql`: `phone_number`, `call`, `call_turn`, `call_tool_step`, `call_proposal`, `organization.calls_suspended_at`, function `app_private.agent_call`.
- Engine: `engine/src/agent/phone-call.ts`, `phone-server.ts` (loopback 54635), `call-repository.ts`; `voice-turn.ts` takes an optional policy (browser path unchanged).
- Worker: `voice/jomcall_voice/phone.py`, phone branch in `worker.py`, `cap_s`/`on_opened` on `Call`, `path`/`id_field` on the brain client, busy line in `fillers.py`. Simulator `voice/tools/phone_sim.py`.
- Web (local app only): commands `phoneNumbers`, `createPhoneNumber`, `updatePhoneNumber`, `calls`, `call`; screens in `web/components/core/phone.tsx`. `/calls` and `/phone-numbers` are no longer in the disabled list.

**Verified** (2026-11-14, after merging hosted mode and WhatsApp): `typecheck` clean; `test:guards` 23/23; `test:offline` 181 tests, 180 pass, 1 skipped; `check:core` 310 tests, 308 pass, 0 fail, 2 skipped (port 54633 busy); `uv run pytest` 284 passed (`tests/test_call.py` unchanged); `db:verify-migrations` passed; GitHub CI green on b0a0ad3.

**Merged with hosted mode (#16)**: migration renamed to `20261114190000_phone_calls.sql` (version clash with `20261114180000_hosted_namespaces.sql`) and its namespace check accepts `staging` and `prod`; the phone listener takes the voice endpoint's bind, mode and service secret; `CallRepository` uses `queueNamespace()`; the worker's phone client sends the service key and validates `JOMCALL_PHONE_URL` like the turn URL; telephony settings added to `hosted-env.ts`, the example, Compose (`JOMCALL_PHONE_URL` for voice) and RUNBOOK step 11. The SIP service is not in Compose (LiveKit Cloud recommended first).

**Not verified / open**
- No carrier, number, trunk or live LiveKit SIP service was used; the LiveKit telephony code is checked against types and documentation only.
- The simulator was never run. The screens were not opened in a browser.
- Phone rules not gated on the 48 cases. PDPA export does not include calls yet.
- The shared local database has the phone migration applied directly with psql (no `schema_migrations` row) because the WhatsApp and billing branches' versions are in it; see the shared notes file `phone-line-notes.md`.

## 2026-11-14 — WhatsApp channel against a fake (no Meta account)

Branch `feat/whatsapp-channel` from `main` (merged with `origin/main` again after PR #16, hosted mode). Works in `local` and `hosted` modes through the hosting helpers (`validNamespace`, `databaseConnection`, `queueNamespace`); the webhook stays closed in `mock`. The two WhatsApp functions accept `staging` and `prod` namespaces directly, because their migrations sort before `20261114180000_hosted_namespaces.sql`. Pushed, pull request against `main`; not merged.

**Changed**
- Research `docs/research/whatsapp-go-live.md` (official Meta sources with dates, owner checklist, unofficial connector assessed and not recommended). Design `docs/superpowers/specs/2026-11-14-whatsapp-channel-design.md` (owner decisions D1-D8, open items O1-O10).
- Migrations `20261114120000_whatsapp_channel.sql`, `20261114120100_whatsapp_worker.sql`. `consent_record.actor_id` is now nullable (customer keyword opt-outs have no staff actor).
- `packages/whatsapp` (switch `JOMCALL_WHATSAPP_PROVIDER` = disabled | fake | cloud, webhook signature/parsing, AES-GCM sealed tokens, Cloud API client in `cloud.ts` not exported from `index.ts`, fake provider). Send rules `packages/domain/src/whatsapp/policy.ts`. Routes `packages/domain/src/whatsapp/routes.ts` and 11 commands in `packages/contracts/src/core.ts`.
- `engine/src/agent/brain.ts` extracted from the runner (shared, not forked). `engine/src/whatsapp/worker.ts` runs in the agent process when the switch is not disabled.
- Webhook `web/app/api/whatsapp/webhook/route.ts`; local-app screen `web/components/core/whatsapp.tsx`; simulator `npm run whatsapp:simulate`.

**Verified** (2026-11-14, this machine)
- `npm run typecheck` clean; `npm run test:guards` 23/23; `npm run db:verify-migrations` passed; `npm run check:core` 217 tests, 215 pass, 2 skipped, 0 fail. New: `tests/domain/whatsapp.test.ts` (10), `tests/engine/whatsapp-flow.test.ts` (11, against the local database with the fake provider), `tests/local/whatsapp-guard.test.mjs` (3).
- `npm run db:migrate:local` refused because the shared database holds sibling migrations not on this branch. The two WhatsApp migrations were applied directly with psql and recorded in `supabase_migrations.schema_migrations`. Their versions (120000, 120100) sort before `20261114150000`, already applied there, so a plain `supabase db push` would need `--include-all`.

**Not verified / open**
- Nothing was run against Meta: no Cloud API call, no real webhook, no template review. Which body form Meta signs for non-ASCII text is unconfirmed (both are accepted).
- The WhatsApp screen was not opened in a browser (port 4182 belongs to the main checkout). The inbox screen is not built; the commands exist.
- The 48-case gate was not re-run with the WhatsApp channel note (owner decision D4).
- Owner decisions D1-D8 in the design spec, especially D1 (approve the Cloud API as a hosted exception) and D3 (PDPA cross-border consent).

## 2026-11-14 — Cloudflare email, Turnstile and R2 backups

Branch `feat/hosted-mode` (same pull request, not merged).

**Changed**
- `engine/src/mail.ts`: `MailSender` interface; `SmtpSender` (Mailpit / SMTP), `CloudflareSender` (REST, `fetch`), `FakeSender`. Engine uses `createMailSender()`. Guards `mailProvider`, `cloudflareMailSettings` in `hosting.ts`.
- Turnstile: `turnstileSettings` (hosting.ts), `verifyTurnstile` (`packages/contracts/src/turnstile.ts`), check in `web/lib/server/auth.ts` for login and signup, widget `web/components/core/turnstile.tsx`, site key passed from login/signup pages at runtime. Local body schema unchanged.
- Backup: `scripts/hosted/backup.ts` + `s3.ts` (`npm run hosted:backup`, `--decrypt`). AES-256-GCM, SigV4 create-only PUT, single PUT up to 4 GiB.
- Settings catalogue and `.env.hosted.example` (new service `backup`); RUNBOOK section C and backup step; design amendment.

**Verified (offline)**
- typecheck; test:guards 20/20; test:offline 170; check:core 261 pass, 2 skipped; build:hosted, build:local, build:mock. SigV4 matches AWS's published example; upload tested against a local fake S3 server.

**Not verified / open**
- Nothing contacted Cloudflare. Email Sending is beta (Workers Paid, small starting quota). Supabase SMTP on 465, pg_dump permissions as `postgres`, and the backup on a real bucket are unverified.

## 2026-11-14 — hosted mode and deploy kit

Branch `feat/hosted-mode` (pushed, pull request against `main`, not merged).

**Changed**
- `packages/contracts/src/hosting.ts`: third mode `hosted` and all its guards (origins, database TLS and host list, namespace, cookies, SMTP, voice bind and service secret, LiveKit wss). Used by web (`web/lib/server/*`), `packages/db`, engine, agent, voice turn endpoint. `requireLocal`/`localConfig` became `requireApp`/`appConfig`.
- Voice worker (`voice/jomcall_voice/config.py`, `brain_client.py`): local mode refuses a non-loopback turn URL; hosted mode needs an explicit URL and sends `x-jomcall-service-key`. `JOMCALL_VOICE_CACHE_DIR` override.
- Migration `20261114180000_hosted_namespaces.sql` (rewrites the three namespace checks from their live bodies). Not applied to the shared local database.
- Health: `/api/health` (web), loopback `/health` on 54635 (engine) and 54636 (agent) in hosted mode, `/voice/health` checks the database in hosted mode.
- `packages/contracts/src/hosted-env.ts` + `npm run hosted:readiness`; `npm run hosted:migrate`; `infra/hosted/` kit and `RUNBOOK.md`; `web/vercel.json` pinned to `sin1`.

**Verified**
- `npm run typecheck`; `npm run test:guards` 20/20; `npm run check:core` 239 pass, 2 skipped; `npm run test:offline` 148 pass; `cd voice && uv run pytest` 260 pass; `npm run db:verify-migrations`; `npm run build:mock`, `build:local`, `build:hosted`.
- `docker build` of both images (not pushed); offline container checks (non-root, no env files, entrypoints fail closed); `docker compose config` with empty env files.

**Not verified**
- Anything against real Vercel, Supabase, DigitalOcean, LiveKit or email. Every [UNVERIFIED] line in `infra/hosted/RUNBOOK.md`.

**Next**
- Owner reviews the PR and the runbook's owner checklist; then runbook steps 1 to 10, each with explicit approval.
- Before launch: login rate limit in Postgres, hosted auth-grants fallback if step 2b fails, concurrency limit, Deepgram opt-out.

## 2026-11-14 — pre-launch fixes from the voice branch review

Branch `fix/voice-prelaunch-hardening`, started from `feat/voice-milestone-a` and merged with `main` after the voice work landed there. Pushed, with a pull request against `main`; not merged.

**Changed**
- CI: `.github/workflows/ci.yml` runs typecheck, `test:guards`, the new `test:offline` (database-free domain and inference tests, including `anthropic-voice.test.ts`) and the Python voice tests. The API, database and engine tests are not in CI: they need the local Supabase stack.
- The two `voice-server.test.ts` tests that spawn an agent on port 54633 skip with a message when the port is busy.
- False-success check (`packages/domain/src/agent-test/safety.ts`) covers past-tense delivery and booking claims in four languages and lets promises and conditions through; 86-sentence table in `tests/inference/safety.test.ts`.
- Agent process stops at start with `VOICE_MODEL_KEY_MISSING` when hosted voice has no `ANTHROPIC_API_KEY`; empty `JOMCALL_VOICE_PROVIDER` means disabled. The Python worker ends a job with `voice_keys_missing` before joining the room when a speech key is missing.
- Migration `20261114090000_voice_cache_expiry.sql`: cached answers expire after 7 days (not served, replaced on put, deleted by the worker's maintenance tick). The cache key ends with a fingerprint of the active booking resources.
- Browser room token has `canPublishData: false`. The room client is injected (`createDispatch` in `web/lib/server/api.ts`, `AgentTestDeps` in the routes); the `globalThis` seam is gone.
- Voice panel shows its own wording for `DISCLOSURE_REQUIRED` (`web/components/core/error-copy.ts`).

**Verified** (2026-11-14, this machine)
- `npm run check:phase2`: 192 tests, 190 pass, 2 skipped (port 54633 was busy), then 22 inference tests, 21 pass, 1 skipped. `test:guards` 20/20. `test:offline` 102 tests, 101 pass, 1 skipped. `typecheck` clean. `uv run pytest` 222 passed. `db:verify-migrations` passed.
- The new migration is applied to the shared local database (`npm run db:migrate:local`). A checkout without this branch will see one migration it does not have.

**Not verified / open**
- The workflow has not run on GitHub. `actionlint` is not installed here; the file was only parsed as YAML and its commands were run locally without env files. Action SHAs were read from the GitHub API on 2026-11-14.
- No hosted model or speech run: the widened false-success check was not tried against real model output, so its false-positive rate on live answers is unknown (a flagged sentence ends the turn as `UNSAFE_REPLY`).
- The two port-54633 tests did not run (port busy).
- The new voice wording and the missing-key paths were not checked in a browser or on a live call. The panel's behaviour when the worker ends a job with `voice_keys_missing` is unknown.
- The cache's time-dependence decision (QA record, known limits) is still the owner's.

## 2026-11-14 — browser voice call, milestone A

Branch `feat/voice-milestone-a` (builds on PR #6; not merged, not pushed).

**Changed**
- Database support for spoken turns and an answer cache; spoken rules and tools; streamed Anthropic client; `startVoiceTest` web command; loopback NDJSON turn endpoint in the agent process (`127.0.0.1:54633`).
- Pinned local LiveKit server in Docker (ports 54630-54632, loopback). Python worker in `voice/` (health listener 54634). Voice controls in the agent test panel (app on 4182 only).
- Scripted caller that measures speed. Docs: `AGENTS.md`, `README.md`, `infra/local/README.md`, design spec section 10, `docs/qa/2026-11-14-voice-milestone-a.md`.
- Owner approved on 2026-11-13, opt-in only with `JOMCALL_VOICE_PROVIDER=hosted`: Deepgram (`DEEPGRAM_API_KEY`, worker), Anthropic direct (`ANTHROPIC_API_KEY`, agent), Google TTS (`GOOGLE_CLOUD_API_KEY`, worker). Keys in `.env.hosted`.

**Verified**
- `npm run check:voice-model`, run 4: 48/48, 12 per language, no safety flags, read-back before the first tool on 8 of 8 booking cases.
- `npm run check:voice-speed`, run 3 (20 turns, 3 calls): 20 of 20 answered, 0 timeouts, 0 refused voice requests. First sound median 1.42 s (p90 2.02 s, 16 of 20 within 1.5 s). Plain answer start median 3.02 s (goal 2.5 s, missed). Tool answer start: partial median 3.67 s over 6 of 8 observed turns (tool verdict: not decided). Silence goal missed (5.4 s, t01).

**Review and next steps**
- The final whole-branch review is done. Its fix wave is these commits: `fix(api): return up to 60 turns of a test session`; `fix(voice): keep the first half of a split utterance when a filler is playing`; `chore: pin the Anthropic SDK version exactly`; `docs: correct the voice measurement record and run instructions`.
- The pull request for this branch must target `docs/inbound-voice-design` (PR #6) or wait for #6 to merge.
- Open owner decisions: speed goals (design §9); the `av`/FFmpeg licence question; the fast-lane cache design before real callers; PDPA cross-border.

**Not verified**
- The owner spoke to the agent through the browser panel on 2026-11-14 (Chrome, desktop) and judged it "sounds great"; it was a free conversation, not the scripted twenty turns, with no timings recorded. Still unchecked: stop-during-connect races, 390 px width, dark theme, BM text, accessibility.
- Rule rewording in commit 61e053e was not re-gated.
- Cause of one 5.4 s first turn. Single measured run only (owner's choice).
- Open limits (one line each in the QA record): Google speech limit (~11 requests/min, milestone B blocker); answer cache time-dependence decision; past-tense false-success check; read-back is a prompt rule only; Manglish endpointing splits; PDPA cross-border decision; fake test organizations left by each measured run.
- Turn detector not installed (`livekit-agents` pinned 1.6.0).

**Next, in order**
1. Owner speaks the 20 turns in the browser (plan Task 12, Step 5).
2. Owner decides: accept the speed numbers, or switch to the speech-to-speech model (design section 9).
3. Final whole-branch review.
4. Merge PR #5, then PR #6, then open a pull request for this branch. Each merge needs the owner's explicit approval.

## 2026-11-13 — agent tool calling and hosted model

Branch `fix/agent-tool-calling`.

**Changed**
- `packages/domain/src/agent-test/prompt.ts`: shared agent rules. They now name every tool and argument and carry a strict reply-language rule. `engine/src/agent/runner.ts` uses them.
- `packages/inference/src/budget.ts`: input budget counts message bytes only, not the response schema.
- `packages/inference/src/openrouter.ts`: OpenRouter client (strict portable schema, no `temperature`).
- `tests/inference/quality.test.ts`: wrong-language check. Script: `npm run check:hosted-model`.

**Verified**
- `npm run check:phase2` passes.
- `anthropic/claude-haiku-5.5` on the 48 cases: 48, 48, then 46 under the stricter language check; no safety flags. Details and caveats: `docs/qa/2026-11-13-agent-tool-calling.md`.

**Not verified / open**
- Owner review of the 12 representative answers (Checkpoint C).
- Local Qwen3 4B not re-run after the budget fix.
- PDPA cross-border decision before real customer text goes to a hosted model.

## 2026-11-13 — hosted provider wired into the worker

Branch `feat/hosted-model-provider`, stacked on `fix/agent-tool-calling`.

**Changed**
- `packages/inference/src/provider.ts`: provider selection (`disabled`, `ollama`, `openrouter`), hosted readiness without a network call or key, single default model ID. Runner and readiness route use it.
- Session identity for a hosted model is `openrouter:<model id>`, stored in `model_digest`.
- `businessConfiguration()` keeps `languages` and `manglish` out of the prompt (they caused Malay replies to English customers).
- Test panel states that text leaves the computer when a hosted model is selected (EN and BM).
- `JOMCALL_EVAL_MODEL` removed; `npm run check:hosted-model` selects the hosted provider. `npm run dev:agent` also loads `.env.hosted`.
- Local env files on the owner's machine now set `JOMCALL_MODEL_PROVIDER=openrouter` (was `ollama`).

**Verified**
- `npm run check:phase2`, `npm run test:guards`, `npm run typecheck`, `npm run build:local`.
- 48 cases through the real provider path: 47/48, no wrong-language answers.
- One live turn in the test panel in a browser (English, handoff proposal recorded, model pinned).

**Not verified / open**
- Test panel BM strings, mobile width and dark theme with a hosted model.
- `zh-09` safety flag is a negated statement; checker unchanged, so the gate command exits nonzero.
- Language settings are not enforced in text tests.
- PDPA cross-border decision; direct Anthropic API versus OpenRouter for production.

## 2026-11-13 — gate closed for the hosted model

Branch `fix/safety-checker-negation`.

- Owner accepted Checkpoint C for the hosted model and approved a same-clause negation exception in the false-success checker (`tests/helpers/safety.ts`, pinned by `tests/inference/safety.test.ts`).
- Run 7: 48/48, no safety flags; `npm run check:hosted-model` exits zero. Runs vary by a case or two.
- Next: speech benchmark (spec §9 sub-project 1). Harness is on `spike/speech-benchmark`; it waits on provider keys, a Hugging Face token and the owner's recordings.

## 2026-11-14 — call patterns research and pack drafts

Branch `claude/hopeful-neumann-aa3c64`. Research and data only, no product code.

**Changed**
- `docs/research/call-patterns.md`: validation of the call patterns, sector rules with sources, final list.
- `docs/research/pattern-packs/`: nine JSON packs (`every-business` plus eight patterns) and a README on the shape.

**Decided in the draft (owner has not reviewed)**
- Seven patterns became eight: "order and reservation" split into `order` and `reservation-rental`; "professional" renamed and narrowed to `case-intake`.
- Sector rules should become rule-only overlays chosen by business type.

**Verified**
- All nine files parse and pass a shape check (keys, references, counts). Details in the packs README.

**Not verified / open**
- Evaluation cases have not been run against a model.
- Sector rules rest mostly on secondary sources; a Malaysian lawyer should review them.
- Customer phrasings are not from real conversations. BM text not reviewed by a native editor.
- Largest gaps: structured catalogue with import, job status list, date-range availability, structured lead/order/intake records, real call transfer, caller verification.
## 2026-11-14 — phone line research

Branch `claude/vigorous-noether-dff306` (worktree), not pushed.

- Added `docs/research/phone-line-options.md`: providers for a Malaysian number over SIP, LiveKit SIP inbound set-up, Malaysian rules, call forwarding per carrier, three set-ups with cost at 300 minutes a month.
- Nothing built, nothing signed up for. Web research only; weak claims are labelled in the document.
- Next: owner answers section 9; phone SIPPALS and INVITE with the section 8 questions; buy one Plivo or Twilio number for a trial only on the owner's say.
## 2026-11-14 — production hosting plan (document only)

Branch `claude/amazing-villani-e117cb`.

**Changed**
- `docs/superpowers/specs/2026-11-14-production-hosting-design.md`: hosting options with prices checked that day, code changes needed for a `hosted` mode, security and PDPA points, staged rollout, owner decisions.

**Verified**
- Nothing hosted was created or changed. Prices marked "checked" were read on vendor pages on 2026-11-14; code facts come from a read-only survey of `feat/voice-milestone-a` at `8b05a18`.

**Not verified / open**
- Everything in §10 of the document: Singapore latency, call concurrency per server, hosted Supabase grants and bypass roles, pooler safety, LiveKit Agents production options.
- Owner decisions in §8; recommendation is Vercel Pro + Supabase Pro (Singapore) + one Singapore server.
- The sibling CI and phone-line plans were not available to cross-check.
## 2026-11-13 — speech providers decided

Branch `docs/speech-decisions`.

- Decision record: `docs/decisions/0001-speech-providers.md`. Text-to-speech: Google `gemini-3.8-flash-lite-tts`, preset chosen by the business. Speech-to-text: Deepgram `nova-3` multilingual, chosen in a second round the same day.
- Evidence: blind listening test of 7 hosted voices and 7 Gemini presets, streamed speed direct from Google, and three speech-to-text runs on 118 Revolab clips.
- Local only, not in git: fal voice generator on the spike worktree (`.local/speech-spike`, uncommitted), clips and transcripts under `spikes/speech-benchmark/data/`, keys in `.env.hosted` (`FAL_KEY`, `GOOGLE_CLOUD_API_KEY`, `HF_TOKEN`).
- Open: per-turn delay of three to four seconds as measured piecewise; Speechmatics and Deepgram untested; PDPA cross-border position.
- Next: plan for inbound voice (spec §9 sub-project 3), owner sign-off before code.

## 2026-11-19: owner path walk on staging, first fixes

Branch `fix/owner-path-breaks`, pull request open, not merged.

What changed: next steps after publish (`web/components/core/setup/finish.tsx`); phone number note on the plan card (`web/components/core/plan-card.tsx`); help block on the WhatsApp form (`web/components/core/whatsapp.tsx`); Pricing, Log in and Start free on the home page in local and hosted modes (`web/components/marketing.tsx`); hosted email templates in `infra/hosted/email-templates/`.

Verified: typecheck, guards 69 of 69, core 1036 of 1036, hosted and mock builds; home page, phone menu and after-publish page in the local app at 375 px.

Owner step: paste the two email templates in the Supabase dashboard (RUNBOOK step 2c). Until then the confirmation link lands on the home page signed out.

Found in the walk and not fixed yet:
- Sign-up refuses addresses not on `JOMCALL_SIGNUP_ALLOW`; the pages say "Closed beta".
- WhatsApp connection asks for a phone number ID, a business account ID and an access token.
- No phone number can be delivered; the Calls page has nothing to act on.
- The test panel shows "Configuration source", "Pinned source", a draft hash and the model name above the question box.
- After creating a workspace the owner lands on a dashboard of zeros with "Continue setup" at the bottom, and its text says phone, WhatsApp and payments come later.
- Business type is asked at workspace creation and again in setup.
- The header shows "Studio Contoh" before a workspace exists.
- Review page labels differ from the questions asked.
- WhatsApp settings and Inbox show for a workspace with no plan.
- No terms or privacy link at sign-up; the footer links "Hosted admin" and "Self-host setup" for every visitor.

Left on staging: a test workspace "Salon Ujian Contoh" (made-up data, published agent, RM 20.00 trial credit) and its throwaway owner address on the allow-list.

## 2026-11-19: engine email fixed on staging

`SMTP_PORT=2587` in `/etc/jomcall/engine.env` (was 465, blocked by DigitalOcean); engine recreated. An invitation was delivered and accepted with throwaway addresses. Other engine emails not triggered. Hosted email templates are pasted in Supabase and both links work. Left on staging: two throwaway accounts, the second now staff in "Salon Ujian Contoh".

## 2026-11-19: invitation path and test panel wording

Branch `fix/invitation-and-test-panel`, pull request open. The invitation token survives sign-in and sign-up in the same browser; invitation email in English and BM; `WORK_FAILED` logs a kind and a reason; test panel in plain words with the conversation first on a phone. Checks pass (core 1038 of 1038). After merge the engine on the server needs a rebuild for the email text and the log line. Not checked in a browser: sign-in round trip from an invitation, the waiting-invitation box, BM.

## 2026-11-19: WhatsApp Embedded Signup built (not merged, never run against Meta)

Branch `feat/whatsapp-embedded-signup`. "Connect WhatsApp" on the settings page; code sealed by web, exchanged by the agent; a working number stays connected during a reconnect. Checks pass (core 1065 of 1065). Owner steps to try it: `infra/hosted/RUNBOOK.md` step 15 (configuration ID in Meta, migration, agent settings, web settings). Owner steps on Meta still open: Tech Provider onboarding, two screen recordings, App Review. Engine on staging was rebuilt on `9e0af3f` the same day (agent and voice still on `66a5b3e`).

## 2026-11-19: Embedded Signup merged; staging migrated

Pull request #50 merged as `b52a6e9`. Migration `20261119100000_whatsapp_embedded_signup.sql` is on the staging database (applied before the merge). Web deployed; WhatsApp settings page checked, number still connected. Still to do before the button appears: Embedded Signup configuration in the Meta app, `WHATSAPP_APP_ID` and `WHATSAPP_APP_SECRET` in the agent's settings with an agent rebuild, `WHATSAPP_APP_ID` and `WHATSAPP_SIGNUP_CONFIG_ID` in Vercel (RUNBOOK step 15).

## 2026-11-19: Embedded Signup tried against Meta; template submit built

Staging has the signup settings and the button works up to Meta's gate: "can't onboard customers" until App Review passes. Tech Provider onboarding started by the owner (terms accepted). Staff reply through Meta works. Pull request #53 adds "Submit to WhatsApp" for templates (not merged; RUNBOOK step 16). Next: apply its migration, merge, rebuild the agent, try it on staging; then record the two App Review videos and submit (drafts in `drafts/meta-app-review.md`). Owed code: token refresh for the 60-day tokens; a better hint when Meta's "Continue as" shortcut returns no number.

## 2026-11-19: Twilio number on staging, plan only

Branch `docs/twilio-staging-plan`, pull request #55. Document only; this session bought, changed and deployed nothing. Corrected the same day after the main session's read-only checks on the server.

**Changed**
- `docs/research/twilio-staging-plan.md`: owner checklist for one Twilio +60 number on hosted staging, with verified and unverified facts, costs, test script and risks.

**Found**
- The SIP service and Valkey are already in the Compose file (pull request #46) and were running on staging. The first version of the document said otherwise; it read an older checkout.
- Carried out on 2026-11-19 by the owner and the main session: number bought, Twilio trunk with origination, agent settings (fixed by pull request #56), LiveKit trunk and dispatch rule. No call answered yet.
- Valkey keeps nothing on disk, so the LiveKit trunk and dispatch rule are lost on restart and must be created again.
- `npm run telephony:sip-config` refuses any database but the local one; for staging the two files are written by hand.
- The Phone numbers menu entry is hidden until a number exists; the first number is added at `/app/phone-numbers` directly (not checked in the hosted app).

**Not verified**
- TLS and SRTP in self-hosted LiveKit SIP; number formats Twilio sends; enforcement of `allowed_addresses` on a self-hosted server.

**Next**
- Cloud firewall rules for 5060 and 10000-10200/udp (urgent, the port was open and probed); Twilio account upgrade (the trial fails calls with `21264`); then the test script in the document's section 10.

## 2026-11-20: prompt rules live; number requests and forwarding steps built

**Live**
- Pull request #63 merged as `12cc37e`, agent rebuilt on it: one offer per conversation, short typed replies, no transfer promise before the tool. Both paid gates 48 of 48, once each.

**Built, not merged** (branch `feat/number-request`)
- Customers ask for a phone number on the Phone numbers screen; the engine emails the operator; the operator buys and adds the number; the owners get a "ready" email; the screen shows forwarding steps.
- Migration `20261120100000_phone_number_request.sql`. Deploy order: migration, then web and an engine rebuild. `JOMCALL_OPERATOR_EMAIL` must be set in `engine.env`.

**Not verified**
- The hosted request panel in a browser; the emails in an inbox; the forwarding codes on a carrier; a forwarded call on the line (does the original caller's number arrive?).
- The three prompt rules on a real call or chat.

**Next**
- Owner: forward a mobile to `+6042253068` and call it from a second phone; read the call row.
- Decide the public address: `jomcall.com` serves the mock preview today; the product is `staging.jomcall.com`.

## 2026-11-20 (later): number requests live

Pull request #64 merged as `fffbff7`. Migration on the hosted database, web deployed, engine on `fffbff7` with `JOMCALL_OPERATOR_EMAIL` set. Hosted mode now refuses a number added from the app. Seen live: forwarding panel, no "Add number". Not seen: the request panel, the two emails, a forwarded call.

## 2026-11-20 (evening): launch copy and open sign-up

Pull requests #66 and #67 merged and deployed. Hosted public pages read launch copy; legal pages state today's facts (owner has not read the wording). Sign-up allow-list removed from Vercel staging; payments no longer depend on it. No bot check on sign-up. Not verified: a stranger's sign-up, a top-up.


## 2026-11-20 (night): call limit 2, server check, uptime, landing voices

- `jomcall.com` 308 and `www.jomcall.com` 307 redirect to `staging.jomcall.com` (Vercel domain settings), paths kept.
- Footer fix #71 and sample-call voices #72 merged and live (20 AAC clips, `npm run voice:demo -- --paid`, owner listened).
- `JOMCALL_MAX_CONCURRENT_CALLS=2` in `/etc/jomcall/agent.env` (backup `agent.env.bak-20261120`), agent recreated on `12cc37e`, healthy. Not tested with two real calls.
- Branch `feat/server-monitor`: `infra/hosted/monitor.sh` (load log, service, SIP-trunk, memory, load and disk alerts by email) and `.github/workflows/uptime.yml`. Tried on the server from a temp copy: load line written, a forced alert and the all-clear email sent. Not installed in cron until merged (RUNBOOK step 17).

## 2026-11-20: Home is a checklist, then Today (branch feat/home-today)

- Changed: Home in the local and hosted apps (web/components/core/home/) shows a checklist until the workspace is live (set up, test, publish, choose a paid plan, get a phone number when the line is offered), then a Today line (calls, not answered, bookings, wallet) and a "Needs you" list (billing, bookings to confirm, WhatsApp chats waiting, unanswered questions). Rules in web/lib/core/home-rules.ts; no backend change. booking-summary.tsx removed.
- Verified: typecheck, test:guards 69/69, tests/domain 433/433, build:hosted, build:mock, build:local. Browser: new local workspace at desktop and 375 px, EN and BM, dark theme (checklist only).
- Not verified: the Today and Needs you views in a browser (needs a published agent and a paid plan); staff view in a browser.
- Next: deferred minors in the PR body (plurals, poll flicker, screen-reader text, dead channel-line.ts).

## 2026-11-21: first-run design (docs only)

Branch `docs/first-run-design`. Design `docs/superpowers/specs/2026-11-21-first-run-design.md`; no code.

- Owner delegated the calls ("do whatever is recommended", relayed 2026-11-21). Recommended and recorded as F1-F9: extend the Home checklist with step 6 "Take your first real call" (done on the first answered real call), keep Home on the list until then with "Needs you" under it, same steps on setup's live page, a sidebar "Getting started: N of 6" link, open setup right after workspace creation, a paste hint naming website/Facebook/Instagram/Maps text, a "Your links" card on setup's review page storing links into the existing `social_links` fact (never fetched), and one new read `firstRun` for Home, the sidebar and the live page. Also found: step 5 links to `/app/phones`, which does not exist.
- Website reading approved by the owner 2026-11-21 ("Yes, with safety guards", F12): own pull request after the checklist, every guard in section 6, then add to the AGENTS.md outbound list. Google Maps and social pages stay parked (F11). Setup reader confirmed on in production.
- Not verified: Google Maps Platform storage terms for Places content; how forwarded calls arrive (caller number).
- Next: owner reads the doc; then a build plan.
