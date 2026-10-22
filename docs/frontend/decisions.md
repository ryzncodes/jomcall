# Frontend decisions

## 2026-10-15 — Remaining inventory

- Complete the missing public, access, outbound, hosted-admin and self-host surfaces in the approved design. Keep public typography editorial and operational layouts scannable.
- Extend shared typed setup/CRM stores rather than introduce parallel customer/channel/wallet fixtures. Preserve existing drafts through default migrations.
- Keep outbound run transitions deterministic and explicit: pinned revisions, consent/DNC gates, KL quiet hours, engagement before calls, unknown-outcome reconciliation and stable usage IDs. No background sends.
- Add independent branch schedules and sample state closures to booking validation. This supersedes the earlier shared-hours-only preview limitation.
- Use clearly labeled sample access and installation checks; never collect provider keys or persist passwords. Public admin is a fictional preview, not authorization.
- Add public pricing and legal drafts describing only the preview. Commercial rates and production policies remain undecided.
- Demonstrate call playback with a generated synthetic tone, not invented customer recordings. Preserve unspecified metadata on older stored calls.
- See [remaining-screens.md](remaining-screens.md) for scope and evidence.

## 2026-10-15 — Home dashboard and settings

The owner requested a connected home dashboard and settings at the existing design standard.

- Make `/app` the daily overview and `/app/calls` the canonical call log; retain old call deep links. Use real shared mock records for all metrics, current alerts and owner-summary previews.
- Define daily figures precisely: calls by start date, confirmed appointments by scheduled date, spend by applied usage-debit date, all in Kuala Lumpur time. Never infer missed-call recovery from a booking outcome; use an explicit call-entry marker.
- Continue the existing typography and palette with an hourly call chart, action queue and linked recent activity. Use a settings rail on wide screens and horizontal navigation on tablet/mobile.
- Keep primary branch identity compatible with setup, while allowing additional branches in phone routing and bookings. Guard archiving against assignments and active bookings. Share existing agent hours for now rather than imply unbuilt per-branch scheduling.
- Implement local team, summary, retention, audit and sample-key workflows. Owner protection and duplicate guards work in the preview; roles do not claim production access control. Sample key values are deliberately invalid credentials and are not persisted in full.
- Record settings and CRM changes in typed local audit entries without credential values or message contents. Keep the distinction from a production access/audit backend visible.
- No new dependencies. Scope, migration, QA and production limits are recorded in [home-and-settings.md](home-and-settings.md).

## 2026-10-15 — Phone numbers, WhatsApp settings and billing

The owner requested these three screens next with the established design and connected mock data.

- Continue the existing identity with a routing/disclosure layout, template workbench and wallet/ledger layout. Keep long BM status copy on its own mobile row. No dependencies added.
- Extend the shared setup draft with typed service records rather than duplicate channel and balance state. Keep existing drafts and expose actual current agent/branch assignments, with one workspace line explicitly supported.
- Make approved template wording authoritative in the inbox. Editing withdraws approval; disconnected or restricted channels block outgoing actions while preserving internal notes.
- Model wallet changes as signed integer-sen ledger entries. Unknown payments must be reconciled before another top-up; paid confirmations and usage entries cannot credit or debit twice. Automatic top-up uses a fictional mandate, with no claim about real provider recurring-payment support.
- Charge sample activity only when explicitly requested. Historical calls and delivered staff messages are eligible; uncertain sends and notes are not. Receipts are clearly labelled simulation records.
- Scope, QA evidence and remaining production boundaries: [phone-whatsapp-billing.md](phone-whatsapp-billing.md).

## 2026-10-15 — Contacts, bookings and integrations

The owner requested these three screens next, at the established design standard with connected mock data.

- Use distinct directory/profile, calendar/agenda and grouped connection-card layouts. Continue existing tokens, fonts and accessible primitives; no new dependencies.
- Consolidate inbox contacts, consent records, appointments, connector health and call-log fixtures in one typed browser store. Import legacy inbox data once and remove its old storage copy after successful persistence. Preserve malformed saved data and report it. Keep setup's calendar state authoritative rather than maintaining a second connection flag.
- Treat consent changes as append-only records, separate template opt-in from do-not-contact, and cascade confirmed local contact deletion through conversations, calls, bookings and consent. Downloads include the same linked records.
- Enforce agent hours, closures, duration and buffer in booking flows. Requests remain requests until explicitly confirmed with a connected calendar. Preserve original calendar ownership on confirmed appointments; changing providers does not silently move them.
- Make each integration interaction observable: calendar health affects booking gates; lead imports create contacts/inbox threads without consent; Sheets/webhook previews produce sample data downloads. Browser test calls remain non-mutating rehearsals.
- Preserve locale/theme and entity query parameters in navigation. Refresh shared data and calendar settings across open tabs; retain explicit local-only boundaries.
- QA and remaining limitations are recorded in [contacts-bookings-integrations.md](contacts-bookings-integrations.md). This supersedes the earlier separate-inbox storage decision, not the approved backend architecture.

## 2026-10-15 — Agent builder, inbox and integration research

The owner requested agent builder and WhatsApp inbox next, challenged the three-business-type limit and clarified a conversational CRM direction with normal calls, WhatsApp calls and chats.

- Expand setup to ten categories including Other. Initial categories were demo personas, not eligibility limits. Use a compact labelled select rather than ten large cards on mobile.
- Add a focused five-section builder and a contact-centred inbox using the existing identity. Preserve the distinct jobs of configuration, work queue, transcript and contact context.
- Migrate the existing browser draft with settings/version snapshots; keep inbox persistence separate. All data remains fictional and backend-replaceable. Publish requires valid configuration plus a completed test after edits; restore creates an untested draft and retains immutable history.
- Model human ownership explicitly. Pending AI replies recheck ownership; delivery status is separate from send intent. Ambiguous sends require reconciliation and failed retries retain one record.
- Show consent, do-not-contact, service-window/template gates and WhatsApp calling permission. Keep phone and WhatsApp call actions distinct. Calling permission is not chat opt-in, and ordinary phone transfer is not a WhatsApp handoff path.
- Research official provider capabilities before promising integration. Calendar is optional; absent availability, collect a request. LiveKit's current WhatsApp connector is Cloud-only, while self-hosted calling needs a separate evaluated transport. Real +60 account eligibility remains unverified.
- No new dependencies. Public product/source inspection informed original behavioral requirements; no external code, endpoints, schemas, copy or assets were imported. Research captures remain ignored. [Integration roadmap](../research/integration-roadmap.md) contains provider-only references.
- Deferred honestly: live accounts, holiday feeds, PDF/OCR indexing, AI interpretation of instructions, full CRM automation, production permissions and other roadmap screens. QA and remaining design-system/performance work are recorded in [agent-builder-and-inbox.md](agent-builder-and-inbox.md).

## 2026-10-15 — Guided setup and dedicated agent testing

The owner explicitly requested extending the developed visual standard to guided setup and the agent test panel, following `screens.md` with mock data. This is authorization for these screens; no further design-selection checkpoint was needed.

- Carry the paper/forest palette, local type and precise rules into a shared app shell. Use a progress rail and one decision per setup stage, then a dark call console and paired test panes. Avoid marketing artwork inside forms.
- Build all nine setup stages in the specified order. WhatsApp and calendar can be skipped explicitly; a completed sample call precedes forwarding verification and sample credit. Configuration changes invalidate prior call/forwarding verification.
- Keep setup and test behavior behind typed models and a centralized mock adapter. Add browser-local save/resume so owners can leave and return. Validate saved shape; recover malformed data and show storage failures. This is not backend persistence or authentication.
- Use deterministic call/chat scenarios with controllable failures. Do not request a microphone or imply real telephony. Only voice auditions use audio, through installed local device speech synthesis; unavailable voices have a clear fallback. Production voice-provider selection remains open.
- Keep money in integer sen. Grant sample trial credit once, expose mock top-ups and record the sample ledger. No payment credentials or payment provider are involved.
- Forwarding guidance links to official telco help, with plan/device checks. Do not invent universal dialing codes or claim a live verification occurred. Sources and verification date are recorded in the forwarding adapter and setup handover.
- No new dependencies. Copy remains in BM/English dictionaries. Locale/theme persist in navigation; saved owner-entered content is not translated when switching the interface language.
- QA: production build and typecheck pass. 144 route/stage/locale/theme/viewport combinations have zero detected horizontal overflow, axe violations or runtime errors. Full setup, recovery, persistence, simultaneous call/chat, keyboard focus and long BM names pass browser checks. Details and limits: [setup-and-testing.md](setup-and-testing.md).
- Remaining deviations: W3C token artifact, component-state gallery, automated CI wiring, real Android/4G performance measurements and real integrations remain outstanding. This is completion of the requested mock screen extension, not the whole frontend roadmap.

## 2026-10-15 — Developed frontend revision

**Current review target: `web/`.** The owner rejected the first studies as too simple and explicitly requested deeper visual/source research followed by implementation. This authorizes the revised build; it does not mean the owner has approved the resulting design.

- Replaced the sampler as the main review target with one developed concept: an attentive front desk. Original material artwork, large editorial type, deliberate changes in section scale, a user-controlled conversation, and a readable product workspace carry the identity. The earlier three static studies remain historical artifacts.
- Marketing and app serve different jobs. Marketing uses the physical telephone as a memorable subject and progresses from promise to conversation to product evidence. The app uses rows, summary/transcript tabs, clear outcomes and visible privacy controls.
- Implemented Next.js App Router, strict TypeScript, Tailwind CSS, Motion and a restyled Radix dialog. Auth, payment and voice providers remain unchosen. `web/AGENTS.md` is generated by the installed Next.js tooling and retained for future agents.
- CSS variables currently define light/dark colors and core interaction values. This is a developed preview, not completion of Phase 2: W3C token serialization, the full component-state gallery and a comprehensive scale remain outstanding.
- Use a small typed dictionary context as the permitted `next-intl` equivalent for the two preview routes. All interface copy lives in `web/messages/en.json` and `ms.json`; URL parameters preserve locale/theme. Production locale routing, localized metadata and server-rendered document language need a subsequent routing pass.
- The centralized TypeScript mock adapter covers organization, contact and call records used here. Money remains integer sen and times use `Asia/Kuala_Lumpur`. Contacts use unmistakable sample labels and null phone numbers. Other spec entities will be added when their screens are built, rather than invented prematurely.
- Demo progression is local text only. Start, pause, resume, reset, replay and sample-language selection work. No microphone, audio, real call, booking or voice-quality claim is involved. There is no autoplay or scroll hijacking. Reduced motion disables the hero entrance and waveform animation.
- Call log supports search, outcome filters, deep-linked selection, summary/transcript tabs, mobile modal focus return, an in-memory do-not-contact switch and download of fictional JSON. Export is not a production PDPA export workflow; deletion and persistent compliance operations remain unbuilt.
- Original concept artwork was generated for this project. Prompt and provenance are in `refined-direction.md`. Reference material and extracted source observations remain outside tracked content. No third-party website assets, copy or implementation were imported.
- QA: production build passes. Twenty-four route/locale/theme/viewport combinations at 390, 768 and 1440 px have zero detected overflow, console errors or axe WCAG 2.2 AA-tagged violations. Interaction checks also cover a mobile dialog, keyboard tabs, focus return, language changes, sample export and reduced motion. These checks do not constitute a complete accessibility certification or measured mobile Core Web Vitals.
- Deviated from the original phased sequence in response to the owner's revised research-and-build request. Guided setup, a real browser call state machine, voice picker, forwarding verification, inbox, billing and the full design-system gallery are not complete. This revision establishes a concrete visual and interaction standard before those larger flows.

## 2026-10-15 — Phase 0 and Phase 1 review

Historical status at first delivery: three visual candidates prepared; owner selection pending. They were subsequently rejected as too simple. See the developed revision above for current status.

- Follow the handover's explicit sequence: make three static hero + call-log prototypes before asking the owner to choose. Do not build the product foundation until that choice exists.
- Phase 1 uses plain HTML, CSS and ES modules under `docs/frontend/directions/`. This is a deliberate temporary exception to the Next.js, TypeScript, Tailwind and Motion defaults: no production code exists, and selecting a visual direction should not commit the product to three competing component systems. These prototypes are design artifacts, not the `web` service. Production defaults remain unchanged.
- Copy lives in `messages/en.json` and `messages/ms.json`. Both locales and themes can be compared using URL parameters and labelled native selects. No auth or payment provider chosen.
- Local Google Fonts files use SIL Open Font License 1.1; each license is bundled. No third-party JavaScript dependencies or external requests at runtime. Fonts are TTF for this prototype; production should subset and use WOFF2.
- All business activity is explicitly fictional. Contacts have `phone_e164: null` and a masked, non-dialable display number. This deliberately avoids inventing a dialable number that could belong to a real person. Production phone fields remain E.164.
- The Phase 1 fixture adapter centralizes sample call/contact entities and uses JSDoc shape annotations. A strict TypeScript API client covering the full model belongs to the approved foundation phase.
- Costs are integer sen; display uses RM. All timestamps are formatted in `Asia/Kuala_Lumpur`. The sample date is fixed for reproducible screenshots, not a claim of current activity.
- Demo is a text-only simulation, labelled before its transcript. Button replays a short reveal; it never opens a microphone, sends a message, makes a call, books or charges. Disclosure is sample dialogue, not an assertion that this browser records audio.
- Sample call rows open a native modal with summary, cost, version and disclosure. Search and attention filtering work. App navigation is non-interactive context, not pretend links to unbuilt screens. Full consent, do-not-contact, PDPA export/delete and configuration flows remain future screens.
- Rejected: three recolors of one layout; generic gradient hero; fake testimonials; invented conversion statistics; unverified telco instructions; voice-quality or pricing claims before the benchmark.
- Production motion uses Motion as requested. Static concepts use short CSS previews to show each direction without installing a production animation dependency. Reduced-motion preference disables them.

## Contradictions and boundaries

1. `AGENTS.md` calls architecture approved, but the architecture document header says “Draft for review.” Treat its architecture as the supplied planning baseline without silently changing its review status.
2. Voice notes suggest about 800 ms to first reply; architecture specifies about 1.2 seconds after end-of-turn. Treat 1.2 seconds as the architecture target, 800 ms as a research aspiration. Neither is measured here.
3. Spec says “open-core style” while also specifying the full code under AGPL-3.0. Follow the explicit full-code license; no proprietary tier implied in copy.
4. Frontend handover brings marketing design before product implementation; architecture places public-site delivery in sub-project 7. These are early design studies, not a change to delivery order.
5. The salon persona prefers Mandarin while the v1 interface scope is BM/EN. Caller language support and owner UI language are separate; Mandarin UI is not silently added.
6. Number provisioning, WhatsApp/calendar connections, forwarding and payment are unverified backend dependencies. Setup should show recoverable states and allow a browser test before requiring the owner to move their number or pay. This sequence needs confirmation during setup design.

## Owner choice

The owner requested a stronger developed revision after rejecting the first sampler. The new `web/` frontend is ready for review; final visual approval has not been recorded.

## 2026-10-15 — whole-app review and shared-state fixes

- Kept the established visual system. Corrected secondary touch targets, setup-step accessible names, skip-link focus, call-history context and branch-hours navigation across existing screens.
- Setup writes now merge with the latest local snapshot and persist before navigation. Storage-event reads no longer write snapshots back. This reduces stale-tab overwrites without pretending browser storage is a transactional backend.
- Inbox delivery confirmation and outbound review use the same workflow action. Shared-provider usage reconciliation makes accounting independent of the open screen and preserves idempotent receipt IDs.
- Call attempts retain their historical agent/branch/line/language metadata. Incoming dashboard totals exclude outbound records; future inbound timestamps cannot open a reply window.
- Replaced the static call-detail appointment card with a contact-filtered booking link instead of inventing a call-to-booking relationship absent from the mock model.
- Completed a new whole-app audit: 26 routes, 830 screen/state variants, desktop/mobile journeys, keyboard and typed-model checks. See [whole-app-review.md](whole-app-review.md) for findings, evidence and scope limits.


## 2026-10-16 — Navigation hierarchy

The flat fifteen-link sidebar made routine work compete with configuration. Keep Home, Inbox, Calls, Contacts, Bookings and Follow-up visible; put builder, test panel and guided setup under Agent, and hours, channels, integrations, billing and settings under Workspace. Native disclosure groups open for their active route, with nested links and scroll-to-current behavior on short desktops. Compact the sidebar footer while retaining the AI disclosure reminder.

Mobile uses three direct destinations (Home, Inbox, Calls) plus Menu, replacing the long horizontal strip. The existing Radix Dialog primitive provides a scrollable grouped menu, active-route focus, focus trapping, Escape dismissal and trigger focus restoration. Moving to desktop closes the mobile dialog. All fifteen routes, locale/theme query parameters and browser mock stores remain connected. No new dependency or backend change.

Verification: production build and TypeScript pass. Thirty-two layout/accessibility states cover 320/390/768/1440px, BM/English, light/dark and opened groups/menu, with no detected axe violations, horizontal overflow or page errors. Thirty actual navigation journeys cover every destination on mobile and desktop at 600px height; active visibility, menu keyboard trapping/restoration and breakpoint dismissal pass. Evidence: `screenshots/navigation/qa-results.json` and selected screenshots. Physical-device/Safari verification remains outside this check.
