# Agent builder and shared inbox

Date: 15 October 2026. Scope authorized by the owner: continue the developed app design with agent builder and WhatsApp inbox, broaden business types, and research channel/integration capabilities. Current review target is `web/`; all actions remain fictional local previews.

## Design

The builder is a configuration desk: a stable section bar, focused editor and quiet agent summary. Identity, knowledge, hours, booking/handoff and versions are separate decisions. Existing forest/paper tokens and local typography carry the visual identity. Form density changes with the task; the app does not repeat marketing artwork.

The inbox is a work queue beside a contact timeline. Optional contact context opens as a third column on wide screens, replaces the thread on tablets, and becomes a separate view on phones. Normal phone calls, WhatsApp calls, messages, internal notes and ownership events have different visual treatments. AI/staff ownership and reply eligibility stay beside the composer.

The three initial business types were demonstration personas, not a product restriction. Setup now offers salon, clinic, dental, workshop, property, education, retail, hospitality, professional services and other. Categories are descriptive; they do not disable channels or claim a specialized trained agent. Business-specific behavior is configured in the builder.

## Working routes

| Route | Implemented mock behavior |
|---|---|
| `/app/agent` | Persona/instructions, greeting, languages, local device voice audition, recording disclosure; FAQ/services editor; sample URL import with failure/retry; `.txt`/`.md` documents up to 100 KB; weekly hours, Malaysian state and closure dates; booking mode/duration/buffer; normal-phone transfer target; take-message and after-hours settings; test-gated publish, immutable snapshots, comparison and restore as a new draft |
| `/app/inbox` | Search and work filters; unified per-contact timeline; AI/staff takeover and return; reviewed sample reply suggestion; staff replies, internal notes, delivery failure/retry and unknown-outcome reconciliation; resolve/reopen; relationship stage; consent and do-not-contact; sample contact export; WhatsApp calling permission and separate mock phone/WhatsApp calls |

Navigation connects these with setup, call log and test panel. BM/English and light/dark are supported. URL parameters preserve interface preferences.

### Builder contract

Configuration lives in the existing typed setup draft, with settings and version snapshots defined in `web/lib/api/builder-types.ts`. The centralized adapter migrates older setup drafts without deleting their progress. It rejects malformed settings/revisions. Browser storage failures remain visible.

Any edit invalidates the draft's test result and forwarding check. Publishing requires valid fields and a full completed sample call after the last edit. Publishing saves a fictional immutable snapshot; it does not activate real channels. Restoring copies a snapshot into a new working draft, preserves history, and requires another test before publication.

Test scenarios use saved greeting, hours, FAQ/services/documents, booking mode, transfer/message choices and after-hours text. Instructions and persona are stored and shown but not interpreted by an AI model. Booking duration/buffer and holidays are configuration previews, not a scheduling engine. Website imports return editable fictional data and do not fetch URLs. Text documents are read locally, not indexed in a backend. PDF/OCR processing remains unbuilt.

The hours summary remains visible because earlier setup allows free text. Changing a weekly schedule day replaces that summary. Imports are not silently parsed into structured hours. State selection and manual closure dates are implemented; an authoritative public-holiday feed and overnight schedules remain future work.

### Inbox contract

`web/lib/api/inbox.ts` contains typed contact/activity views, fictional seeds, persistence, eligibility gates and mock delivery acknowledgements. It is a frontend view model, not a new database schema. The architecture's contact/conversation/message/call boundaries remain the backend baseline.

Data saves under `jomcall-preview-inbox-v1`. Pending sends recovered after a reload become unknown, never silently delivered or automatically resent. Failed sends retry the same record; unknown sends must be reconciled first. The preview's Check delivery action supplies a deterministic simulated acknowledgement.

Human takeover pauses AI; a simulated incoming message can generate a deterministic AI reply only if ownership still belongs to AI when the pending reply completes. Staff notes never leave the timeline. Resolved conversations must reopen before outbound actions. Do-not-contact blocks outbound replies and calls while preserving internal notes.

Free-form replies use the latest incoming message's sample 24-hour window. Outside it, the composer offers one approved fictional utility template and requires recorded opt-in. Sending the template does not open free-form replies. WhatsApp call permission is separate from messaging opt-in. The preview only requests permission inside an open reply window; the outside-window permission-template flow is explicitly deferred. Production must also handle verified WhatsApp call events that affect the window, permission expiry/limits, account eligibility, connection health and provider-specific restrictions.

Every number is masked and non-dialable. No microphone, external message, real call, recording or account connection is used. Contact export downloads fictional JSON; this is not a production PDPA export workflow. No shared auth, multi-user concurrency, webhook receiver or server-side authorization exists yet.

## Product and integration direction

The owner clarified the product as a conversational CRM. Shared contacts, consent, activity, bookings and staff ownership already fit the architecture. A complete sales CRM, campaign platform and universal connector catalogue are not implied by this preview.

Normal calls and WhatsApp calls are separate transports sharing the agent and contact context. WhatsApp calling requires its own connector and permission/eligibility checks. A normal-phone staff transfer cannot be assumed to work for WhatsApp calls. Calendar integration is optional: without an authoritative availability source, collect a booking request for staff confirmation.

See [integration-roadmap.md](../research/integration-roadmap.md) for official provider evidence, recommended integration order, OAuth/webhook boundaries, Cloud-only connector limitations and unresolved account checks. Public product research was used to understand observable behavior; external implementation, schemas, source assets and copy were not imported. Captured research artifacts remain outside tracked content.

## QA and limits

Production build and strict TypeScript checking pass. Browser evidence lives under `screenshots/crm/`. The main matrix covers 120 combinations, plus four populated comparison/delivery states, with zero detected horizontal overflow, axe violations or runtime errors:

- `builder.json`: category expansion and persistence; sample import failure/retry; text-document acceptance/rejection; hours/state/closures; booking/transfer validation; saved knowledge and after-hours tests; publish failure/retry; comparison, restore and invalidation; older-draft migration.
- `inbox.json`: shared call/chat history; editable reply; delivery retry without duplicate; unknown-status gate; do-not-contact and notes; call permission; resolve/reopen; template gating; incoming window refresh; takeover cancellation; return to AI; persistence, filters, mobile navigation and focus.
- `recovery.json`: unknown/interrupted delivery after reload; malformed settings, revisions and inbox data; incomplete hours preserved without discarding the rest of the draft; unavailable browser storage.
- `extra-capture.json`: populated version comparison and unknown-delivery review in desktop English/light and mobile BM/dark.
- `setup-regression.json`: all nine earlier setup stages, failure paths, save/resume, full browser simulation, forwarding, idempotent trial credit, test chat and invalidation.
- `capture-en.json` and `capture-ms.json`: all five builder sections, expanded setup category control, inbox list/thread/contact/template views across 390/768/1440 px and both themes.

Visual review caught a tablet navigation breakpoint mismatch. Axe caught a BM transcript scroll region without keyboard focus; both were corrected. Browser tests use local Chromium against a production build, not real provider traffic. Automated axe checks are not a WCAG certification. Screen-reader testing, CI integration, cross-engine checks and measured Android/4G Core Web Vitals remain outstanding, alongside the earlier token serialization/component-gallery work.
