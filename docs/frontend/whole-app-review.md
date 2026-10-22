# Whole-app review — 15 October 2026

Reviewed all 26 public and product routes against `screens.md`, plus setup stages, editor tabs, contact and conversation details, administration sections, workflow states and dialogs. The paper/forest design and existing typography remain consistent. All actions remain local simulations using fictional records.

## Fixes

| Finding | Result |
|---|---|
| Updating the wallet could overwrite a newer setup snapshot when a storage event had not reached the tab yet. | Setup mutations now read the latest persisted snapshot, merge the edit and persist before navigation. Receiving another tab's update does not write it back. Blocked storage still works in memory with a warning. |
| Confirming an uncertain workflow message in Inbox changed the message but left its run in review. Billing only reconciled on the Follow-up screen. | Inbox uses the shared workflow reconciliation action. Workflow usage reconciles through the shared provider on every screen, with stable IDs preventing duplicate charges. |
| Uncertain workflow phone calls had no delivery controls in the inbox timeline. | Phone attempts display delivery state and a confirmation action. Confirmation creates one call-log record and one usage charge. Failed workflow attempts return to Follow-up rather than using the ordinary message retry action. |
| Later agent, branch or contact edits could rewrite an uncertain call's historical metadata during confirmation. | New call attempts snapshot agent version, branch, line and language. Confirmation preserves that snapshot and the original attempt time. Older attempts without snapshots retain the existing fallback. |
| Outbound calls inflated the incoming-call KPI and hourly chart. | Incoming metrics and the owner summary filter by direction. Recent history and wallet spend still include the relevant outbound records. |
| A future-dated inbound timestamp opened a free-form reply window. | The window requires a timestamp at or before now and less than 24 hours old. |
| Setup step accessible names omitted the visible step number. Skip links scrolled without moving keyboard focus. | Step names follow their visible content. All main-content targets accept focus without adding a tab stop. |
| Secondary footer and access links had undersized hit areas. | These links now have a 44px minimum height, matching primary controls. |
| Call history retained a fixed morning greeting/date and an unrelated static appointment card. | Call-specific heading and neutral time-zone context replace the greeting/date. The appointment action opens that contact's shared booking list. |
| Settings' branch-hours action opened the general agent editor. | It now opens branch schedules. The separate recording-disclosure action continues to open the agent builder. |
| An unclear phone attempt claimed completion in its body text. | BM and English copy describe an attempt pending delivery confirmation. |

## Verification

Production build, TypeScript and `git diff --check` passed. No dependencies added.

Machine-readable results (kept locally, not in this repository) contain **830 screen/state variants**, with zero detected horizontal overflow, axe violations or runtime errors:

| Coverage | Variants |
|---|---:|
| 26 routes × 390/768/1440px × BM/EN × light/dark | 312 |
| Eight additional guided-setup stages | 96 |
| Four additional builder tabs and three inbox detail states | 84 |
| Six additional Settings sections | 72 |
| Four Settings dialogs | 48 |
| Workflow runs/review, hosted-admin tabs/dialog, expanded guide, recovery, signed-in access and installation checks | 120 |
| Contact profile, booking form, template editor, payment and receipt | 60 |
| All routes at 320px, BM/dark | 26 |
| Call-detail recording/deep links | 12 |

Axe checked WCAG 2 A/AA, 2.1 A/AA and 2.2 A/AA tags. Screenshots use reduced motion. Visual review covered every route on desktop and mobile using contact sheets, with full-size checks of dense screens, BM/dark layouts and dialogs. Selected screenshots are committed in this directory; the full captures and CLI scripts remain under ignored `output/playwright/whole-audit/`.

Browser journeys covered:

- All nine setup stages on desktop and mobile: validation, import retry, channel connection/skip, save/resume, failed test/retry, mute, forwarding failure/retry, credit, completion and edit invalidation. Text-chat retry does not duplicate messages; clearing a pending reply cancels it.
- Builder knowledge/documents, schedules, handoff validation, publishing, comparison and rollback. Existing drafts retain their data through migration.
- Contact editing, consent/DNC, inbox deep links, export and deletion; booking creation, conflicts, hours, rescheduling, calendar failure/switching and cancellation; integration imports and source eligibility.
- Phone assignment and forwarding gates; template draft/rejection/approval and channel health; uncertain/failed payments, receipts and usage accounting.
- Inbox delivery, retry, confirmation, private notes, call permissions, takeover, resolve/reopen and mobile list/detail navigation. Mobile DNC permits internal notes while blocking outbound replies.
- Workspace/team/key/privacy/audit settings, sample access and invitations, self-host checks, platform inventory and tenant pause, outbound revision/run/review flows.
- Before/after reproductions of stale setup overwrite and inbox/workflow/accounting divergence. A separate mobile phone-attempt check confirms one call record and one charge, including after reload.
- **164 keyboard assertions** across every route at 390px and 1440px with a 600px viewport height: skip links, active sidebar visibility, dialog focus containment/restoration, branch-hours and recording-disclosure links.
- Audio playback/seek and non-first-call deep links in all twelve standard variants; contact-filtered booking navigation on mobile and desktop; blocked-storage recovery.

Typed-model checks cover call-attempt history, inbound-only metrics, reply-window boundaries, workflow revision pinning, re-entry/duplicates, quiet hours, waits, engagement, consent, branch closures, export/deletion and idempotent payment/usage handling.

Several older QA scripts still expected the pre-dashboard `/app` route, earlier setup markup/copy, or desktop-only panel visibility. Their selectors and navigation were updated for this audit; the final listed checks passed.

## Scope limits

This is a local Chromium browser audit with responsive viewports, not physical Android/iOS or Safari certification. Real microphone/voice providers, WhatsApp, calendars, authentication, banking and background jobs remain unconnected. Device speech synthesis reported no matching installed voice in the audit browser and showed the intended fallback. Component gallery, CI axe wiring and physical-device performance verification remain separate outstanding work.
