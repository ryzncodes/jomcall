# MVP focus and call insights backlog

Date: 2026-11-18. Source: owner conversation that day. This is a backlog note, not an approved design. Nothing in it is built.

## 1. Owner decisions on 2026-11-18

- The current hosted environment (called staging) becomes production. No second environment for now.
- Supabase stays on the free plan until the first paying customer. Accepted risk: no backups and the project pauses when idle.
- Payments: go live and monitor. Prices stay as they are if the margin works.
- Legal items are treated as approved by the owner; ship first.
- Extra operations work (backup job, alerting) is skipped for now.
- Phone: one number per client. The client forwards their existing number to it themselves (forwarding codes on mobile, the carrier portal on fixed lines).
- WhatsApp onboarding must be as non-technical and self-serve as possible (a "Connect WhatsApp" button with Meta's sign-up popup, instead of pasting IDs and a token).
- Priority: the self-serve path must work from an owner's point of view before more depth is added.

## 2. The MVP path to prove

1. Sign up and confirm email.
2. Guided setup and a test of the agent.
3. Pick a plan and top up.
4. Connect WhatsApp (not self-serve today) and, later, get a phone number (no carrier today).
5. A customer writes or calls and the agent answers.
6. The owner sees it in the inbox or call log, takes over and replies.

Known breaks on 2026-11-18: step 4 is not self-serve for WhatsApp and does not exist for phone; step 3 has never taken real money.

## 3. Call and chat insights (parked until real traffic exists)

Goal: show business owners the value JomCall brings, and sell a higher plan on it.

Layer 1, from data already stored (no recording): calls answered, calls caught outside opening hours, bookings proposed, messages taken, transfers, questions the agent could not answer. A weekly email to the owner, for example "JomCall caught 14 calls you would have missed; 6 became bookings". Free for every plan.

Layer 2, audio recording (not built): record each call through LiveKit to file storage, with a retention period, a play button in the call log and deletion on a PDPA request. The spoken recording notice already exists as a setting. Needs a storage decision and a retention decision.

Layer 3, conversation scoring (not built): after a call or WhatsApp chat ends, a model reads the transcript and scores each line for whether it moved the customer toward or away from a booking; the screen shows a curve, the turning point and a one-line reason. One low-cost model call per conversation. Limit to state on the screen: the score is a model's estimate, not a measurement. A stronger later version compares against real outcomes across many conversations.

Suggested packaging: layer 1 on every plan; layers 2 and 3 on the higher plan.

Rules: original design only (no copying of other products' screens); transcripts and audio are personal data, so export, delete and retention apply; sending transcripts to a model for scoring is a new use and needs the owner's approval when it is built.

## 4. Phone line: fastest route to a first real call (researched 2026-11-18)

- The hosted server runs LiveKit only. A phone call needs LiveKit's SIP service and Redis next to it, with port 5060 and the media ports 10000 to 20000 reachable. This is required before any carrier number can work.
- Trial route: Plivo (USD 10 trial credit, no card stated on its page; LiveKit publishes a Plivo guide). Whether a trial account can rent a number at once, and in which countries, was not confirmed.
- Malaysian numbers for clients: Plivo local USD 4.00 a month and USD 0.015 a minute inbound (documents not confirmed); Telnyx USD 4.45 a month with a purchase API, business documents and about 72 hours; Twilio USD 4.00 a month and USD 0.0278 a minute, SSM and address proof, no SIP on a trial account.
- Figures are from vendor pages read on 2026-11-18; items marked not confirmed need checking in the vendor's console.
