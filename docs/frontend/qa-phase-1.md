# Phase 1 review evidence — 2026-10-15

Scope: static design exploration only. No product release, voice quality, real integration, WCAG conformance certification or Core Web Vitals claim.

## Completed checks

- 36 full-page Playwright screenshots: three directions × two themes × two locales × 390, 768 and 1440 px. Screenshots are in `screenshots/`; filename identifies the complete matrix.
- All 36 report no horizontal document overflow, loaded Public Sans and three sample call rows. See `screenshots/capture-results.json`.
- Inspected all six contact sheets covering the matrix. Fixed long BM heading measure, wrapped RM totals and an English tablet overflow in the Open for calls supporting paragraph.
- Replaced one corrupt full-page capture after disabling smooth motion during capture. Final screenshots show complete pages.
- axe-core checks with WCAG 2 A/AA, 2.1 AA and 2.2 AA tags: zero reported violations across all twelve direction/theme/locale combinations at 390 px and again at 1440 px. Results: `check-mobile-results.json` and `check-results.json` respectively. Automated checks do not replace manual accessibility review.
- Across the same 24 cases: attention filter reduces to one call, unmatched search produces a useful empty state, Enter opens call details, Escape closes it and focus returns to the call row. Sample replay is user-triggered and reduced-motion disables its animation.
- Locally hosted font assets and matching OFL licenses checked. Preview makes no external runtime requests.
- `git diff --check` clean before commit.

## Review notes against usability heuristics

- Visibility: explicit sample banner, outcome chips, attention marker and enabled disclosure status.
- Real-world language: calls, bookings and callback requests; BM/EN switching stays separate from caller languages.
- Control: reversible filters, visible modal close, Escape and focus return. Full setup must add resumable progress and safe retry.
- Consistency: same fictional calls and outcomes across all directions; money in MYR and times in Malaysia.
- Error prevention: no microphone request, forwarding codes or payment action in a static review. Future setup must verify external states before success.
- Recognition: caller, time, outcome, language and cost visible without opening details.
- Efficiency: attention filter and search; main app navigation remains illustrative.
- Restraint: marketing uses one signature motif; app reduces it to functional layout cues.
- Recovery: empty state explains how to clear the search; live service errors await actual state machines.
- Help: preview boundaries are stated in-page; telco guides require source verification before implementation.

## Deferred until owner selection

Next.js/strict TypeScript foundation, W3C token source, atomic component gallery, all component states, guided setup, real browser-call state machine, voice picker, complete call details/audio, full privacy controls, CI accessibility checks and performance measurement on Android/4G. These are later handover phases, not omissions from a claimed product build.

Review starts at `directions/index.html` served through the README's local HTTP command. Choose or mix directions before Phase 2. Current recommendation: Switchboard for phone-first clarity.
