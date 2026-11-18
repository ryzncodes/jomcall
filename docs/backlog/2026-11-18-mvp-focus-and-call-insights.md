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

## 4. Phone line: state at the end of 2026-11-18

Server side (done): LiveKit's SIP service and its message bus run on the hosted server (pull request #46, `66a5b3e`); ports 5060 (UDP and TCP) and 10000 to 10200/udp are open in the DigitalOcean firewall to all sources, to be narrowed to the chosen carrier's addresses; 5060 answers from outside. The agent's phone switch is still off, no number is added in JomCall, no trunk or dispatch rule exists, and no call has gone through. No browser voice test was held after LiveKit moved onto the message bus.

Number suppliers looked at that day (consoles seen by the owner or the controller; nothing bought):

| Supplier | Malaysian numbers | Price seen | State |
|---|---|---|---|
| Twilio | Many local numbers in stock (03 Klang, 04, 07) | USD 4.00 a month; inbound about USD 0.028 a minute (pricing page) | Trial account. A Malaysia Local Business regulatory bundle was submitted and is pending review; a number can be bought only against an approved bundle. Front-runner. |
| Telnyx | None in stock in any type | USD 4.45 a month (pricing page) | Account verified. One local number requested through "Request Number". US numbers: USD 1.00 upfront and USD 1.00 a month, in stock. |
| DIDLogic | 03 numbers in stock | USD 12.00 a month plus USD 12.00 setup, 12-month minimum term, documents required | Too dear for one number per client. Not used. |
| SIPPALS (Malaysian) | 03 numbers per its site | RM 0.13 a minute, no contract; monthly price unknown | Email with technical and price questions drafted for the owner to send. |
| Plivo | - | - | Sign-up refused from Malaysia. |

Facts that shape the design:

- Digitalize Plus Enterprise is registered at an address in Pulau Pinang, and Twilio requires the address to be in the region of the number's prefix, so its own number should be an 04 number.
- On Twilio's form the honest answer for numbers handed to clients is "ISV, reseller or partner", which may need each client's details. Whether client numbers can sit under JomCall's own bundle is not confirmed. This, not price, may limit instant self-serve phone numbers.
- Forwarding costs fall on the client: U Mobile states RM 0.05 per 30 seconds outside the plan's free minutes and does not allow forwarding to international numbers; Maxis states RM 3 a month and local call charges. Other telcos' rules were not found. So numbers must be Malaysian, and the forwarding screen must tell owners about their telco's charge and recommend forwarding unanswered calls only.
- At about RM 18 to 20 a month per number plus about RM 0.12 a minute inbound, "one number and 100 minutes" on the RM 49 plan leaves about RM 19 for speech, the model and margin. Prices need a second look before phone is sold.
- The business registration certificate lapses on 7 December 2026.
