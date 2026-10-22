# An attentive front desk

Review build: `web/`. Date: 15 October 2026. Status: developed frontend preview, awaiting owner feedback.

## Design

The subject is service: a front desk that stays attentive while the owner is busy. A translucent green telephone, brushed silver and tropical daylight give an invisible AI service a tangible visual world. Large plain typography introduces the idea; a conversation demonstrates it; the call log makes its outcome inspectable.

The page changes scale deliberately. A wide material scene follows the opening statement. A quiet business selector explains relevance. A dark conversation section makes the transcript the focal point. Three numbered steps lead into a large working app preview. Privacy controls, an expandable FAQ and a large closing wordmark finish the story.

The app drops editorial effects. Call rows align names, outcomes, times and sen-based costs. The selected call opens beside the list on wide screens and in a focus-managed dialog below 1180 px. Search and filtering keep the selected detail consistent with visible results. Empty results remove stale details.

### Palette and typography

| Role | Light | Dark |
|---|---|---|
| Paper | `#F5F6F2` | `#1C2C26` |
| Surface | `#FFFFFF` | `#263A31` |
| Ink | `#23392F` | `#EDF1E6` |
| Secondary | `#5B695F` | `#B6C4B7` |
| Rule | `#DCE1D9` | `#405349` |
| Accent | `#D7E7B6` | `#D7E7B6` |

Public Sans carries display and reading text. Manrope supports the wordmark and selected interface labels. IBM Plex Mono carries durations and aligned figures. Fonts are local, with their OFL notices. Current TTF files total approximately 280 KB uncompressed; WOFF2 conversion, glyph subsetting and production preload tuning remain performance work.

Motion follows an event: a user starts a sample conversation, turns arrive, then a booking ticket becomes confirmed. Pause, resume, reset and replay are available. The hero has a brief entrance; there is no looping idle spectacle, scroll hijack or WebGL. Reduced-motion preferences stop entrance/wave animations and remove transcript movement.

## Implementation scope

This section records the first developed revision. Guided setup and a dedicated test panel were added afterward; current scope and evidence are in [setup-and-testing.md](setup-and-testing.md).

Built:

- Marketing page with original artwork, business selector, interactive text sample, working app preview links, controls narrative, FAQ and footer.
- Call log and detail: filters, search, selected states, summary/transcript tabs, fictional consent information, in-memory do-not-contact and sample JSON export.
- Agent-test view sharing the controllable sample conversation.
- BM/English and light/dark across both routes; three demo language examples.
- Centralized typed organization/contact/call mock adapter; MYR formatting from integer sen; Malaysian time formatting.

Not yet built: guided setup, live browser calls and microphone states, voice picker, call forwarding verification, messaging inbox, persistent compliance workflows, real connections, authentication, billing, full component-state gallery and W3C token artifact. Pricing remains undecided and is explained in the FAQ. This is not a complete Phase 2 or Phase 3 delivery.

The original static direction sampler is historical. The owner's request for a deeper redesign superseded the initial sampler-only checkpoint for this iteration. It is not a record of approval of the finished visual direction.

## Verification

Production `next build` passes, including TypeScript checking. Screenshots in `screenshots/refined/` cover marketing and app × BM/English × light/dark × 390/768/1440 px: 24 combinations. `checks.json` records no detected horizontal overflow, loaded primary font, zero runtime/console errors and zero axe violations under WCAG 2 A/AA, 2.1 AA and 2.2 AA tags. Desktop, tablet and mobile contact sheets and representative full renders were visually inspected.

`interactions.json` records passing browser checks for:

- Business selection, demo start/pause/resume/finish/replay/reset, English and Mandarin samples.
- FAQ expansion, locale/theme changes and document language update.
- Deep-linked call selection, booked/attention filters, search, empty results and detail synchronization.
- Keyboard transcript tabs, do-not-contact state, downloaded sample JSON and agent-test navigation.
- Mobile dialog, dialog axe scan, Escape close and focus restoration.
- Mobile menu closing after navigation; reduced-motion hero and waveform.

The exported JSON was separately inspected: `sample: true`, changed `do_not_contact: true`, and no real phone number. Checks fixed waveform hydration precision, motion hydration, filtered-detail consistency, modal focus return, two contrast issues and tablet BM heading composition.

Four extra 390 px dark-mode states cover BM/English mobile call detail and the agent-test view. `extra-states.json` records zero axe violations; the test view has no horizontal overflow.

Limits: automated axe is not a complete WCAG certification. No screen-reader usability session, cross-engine browser matrix, real mid-range Android/4G performance run or production Core Web Vitals has been measured. There is no real voice or external integration to validate. The baseline is local Chromium against a production build, not a deployment claim.

## Dependencies and asset provenance

Direct runtime dependencies: Next.js, React, React DOM, Motion, Radix Dialog and Phosphor React icons; published package metadata lists MIT for these dependencies. Tailwind, TypeScript and their tooling are in the lockfile. Installed transitive packages include MIT, ISC, BSD, Apache-2.0, MPL-2.0, CC-BY-4.0 and LGPL-3.0-or-later declarations; keep their upstream notices with distributions. `npm install` reported zero known vulnerabilities at installation time. Fonts retain separate OFL-1.1 licenses. No external website assets or source code were imported.

`web/public/images/front-desk.png` is original AI-generated concept artwork, 1536 × 1024. It is not a photograph of a real device or business. Next.js Image serves optimized responsive derivatives. The source is retained unchanged. Generation used the built-in image tool with this prompt:

> Use case: product-mockup. Asset type: original cinematic editorial artwork for JomCall, an AI receptionist SaaS for Malaysian small businesses. Create a very wide landscape high-end still-life photograph, 3:2 or wider. A beautiful translucent pale chartreuse/mint green retro telephone handset, real physical object with soft satin clear resin, resting diagonally on a low rectangular brushed-aluminium telephone cradle on a pale cool-grey stone receptionist counter. The phone is oversized and sculptural, placed toward right half. A dark forest green coiled telephone cord loops elegantly across the lower foreground toward the left; keep left upper third empty, atmospheric cool pale sage. Behind the counter is ribbed frosted glass, soft shadows of tropical leaves outside a Malaysian shop, soft morning directional sunlight through the glass from top left. Subtle warm highlights against cool silver. Camera low three-quarter angle, 50mm editorial product lens, exquisite material realism, fine brushed metal grain, beautiful directional shadows. Quiet luxurious industrial art direction, not science fiction. Main handset and cradle fully visible, generous negative space, clean intentional composition. No text, no numbers, no logos, no interfaces, no UI cards, no gradients, no rendered letters, no people, no watermark. This is conceptual photography, not an interface mockup. Original composition, do not reference any existing brand or website.
