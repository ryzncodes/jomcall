# Guided setup and agent testing

Date: 15 October 2026. Review target: `web/`, branch `codex/frontend-directions`.

## Design and scope

The owner requested the developed visual standard across the app, starting with the two priority flows in `screens.md`. The shared shell now connects Calls, Guided setup and Agent test panel. Setup uses a quiet progress rail, generous form typography and one primary action per stage. Mobile progress collapses behind a labelled control. The test panel puts a dark call console beside text chat; on phones, labelled anchors move between them. Transcript turns, inline tool actions and explicit status changes make behavior inspectable.

The existing local fonts, forest/paper palette and small-radius controls carry the identity. No new dependency or third-party artwork was added. The earlier marketing page and call log remain available.

| Route | Working preview |
|---|---|
| `/app/setup` | Nine stages, local save/resume, validation, retry and completion |
| `/app/test` | Simulated browser call and text chat, live transcript, sample latency, tools used and recent call outcomes |
| `/app` | Existing searchable call log and detail, now inside the shared shell |

Both interfaces support BM/English and light/dark. Add `?lang=ms&theme=dark` to review the alternative. Switching interface language preserves saved business content.

## Setup stages

1. Business: salon, clinic or workshop, business name and branch.
2. Knowledge: validate a website/Google Business URL, run a sample import, edit hours/services/FAQ. No URL is fetched.
3. Agent: caller languages, three voice directions, greeting, mandatory AI introduction, recording toggle and disclosure text. Audio auditions use an installed local device voice when available; these are not provider voice samples.
4. Number: reserve a masked fictional Malaysian number, including an unavailable/retry state. Its E.164 field stays null so it cannot accidentally represent a real subscriber.
5. WhatsApp: sample connect/failure/retry/disconnect, or explicit skip.
6. Calendar: sample Google Calendar or Cal.com connection, failure/retry/disconnect, or explicit skip.
7. Browser call: simulated permission, connecting, live, ended and error states. Complete the full scenario to pass; early hang-up does not pass. Mute pauses the sample progression. Denied permission, connection failure and timeout have recovery paths.
8. Forwarding: telco-specific guidance, missed/all mode, checklist and sample verification. Changing carrier or mode clears the old verification.
9. Credit: one RM20 sample trial grant, optional sample top-ups, integer-sen ledger and completion screen. Reloading cannot duplicate the trial grant.

Editing agent/business knowledge invalidates prior call and forwarding checks. Completion checks all preceding requirements. Optional channel/calendar steps still require an explicit connect or skip decision.

## Mock contract

`web/lib/api/product-types.ts` defines the setup draft, call states and test turns. `product.ts` implements the replaceable mock adapter. The draft groups organization, location, agent/version reference, knowledge items, phone line, WhatsApp channel and wallet ledger around the architecture's entities. Calendar connection and setup progress are frontend workflow state, not a proposed database schema.

The provider saves under `jomcall-preview-setup-v1`. Malformed data falls back to defaults; unavailable storage shows an in-tab warning. Clear that key to reset the preview. This storage is only a local fictional-data preview, not a secure or multi-user backend.

Call scenarios cover booking, opening hours and staff handoff. Saved greetings, hours and recording settings affect the transcript. AI disclosure remains present. A connected sample calendar yields sample availability/booking actions; a skipped calendar takes a message. Chat uses deterministic keyword matching, supports custom prompts and suggestions, and has a one-shot reply failure/retry path. Retrying does not duplicate the user turn; clearing cancels a pending response. Call and chat can run simultaneously.

No microphone or call audio is captured. No external model, real account connection, website import, booking, forwarding, credit or charge occurs. The voice audition is the only actual audio feature and only uses voices marked local by the browser. Real provider quality and latency remain unverified; the displayed 420 ms is explicitly sample data.

## Forwarding sources

Checked 15 October 2026. The UI paraphrases these sources and asks the owner to confirm plan/device support. It does not provide unverified activation codes.

- [Maxis call forwarding FAQ](https://www.maxis.com.my/en/faq/network/mobile/call-fowarding/): check the line add-on and use phone settings.
- [CelcomDigi call forwarding guide](https://help.celcomdigi.com/en/support/solutions/articles/70000665825-how-to-turn-on-off-call-forwarding-): device settings vary; confirm conditional forwarding with the provider.
- [U Mobile call forwarding FAQ](https://www.u.com.my/en/personal/support/faqs/value-added-services/call-forwarding): verify activation and forwarding charges before testing.
- [Unifi support](https://unifi.com.my/support/contact-us): establish whether the line is mobile or fixed and ask support for the correct procedure. No universal activation claim.

Provider names here are integrations expressly required by `screens.md`.

## Verification

Production `npm run build --prefix web` and `npm run typecheck --prefix web` pass. Local production server binds to `127.0.0.1:4181`.

Evidence in `screenshots/product/`:

| Evidence | Coverage | Result |
|---|---|---|
| `capture-en.json`, `capture-ms.json` | Nine stages plus test panel × two locales × two themes × 390/768/1440 px = 120 combinations | No detected overflow, axe violations or runtime errors |
| `finish-capture.json` | Completion and call log × same locale/theme/width matrix = 24 combinations | No detected overflow, axe violations or runtime errors |
| `journey.json` | Full setup, failure recovery, save/resume, trial idempotency, chat intents/retry/clear, invalidation | Passed |
| `recovery.json` | Device voice start/stop, busy form lock, permission/connection/timeout recovery, early hang-up, concurrent call/chat, malformed/blocked storage, mobile call-log regression | Passed |
| `keyboard.json` | Radio arrow keys, Enter advance, heading focus, Tab order, long BM business/branch names at 390 px | Passed |

Screenshots include every matrix state, a live call/chat desktop view and a long-name mobile view. Representative full renders and contact sheets were visually inspected. Axe used WCAG 2 A/AA, 2.1 AA and 2.2 AA tags. Existing reduced-motion handling applies to the call animation and transitions.

### Usability review

| Heuristic | Setup and call-log treatment |
|---|---|
| System status | Saved/saving/unavailable status, numbered progress, call states, connection chips and verification outcomes |
| Familiar language | Business terms, MYR amounts and KL time; implementation details stay out of primary actions |
| User control | Back, save/leave, explicit skips, disconnect, stop voice, end call, chat clear and dialog Escape |
| Consistency | Shared shell, field styling, localized action names and outcome treatments |
| Error prevention | Required fields, disabled busy controls, setup gates, invalidation after edits and one-time trial credit |
| Recognition | Visible stage names, current configuration, transcript/tool history and call detail tabs |
| Efficiency | Resume, chat suggestions, mobile pane anchors, call search and outcome filters |
| Minimal presentation | One setup decision per stage; recovery controls collapsed; no decorative marketing scene inside forms |
| Error recovery | Specific retry paths, preserved draft, explicit unavailable voice/storage states |
| Help | Field hints, mock boundaries, forwarding checklist and official provider help |

Limits: no screen-reader session, cross-engine matrix, real Android/4G Core Web Vitals or accessibility certification. Axe is not yet wired into CI. Authentication, real voice/channel/payment integrations, recording playback, persistent PDPA workflows, other product areas, W3C token serialization and the component-state gallery remain outstanding. No deployment or production-readiness claim is made.
