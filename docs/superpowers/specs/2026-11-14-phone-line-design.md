# Phone line: inbound calls into the published agent (milestone B, code side)

Date: 2026-11-14. Status: written and built by the assistant overnight while the owner was asleep. Not reviewed by the owner. No telephony account exists. Nothing here has touched a real phone network.

This is milestone B of `docs/superpowers/specs/2026-11-13-inbound-voice-design.md`, cut down to what can be built and tested before a number is bought. Calls marked **my call** are decisions the assistant made so that work could continue. Each one is listed again in section 13 with a recommendation, for the owner to accept or change.

## 1. What this milestone delivers

A caller dials a business's Malaysian number. The call goes from the provider's SIP trunk to LiveKit SIP, then into a LiveKit room. The `jomcall-voice` worker answers with the AI and recording disclosure and then the greeting, and talks to the caller using the business's **published** agent version. The result is a real call record with turns, tool steps, an outcome, a duration and the caller's number. The owner sees the call in the local app's call log.

Everything up to the trunk is code in this branch. The trunk, the number and the forwarding are owner steps (`docs/research/phone-line-owner-steps.md`).

Not in this milestone: warm transfer, recording audio (the recording flag and its disclosure only), the after-call WhatsApp summary, missed-call text-back, billing, outbound calls, a number pool, forwarding verification.

## 2. LiveKit facts this design relies on

All read on 2026-11-14 from the official documentation (Markdown pages under `https://docs.livekit.io/`) and from the installed packages: `livekit-server-sdk` 2.19.2 (`dist/SipClient.d.ts`) and the Python `livekit-api` shipped with `livekit-agents` 1.6.0 (`livekit/api/sip_service.py`, `livekit/api/access_token.py`).

| Fact | Source |
|---|---|
| An inbound trunk lists `numbers`, and limits who may send calls with `allowed_addresses` and/or `auth_username`/`auth_password`. `allowed_numbers` limits caller numbers. It is created with `lk sip inbound create <file>`, and the JSON wraps a top-level `trunk` key | `telephony/accepting-calls/inbound-trunk.md` |
| `allowed_addresses` must be enabled for a LiveKit Cloud project by support. Until then it is saved but not enforced | same page |
| `ringing_timeout` limits how long the caller rings while LiveKit waits for someone to subscribe to the caller's audio. When it expires, the call is rejected with `486 Busy Here`, and `ringing_timeout_status` can change that code | same page |
| Username and password are not supported by Twilio Elastic SIP Trunking | same page |
| A dispatch rule wraps a top-level `dispatch_rule` key and is created with `lk sip dispatch create <file>`. `room_config.agents[]` carries `agent_name` and a **fixed** `metadata` string that the agent receives as job metadata | `telephony/accepting-calls/dispatch-rule.md` |
| An `individual` rule names the room after the **caller's** number plus a random suffix. The docs warn that this personal data ends up in logs and traces. A `callee` rule names it after the **dialled** number, with an optional prefix and, with `randomize: true`, a random suffix | same page |
| A SIP participant has `kind == SIP`. Its attributes include `sip.phoneNumber` (the caller), `sip.trunkPhoneNumber` (the dialled number), `sip.callID`, `sip.callIDFull`, `sip.callStatus` (`ringing`, then `active` once the SIP participant subscribes to remote audio, and `hangup`), `sip.trunkID`, `sip.ruleID`, and for Twilio `sip.twilio.callSid`. `sip.phoneNumber` is missing when the rule sets `hide_phone_number` | `reference/telephony/sip-participant.md` |
| Disconnect reasons: `CLIENT_INITIATED` (either side hung up) and `ROOM_DELETED` (deleting the room ends the call) | same page |
| LiveKit answers an inbound call after another participant publishes audio. Cold transfer is `TransferSIPParticipant` (SIP REFER). It fails with `failed_precondition` before answer. `ringing_timeout` defaults to 30 s. On failure the caller stays in the room and the error carries `sip_transfer_reason`: `STR_REJECTED`, `STR_RINGING_TIMEOUT`, `STR_CALL_ENDED` or `STR_UNSPECIFIED`. A 408 `canceled` error can also come back with no reason | `telephony/features/transfers/cold.md` |
| Twilio must have REFER switched on for the trunk. Plivo allows REFER by default, and its `transfer_to` must be `sip:+<E.164>@<trunk-id>.zt.plivo.com`. Caller ID on a transfer is set on the trunk, not per transfer | same page |
| Warm transfer needs an outbound trunk and dials the staff member into a consultation room | `telephony/features/transfers/warm.md` |
| Default SIP codecs are `PCMU`, `PCMA` and `G722`. PCMU and PCMA run at 8 kHz | `reference/telephony/codecs-negotiation.md` |
| A participant token can carry a `kind` claim and attributes (`AccessToken.with_kind`, `with_attributes`), which the local simulator uses to look like a SIP caller | installed `livekit/api/access_token.py` |
| `JobContext.delete_room()` deletes the room and disconnects everyone, which hangs up a SIP caller | installed `livekit/agents/job.py` |

## 3. The path of one call

```
caller ── PSTN ── provider trunk ── SIP ── LiveKit SIP ──┐
                                                         │ callee rule, randomize, prefix "call-"
                                         room "call-+60XXXXXXXX_<random>"
                                                         │ room_config.agents: jomcall-voice, metadata {"channel":"phone"}
                                               voice worker (Python)
                                                         │ 1. waits for a participant of kind SIP
                                                         │ 2. POST /phone/calls {room, identity}  (loopback)
                                               agent process: phone server
                                                         │ 3. asks LiveKit RoomService for that participant; it must be SIP and its sip.* attributes are read from LiveKit, not from the worker
                                                         │ 4. app_private.agent_call('call_start', ...) in one transaction:
                                                         │    number → location, agent, published version; refusals; concurrency guard; contact; after hours; call row; token hash
                                                         │ 5. returns {callId, token, voice, greeting, disclosure, recordingDisclosure, capSeconds}
                                               voice worker speaks the disclosure, then turns go to POST /phone/turns with the per-call token
```

Why the room is named after the dialled number (**my call**): an `individual` rule would put the caller's number in the room name, and the docs warn that room names are kept in logs. The dialled number is the business's own number, so it is not the caller's personal data.

### 3.1 How the worker gets a per-call credential (**my call**)

A dispatch rule can only pass a fixed metadata string, so no per-call token can come through the rule. A secret in SIP headers is ruled out. Two server-side options were considered:

1. **The worker asks and the server checks with LiveKit (chosen).** The worker sends only the room name and the participant identity. The agent process then reads the participant from LiveKit with `RoomServiceClient.getParticipant`. It refuses unless the participant is of kind SIP and has `sip.callID` and `sip.trunkPhoneNumber`. Every fact the call is built on (the dialled number, the caller's number, the call ID) comes from LiveKit, not from the request. A local process that can reach the loopback port can only start a call for a SIP participant that really exists in a real room, and only once per `sip.callID`, enforced by a unique index. The token is random, only its SHA-256 is stored, and it is bound to one call row and expires with it.
2. **A LiveKit webhook calls `createDispatch` with the token in the dispatch metadata**, as the browser path does today. This was rejected for now. The local LiveKit server runs in Docker bridge mode and cannot reach a listener bound to the host's 127.0.0.1. In production it adds a public webhook endpoint. It remains a possible later change, and the server-side call start (`startPhoneCall`) does not depend on the transport.

The agent process now holds the LiveKit API key and secret, which it needs for the participant lookup and for transfers. Until now only the web server and the worker held them (**my call**, recorded in `AGENTS.md`).

The phone server is a new loopback listener on `127.0.0.1:54635`, separate from the browser voice endpoint on 54633. The 54633 endpoint and its authentication are left untouched, because a parallel session is changing them for the hosted mode.

## 4. Data model

New migration files only. Every table has `org_id`, row-level security is forced, and grants follow the existing style.

- **`app.phone_number`**: `e164` (unique among active numbers across all organizations, because one dialled number must map to exactly one business), `location_id`, `agent_id`, `label`, `active`, `transfer_e164` (the staff number for transfers, optional), `revision`. Owners and admins write; all members read.
- **`app.call`**: `phone_number_id`, `location_id`, `agent_id`, `agent_version_id` (not null, the version actually used), `snapshot` (copied from the version at call start so the call keeps what it answered from even if versions are pruned later), `direction` (`inbound`), `caller_e164` (null when the caller ID is withheld), `dialled_e164`, `contact_id`, `sip_call_id` (unique), `room`, `participant_identity`, `state` (`active`, `ended`, `refused`), `refusal`, `outcome` (`answered`, `booking_proposed`, `message`, `handoff`, `transferred`, `transfer_failed`, `refused`, `abandoned`), `end_reason`, `language`, `recording_enabled`, `after_hours`, `do_not_contact`, `disclosure_played_at`, `started_at`, `answered_at`, `ended_at`, `duration_seconds`, `token_hash`, `token_expires_at`, `pending_readback`. All members may **read** calls, because the call log is the staff's daily screen, but turns and tool steps are owner and admin only (**my call**).
- **`app.call_turn`**, **`app.call_tool_step`**, **`app.call_proposal`**: the same shape as the test tables. A proposal waits for staff (`state` is `pending`, `done` or `dismissed`). Kinds are `booking`, `message` and `handoff`.
- **`app.organization.calls_suspended_at`**: a switch that refuses calls for one organization. It is named for calls so it does not collide with any billing or suspension column another session may add.

**PDPA.** At call start, the caller's number is matched to a contact in the organization, and a contact is created when there is none (name "Caller +60…", source `phone`). `call.contact_id` references the contact with `on delete cascade`, so the existing contact deletion job also deletes that caller's calls, turns, steps and proposals, with no change to the privacy function. A call whose caller ID is withheld has no contact; its retention is the general retention rule (open decision 8). **Export** of call records in the PDPA export is **not built** in this milestone (stubbed, section 12).

## 5. Call start and refusals

`startPhoneCall` (TypeScript, in the agent process) and `app_private.agent_call('call_start')` (SQL, security definer, owned by `jomcall_agent_jobs`, executable by `jomcall_agent`) refuse in this order:

| Refusal | When | What the caller hears |
|---|---|---|
| `NOT_SIP` | The participant is missing or not of kind SIP | Nothing. The worker ends the job |
| `DUPLICATE_CALL` | The `sip.callID` already started a call | Nothing. The worker ends the job |
| `UNKNOWN_NUMBER` | No active `phone_number` for the dialled number | The room is deleted, so the call ends |
| `CALLS_SUSPENDED` | `organization.calls_suspended_at` is set | Room deleted. A refused call row is kept |
| `AGENT_UNPUBLISHED` | The agent has no published version | Room deleted. Refused row |
| `DISCLOSURE_REQUIRED` | The published version has no AI disclosure, or has recording on and no recording notice | Room deleted. Refused row. The AI disclosure is never skipped |
| `LINES_BUSY` | The concurrency guard is full | The busy line from the cache (no speech request), then the room is deleted. Refused row |

When the room is deleted without an answer, the provider sees the call end. Carrier "forward when busy or unanswered" from the owner's own number does not apply here, because the caller dialled through to the JomCall number. Open decision 4 covers sending these calls back to the owner instead.

A refused row records the refusal, so the owner sees "missed: agent not published" in the call log rather than nothing.

### 5.1 Concurrency guard (**my call**)

Google's text-to-speech endpoint allows about 11 requests a minute on the owner's project. A turn uses at most 2 requests, so one busy call uses most of that limit. The guard is **one live call at a time per deployment** by default (`JOMCALL_MAX_CONCURRENT_CALLS`, 1 to 20). Both call types count: active phone calls whose token has not expired, and browser voice tests whose `voice_expires_at` is in the future, because both draw on the same Google limit. The count runs inside `pg_advisory_xact_lock`, so two calls that start together cannot both get the last line. A call whose worker crashed stops counting when its token expires (cap + 60 s), so it never blocks the line for ever.

A second caller is refused **gracefully, before the call is answered**: they hear one fixed line from the cache ("All our lines are busy. Please call again in a few minutes."), and no speech request is made. They are never dropped mid-call. Queueing was rejected: a caller on hold costs provider minutes and gives a worse experience than a clear "call back" line, and the limit is a quota, not a burst that clears in seconds.

## 6. Turns on a real call

The real-call turn reuses `runVoiceTurn` (`engine/src/agent/voice-turn.ts`). That function gains optional dependencies: a store (begin, complete, fail, cancel), a tool runner and extra prompt rules. The browser test path passes none of them and behaves exactly as before.

Differences on a phone call:

- **Store**: `app_private.agent_call` writes to `app.call_turn`. The call's `snapshot` is the published version's snapshot. The turn limit is 80 turns per call.
- **No fast lane.** The answer cache is off on phone calls. The QA record makes the cache an owner decision before real callers.
- **Read-back is enforced in code.** The first `book_slot` in a call does not record anything. It stores the exact arguments as the call's `pending_readback` and returns a tool result telling the model that nothing was recorded, and that it must read the service, day and time back and wait for a yes. A booking proposal is recorded only when both of these hold:
  - the pending read-back was stored by an earlier, completed turn, and the new `book_slot` arguments are identical to it, and
  - the caller's words in the current turn are a plain yes (a fixed word list for BM, English, Manglish and Mandarin: "ya", "betul", "boleh", "ok", "yes", "correct", "sure", "好", "对", "可以" and similar) and contain no "no" word ("tak", "bukan", "no", "不" and similar).
  
  Otherwise `book_slot` is refused with `READBACK_REQUIRED`, and the pending read-back is replaced with the new arguments. A cancelled turn clears a read-back it stored. This is a deliberate double check: the database checks the "earlier turn, same arguments" part, and TypeScript checks the "caller said yes" part.
- **Bookings stay proposals for staff to confirm.** The inbound voice design (§6) makes bookings without human approval an owner option, not the default.
- **Messages are recorded as proposals.** Nobody is notified yet: the owner summary is later work (section 11).
- **Handoff means transfer when it can.** `handoff_to_human` keeps its name, so the model and its tool schema do not change:
  - **during opening hours, with a staff number set**: a cold transfer to `transfer_e164` through the telephony provider (section 7);
  - **otherwise** (after hours, no number, or a failed transfer): a recorded handoff proposal, and the model is told to offer to take a message.
- **Phone rules** are added to the spoken rules: the read-back protocol above, after-hours behaviour, and "never promise a call back time".

The 48-case gate was **not** re-run with the phone rules (paid model, not allowed in this run). Running it is an owner step before real callers.

## 7. Transfer to a staff number

Only **blind (cold) transfer** is built. It uses `TransferSIPParticipant`, which sends a SIP REFER through the trunk to `tel:+60…`, or to the provider's SIP URI form for Plivo (`JOMCALL_SIP_TRANSFER_URI`, a template with `{e164}`). The ringing timeout is 20 s.

- **Answered**: LiveKit ends its side and the caller stays connected to staff through the provider. The call ends with outcome `transferred`.
- **Rejected, no answer, or provider error**: the caller stays in the room. The tool result says the transfer did not go through, the model offers to take a message, and the outcome becomes `transfer_failed` unless a message follows.
- **After hours**: no transfer is attempted.

Warm transfer needs an outbound trunk and a consultation room. It is left for later (section 11). REFER support at a Malaysian provider is unconfirmed (`phone-line-options.md` §4.6), and Twilio needs it switched on.

## 8. After hours

At call start the location schedule (`app.location_schedule`, `Asia/Kuala_Lumpur`) decides whether the location is open at that minute. The check reuses the same interval logic as bookings, with closures counted as closed. If there is no schedule the location counts as open. The decision is stored on the call (`after_hours`) and put into the volatile prompt. After hours:

- the agent says the business is closed and offers to take a message or propose a booking in open hours;
- transfer is not attempted.

Public holidays come only from the closures the owner has entered (the state holiday calendar is later work).

## 9. Consent, do-not-contact and disclosure

- **Disclosure.** The call opens with the AI disclosure. When recording is enabled on the published version, the recording notice follows it, then the greeting. Call start is refused if either required line is empty. The worker stamps `disclosure_played_at` once the opening has played, which is the evidence that the notice was given. No audio is recorded in this milestone: `recording_enabled` only decides whether the notice is spoken.
- **Do-not-contact on inbound (my call).** A caller who rings the business is answered as normal, because do-not-contact governs contact *from* the business. The flag is copied onto the call (`do_not_contact`) and shown in the call log, so that no follow-up is ever sent for that call. The agent is told not to offer a WhatsApp follow-up or a call back.
- **Consent records.** No consent record is written automatically. The existing table needs a human actor, and an inbound call is not consent to marketing. The call row keeps the disclosure evidence.

## 10. Call caps and abuse limits (**my call**)

| Limit | Value | Why |
|---|---|---|
| Length of one call | 600 s (10 minutes), then the goodbye line | The 300 s cap was a test rule. A real booking call with read-back fits comfortably in 10 minutes, and runaway calls cost speech and model money |
| Turns per call | 80 | About one turn every 7 s for 10 minutes |
| Calls from one caller number to one business | 6 per hour, more are refused as `CALLER_LIMIT` (busy line) | Stops a dialler or a prank loop from draining the speech quota |
| Concurrent calls | 1 by default (section 5.1) | Google's limit |

## 11. Later pieces

- **After-call summary to the owner**: a summary of each call over WhatsApp once the WhatsApp channel exists (another session owns WhatsApp). The call row already has the outcome, the proposals and the turns it would need.
- Missed-call text-back, recording audio with retention (Egress), warm transfer, forwarding verification calls, the number pool, billing per provider-confirmed minute.

## 12. What is stubbed or not verified

- No real number, trunk, carrier, forward or handset has been used. The LiveKit SIP configuration is generated as files and never applied.
- The telephony provider has a LiveKit implementation (participant lookup, transfer, room delete) that has only been exercised against the in-memory fake, not a live server.
- The simulator fakes a SIP participant by joining with a `kind` claim and `sip.*` attributes. Whether a self-hosted LiveKit server honours that claim the same way it treats a real SIP participant is unverified, and the simulator was not run end to end (it would call Deepgram and Google).
- PDPA export of call records is not built.
- The phone rules were not gated on the 48 cases.
- Phone audio (8 kHz) is raised to the room rate by LiveKit SIP. The Deepgram settings stay as they are (`nova-3`, multilingual, 16 kHz input), and LiveKit's `nova-2-phonecall` suggestion is not followed because it drops BM and Mandarin. The effect of real phone audio on accuracy is unmeasured (`phone-line-options.md` §4.5).

## 13. Open decisions, with recommendations (all built to the recommendation)

1. **Credential path** (§3.1): worker asks and server checks with LiveKit. *Recommend keeping it*; revisit webhooks with the hosted-mode work.
2. **Concurrency** (§5.1): one call per deployment, busy line, no queue. *Recommend keeping it until Google raises the limit*, then raise `JOMCALL_MAX_CONCURRENT_CALLS`.
3. **Call length** 600 s and **caller limit** 6 an hour (§10). *Recommend keeping them*.
4. **Refused calls**: today the room is deleted. *Recommend later* setting the trunk's `ringing_timeout_status` and asking the provider for failover to the owner's number, so a refused caller reaches a human.
5. **Do-not-contact on inbound** (§9): answer, flag, no follow-up. *Recommend keeping it*.
6. **Staff see call rows, not turns** (§4). *Recommend keeping it*; revisit when staff roles get finer.
7. **Auto-created contacts** for unknown callers (§4). *Recommend keeping it*, since it is what makes PDPA deletion work; the contact list marks them as phone-sourced.
8. **Retention** of withheld-number calls and transcripts: not set. *Recommend 90 days*, decided with the lawyer points in `phone-line-options.md` §5.7.
9. **Blind transfer only** (§7). *Recommend keeping it* until the first real REFER test passes.
10. **The agent process holds the LiveKit secret** (§3.1). *Recommend keeping it*; it is loopback-only and already holds the Anthropic key.
