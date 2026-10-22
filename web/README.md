# JomCall frontend preview

A developed visual preview for a Malaysian AI front desk. Twenty-six product/public routes, BM/English, light/dark, fictional data only.

## Run

From the repository root, with Node.js 20.9 or newer:

```sh
npm ci --prefix web
npm run dev --prefix web -- --port 4180
```

Open `http://127.0.0.1:4180/` for marketing, `/app` for the home dashboard, `/app/calls` for the call log, `/app/setup` for guided setup, `/app/test` for the agent test panel, `/app/agent` for the agent builder, `/app/inbox` for the shared inbox, `/app/contacts` for contacts, `/app/bookings` for the calendar, `/app/integrations` for connected tools, `/app/phone-numbers` for routing, `/app/whatsapp` for channel/templates, `/app/billing` for the shared wallet, or `/app/settings` for workspace administration. Use `?lang=ms&theme=dark` to review BM/dark. The header switches locale and theme.

Production verification:

```sh
npm run build --prefix web
npm run start --prefix web -- --port 4181
npm run typecheck --prefix web
```

The dev/start scripts bind to localhost. No environment variables or backend accounts are required.

## Structure

- `app/`: App Router entry points and theme/responsive CSS.
- `components/marketing.tsx`: editorial landing page, business examples and FAQ.
- `components/call-demo.tsx`: controllable text simulation and illustrative waveform.
- `components/workspace.tsx`: searchable call log, details and contact controls.
- `components/product/`: shared app shell, persistent setup, agent builder/version history, shared contact inbox, simulated browser call and text-chat tester.
- `components/experience.tsx`: typed locale/theme context and shared header controls.
- `lib/api/`: typed adapter and centralized fictional records. Replace the adapter when the backend exists.
- `messages/`: BM and English copy.
- `public/`: local licensed fonts and original generated artwork.

## Preview boundaries

Setup persists in this browser under `jomcall-preview-setup-v1`. Malformed drafts recover to defaults; unavailable storage shows a warning. Clear that key to reset the preview. Use fictional information only. Contacts, inbox, call log, consent and bookings share persistent browser-local records. Export downloads sample JSON.

Browser calls and text replies are deterministic simulations. No microphone, real call, website fetch, AI model, live account connection, external booking or payment is used. The voice picker can audition an installed local device voice through speech synthesis; this is not a production voice-provider demo. It shows a fallback when no suitable local voice exists.

Setup covers all nine stages, including optional channel/calendar skips, call and forwarding failure recovery, and an idempotent RM20 sample credit. The test panel reads saved setup, displays transcript/tool turns and supports concurrent call/chat tests. Real integrations, authentication, payment processing and remaining product areas are unbuilt.

Source is FSL-1.1-ALv2 (see the root `LICENSE.md`). Font licenses remain OFL-1.1 and are bundled beside their files. Dependency licenses are retained in installed packages. See `docs/frontend/refined-direction.md` for the earlier design rationale and verification evidence. See `docs/frontend/setup-and-testing.md` for the setup/test extension.

Builder settings extend the setup draft. Contacts, inbox, bookings, consent, call records and connector health use `jomcall-preview-crm-v1`. Older inbox data is migrated once and its legacy storage copy removed after a successful save. Calendar connection state stays in the shared setup draft. Clear the setup and CRM keys to reset the fictional workspace. No real messages or calls leave this app. See `docs/frontend/agent-builder-and-inbox.md` for feature/QA details and `docs/research/integration-roadmap.md` for provider research.

See `docs/frontend/contacts-bookings-integrations.md` for the connected operations screens, migration rules and QA evidence.

Phone routing, channel quality, template approval, payments and usage extend the same setup store. Inbox sends use the shared channel/template gates; billing draws sample activity from the CRM store. See `docs/frontend/phone-whatsapp-billing.md` for behavior, migration and QA.

Home metrics and owner-summary previews derive from shared call, booking and wallet records. Settings extend the setup store with branches, sample memberships, summary preferences, recording retention and non-functional key metadata. CRM and setup changes append local audit entries. Existing `/app?call=...` links still open the call log. See `docs/frontend/home-and-settings.md` for supported workflows and production boundaries.

Remaining screen groups: `/pricing`, `/docs`, `/privacy`, `/terms`, `/login`, `/signup`, `/forgot-password`, `/invite`, `/app/outbound`, `/app/hours`, `/admin`, `/self-host`. Shared setup extensions and CRM workflow records preserve earlier local data. Call playback uses an explicitly labeled generated test tone; no customer audio. Access, infrastructure and hosted-admin actions remain fictional. See `docs/frontend/remaining-screens.md` for behavior, QA and remaining production/foundation work.

Whole-app review and verification: [docs/frontend/whole-app-review.md](../docs/frontend/whole-app-review.md).
