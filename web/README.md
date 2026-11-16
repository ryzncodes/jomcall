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

## Guided setup (local and hosted builds only)

`/app/setup` is one guided flow with four stages. It is not part of this mock preview, which keeps its own nine-stage setup above.

1. Business type: pick one of twelve types. Packs that go with it can be ticked.
2. Interview: up to 8 questions, one per screen, with Back and Skip. Answers are kept as the owner moves on; there is no Save button.
3. Review: what was gathered, what is still missing (3 shown, "Show all" for the rest), and any value that would replace a current one. Apply writes it to the agent. It never publishes.
4. Finish: a test turn on the fresh draft, then Publish. After Publish the page shows the live state.

Bring a document (new, between business type and the interview, only when `JOMCALL_SETUP_READER=anthropic` is set for the web service and the agent process). The owner can add a price-list photo, a PDF, a CSV file or pasted text (cells copied from a spreadsheet arrive as pasted text; an .xlsx file is refused with a message to paste the cells or save as CSV or PDF). At most 5 files per setup, 10 MB each, 20,000 pasted characters. Photos are shrunk in the browser before sending; a very tall picture is refused with a message to crop it into parts. A plain notice says the content goes to Anthropic and tells the owner not to add customer names or phone numbers. The agent process reads each file. The interview asks only what is still missing when the files have finished reading before the owner continues; otherwise later questions open filled in from the document. The stage can be skipped. With the reader switch off, the bring stage and the "Add a document" link are hidden, and the interview works as before.

On the review page, the price rows from documents show as a table. Rows that need a look (the reader was unsure, the price is missing, the item is listed twice, or it matches an item the agent already has) come first, with the reader's reason. The owner confirms a row, types a corrected price, or removes it; a flagged row never reaches the agent unless the owner confirms or corrects it; unflagged priced rows are saved with the page; a row with no price is never applied. A removed row can be restored with Undo. Rows keep their place while the owner works, and every confirming or removing control ignores taps for half a second after the page changes, so a moving list cannot confirm the wrong price. "Remove everything from this file" (shown once the file is read; "Remove" before that) deletes the file and its unconfirmed and removed rows, and leaves rows the owner already confirmed. The apply button says how many prices will be saved and asks first about any that will be left out. The review page's logic is in `components/core/setup/rules.ts`; the same planner (`packages/domain/src/setup/rows.ts`) decides what the screen predicts and what apply writes.

`/app/inbox` in the local and hosted apps is the shared WhatsApp inbox (`components/core/inbox.tsx`). It reads only the inbox commands: the list comes in the server's order (waiting for staff first, then newest), the open chat polls every 5 seconds while the page is visible, and the reply box shows what the server's send rules say before sending (`reply_outlook` on the `conversation` read) and the agent process's decision after it (`blocked` with a reason). Send is disabled when the server says the reply would be refused, and the server itself refuses a reply on a hard refusal (do-not-contact, opted out, no consent for the reply-request template, contact being deleted, reply-request already sent) before storing it. Each draft keeps one idempotency key, so a retry after a lost response cannot queue a second message. Phone numbers show as the last four digits only. On an error the screen offers a retry and never shows sample records. To try it locally, run the app and the agent process with `JOMCALL_WHATSAPP_PROVIDER=fake` and the WhatsApp secrets, connect a fake number in WhatsApp settings, and send messages with `npm run whatsapp:simulate`.

The sidebar hides Phone numbers, WhatsApp and Integrations until each is connected; Inbox follows the WhatsApp rule, because it holds WhatsApp chats only for now. Guided setup leaves the sidebar once the agent is published, except while the owner is on it.

## Voice picker (local and hosted apps)

The Agent builder's Voice field is a single-choice list of the five spoken voices in `packages/contracts/src/voices.ts` (`VOICE_PRESETS`, the same list the browser voice test, the phone line and the Python worker use). Each shows Google's own description and gender. Saving stores the exact voice name in `voicePreference`; an empty saved value shows the default voice selected with a note; old free text that is not a voice name is shown back in the note ("Your earlier note … is not a voice name") and is replaced by the selected voice on the next save. The old text was also part of the prompt's business configuration, so it leaves the next published version. Play buttons stream pre-recorded clips from `web/public/voice-samples/` in the page's language, one at a time, with a plain audio element: no model call and no microphone. Clips are recorded with `npm run voice:samples -- --paid` (see `voice/README.md`); a voice without a clip has no Play button. The mock preview keeps its own setup voice styles and does not use this picker.

## Preview boundaries

Setup persists in this browser under `jomcall-preview-setup-v1`. Malformed drafts recover to defaults; unavailable storage shows a warning. Clear that key to reset the preview. Use fictional information only. Contacts, inbox, call log, consent and bookings share persistent browser-local records. Export downloads sample JSON.

Browser calls and text replies are deterministic simulations. No microphone, real call, website fetch, AI model, live account connection, external booking or payment is used. The voice picker can audition an installed local device voice through speech synthesis; this is not a production voice-provider demo. It shows a fallback when no suitable local voice exists.

Setup covers all nine stages, including optional channel/calendar skips, call and forwarding failure recovery, and an idempotent RM20 sample credit. The test panel reads saved setup, displays transcript/tool turns and supports concurrent call/chat tests. Real integrations, authentication, payment processing and remaining product areas are unbuilt.

Source is FSL-1.1-ALv2 (see the root `LICENSE.md`). Font licenses remain OFL-1.1 and are bundled beside their files. Dependency licenses are retained in installed packages. See `docs/frontend/refined-direction.md` for the earlier design rationale and verification evidence. See `docs/frontend/setup-and-testing.md` for the setup/test extension.

Builder settings extend the setup draft. Contacts, inbox, bookings, consent, call records and connector health use `jomcall-preview-crm-v1`. Older inbox data is migrated once and its legacy storage copy removed after a successful save. Calendar connection state stays in the shared setup draft. Clear the setup and CRM keys to reset the fictional workspace. No real messages or calls leave this app. See `docs/frontend/agent-builder-and-inbox.md` for feature/QA details and `docs/research/integration-roadmap.md` for provider research.

See `docs/frontend/contacts-bookings-integrations.md` for the connected operations screens, migration rules and QA evidence.

Phone routing, channel quality, template approval, payments and usage extend the same setup store. Inbox sends use the shared channel/template gates; billing draws sample activity from the CRM store. See `docs/frontend/phone-whatsapp-billing.md` for behavior, migration and QA. In the local and hosted apps only (never this preview), the wallet screen at `/app/billing` also has a plan card (`components/core/plan-card.tsx`, rules in `lib/core/plan-rules.ts`) through the `plan` and `choosePlan` commands: owners and admins start a first paid plan at once from the wallet, change or cancel a change for the next period, and see unpaid and stopped warnings; staff get no card.

Home metrics and owner-summary previews derive from shared call, booking and wallet records. Settings extend the setup store with branches, sample memberships, summary preferences, recording retention and non-functional key metadata. CRM and setup changes append local audit entries. Existing `/app?call=...` links still open the call log. See `docs/frontend/home-and-settings.md` for supported workflows and production boundaries.

Remaining screen groups: `/pricing`, `/docs`, `/privacy`, `/terms`, `/login`, `/signup`, `/forgot-password`, `/invite`, `/app/outbound`, `/app/hours`, `/admin`, `/self-host`. Shared setup extensions and CRM workflow records preserve earlier local data. Call playback uses an explicitly labeled generated test tone; no customer audio. Access, infrastructure and hosted-admin actions remain fictional. See `docs/frontend/remaining-screens.md` for behavior, QA and remaining production/foundation work.

Whole-app review and verification: [docs/frontend/whole-app-review.md](../docs/frontend/whole-app-review.md).
