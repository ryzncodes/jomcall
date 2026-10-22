# Phase 1 visual directions

Three original static studies for JomCall, retained as historical work. **Superseded:** the owner rejected their level of visual craft. Review the developed Next.js frontend in `web/` instead; see `docs/frontend/refined-direction.md`. Neither version is a working SaaS or voice integration.

## Review locally

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/frontend/directions
```

Open http://127.0.0.1:4173. Direction, light/dark and BM/EN controls preserve choices in the URL:

- `?direction=switchboard&theme=light&lang=en`
- `?direction=open&theme=light&lang=en`
- `?direction=appointment&theme=light&lang=en`

Each page includes a marketing hero and a working local call-log preview. Sample transcript replay, caller search, attention filter, call details and native dialog keyboard behavior are available. Navigation labels inside the app frame are context only. No live audio, backend, login or charges.

## Phase 0: users and trust

| Persona | Job to be done | Trust moment | Abandonment trigger |
|---|---|---|---|
| Fictional clinic receptionist-owner, Shah Alam | Serve patients without losing the next booking to an unanswered call | Test call repeats the right time, service and branch, then makes handoff clear | Wrong appointment details or AI sounding certain when it should ask staff |
| Fictional salon owner, Penang, prefers Mandarin | Keep hands on the haircut while callers book in their own language | Hear natural Mandarin and successful code-switching, then inspect the booking | Awkward speech, wrong name or repeated corrections; BM/EN owner UI may also create friction |
| Fictional workshop owner, Johor, WhatsApp-first | Capture service questions and callback requests while working on vehicles | A short call summary tells staff exactly whom to call and why | Unclear handoffs, duplicate follow-ups or constant manual supervision |

Marketing's single job: earn a demo call by making the conversation believable. App's single job: let owners set up and test confidently within 15 minutes, then check activity in seconds.

Critical screens: guided setup with browser call and forwarding verification; agent test panel; call log and detail.

### Setup journey

1. Sign up → choose business type. Anxiety: another long registration. Use small steps and resumable progress.
2. Import/review hours, services and FAQs. Anxiety: wrong information reaching customers. Draft clearly, ask owner to review before publishing.
3. Choose caller languages and voice. Anxiety: accent and pronunciation. Preview specific booking phrases; do not promise quality without benchmark evidence.
4. Browser test: idle → connecting → live → ended, plus microphone denied, timeout and retry. Anxiety peaks at first AI greeting. Show disclosure before testing and show what was booked or handed off.
5. Connect Malaysian number, WhatsApp and calendar as needed. Anxiety: loss of number or access. Explain scopes and show connection health. Existing spec places these before testing; propose making optional channels deferrable so the first test is not gated by all integrations.
6. Choose missed-calls-only or always-forward; follow verified telco instructions; make verification call. Anxiety peaks at giving up control. Keep manual fallback visible; do not show “live” until verified.
7. Explain trial balance and cost, then optional top-up. Anxiety: unexpected charges. Show MYR amounts and explicit payment action. Rates await actual provider costs.
8. First real call → summary and transcript → action if needed. Trust is reinforced by visible evidence, not only totals.

## Direction A: Switchboard

A front desk seen through its phone lines: compressed, confident headlines beside a tall conversation console. Blue-grey surfaces and petrol ink recall practical communication equipment without pretending to be an engineering dashboard. The waveform is the hero's one graphic event. In the app it shrinks to a quiet recording cue beside compact rows, with a persistent navigation rail and explicit attention states.

- Type: **Barlow Condensed 600** display / **Public Sans 400** body / **IBM Plex Mono 400** for times and costs.
- Hero: left-aligned condensed statement; right-aligned transcript console; languages below the console.
- Motion principle: one signal travels into speaker turns, ending at a tool result. Prototype uses user-triggered text reveal; no looping ambient animation.
- Strength: strongest phone-first identity and quickest operational scan. Risk: cooler tone needs friendly copy.

| Token | Light | Dark |
|---|---|---|
| Paper | `#E9EFF0` | `#193B45` |
| Surface | `#FFFFFF` | `#244B56` |
| Ink | `#153E49` | `#EDF4F5` |
| Muted | `#50666B` | `#B9CDD2` |
| Accent | `#205766` | `#ADCFD8` |
| Line | `#BDCDD0` | `#53737C` |

## Direction B: Open for calls

A shop's open sign becomes the central promise: someone is still answering while the owner works. Broad lettering and a yellow sign on navy brackets borrow from functional Malaysian storefront signage, without cultural patterns as decoration. The transcript sits underneath as evidence. The app replaces the side rail with a horizontal counter: summary at left, a broad callback queue at right. Marketing has personality; operations stay plain.

- Type: **Archivo Black 400** display / **Public Sans 400** body / **IBM Plex Mono 400** data.
- Hero: asymmetric headline and physical open sign, followed by conversation and a short booking statement.
- Motion principle: sign settles once, then conversation answers. The static sign keeps its angle; only the user-triggered transcript reveal is implemented at this checkpoint.
- Strength: most memorable for small shops. Risk: heavier display letters consume space in longer BM headlines.

| Token | Light | Dark |
|---|---|---|
| Paper | `#FFF9E3` | `#253952` |
| Surface | `#FFFEF8` | `#304861` |
| Ink | `#223954` | `#FFF9E3` |
| Muted | `#526173` | `#CBD4DD` |
| Accent | `#F1CB43` | `#E3C45C` |
| Line | `#C8C5AB` | `#697B8E` |

The sign keeps navy lettering on yellow in both themes; buttons use Ink/Paper for readable text. Yellow is not used for body text.

## Direction C: Appointment book

A booking slip gives an otherwise invisible call a tangible outcome. Lilac paper, plum ink and generous sans-serif type make the service feel considered rather than clinical. An oversized appointment time is the hero's focal point; the transcript below explains how it got there. In the app, inset call entries form a daily agenda, with a strong left edge for the item needing attention. This puts reassurance and follow-through before machinery.

- Type: **Manrope 600** display / **Public Sans 400** body / **IBM Plex Mono 400** data.
- Hero: left-aligned promise beside a tilted booking slip; transcript and language summary below.
- Motion principle: conversation resolves into a booking slip. The slip is static in Phase 1; text reveal demonstrates pacing without asserting a real booking.
- Strength: warmest fit for clinics and salons. Risk: booking focus may undersell workshop messages and transfers.

| Token | Light | Dark |
|---|---|---|
| Paper | `#F1EDF5` | `#493B50` |
| Surface | `#FFFAFF` | `#594A61` |
| Ink | `#49374F` | `#FBF2FF` |
| Muted | `#705E77` | `#DDCCE3` |
| Accent | `#76537E` | `#D4B8DF` |
| Line | `#CDC0D1` | `#89748F` |

## Recommendation and checkpoint

Start with **Switchboard** for the phone-first product. Choose **Open for calls** if approachable storefront identity matters most; **Appointment book** if bookings are the main sales story. Mixing marketing B with app A is viable, but would need one shared token and typography pass after approval.

Phase 1 deliverable: these pages, screenshots and documented decisions. Owner selection remains required. Phases 2–5 are intentionally not started.

## Font provenance

Downloaded from the Google Fonts CSS service on 2026-10-15. Licenses copied from `https://github.com/google/fonts/tree/main/ofl/` under `barlowcondensed`, `archivoblack`, `manrope`, `publicsans`, `ibmplexmono`. Original font files are unmodified; matching OFL files are bundled in `fonts/`.
