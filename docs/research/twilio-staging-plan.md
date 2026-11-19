# Twilio number on hosted staging: plan and owner checklist

Date: 2026-11-19. Status: partly carried out on 2026-11-19. No call has been answered yet.

Done that day, by the owner and the main session (reported to the author of this document, who did not see the server or the Twilio console):

- The SIP service and Valkey run on the staging server (they were already in the Compose file, pull request #46, `66a5b3e`). Sections 4 and 6.
- The owner bought the number `+60422530XX` (last two digits left out here because this repository is public) and created the Twilio trunk `jomcall-staging` with the origination URI `sip:livekit.staging.jomcall.com:5060;transport=tcp`. Steps T2 and T3.
- The agent runs with `JOMCALL_TELEPHONY_PROVIDER=livekit_sip` since pull request #56 (`2fef3c1`). Section 6.
- The LiveKit trunk `ST_LhsjeYrVVz9K` and dispatch rule `SDR_Muu3nfdD7CR4` exist. Section 7.

Not done: the Twilio account upgrade (T1, now known to be required), the cloud firewall rules (section 5, urgent), and a successful test call (section 10). Not reported either way: whether the number is attached to the trunk (T4), the number added to a workspace (section 8), the plan and wallet (section 9), the Vercel setting and the prewarm (section 6).

Correction: the first version of this document said staging had no SIP service and no Redis. That was wrong. The author read an older checkout of the Compose file.

Goal: one real Malaysian number from Twilio, on `staging.jomcall.com`, answered by the published AI agent of one test workspace.

Every step marked **[OWNER]** costs money, faces the internet or writes to a hosted service. Each one needs the owner's explicit yes at the time it is done.

Related documents: `docs/superpowers/specs/2026-11-14-phone-line-design.md` (design), `docs/research/phone-line-owner-steps.md` (generic owner steps, written before a provider was chosen), `infra/hosted/RUNBOOK.md` step 11, `docs/research/phone-line-options.md` (provider comparison).

## 1. Summary

The path of a call:

```
caller, Malaysian network
  -> Twilio number (+60, bought with bundle "Digitalize Plus - MY Local")
  -> Twilio Elastic SIP trunk, origination URI
  -> LiveKit SIP service on the staging server (livekit/sip, host network, port 5060)
  -> LiveKit room "call-<dialled number>_<random>" on livekit.staging.jomcall.com
  -> jomcall-voice worker -> agent process (phone listener, port 54635, private)
```

The SIP service exists: `infra/hosted/docker-compose.yml` on `main` has a `sip` service (`livekit/sip` v1.25.0) and a `redis` service (Valkey 8.1), and both were running on the server on 2026-11-19. Three things stand between that day's state and a first answered call:

1. **The Twilio account is a trial, and a trial cannot receive these calls.** Two inbound test calls failed at Twilio with `21264 From number not verified`, even with the caller's number verified. The upgrade is required (section 3, step T1).
2. **Port 5060 is open to the internet.** Scanners were already probing it. The cloud firewall rules of section 5 come before any further testing.
3. **The trunk and dispatch generator cannot read staging, and the server has no `lk` CLI.** `scripts/telephony/sip-config.ts` stops with `LOCAL_DATABASE_REQUIRED` unless the database is `127.0.0.1:54622`. RUNBOOK step 11.4 says to run it "against this environment's database", which the script refuses. The trunk and rule were created another way (section 7), and they are lost whenever Valkey restarts.

The code has never touched a live SIP service. The LiveKit telephony implementation (`packages/domain/src/phone/telephony.ts`) has run only against an in-memory fake, and the fake SIP caller (`npm run phone:simulate`) has never been run. Expect the first real call to find defects.

Staging must not hold customer data (free database, no backups; `AGENTS.md`). This plan gives a real test line. It does not give a line a paying customer can use. Section 12 lists what a customer line needs on top.

## 2. What was verified, and how

Documentation was read on 2026-11-19 through a page-summarising fetcher, so the wording below is paraphrase unless quoted. Repository facts were read from `origin/main` at `2fef3c1`.

### Seen on staging on 2026-11-19

Read-only checks by the main session, and the owner's own console work. The author of this document did not see them.

| Fact | Where |
|---|---|
| The `sip` and `redis` containers were running, up 23 hours | server |
| `livekit.staging.jomcall.com` resolves straight to the server (not proxied) | DNS |
| Port 5060 was being probed by scanners | SIP service log |
| The server has no `lk` CLI | server |
| `npm run telephony:sip-config` refuses a hosted database | server |
| With `JOMCALL_TELEPHONY_PROVIDER=livekit_sip` the agent restarted in a loop with `LOCAL_DATABASE_REQUIRED` until pull request #56 (`2fef3c1`) | agent log |
| `LIVEKIT_URL=ws://livekit:7880` works in `agent.env` | server |
| A Twilio trial account failed two inbound test calls at Twilio with `21264 From number not verified`, with the caller's number verified | Twilio call log |
| No call has been answered | |

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

- Why exactly the trial refuses a verified caller on the trunk. The trial pages do not say. The observed result is enough: upgrade.
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

Not done yet, and required. On 2026-11-19 the trial account could buy the number and create the trunk, but two inbound test calls failed at Twilio with `21264 From number not verified`, even though the caller's number was verified. No call reaches the server until the account is upgraded. Upgrading means adding a payment method and a first top-up. The minimum top-up amount was not checked.

Before upgrading, check in the console:

- that the bundle "Digitalize Plus - MY Local" still shows **Approved** and stays attached to this account after the upgrade;
- the currency of the prices;
- that **auto recharge is off**, and set a usage trigger (for example an alert at USD 10) so a fault cannot drain the balance.

### T2. Buy the number **[OWNER, costs money, monthly]**

Done on 2026-11-19: the owner bought `+60422530XX`. The steps are kept for the record.

1. Phone Numbers > Buy a number. Country Malaysia, type Local, capability Voice.
2. Pick one number. Write it down in E.164, for example `+60XXXXXXXXX`.
3. At checkout, assign the approved bundle and its address. The address must be inside the locality of the number's prefix, so pick a prefix that matches the bundle's address.
4. Leave the number's voice configuration empty for now. Step T4 attaches it to the trunk.

### T3. Create the trunk **[OWNER]**

Done on 2026-11-19: trunk `jomcall-staging`, origination `sip:livekit.staging.jomcall.com:5060;transport=tcp`. The settings in items 2 and 3 below were not reported; check them in the console.

1. Elastic SIP Trunking > Trunks > Create new SIP trunk. Name it `jomcall-staging`.
2. General settings: Secure Trunking **off** (TLS and SRTP at LiveKit SIP are not verified). Call recording **off** (JomCall records nothing in this milestone and the recording disclosure is tied to JomCall's own setting).
3. Call Transfer (SIP REFER): **Enabled**, and **Enable PSTN Transfer**, only if the transfer test in section 10 is wanted. Transfers place an outbound call that Twilio bills. Leave it off for the first call.
4. Termination: leave empty. JomCall places no outbound calls.
5. Origination: one URI.

   ```
   sip:livekit.staging.jomcall.com:5060;transport=tcp
   ```

   `livekit.staging.jomcall.com` resolves straight to the server, which SIP needs (a proxied Cloudflare record does not carry SIP). Priority 10, weight 10.

The plan was to add the origination URI only after the firewall rules. It was added first, so the firewall step is now the urgent one.

### T4. Attach the number to the trunk **[OWNER]**

Whether this was done on 2026-11-19 was not reported; the failed test calls suggest it was. Trunk > Numbers > Add an existing number > pick the +60 number. From this moment a call to the number is sent to the origination URI.

Rollback for T3 and T4: remove the number from the trunk, or delete the origination URI. Releasing the number stops the monthly fee; a released number may not be recoverable.

## 4. The SIP service on staging: what exists

The owner decided on 2026-11-18 that LiveKit's SIP service runs on the staging server (`AGENTS.md`; `infra/hosted/RUNBOOK.md` step 11.1). Pull request #46 (`66a5b3e`) added it, and it was running on 2026-11-19. LiveKit Cloud is not used.

| Part | What it is |
|---|---|
| `sip` | `livekit/sip` v1.25.0 (Apache-2.0), pinned by digest, on the host's network. Listens on 5060 (UDP and TCP) and on 10000-10200/udp for phone audio, on the server's public address. Connects to LiveKit at `ws://127.0.0.1:7880` and to Valkey at `127.0.0.1:6379`. `use_external_ip: true`. Keys from `/etc/jomcall/sip.env` (the same pair as the LiveKit server) |
| `redis` | Valkey 8.1 (BSD-3-Clause), the message bus between LiveKit and the SIP service. Started with `--save "" --appendonly no` on a tmpfs: nothing is kept on disk. Published on `127.0.0.1:6379` only |
| `livekit` | Gained a `redis` block in `infra/hosted/livekit/livekit.yaml`, and publishes 7880 on `127.0.0.1` for the SIP service |

What still matters:

1. **RTP range.** Phone audio uses 10000-10200/udp, not the 10000 to 20000 of LiveKit's page. The firewall rule in section 5 uses that range.
2. **Nothing on disk.** The inbound trunk and the dispatch rule live in Valkey. A restart of the `redis` container, a `docker compose down`, or a server reboot loses both, and calls then stop being answered until they are created again (section 7). The new trunk gets a new id, so the dispatch rule must be created again with it.
3. **Memory.** The staging droplet has 2 GB and now runs two more containers. Check `docker stats` under a call.
4. **LiveKit now depends on Valkey.** Browser voice tests go through it too. If Valkey is down, no call of either kind starts.
5. **Open port.** The SIP service is on the host's network, so 5060 and the RTP range face the internet until the cloud firewall limits them (section 5).

Optional, small, not built: let `telephony:sip-config` take a list of numbers on the command line so it no longer needs a database.

## 5. Firewall **[OWNER]**

Not done yet, and urgent: on 2026-11-19 port 5060 was reachable from anywhere and scanners were probing it. Do this before the next test call.

The SIP service is on the host's network and Docker publishes ports past `ufw`, so the rules go in the DigitalOcean Cloud Firewall, as in RUNBOOK step 3b. Add exactly these inbound rules and nothing wider:

| Port | Protocol | Sources |
|---|---|---|
| 5060 | TCP | The eight Twilio signalling ranges in section 2 |
| 10000 to 10200 | UDP | `168.86.128.0/18` |

UDP 5060 is not needed, because the origination URI forces TCP; the SIP service listens on it, so the firewall must not allow it. Do not leave 5060 open to the world: the trunk's own address limit is unverified on a self-hosted server, so the firewall is the guard.

Check from another machine afterwards: `nmap -Pn -p 5060 <server>` must show the port filtered from a non-Twilio address.

## 6. Server and Vercel settings **[OWNER]**

Staging already runs browser voice, so `JOMCALL_VOICE_PROVIDER=hosted` and the speech keys are in place. The agent settings were in place on 2026-11-19. With them the agent restarted in a loop with `LOCAL_DATABASE_REQUIRED` (the phone call repository accepted only the local database) until pull request #56 (`2fef3c1`); the server must run a build that contains it. The Vercel setting and the prewarm were not reported. The settings:

| Where | Setting | Value |
|---|---|---|
| `/etc/jomcall/agent.env` | `JOMCALL_TELEPHONY_PROVIDER` | `livekit_sip` |
| `/etc/jomcall/agent.env` | `LIVEKIT_URL` | `ws://livekit:7880`, seen working on 2026-11-19. The agent uses it for the SIP participant lookup and transfers |
| `/etc/jomcall/agent.env` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The same pair as `livekit.env`. The agent process now holds the secret |
| `/etc/jomcall/agent.env` | `JOMCALL_MAX_CONCURRENT_CALLS` | Leave unset (default 1; Google speech allows about 11 requests a minute) |
| `/etc/jomcall/agent.env` | `JOMCALL_CALL_CAP_SECONDS` | Leave unset (default 600) |
| `/etc/jomcall/agent.env` | `JOMCALL_SIP_TRANSFER_URI` | Leave unset (default `tel:{e164}`, which is what Twilio accepts) |
| Vercel, staging environment | `JOMCALL_TELEPHONY_PROVIDER` | `livekit_sip`, then redeploy. The web app only shows whether the line is connected |
| `/etc/jomcall/sip.env` (root, mode 0600) | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Same pair. In place, since the SIP service runs |

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

Check before any call: `npm run hosted:readiness` passes for each service's env file; `docker compose ps` shows agent, engine and voice healthy and `sip` and `redis` running; `docker compose logs sip` shows "sip signaling listening on" for udp and tcp; the browser voice test still works.

Database: the phone migration (`20261114190000_phone_calls.sql`) and the channel metering migration must be applied on staging. `AGENTS.md` records channel metering as applied there, which implies the phone migration is too. The plan picker and later migrations are recorded as not on staging. Confirm with the migration list before the test; `npm run hosted:migrate` is an owner step.

## 7. Trunk and dispatch rule: files and how they are applied

Done on 2026-11-19: inbound trunk `ST_LhsjeYrVVz9K` and dispatch rule `SDR_Muu3nfdD7CR4` exist on staging. The server has no `lk` CLI, so the main session created them with `livekit-server-sdk` from inside the agent container, which already holds the LiveKit values. The exact fields it sent were not reported to the author; they must match the two shapes below.

Both are lost whenever Valkey restarts (section 4). Creating them again gives new ids, and the rule must name the new trunk id.

The generator `npm run telephony:sip-config` reads active numbers from the **local** database only and refuses any other (confirmed on the server that day). For one staging number, the two definitions are written by hand, as files in the git-ignored folder `output/telephony/` or as the same fields passed to the SDK. They must have exactly the shape the generator produces (`packages/domain/src/phone/sip-config.ts`), because the voice worker and the agent rely on the agent name, the room prefix and the metadata string.

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

Two ways to apply **[OWNER]**. The one used on 2026-11-19: `livekit-server-sdk` in a one-off Node command inside the agent container. That command is not in the repository; a small checked-in script would make the step repeatable after a restart. The other: the LiveKit CLI on a machine that can reach LiveKit, from that folder. The CLI reads `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from the shell; set them for that shell only and do not write them to a file in the repository. The SIP service and Valkey must be running, or the commands fail.

```bash
lk sip inbound create inbound-trunk.json
```

```bash
lk sip dispatch create dispatch-rule.json
```

Check with `lk sip inbound list` and `lk sip dispatch list`. Rollback: `lk sip dispatch delete <id>` and `lk sip inbound delete <id>`.

After any restart of Valkey, list the trunks and dispatch rules before a test call (`lk sip inbound list` and `lk sip dispatch list`, or the SDK), and create them again if they are gone. Open choice for the owner: keep this manual step, give Valkey a volume with persistence on, or have a script create them at start.

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

JomCall's own per-minute costs (Deepgram, Google speech, Anthropic) are not recomputed here; see the margin check in `docs/research/payment-providers-malaysia.md`. JomCall charges the workspace RM 0.32 a minute beyond the plan allowance (price version 2, an owner placeholder). The server, Valkey and the SIP service add no fee on the existing droplet unless it must grow beyond 2 GB.

## 12. Risks and open questions

1. **Never run against a live SIP service.** Participant lookup, attributes (`sip.trunkPhoneNumber`, `sip.callID`, `sip.phoneNumber`), room deletion as hang-up and REFER transfer are checked against documentation and types only.
2. **The trunk and dispatch rule do not survive a restart.** Valkey keeps nothing on disk (section 4). After a reboot or a `docker compose down`, calls go unanswered until both are created again, and nothing warns anyone.
3. **The generator is local only and the server has no `lk` CLI** (section 7). The trunk and rule were made with a one-off SDK command that is not in the repository. Hand-written definitions can drift from the code's constants.
4. **Trial account.** It fails inbound calls with `21264 From number not verified`. No call can be tested until the upgrade (T1).
5. **Unencrypted SIP and RTP** between Twilio and the server. Callers' numbers and voices cross the internet in the clear on that leg. Fixing it needs verified TLS and SRTP support in self-hosted `livekit/sip`. A PDPA point for the lawyer before real callers.
6. **Address limiting rests on the firewall, which is not set yet.** Port 5060 was open and being probed by scanners on 2026-11-19. Self-hosted enforcement of `allowed_addresses` is unverified, and Twilio cannot use the trunk password. Twilio's ranges are shared by all Twilio customers, so another Twilio account could send an INVITE to the server; the trunk's `numbers` list and JomCall's `UNKNOWN_NUMBER` refusal are the remaining guards.
7. **Twilio's ranges can change.** The firewall list and the trunk list then need updating, or calls stop.
8. **Dialled and caller number formats from Twilio are unverified.** JomCall normalises several forms (`toE164`), but LiveKit's trunk match happens first.
9. **Reachability.** Whether all Malaysian mobile and fixed networks route to a Twilio local number, and which prefix it carries, is unverified. Test from at least two networks.
10. **Bundle scope.** The bundle is in the name of Digitalize Plus. Whether a number bought under it may be used as an end customer's business line, or each customer needs their own bundle, is a question for Twilio and for the regulatory terms. It decides whether Twilio can serve paying customers at all.
11. **One call at a time.** Google's speech limit (about 11 requests a minute) keeps `JOMCALL_MAX_CONCURRENT_CALLS` at 1. A browser voice test blocks the phone line while it runs.
12. **Phone audio quality.** 8 kHz G.711 has never been measured against Deepgram `nova-3` multilingual for BM, English, Manglish or Mandarin.
13. **The phone prompt rules were never run through the 48-case gate** (design section 12).
14. **A deploy during a call.** The voice container's stop grace is 330 s but a phone call can last 600 s, so a redeploy can cut a long call.
15. **Valkey is a dependency of every call, browser tests included.**
16. **Droplet memory** (2 GB) with the SIP service and Valkey added. Not measured under a call.
17. **Staging is public, payments are live, and it may hold no customer data.** A real caller's number and words are personal data. Use only the owner's own phones on this number. A paying customer needs production: a paid database with backups, the PDPA cross-border decision, a decision on encryption (item 5), and items 10 to 13 closed.
18. **Refused callers hear nothing.** A plan, wallet, unpublished-agent or disclosure refusal drops the call silently. A fallback to the owner's own phone (design section 13, decision 4) is not built; Twilio's trunk has no simple "failover to a mobile" for origination, only extra origination URIs.
19. **Approvals.** `AGENTS.md` records the owner's decision of 2026-11-18 to run the SIP service on the server. Check that it also names Twilio as an approved outbound service.
20. **The first-number page** may be unreachable from the menu (section 8).
21. **PDPA export of call records is not built** (design section 4).

## 13. Order of work, with the owner's yes at each bold step

Done by 2026-11-19: the SIP service and Valkey on the server; the number bought; the Twilio trunk with its origination URI; the agent settings and the fix in pull request #56; the LiveKit trunk and dispatch rule.

Left, in this order:

1. **Open only the firewall rules of section 5** and check them from outside. Urgent: the port is open now.
2. **Upgrade the Twilio account** (T1). Set the usage alert and keep auto recharge off.
3. Check the trunk settings in the Twilio console (T3 items 2 and 3) and that the number is attached (T4).
4. Check the Vercel setting, then **prewarm** the voices (section 6).
5. Check that the LiveKit trunk and dispatch rule still exist (section 7); create them again if Valkey restarted.
6. Publish the agent, add the number, **start a plan** on the test workspace (sections 8, 9).
7. Run the test script (section 10) and record the results under `docs/qa/`.

Full rollback: remove the number from the Twilio trunk; set `JOMCALL_TELEPHONY_PROVIDER=disabled` in `agent.env` and Vercel and redeploy; delete the dispatch rule and trunk; close the firewall rules; release the number to stop the monthly fee.
