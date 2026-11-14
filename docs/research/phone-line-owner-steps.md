# Phone line: owner steps for the first real call

Date: 2026-11-14. Design: `docs/superpowers/specs/2026-11-14-phone-line-design.md`.

The code side of the phone line is built and tested against an in-memory fake. Nothing in it has touched a carrier, a real number, a SIP trunk or a handset. These are the steps only the owner can take. Each one is outward-facing or costs money, so none of them has been done.

## 0. One decision first: where the SIP service runs

The local LiveKit server (Docker, loopback ports 54630–54632) does not receive phone calls by itself. Calls arrive at LiveKit's separate SIP service, which a provider must be able to reach from the internet. You have two options:

| Option | What it means | Fits the "all runtime local" rule? |
|---|---|---|
| A. LiveKit Cloud project | LiveKit hosts the SIP service and the rooms. The worker and the agent process connect to it with that project's URL and keys. | No: it is a new hosted service and needs your written approval in `AGENTS.md`. |
| B. Self-hosted `livekit/sip` (Apache-2.0) next to the local server | Adds Redis and the SIP container, plus a public SIP port (5060 UDP/TCP) and an RTP port range opened to the provider's addresses only. | Partly: the services stay yours, but a port faces the internet. Needs your approval too. |

My call: **A for the first test call** (fewest moving parts, no open ports on your machine). Move to B later if hosting cost or data location requires it. Either way, record the approval in `AGENTS.md` before step 4.

## 1. Provider account and a Malaysian number

Pick a SIP trunk provider that sells Malaysian (+60) numbers and supports SIP REFER for transfers (`docs/research/phone-line-options.md` compares them). In its console:

| Form field (names vary by provider) | What to enter |
|---|---|
| Number / DID | Buy one +60 number. Write it down in E.164, e.g. `+603xxxxxxxx`. |
| Inbound / origination URI | The SIP URI of your LiveKit SIP service: for option A, the project's SIP URI from the LiveKit Cloud settings page; for option B, `sip:<your public host>:5060`. |
| Transport | TCP or UDP. TLS only if your SIP service has a certificate. |
| Codecs | PCMU (G.711 µ-law) and PCMA (G.711 A-law). G.722 if offered. |
| Authentication | Prefer IP allow-listing of the provider's signalling addresses. If the provider only offers digest auth, choose a username and a long random password, and keep the password out of git. |
| REFER / call transfer | Switch it on (Twilio calls it "Enable call transfer"; Plivo needs the transfer target written as `sip:+E164@<trunk>.zt.plivo.com`). |
| Failover number | Optional but recommended: your own mobile, so a caller still reaches a person if JomCall refuses or fails (design §13, decision 4). |

## 2. Add the number in JomCall

1. Publish the agent (Agent builder → Publish). An unpublished agent refuses calls.
2. Local app (port 4182) → Phone numbers → Add number. Enter the number in E.164, pick the location, and optionally a staff number for transfers (used during opening hours only).
3. Check the screen says **Not connected**. That is correct until step 4.

## 3. Generate and apply the LiveKit trunk and dispatch rule

```bash
npm run telephony:sip-config -- --allowed 203.0.113.10,203.0.113.11
```

Replace the example addresses with your provider's signalling addresses. With digest auth instead, use `--username <name>`; the script never writes a password. The command writes two files into the git-ignored folder `output/telephony/`:

- `inbound-trunk.json`: one inbound trunk listing every active JomCall number, the allowed addresses, `krisp_enabled` only when you pass `--krisp`.
- `dispatch-rule.json`: a callee rule that names each room `call-<dialled number>_<random>`, dispatches the agent `jomcall-voice` with the fixed metadata `{"channel":"phone"}`, and is bound to that trunk.

Apply them with the LiveKit CLI from that folder, against the project you chose in step 0. The script prints the exact commands; they are:

```bash
lk sip inbound create inbound-trunk.json
```

```bash
lk sip dispatch create dispatch-rule.json
```

For digest auth, add the password with `lk sip inbound update` or the LiveKit console, not in the JSON file. When you add or remove a number later, regenerate and update the existing trunk (`--trunk <ST_id>`).

## 4. Environment values

Put these in the git-ignored env files read by the agent process, the voice worker and the local web app. Never commit them. The web app reads the switches only to show whether the line is connected; it never places or answers a call.

| Name | Value | Read by |
|---|---|---|
| `JOMCALL_TELEPHONY_PROVIDER` | `livekit_sip` (default `disabled`) | agent process, web app |
| `JOMCALL_VOICE_PROVIDER` | `hosted` (phone calls use the same speech and brain services) | agent process, web app |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The project from step 0. The agent process now holds the secret: it checks the SIP caller and starts transfers. | agent process, voice worker, web app |
| `JOMCALL_SIP_TRANSFER_URI` | Optional. Default `tel:{e164}`. For Plivo: `sip:{e164}@<trunk-id>.zt.plivo.com`. | agent process |
| `JOMCALL_MAX_CONCURRENT_CALLS` | Optional. Default `1` (Google speech is limited to about 11 requests a minute). | agent process |
| `JOMCALL_CALL_CAP_SECONDS` | Optional. Default `600`. | agent process |
| `JOMCALL_PHONE_URL` | Optional. Default `http://127.0.0.1:54635` (the agent's loopback phone listener). | voice worker |

Restart the agent process, the voice worker and the web app. The phone numbers screen should now say **Phone line connected**.

Before a call, run `npm run voice:prewarm` once for the `Kore` preset and once for the agent's own voice, so the busy line and fillers are cached (it sends fixed text to Google and is rate limited). A refused caller hears the busy line in `Kore`, because a refusal comes before the agent's settings are read; if it is not cached, the caller hears nothing before the hang-up.

## 5. Forwarding an existing business number (optional)

If the business keeps its current number, forward it to the new JomCall number:

- Mobile lines in Malaysia: the usual GSM codes work on most carriers: `**21*<JomCall number>#` forwards all calls, `**61*<number>#` forwards only unanswered calls, `##21#` cancels. Check with the carrier; some charge for forwarding.
- Fixed lines (TM Unifi and others): forwarding is set in the carrier's portal or by request.
- Forward "when unanswered" first, so staff still pick up during busy hours and JomCall catches the rest.

A forwarded call shows the original caller's number to JomCall only if the carrier passes it through; otherwise the call log says "Number withheld".

## 6. The first real test call

Call the number from your own phone. Check, in this order:

1. It rings and is answered within a few seconds. (LiveKit answers once the agent publishes audio.)
2. You hear the AI disclosure first, then the recording notice if recording is on, then the greeting. Nothing can skip this.
3. Ask an opening-hours question in BM, then in English. Note the delay before the first word.
4. Ask to book a slot. The agent must read the details back and wait for your "ya" or "yes" before it records anything. The booking stays a proposal for staff to confirm.
5. During opening hours, ask for a person. If a staff number is set, the call should transfer (20 s ring). Let it ring out once: you should stay with the agent, which offers to take a message.
6. Hang up. In Calls, the call shows your number, the outcome, and (for owners and admins) what was said. The booking proposal is listed for follow-up.
7. Call twice at once from two phones: the second caller should hear the busy line and be disconnected.

Write down for each step what happened and the delays, and keep audio out of git. Any failure: stop, note the step, and check `voice` worker and agent logs (they log codes and class names only, never numbers or words).

## What remains unverified until these steps are done

- Every LiveKit SIP call, attribute and transfer has been checked against documentation and types only.
- The fake SIP caller (`npm run phone:simulate`) has never been run.
- 8 kHz phone audio has not been measured against BM, English, Manglish or Mandarin speech.
- The phone-specific prompt rules have not been run through the 48-case gate.
