# Home dashboard and workspace settings preview

Built on 15 October 2026, following `screens.md`, using the established paper/forest interface and shared fictional data.

## Routes and navigation

- `/app` is now the home dashboard.
- `/app/calls` is the canonical call log. Existing `/app?call=...` links still open the call log and selected detail.
- `/app/settings?section=workspace` opens business settings. Sections are `workspace`, `branches`, `team`, `notifications`, `keys`, `privacy` and `audit`; locale/theme switches preserve the section.

The main navigation scrolls the current destination into view after layout and fonts settle. Settings use a section rail on wide screens and horizontal navigation on tablet/mobile.

## Dashboard

All figures are derived from shared stores rather than separate dashboard fixtures. Calls and hourly activity use the selected `Asia/Kuala_Lumpur` date; confirmed bookings use their scheduled date and exclude cancellations. Wallet spend includes usage debits applied on that date, not historical call estimates or top-ups. An empty day shows zero totals and a route back to the latest sample call date.

Recovered missed calls require an explicit `entry_point: forwarded_missed` on the call record. Fresh fictional fixtures include this evidence; older saved calls without it are not retroactively classified. This does not claim a live missed-call recovery occurred.

Current alerts link to staff-owned conversations, unclear delivery, calendar connection, WhatsApp health, forwarding and wallet/payment recovery. Alerts reflect current workspace state independently of the date filter. Recent calls open their matching details, appointments open the matching booking day, and wallet/retention links reach the corresponding settings.

## Settings and connected behavior

- **Business:** update name and business type. The shared sidebar, setup and receipts use the same organization. Changes invalidate agent testing and forwarding verification. Templated greetings substitute the current business name; custom saved copy is not rewritten.
- **Branches:** edit the primary branch, create additional branches, archive and restore. Active branches appear in phone routing and booking forms. The primary branch, a phone-assigned branch or a branch with non-cancelled bookings cannot be archived. Historical cancelled bookings retain their branch identity. All branches currently share the agent's hours, closures, duration and buffer; per-branch schedules are not implemented.
- **Team:** create fictional invitations, accept them locally, edit member details/roles, deactivate and reactivate. Duplicate emails are rejected case-insensitively. The owner cannot be demoted or deactivated. These are sample memberships, not authentication or enforced permissions; no invitation is sent.
- **Owner summaries:** save daily time in KL time and inclusion of staff conversations. Preview counts come from the same dashboard selector. Sample delivery requires enabled summaries and an available WhatsApp channel, then records a timestamp. No external message or background scheduled job runs.
- **API keys:** create clearly non-functional sample values, display once, and retain only metadata/suffix in storage. A local request simulator returns current call/booking counts with scope checks; mismatched scopes return 403 and revoked keys return 401. No real credential or HTTP endpoint is created.
- **Recordings and privacy:** save a 7/30/90/365-day policy, reflected in call details and the dashboard. The preview stores no audio and does not delete recordings. Existing Contacts consent, DNC, export and local deletion remain available through a direct link.
- **Audit:** list local changes to business, branches, team, summaries, keys, retention, agent, channels, wallet, contacts, conversations, bookings and integrations. Filter by category and export sample JSON. Contact and audit exports append an export entry. Entries contain category/time/workspace attribution, not secret values or message contents. This is a local change history, not a production access or tamper-proof audit trail.

## Mock architecture and migration

`web/lib/api/admin.ts` owns administration types, validation, branch guards, audit transitions and sample-key responses. `web/lib/api/dashboard.ts` owns the shared dashboard/summary selector. No dependencies were added.

Administration extends `jomcall-preview-setup-v1`; CRM change history extends `jomcall-preview-crm-v1`. Existing drafts receive administration defaults without replacing business, routing, wallet or CRM records. Stored data remains scoped to the single fictional workspace. Cross-tab storage updates refresh the dashboard and settings, without claiming transactional multi-tab concurrency.

The primary branch stays in the existing `location` record so setup, agent configuration and existing bookings keep their identity. Additional branches are stored with their own IDs and organization IDs. There is no workspace switcher or second organization.

## Verification

- Production build and TypeScript checks pass across all routes.
- Dashboard plus seven settings sections are captured at 390, 768 and 1440 px, BM/English, light/dark: 96 combinations. Branch, member, key and summary dialogs add 48 combinations. Two additional mobile BM/dark checks cover long business names, for 146 combinations total. No axe violations, horizontal overflow or runtime errors were detected. A separate desktop viewport capture verifies active navigation remains visible.
- Connected browser journeys verify business identity, branch routing/booking selection, archive protection, team invitation lifecycle, summary gating, sample key scope/revocation, retention in call details, legacy call links, audit export, dashboard spend/date filters and persistence.
- Further checks verify duplicate branch/email rejection, protected owner, archive/restore, keyboard focus trapping/restoration, cross-tab business/retention changes, confirmation/cancellation changing dashboard totals, and contact-export audit entries.
- Model checks cover KL date boundaries, explicit recovered-call evidence, confirmed booking counts, nonnegative zero spend, branch forwarding gates, audit append behavior, key scopes and legacy draft migration. Existing accounting invariants and the full inbox interaction regression pass.
- Visual review corrected tablet layout crowding, active-sidebar clipping and negative-zero currency display. Evidence lives under `screenshots/admin/`; scripts and raw results remain ignored under `output/playwright/admin/`.

## Remaining boundaries

No live calls, Meta integration, calendar synchronization, payment processing, real credentials, authentication, RBAC, recording storage/retention jobs, notification scheduler or immutable audit backend exists. Real Android/4G Core Web Vitals, CI accessibility wiring and the broader component-state gallery remain outstanding. This completes the requested connected mock screens, not the production services or all remaining roadmap areas.
