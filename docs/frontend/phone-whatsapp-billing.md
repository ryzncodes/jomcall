# Phone numbers, WhatsApp settings and billing preview

Built on 15 October 2026, following `screens.md`. These screens extend the existing paper/forest interface with shared fictional state. No account, credential, real number or banking operation is required.

## Routes and behavior

- `/app/phone-numbers`: reserve one masked workspace line; choose missed-call or always-forward mode; assign the current agent and branch; review AI/recording disclosures and carrier help; run a sample forwarding check with failure recovery. Verification requires a reserved line, assignments and a completed agent test. Routing changes invalidate verification. Setup sees the same line and verification state.
- `/app/whatsapp`: connect/disconnect the sample channel, review or simulate quality states, and create/edit message templates. Drafts move through pending, approved or rejected review states. Editing removes approval. The inbox selects approved wording from this shared collection; disconnected/restricted channels block outgoing messages and WhatsApp call simulations. Internal notes remain available. Consent, do-not-contact, ownership, reply-window and call-permission rules still apply.
- `/app/billing`: shared MYR wallet, one-time RM20 trial credit, sample FPX/DuitNow payments, payment failure/reconciliation, automatic top-up settings, voice-minute/message usage, wallet activity and downloadable sample receipts. Unknown payments add no credit and prevent a new attempt until reconciled. Confirmed payments and usage charges are idempotent within the local model.

## Connected mock model

`web/lib/api/service.ts` owns typed templates, payments, usage, channel readiness, forwarding readiness and wallet transitions. It extends the existing setup store (`jomcall-preview-setup-v1`); legacy drafts receive service defaults while retaining their wallet and routing. The CRM store remains authoritative for contacts, conversations and call records. Open tabs refresh shared setup/channel/wallet state through storage events.

Billing's expandable simulation selects an unbilled historical sample call or delivered staff message from the inbox. Failed, uncertain, incoming and internal-note events are excluded. An explicit simulation debits the wallet once per record. Historical examples are not silently billed on page load. Message cost is a fictional five sen, not provider pricing. Inbox call simulations remain timeline events, not billable call-log records.

Automatic top-up uses an explicitly simulated mandate after a usage charge takes the balance below the saved threshold. The top-up amount must exceed the threshold, and an unknown payment suspends automatic refills. Insufficient credit blocks the usage simulation. No bank/card is charged; this does not promise recurring FPX or DuitNow capabilities.

Receipts are JSON simulation records, visibly marked as neither proof of payment nor tax invoices. Earlier setup credits appear in the same history. All amounts remain integer sen; timestamps render in `Asia/Kuala_Lumpur`.

## Design and verification

Routing uses a visual path and persistent disclosure rail. WhatsApp pairs a channel-health summary with a template directory/message preview. Billing centers the balance, then usage and the ledger, with automatic top-up alongside. All three use the established typography, spacing and theme tokens. Mobile navigation scrolls to the active destination; long channel-status copy gets a separate row.

- Production build and TypeScript checks pass across all routes; no dependencies added.
- Screenshots and axe checks cover three screens plus template, payment and receipt dialogs at 390, 768 and 1440 px, BM/English, light/dark: 72 combinations with no detected horizontal overflow, axe WCAG A/AA violations or runtime errors. Visual review found and fixed BM mobile channel-name squeezing that overflow detection did not catch.
- Connected browser journey covers line reservation, real sample-test completion, missing-assignment and failed-forwarding gates, retry verification, template edit/rejection/approval, inbox selection, restricted sends, trial credit, unknown/failed/paid recovery, receipt download, FPX simulation and persisted usage charges.
- Five additional recovery/state captures cover unknown payment, setup wallet, restricted channel, rejected template and failed forwarding, also without detected axe violations, overflow or runtime errors. Failed forwarding rechecks revoke earlier verification; retry succeeds in both setup and phone settings.
- Additional browser checks cover legacy draft migration, invalid auto-top-up validation, one automatic refill, delivered-message billing, cross-tab wallet/channel changes, notes while disconnected, dialog focus trapping and focus restoration.
- Accounting checks cover unknown-payment exclusion, idempotent confirmation, immutable paid status, usage deduplication, one automatic refill, insufficient-credit handling, input immutability and forwarding assignment requirements.
- Existing inbox regression passes: sends/retries/reconciliation, DNC, notes, call permission, separate call channels, takeover/resume, templates, resolve/reopen, persistence, filtering and mobile navigation/focus.

Evidence: `screenshots/services/`; local scripts/results remain ignored under `output/playwright/services/`.

## Boundaries

One workspace line, agent and branch are available; their administration is a later screen. Quality, template approval, verification, payment methods and mandates are simulations. No live Meta sign-up, number provisioning, telephony, payment processing, authentication or backend exists. Storage-event refresh is not distributed concurrency control. Saved user content is not automatically translated when the interface language changes.

Real Android/4G Core Web Vitals, CI accessibility wiring, component-state gallery, auth and the remaining roadmap screens are still outstanding. No new owner decision is needed for this mock extension; actual provider selection and eligibility remain open.
