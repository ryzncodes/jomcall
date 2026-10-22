# Remaining screen groups — connected mock preview

Built on 15 October 2026 against `screens.md`. The existing paper/forest design, Public Sans, Manrope and Plex Mono continue throughout. No dependencies were added.

## Coverage

| Surface | Routes | Working preview behavior |
|---|---|---|
| Public reference pages | `/pricing`, `/docs`, `/privacy`, `/terms` | Integer-sen usage calculator, expandable guides linking to product screens, anchored privacy/terms documents describing the local preview |
| Access | `/login`, `/signup`, `/forgot-password`, `/invite` | Email/Google simulation, linked sample member creation, recovery preview, pending invitation acceptance, persisted session and sign-out |
| Outbound | `/app/outbound` | Editable ordered steps, source/consent/re-entry rules, immutable published revisions, manual run clock, run monitor, unknown-outcome review queue |
| Hosted admin | `/admin` | Searchable fictional tenants, pause/resume, masked number pool, assignment/release, abuse review, shared current-workspace usage |
| Self-host | `/self-host` | Configurable missing/ready/invalid fixtures for database, speech, model and SIP, explicit checks, readiness gate, setup checklist download |
| Branch schedules | `/app/hours` | Independent weekly schedules, state selection, explicitly fictional holiday closures, inheritance reset, booking validation |
| Call-log completion | `/app/calls` | Outcome/language/date/branch/line filters, reset, transfer result, recorded version reference, native sample audio player and seek controls |

All rows in the screen inventory now have a navigable mock surface. This is screen coverage, not production service completion.

## Connected state

- Setup storage gains typed `extensions` for sample sessions, hosted administration, self-host readiness and branch schedules. Missing extensions migrate to defaults without replacing prior settings.
- CRM storage gains `outbound`: editable workflow draft, immutable revisions and runs. Every revision/run has `org_id`. Runs retain the revision they started on even after another is published.
- Run advancement is explicit. A sample clock exercises waits and Kuala Lumpur quiet hours. No background process or real send occurs. The clock cannot move execution backward past a completed step, and a future-dated reply cannot authorize an earlier call. Opt-in and DNC are checked on enrollment and again before advancing; calls require a post-enrollment reply. WhatsApp requires a healthy connected channel and an approved template; calls require verified forwarding/test state. Current tenant suspension blocks runs.
- Only one run may be active per contact. Re-entry requires a finished run and an explicitly published re-entry rule. A source-specific enrollment requires a contact imported from that connected source. Facebook/TikTok imports and added Sheets/webhook import actions record provenance, with opt-in off until explicitly granted in Contacts. Existing export/test actions remain intact.
- Unknown outcomes freeze the run and append exactly one unknown attempt to the inbox. Recording confirmation updates the same event; recording non-delivery stops the run without resending. Confirmed outbound calls appear in the shared call log. Confirmed workflow usage is reconciled into the existing wallet with stable usage IDs while the outbound screen is open; historical/manual activity retains the existing billing action. Repeated confirmations cannot charge twice.
- Contact export includes workflow runs. Contact deletion removes those runs with linked messages/bookings/calls. Audit entries identify changes by category without storing message contents or password values.
- Signup adds a sample admin member to the single fictional workspace; invitation acceptance activates the member created in Settings. Email/Google sessions are simulations, with no password persistence, OAuth, email delivery, real authentication or role enforcement.
- Hosted admin has one connected workspace and two labeled comparison fixtures. It is intentionally public in this preview. Pause blocks local outbound execution only; it is not a security boundary. Number-pool labels are masked inventory identifiers; assigning or releasing updates the shared line reservation and invalidates forwarding verification. The preview still supports one assigned line.
- Branch schedules fall back to the primary schedule until an override is saved. Saving primary hours also updates the agent's main schedule. Booking validation consults the selected branch; per-branch schedules are separate from agent-version snapshots. State-holiday fixtures require an explicit date and are never represented as an official holiday feed.
- Fresh call fixtures attach an eight-second, locally generated synthetic test tone to demonstrate playback/seek. No speech or customer recording is present. Mobile call deep links open the chosen detail immediately and restore focus on close; selection waits for data loading. Old saved calls lacking recording/branch/line metadata are left unspecified rather than assigned invented history. Outbound calls have no recording fixture.

## Design and accessibility

The outbound editor uses an ordered vertical path with editable steps and a separate rules panel. The run monitor prioritizes blocked reasons and next actions. Public pages use larger editorial typography; access pages use a restrained voice-line illustration. Hosted admin uses lists and usage summaries; self-host checks use a dependency checklist. Mobile views stack these layouts and retain scrollable navigation.

Explicit control names, native form semantics, Radix modal focus management, visible focus and reduced-motion behavior are retained. The pricing slider names and call-row accessible names were corrected during browser verification. All interface copy is in BM/English dictionaries; user-authored/sample record content remains in its saved language.

## Verification

Production build and TypeScript pass. Main route capture covers 13 surfaces × 3 widths × 2 languages × 2 themes (156 combinations); 10 populated states add 120 combinations. Integration cards, pending invitations, two long-name checks and recording/deep-link states bring the final total to 314 unique combinations, with zero detected axe violations, horizontal overflow or runtime errors. Browser journeys cover access, invitation lifecycle, readiness invalidation, number inventory, abuse resolution, workflow delivery/review, usage charges and call filters. Additional checks exercise branch closures, native audio playback/seeking, keyboard focus, DNC and imported lead enrollment. Typed-model checks exercise quiet-hour boundaries, revision pinning, duplicate runs, delayed steps, engagement, DNC, unknown-outcome idempotency and accounting deduplication.

Final machine-readable results and screenshots live in `screenshots/remaining/`. Temporary browser scripts and raw outputs live in ignored `output/playwright/remaining/`.

## Remaining production and QA work

No backend worker, real authentication/RBAC, tenant isolation, OAuth, provider credential checking, SIP/voice service, Meta service, payment processing, official holiday feed, notification scheduler or real recording retention exists. Privacy and terms are clearly marked preview documents; final operator identity, contacts, commercial terms and policy review remain required before launch. Pricing is illustrative and excludes numbers/provider fees/taxes.

The handover's broader component-state gallery, CI accessibility wiring and measured mid-range Android/4G Core Web Vitals remain separate unfinished QA/foundation work. The existing three trust-critical screens remain the priority when connecting real services.
