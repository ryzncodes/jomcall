# Twilio number on hosted staging: plan and owner checklist

Date: 2026-11-19. Status: plan only. Nothing in this document has been done. No number was bought, no Twilio, LiveKit, server or database setting was changed, and nothing was deployed.

Goal: one real Malaysian number from Twilio, on `staging.jomcall.com`, answered by the published AI agent of one test workspace.

Every step marked **[OWNER]** costs money, faces the internet or writes to a hosted service. Each one needs the owner's explicit yes at the time it is done.

Related documents: `docs/superpowers/specs/2026-11-14-phone-line-design.md` (design), `docs/research/phone-line-owner-steps.md` (generic owner steps, written before a provider was chosen), `infra/hosted/RUNBOOK.md` step 11, `docs/research/phone-line-options.md` (provider comparison).

## 1. Summary

The path of a call will be:

```
caller, Malaysian network
  -> Twilio number (+60, bought with bundle "Digitalize Plus - MY Local")
  -> Twilio Elastic SIP trunk, origination URI
  -> LiveKit SIP service (NOT RUNNING ANYWHERE YET)
  -> LiveKit room "call-<dialled number>_<random>" on livekit.staging.jomcall.com
  -> jomcall-voice worker -> agent process (phone listener, port 54635, private)
```

Three things stand between today and a first call. The first two are code and deploy work, not console work:

1. **Staging has no SIP service.** `infra/hosted/docker-compose.yml` runs Caddy, LiveKit, agent, engine and voice. It has no `livekit/sip` container and no Redis, and `infra/hosted/livekit/livekit.yaml` has no Redis block. LiveKit's SIP service needs Redis shared with the LiveKit server. So "the staging LiveKit SIP address" does not exist yet. See section 4.
2. **The trunk and dispatch generator cannot read staging.** `scripts/telephony/sip-config.ts` stops with `LOCAL_DATABASE_REQUIRED` unless the database is `127.0.0.1:54622`. RUNBOOK step 11.4 says to run it "against this environment's database", which the script refuses. For one number the two files can be written by hand (section 7).
3. **The Twilio account is a trial.** A trial very likely cannot serve this purpose (section 3, step T1).

The code has never touched a live SIP service. The LiveKit telephony implementation (`packages/domain/src/phone/telephony.ts`) has run only against an in-memory fake, and the fake SIP caller (`npm run phone:simulate`) has never been run. Expect the first real call to find defects.

Staging must not hold customer data (free database, no backups; `AGENTS.md`). This plan gives a real test line. It does not give a line a paying customer can use. Section 12 lists what a customer line needs on top.

## 2. What was verified, and how

Documentation was read on 2026-11-19 through a page-summarising fetcher, so the wording below is paraphrase unless quoted. Repository facts were read from `origin/main` at `e9bd321`.

### Verified from official pages

| Fact | Source |
|---|---|
| Twilio origination URI must use the `sip:` scheme (`sips:` is not supported). Host is an IP address or a domain name. Twilio puts the dialled number in the user part. Default transport is UDP; `;transport=tcp` and `;transport=tls` are allowed. Up to 10 URIs, with priority (lowest first) and weight | `twilio.com/docs/sip-trunking`, `twilio.com/docs/sip-trunking/api/originationurl-resource` |
| LiveKit's Twilio guide: add an origination URI that is the LiveKit SIP endpoint with `;transport=tcp` appended, and attach the number to the trunk | `docs.livekit.io/telephony/start/providers/twilio/` |
| Twilio signalling addresses (5060 TCP and UDP, 5061 TLS): Singapore `54.169.127.128/30`, Tokyo `54.65.63.192/30`, Sydney `54.252.254.64/30`, Virginia `54.172.60.0/30`, Oregon `54.244.51.0/30`, Ireland `54.171.127.192/30`, Frankfurt `35.156.191.128/30`, Sao Paulo `177.71.206.192/30`. Twilio says to accept signalling from every listed address | `twilio.com/docs/sip-trunking/ip-addresses` |
| Twilio media: `168.86.128.0/18`, UDP, Twilio's ports 10000 to 60000 | same page |
| Twilio trunk codecs: PCMU and PCMA by default. G.729, Opus and AMR-NB are limited availability. No G.722 | `twilio.com/docs/sip-trunking/codecs` |
| Twilio Secure Trunking: TLS 1.2 or later and SRTP. Turning it on rejects unencrypted calls | `twilio.com/docs/sip-trunking` |
| The `edge` parameter picks the Twilio edge that sends origination traffic. Without it, Twilio uses the edge where the call came in. Singapore, Tokyo and Sydney exist | same page |
| Twilio trial: calls only with verified numbers, 30 days, 75 voice minutes, voice limited to the sign-up country | `twilio.com/docs/sip-trunking`, `twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account` |
| Malaysia local number for a business needs SSM registration and proof of a local address inside the number prefix's locality, no PO Box | `twilio.com/en-us/guidelines/my/regulatory` |
| Prices shown: Malaysia local number "$4.00 per month"; Elastic SIP Trunking origination on a local number "$0.0278 per minute" (page dated October 2026). The pages show "$" with no currency code | `twilio.com/en-us/sip-trunking/pricing/my`, `twilio.com/en-us/voice/pricing/my` |
| LiveKit inbound trunk: JSON under a top-level `trunk` key; `numbers` in E.164 with `+`, or a bare SIP user name; `allowed_addresses` takes addresses and CIDR ranges. Twilio Elastic SIP Trunking does not support the trunk user name and password | `docs.livekit.io/telephony/accepting-calls/inbound-trunk/` |
| LiveKit dispatch rule: JSON under `dispatch_rule`, with `trunk_ids` and `room_config.agents`. Created with `lk sip dispatch create <file>`; the trunk with `lk sip inbound create <file>` | `docs.livekit.io/telephony/accepting-calls/dispatch-rule/` |
| Self-hosted LiveKit SIP: SIP port 5060 and RTP ports 10000 to 20000 must be reachable from the internet. Redis is required, the same Redis as the LiveKit server. Config keys `api_key`, `api_secret`, `ws_url`, `redis.address`, `sip_port`, `rtp_port`, `use_external_ip` | `docs.livekit.io/transport/self-hosting/sip-server/` |
| Cold transfer through Twilio needs "Call Transfer (SIP REFER)" enabled on the trunk, plus "Enable PSTN Transfer". The transfer target is `tel:+<E.164>` | `docs.livekit.io/telephony/features/transfers/cold/` |

### Not verified

- Whether a Twilio **trial** account can buy a +60 local number, use Elastic SIP Trunking at all, or receive calls from unverified callers on a trunk. The trial pages do not say. The verified trial limits make an upgrade the safe assumption.
- Whether Twilio's origination signalling comes only from the address ranges above. The page lists them as trunking signalling addresses and does not use the word origination.
- The exact form in which Twilio sends the dialled number (`+60...` with the plus is assumed) and the caller's number.
- Whether self-hosted LiveKit SIP enforces `allowed_addresses`. LiveKit's page says it "must be enabled by LiveKit support", which is Cloud wording. Treat the firewall as the real guard.
- TLS (port 5061) and SRTP support in self-hosted `livekit/sip`, and its codec list. This plan therefore uses plain SIP over TCP and plain RTP. Signalling and audio cross the internet between Twilio and the server unencrypted (section 11).
- Which Malaysian prefixes Twilio offers under the bundle, whether every Malaysian mobile and fixed network can reach the number, and SMS support.
- The literal syntax `;edge=singapore` on an origination URI.
- Whether the dollar prices are US dollars. Confirm in the Twilio console before buying.
- Whether the Phone numbers page opens by direct address in the hosted app before any number exists (section 8).

## 3. Twilio console, in order

### T1. Upgrade the account **[OWNER, costs money]**

Recommended before anything else. A trial is limited to verified numbers and to 30 days, and whether it can hold a Malaysian number on a SIP trunk is not verified. Upgrading means adding a payment method and a first top-up. The minimum top-up amount was not checked.

Before upgrading, check in the console:

- that the bundle "Digitalize Plus - MY Local" still shows **Approved** and stays attached to this account after the upgrade;
- the currency of the prices;
- that **auto recharge is off**, and set a usage trigger (for example an alert at USD 10) so a fault cannot drain the balance.

### T2. Buy the number **[OWNER, costs money, monthly]**

1. Phone Numbers > Buy a number. Country Malaysia, type Local, capability Voice.
2. Pick one number. Write it down in E.164, for example `+60XXXXXXXXX`.
3. At checkout, assign the approved bundle and its address. The address must be inside the locality of the number's prefix, so pick a prefix that matches the bundle's address.
4. Leave the number's voice configuration empty for now. Step T4 attaches it to the trunk.

### T3. Create the trunk **[OWNER]**

1. Elastic SIP Trunking > Trunks > Create new SIP trunk. Name it `jomcall-staging`.
2. General settings: Secure Trunking **off** (TLS and SRTP at LiveKit SIP are not verified). Call recording **off** (JomCall records nothing in this milestone and the recording disclosure is tied to JomCall's own setting).
3. Call Transfer (SIP REFER): **Enabled**, and **Enable PSTN Transfer**, only if the transfer test in section 10 is wanted. Transfers place an outbound call that Twilio bills. Leave it off for the first call.
4. Termination: leave empty. JomCall places no outbound calls.
5. Origination: add one URI, only after the SIP service of section 4 is running and firewalled:

   ```
   sip:<SIP host>:5060;transport=tcp
   ```

   `<SIP host>` is the staging server's public address or a DNS name that points straight at it. `livekit.staging.jomcall.com` works only if that DNS record is not proxied (a proxied Cloudflare record does not carry SIP). Priority 10, weight 10.

Do not add the origination URI early. Until it exists, calls to the number simply fail at Twilio.

### T4. Attach the number to the trunk **[OWNER]**

Trunk > Numbers > Add an existing number > pick the +60 number. From this moment a call to the number is sent to the origination URI.

Rollback for T3 and T4: remove the number from the trunk, or delete the origination URI. Releasing the number stops the monthly fee; a released number may not be recoverable.

## 4. The missing SIP service: decision and work

The owner must choose where LiveKit's SIP service runs. Either choice needs written approval in `AGENTS.md` before it is deployed (RUNBOOK step 11.1), together with approval of Twilio as a new outbound service.

| | A. Self-host `livekit/sip` on the staging server | B. A LiveKit Cloud project |
|---|---|---|
| What changes | Add Redis and `livekit/sip` (Apache-2.0) to the Compose stack; add a Redis block to `livekit.yaml`; open SIP and RTP ports | Web, agent and voice all move to the Cloud project's URL and keys. Compose hard-codes `LIVEKIT_URL: ws://livekit:7880` for the voice worker, so Compose still needs a change |
| New vendor | None beyond Twilio | LiveKit Cloud: call audio passes through it. A PDPA cross-border point |
| Internet-facing ports | 5060 and an RTP range, limited to Twilio's addresses | None on the server |
| `allowed_addresses` | Enforcement unverified; the cloud firewall does the limiting | Needs LiveKit support to enable it; Twilio cannot use the password alternative |
| Cost | No new fee | Cloud plan and per-minute fees, not checked |

Recommendation: **A**. It matches the task as given (origination at the staging LiveKit address), adds no second vendor, and keeps one LiveKit for browser tests and phone calls. Its cost is engineering work and a wider attack surface.

Work for option A. None of it is built. It needs its own branch and pull request, then an owner-approved deploy:

1. Compose: a `redis` service on the private network only (no published port), and a `sip` service from a pinned `livekit/sip` image digest.
2. `infra/hosted/livekit/livekit.yaml`: a `redis:` block pointing at that Redis. This moves the LiveKit server from single-node memory to Redis-backed state. The browser voice test must be checked again after it.
3. A SIP config file: `ws_url: ws://livekit:7880`, `redis.address`, `sip_port: 5060`, `rtp_port: 10000-20000` (or a narrower range, see below), `use_external_ip: true`, and the same API key and secret as the LiveKit server, read from a 0600 env file under `/etc/jomcall`, never from git.
4. Networking. Publishing ten thousand UDP ports through Docker is slow and memory hungry. The `livekit/sip` project's own Compose example was not read for this plan; the two candidates are host networking for the `sip` container or a narrow RTP range (for example 10000 to 10100, enough for the one call at a time that `JOMCALL_MAX_CONCURRENT_CALLS=1` allows). Decide in the pull request and test it.
5. `scripts/hosted/readiness.ts` and `packages/contracts/src/hosted-env.ts`: a `sip` service entry so its env file is checked like the others.
6. Memory. The staging droplet has 2 GB. Redis and the SIP service add to it. Check `docker stats` after the deploy.
7. Optional, small: let `telephony:sip-config` take a list of numbers on the command line so it no longer needs a database. Not required for one number.

## 5. Firewall **[OWNER]**

Docker publishes ports past `ufw`, so the rules go in the DigitalOcean Cloud Firewall, as in RUNBOOK step 3b. Add exactly these inbound rules and nothing wider:

| Port | Protocol | Sources |
|---|---|---|
| 5060 | TCP | The eight Twilio signalling ranges in section 2 |
| The RTP range chosen in section 4 (default 10000 to 20000) | UDP | `168.86.128.0/18` |

UDP 5060 is not needed, because the origination URI forces TCP. Do not open 5060 to the world: an open SIP port is scanned within minutes, and the trunk's own address limit is unverified on a self-hosted server.

Check from another machine afterwards: `nmap -Pn -p 5060 <server>` must show the port filtered from a non-Twilio address.

## 6. Server and Vercel settings **[OWNER]**

Staging already runs browser voice, so `JOMCALL_VOICE_PROVIDER=hosted` and the speech keys are in place. Add:

| Where | Setting | Value |
|---|---|---|
| `/etc/jomcall/agent.env` | `JOMCALL_TELEPHONY_PROVIDER` | `livekit_sip` |
| `/etc/jomcall/agent.env` | `LIVEKIT_URL` | `wss://livekit.staging.jomcall.com`. The agent uses it for the SIP participant lookup and transfers. The internal `ws://livekit:7880` may also work but was not checked against the hosted guards, so use the public address |
| `/etc/jomcall/agent.env` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The same pair as `livekit.env`. The agent process now holds the secret |
| `/etc/jomcall/agent.env` | `JOMCALL_MAX_CONCURRENT_CALLS` | Leave unset (default 1; Google speech allows about 11 requests a minute) |
| `/etc/jomcall/agent.env` | `JOMCALL_CALL_CAP_SECONDS` | Leave unset (default 600) |
| `/etc/jomcall/agent.env` | `JOMCALL_SIP_TRANSFER_URI` | Leave unset (default `tel:{e164}`, which is what Twilio accepts) |
| Vercel, staging environment | `JOMCALL_TELEPHONY_PROVIDER` | `livekit_sip`, then redeploy. The web app only shows whether the line is connected |
| SIP service env file (new, section 4) | LiveKit key and secret | Same pair |

`JOMCALL_PHONE_URL` and `JOMCALL_VOICE_SERVICE_SECRET` are already handled: Compose sets the first, and the phone listener uses the same private bind and service secret as the browser voice endpoint. Port 54635 is never published.

Then, on the server:

```bash
cd /opt/jomcall/infra/hosted
```

```bash
JOMCALL_IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
```

Prewarm the `Kore` voice and the agent's own voice, so the busy line and fillers are cached (this sends fixed text to Google with the staging key):

```bash
docker compose run --rm voice python -m jomcall_voice.prewarm --preset Kore
```

Check before any call: `npm run hosted:readiness` passes for each service's env file; `docker compose ps` shows agent, engine and voice healthy and the new containers running; the browser voice test still works.

Database: the phone migration (`20261114190000_phone_calls.sql`) and the channel metering migration must be applied on staging. `AGENTS.md` records channel metering as applied there, which implies the phone migration is too. The plan picker and later migrations are recorded as not on staging. Confirm with the migration list before the test; `npm run hosted:migrate` is an owner step.

## 7. Trunk and dispatch rule: files and how they are applied

The generator `npm run telephony:sip-config` reads active numbers from the **local** database only and refuses any other. For one staging number, write the two files by hand in the git-ignored folder `output/telephony/`. They must have exactly the shape the generator produces (`packages/domain/src/phone/sip-config.ts`), because the voice worker and the agent rely on the agent name, the room prefix and the metadata string.

`inbound-trunk.json`:

```json
{
  "trunk": {
    "name": "jomcall-inbound",
    "numbers": ["+60XXXXXXXXX"],
    "allowed_addresses": [
      "54.169.127.128/30", "54.65.63.192/30", "54.252.254.64/30",
      "54.172.60.0/30", "54.244.51.0/30", "54.171.127.192/30",
      "35.156.191.128/30", "177.71.206.192/30"
    ]
  }
}
```

`dispatch-rule.json` (put the trunk id printed by the first command into `trunk_ids`):

```json
{
  "dispatch_rule": {
    "name": "jomcall-inbound",
    "trunk_ids": ["ST_..."],
    "rule": {
      "dispatch_rule_callee": { "room_prefix": "call-", "randomize": true }
    },
    "hide_phone_number": false,
    "room_config": {
      "agents": [
        { "agent_name": "jomcall-voice", "metadata": "{\"channel\":\"phone\"}" }
      ]
    }
  }
}
```

Apply **[OWNER]**, from that folder, with the LiveKit CLI pointed at staging. The CLI reads `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from the shell; set them for that shell only and do not write them to a file in the repository. The SIP service and Redis must already be running, or the commands fail.

```bash
lk sip inbound create inbound-trunk.json
```

```bash
lk sip dispatch create dispatch-rule.json
```

Check with `lk sip inbound list` and `lk sip dispatch list`. Rollback: `lk sip dispatch delete <id>` and `lk sip inbound delete <id>`.

The trunk and rule live in Redis. If the Redis container has no persistent volume, they are lost on restart and calls stop being answered. The Compose change in section 4 must give Redis a volume, or the files must be applied again after every restart.

## 8. Add the number to a workspace in JomCall

Use a test workspace with made-up business data. No real customer.

1. Sign in on `https://staging.jomcall.com` as the workspace owner.
2. Agent: publish it. The published version must have an AI disclosure line (and a recording notice if recording is on). Without them a call is refused as `AGENT_UNPUBLISHED` or `DISCLOSURE_REQUIRED`.
3. Open `https://staging.jomcall.com/app/phone-numbers` directly. The sidebar hides Phone numbers until the workspace has a number and the line is configured (`/channels` in `packages/domain/src/phone/routes.ts`), so the first number cannot be reached from the menu. Whether the page opens by address in the hosted app is not verified; if it does not, that is a defect to fix before the test.
4. Add number: the Twilio number in E.164, the location, the agent, and optionally a staff mobile for transfers.
5. The page should say "Phone line connected" once section 6 is deployed.

One number maps to one workspace across the whole deployment (unique among active numbers).

## 9. Plan and wallet conditions for admission

A call is checked by `app_private.channel_admission` after every other refusal. Refused callers hear nothing; the room is deleted and the owners get one email per reason per day.

The call is admitted when both hold:

1. **The workspace's plan includes a phone number.** That is `starter` (RM 49.00, 100 minutes) or `growth` (RM 129.00, 400 minutes), with a current period that is charged or still inside its 7 days of grace. `payg` and "no plan" give `NO_PHONE_ENTITLEMENT`.
2. **Money or minutes.** Either the wallet allows service (funded, low or in grace), or the charged period still has unused included minutes. Otherwise `WALLET_UNFUNDED` or `WALLET_EXHAUSTED`.

How the test workspace gets there, in order of preference:

- If the plan picker is deployed on staging: top up at least the fee, then pick Starter on `/app/billing`. A first pick starts today and charges the full fee, and refuses on a short wallet. **A top-up on staging goes through LIVE Curlec keys, so it is real money [OWNER].** It also needs `CURLEC_LIVE_ON_STAGING=1` and the sign-up allow-list, which `AGENTS.md` records as not yet set on staging.
- Otherwise the owner runs the SQL equivalent of `npm run billing:admin -- plan <org> starter "<operator>"` and, if no top-up is wanted, an operator credit. Both are writes to the staging database **[OWNER]**. The `billing:admin` script itself works on the local database only.

After a charged Starter period the wallet may sit at zero and calls are still admitted until the 100 minutes are used. Each answered test call is billed once (`voice_second`, key `call:<call id>`) from that allowance; refused and unanswered calls are free.

Other refusals to keep in mind during testing: `LINES_BUSY` (a browser voice test in progress counts as the one line), `CALLER_LIMIT` (the seventh call in an hour from the same caller number to the same business), `CALLS_SUSPENDED`, `UNKNOWN_NUMBER`.

## 10. Test call script

Have two mobile phones on different Malaysian networks, and a terminal on the server running `docker compose logs -f sip livekit voice agent`. Logs carry codes and class names only. Do not record audio into the repository. Keep to five calls an hour from one phone.

| # | Do | Expect | In the Calls log (`/app/calls`) |
|---|---|---|---|
| 1 | Call the number | Rings, answered within a few seconds. AI disclosure first, then the recording notice if on, then the greeting | A call in progress with your number |
| 2 | Ask the opening hours in BM, then in English | Correct answer in each language. Note the delay before the first word | Turns visible to owner and admin |
| 3 | Ask to book a slot | The agent reads service, day and time back and waits for "ya" or "yes" before it records anything | A booking proposal for staff, outcome "booking proposed" |
| 4 | Hang up | Call ends at once | State ended, a duration, your number, the outcome. On `/app/billing`, usage shows the seconds drawn from the allowance |
| 5 | Call from a withheld number | Answered as normal | Caller shown as withheld, no contact created |
| 6 | Start a call, then call from the second phone | Second caller hears the busy line in BM then English and is disconnected | A refused row, "lines busy" |
| 7 | Only with REFER enabled (T3) and a staff number set, during opening hours: ask for a person | Transfer rings the staff phone for up to 20 s. Answer once; let it ring out once: after ring-out the agent offers to take a message | Outcome "transferred", or "transfer failed" then a message proposal |
| 8 | Call outside the location's hours | Agent says the business is closed, offers a message, no transfer | `after_hours` behaviour, message proposal |
| 9 | Refusal check: unpublish the agent, call once, publish again | Call drops without a word | Refused row "agent not published" |

Where to look when it fails:

| Symptom | Likely place |
|---|---|
| Twilio plays an error or fast busy, nothing in server logs | Firewall, origination URI, DNS record proxied, SIP service down. Twilio console > Monitor > Logs > Calls shows the SIP response |
| SIP log shows the INVITE but no room | No trunk matches. The dialled number form may differ from `+60...`; read the user part in the SIP log and add that exact form to the trunk's `numbers` |
| Room created, no agent | Dispatch rule (agent name `jomcall-voice`, metadata) or the voice worker not registered |
| Rings for 30 s then ends | Worker joined but never published audio; check voice logs for missing keys or `phone_config_invalid` |
| Answer, then silence in one direction | RTP range not open, or `use_external_ip` picked the wrong address |
| Drops silently right after connect | A refusal. The Calls log names it; a plan or wallet refusal also emails the owners |
| Heard, but wrong language or slow | 8 kHz phone audio has never been measured against the speech services |

Write down what happened at each step and the delays, as in `docs/qa/`.

## 11. Costs

Twilio, as shown on its pricing pages on 2026-11-19 (currency symbol "$" only, presumably US dollars; confirm in the console):

| Item | Price |
|---|---|
| Malaysia local number | 4.00 per month |
| Inbound on the SIP trunk (origination), local number | 0.0278 per minute |
| Example: one number and 100 minutes in a month | 4.00 + 2.78 = 6.78 |
| Transfer to a staff mobile | An outbound (termination) leg at Twilio's Malaysia rate, not checked |
| Account upgrade | No fee found; a first top-up is needed, minimum not checked |

JomCall's own per-minute costs (Deepgram, Google speech, Anthropic) are not recomputed here; see the margin check in `docs/research/payment-providers-malaysia.md`. JomCall charges the workspace RM 0.32 a minute beyond the plan allowance (price version 2, an owner placeholder). The server, Redis and the SIP service add no fee on the existing droplet unless it must grow beyond 2 GB.

## 12. Risks and open questions

1. **Never run against a live SIP service.** Participant lookup, attributes (`sip.trunkPhoneNumber`, `sip.callID`, `sip.phoneNumber`), room deletion as hang-up and REFER transfer are checked against documentation and types only.
2. **No SIP service or Redis on staging, and the Compose change is unbuilt** (section 4). This is the largest piece of work in the plan.
3. **The generator is local only** (section 7). Hand-written files can drift from the code's constants.
4. **Trial account.** Whether it can buy the number or carry trunk calls is unverified; the plan assumes an upgrade.
5. **Unencrypted SIP and RTP** between Twilio and the server. Callers' numbers and voices cross the internet in the clear on that leg. Fixing it needs verified TLS and SRTP support in self-hosted `livekit/sip`. A PDPA point for the lawyer before real callers.
6. **Address limiting rests on the firewall.** Self-hosted enforcement of `allowed_addresses` is unverified, and Twilio cannot use the trunk password. Twilio's ranges are shared by all Twilio customers, so another Twilio account could send an INVITE to the server; the trunk's `numbers` list and JomCall's `UNKNOWN_NUMBER` refusal are the remaining guards.
7. **Twilio's ranges can change.** The firewall list and the trunk list then need updating, or calls stop.
8. **Dialled and caller number formats from Twilio are unverified.** JomCall normalises several forms (`toE164`), but LiveKit's trunk match happens first.
9. **Reachability.** Whether all Malaysian mobile and fixed networks route to a Twilio local number, and which prefix it carries, is unverified. Test from at least two networks.
10. **Bundle scope.** The bundle is in the name of Digitalize Plus. Whether a number bought under it may be used as an end customer's business line, or each customer needs their own bundle, is a question for Twilio and for the regulatory terms. It decides whether Twilio can serve paying customers at all.
11. **One call at a time.** Google's speech limit (about 11 requests a minute) keeps `JOMCALL_MAX_CONCURRENT_CALLS` at 1. A browser voice test blocks the phone line while it runs.
12. **Phone audio quality.** 8 kHz G.711 has never been measured against Deepgram `nova-3` multilingual for BM, English, Manglish or Mandarin.
13. **The phone prompt rules were never run through the 48-case gate** (design section 12).
14. **A deploy during a call.** The voice container's stop grace is 330 s but a phone call can last 600 s, so a redeploy can cut a long call.
15. **Redis becomes a dependency of every call, browser tests included**, and the trunk and rule are lost if Redis has no volume.
16. **Droplet memory** (2 GB) with two more containers.
17. **Staging is public, payments are live, and it may hold no customer data.** A real caller's number and words are personal data. Use only the owner's own phones on this number. A paying customer needs production: a paid database with backups, the PDPA cross-border decision, a decision on encryption (item 5), and items 10 to 13 closed.
18. **Refused callers hear nothing.** A plan, wallet, unpublished-agent or disclosure refusal drops the call silently. A fallback to the owner's own phone (design section 13, decision 4) is not built; Twilio's trunk has no simple "failover to a mobile" for origination, only extra origination URIs.
19. **Approvals not yet recorded.** `AGENTS.md` must record the owner's approval of Twilio as an outbound service and of the internet-facing SIP port before deployment.
20. **The first-number page** may be unreachable from the menu (section 8).
21. **PDPA export of call records is not built** (design section 4).

## 13. Order of work, with the owner's yes at each bold step

1. Owner decides option A or B (section 4) and records the approvals in `AGENTS.md`.
2. Build the Compose, Redis, SIP and readiness change on a branch; review; merge.
3. **Deploy it to staging.** Re-run the browser voice test.
4. **Open the firewall rules** (section 5) and check them from outside.
5. **Upgrade Twilio and buy the number** (T1, T2).
6. **Create the trunk** without origination (T3).
7. **Set the env values and redeploy** agent, voice and web (section 6); prewarm.
8. **Apply the trunk and dispatch rule** (section 7).
9. Publish the agent, add the number, **start a plan** on the test workspace (sections 8, 9).
10. **Add the origination URI and attach the number** (T3.5, T4).
11. Run the test script (section 10) and record the results under `docs/qa/`.

Full rollback: remove the number from the Twilio trunk; set `JOMCALL_TELEPHONY_PROVIDER=disabled` in `agent.env` and Vercel and redeploy; delete the dispatch rule and trunk; close the firewall rules; release the number to stop the monthly fee.
