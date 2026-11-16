# Agent page: one page for the agent, its hours and what it could not answer

Status: draft for the owner's approval, 2026-11-16. Nothing is built. A reviewer read it against the code as a builder would; its findings are folded in and listed in section 12. The owner approved the shape and gave two answers that day (section 9). Mock-ups and references: `drafts/agent-page-redesign.html` (not in git), published as a private artifact.

## 1. Why

On 2026-11-14 the owner set up a real agent on staging and called the builder "very very tedious". Guided setup (2026-11-15) fixed the first run. It did not fix coming back: once the agent is published, Setup leaves the sidebar and the owner is in the old builder again.

Measured from the code on 2026-11-16:

- The Agent page has four tabs: Personality & disclosure, Business knowledge, Knowledge core, Published versions. Hours live on a fifth page, `/app/hours`.
- Three of the four tabs and the Publish button are locked while the personality tab has unsaved edits. No server rule needs this. The cause is in the browser: a save on another tab replaces the unsaved settings with the server's copy (`accept()` in `web/components/core/agent.tsx`).
- The knowledge core tab has five sections with their own Save buttons. The questions the agent could not answer are the last of the five.
- Nothing tells the owner that the draft differs from what is live. There is no server diff and no "unpublished changes" signal.
- Hours saved on `/app/hours` never reach a real phone call or a WhatsApp chat. Only browser test sessions add them (`sessionContext` in `packages/domain/src/knowledge/snapshot.ts`). A published snapshot has no hours.

## 2. Goal

An owner on a phone can see in one screen whether the agent is live, what it could not answer and what is waiting to go live, fix it, and publish with one button.

Success looks like:

- Answering a question the agent missed takes three steps: open Agent, type the answer, Publish.
- No Save button on the page. No tab is ever locked.
- After Publish, the agent says the opening hours of every branch on phone and WhatsApp.
- The owner can always tell what Publish will change before pressing it.

## 3. Non-goals and anti-goals

Non-goals for this round:

- The merged "What it knows" list (facts, prices, rules and knowledge items in one searchable list, with paste, photo and PDF adding). Second round. Until then that row opens today's knowledge screens.
- Merging stored `knowledge_item` rows into facts.
- A test panel beside the page on desktop. "Try it" opens the existing `/app/test`.
- A separate agent per branch. One agent, many branches, as today.
- Any change to the mock preview (port 4181).
- Draft schedules (see decision D3).

Anti-goals, any of which makes this a failure:

- An edit that is lost without the owner being told.
- A change that goes live without Publish, except where section 6 says so in plain words.
- A published version from before this change that reads differently to the model afterwards. Old snapshots keep their prompt byte for byte.
- A screen that needs a desktop.

## 4. Approaches

A. Tidy the tabs. Keep four tabs, remove the lock, move the gap list up. Cheap, but hours stay on another page, Save buttons stay, and the owner still cannot see what is waiting to go live.

B. One page built around what needs attention (chosen by the owner, 2026-11-16). A home screen with a status card and four rows, each opening a sub-view. Edits save themselves into the draft. One Publish that lists the changes. Hours move in and are published with the agent.

C. A chat that edits the agent ("tell me what to change"). Rejected: the web service holds no model key, every edit would cost a paid model call, and a wrong edit to a price or a rule is harder to see in a chat than in a list.

## 5. The page

Route `/app/agent`, local and hosted apps. English and Bahasa Melayu, 390 px first, light and dark. Owners and admins edit. Staff see the read-only published summary they see today (`PublishedAgent`), unchanged.

Sub-views are addressed by hash so the back button works: `#questions`, `#knowledge`, `#hours`, `#greeting`, `#more`, `#publish`. `/app/hours` redirects to `/app/agent#hours` and its sidebar entry is removed.

### 5.1 Home

- Status card. One of: "Not published yet", "<name> is answering" with a Live label and the publish date, or the same with "N changes not live yet". Channels named are the ones the `channels` command reports as connected; with none, the line says the agent answers test calls only.
- Row "Questions it could not answer" with the count of open gaps. Hidden count when zero; the row stays.
- Row "What it knows" with counts of confirmed facts, catalogue rows and rules in the draft.
- Row "Opening hours" with a one-line summary of the main branch and the number of branches.
- Row "Greeting and voice" with the disclosure state and languages.
- A "More" link: call types (packs), written instructions, past versions.
- Two buttons fixed at the bottom: "Try it" and "Publish changes". Publish is disabled with the reason shown when there is nothing to publish.

Before the first publish, the home also links to guided setup, which stays the first-run path. This page does not replace it.

### 5.2 Unanswered questions (`#questions`)

- Three filters: To answer (status `open`), Answered (`resolved`), Skipped (`ignored`).
- A card per gap: the latest wording of the question, how many times it was asked (`ask_count`), the channels seen among the stored asks, and when it was last asked.
- A text box and "Save answer". The answer is saved through `resolveGap` with `as: "fact"`. The owner is never asked "fact or rule". A rule can still be written under What it knows.
- `resolveGap` needs a title. The page has an optional short "Topic" field; when it is empty the title is the first 60 characters of the owner's answer. The customer's wording is never used as the title, so customer words are not copied into published versions (D9).
- Answered cards show the owner's answer, read from the fact the gap points to. When that fact no longer exists (deleted, or replaced by a restore), the card says "This answer was removed".
- "We do not answer this" calls `ignoreGap`.
- A saved answer is in the draft and is counted in "changes not live yet". The card says so.
- Empty state: "No unanswered questions. When a customer asks something the agent cannot answer, it shows up here."

### 5.3 Opening hours (`#hours`)

- Branch chips across the top, main branch first, then "+ Branch". "+ Branch" opens a short form for what `createLocation` requires (name, address, state; time zone is set to Kuala Lumpur), then the new branch starts with a copy of the main branch's week. Later edits to those details stay in Settings.
- A branch with no saved schedule shows the all-closed week with "Hours not set yet".
- Presets: Every day, Weekdays, Custom. A preset fills the week from the first open day's blocks; it is a shortcut, not a stored setting. The chip shown as selected is worked out from the week.
- One row per day, Monday first: an open or closed switch, the blocks as typed times, a copy button that offers "Copy to all open days". Up to four blocks a day, as the schema allows today.
- "Closed dates": a list of dates with an optional label, saved with the schedule as today.
- Branch name, address and state stay in Settings. Time zone is not shown: bookings are Kuala Lumpur only.
- Under the week: "The agent says these hours on calls and WhatsApp after you publish. Bookings follow them straight away." (see D3).
- `BOOKINGS_AFFECTED` and `LOCATION_IN_USE` keep their meaning and get plain-word messages that name the number of bookings.

### 5.4 Greeting and voice (`#greeting`)

Agent name, greeting, AI introduction, recording switch and recording disclosure, languages, and the existing voice picker. Same fields and limits as today's personality tab, minus the long instructions, which move to More.

### 5.5 What it knows (`#knowledge`), this round

Today's Business knowledge list and Knowledge core sections (facts, rules, catalogue), shown as one scrolling sub-view without the "save personality first" lock. Their own Save buttons stay this round, because each row is a small form; removing them belongs to the merged list. Call types leave this view for More. The gap section leaves it for `#questions`.

### 5.6 More (`#more`)

Call types (packs), written instructions, and past versions with restore. Compare stays as it is.

### 5.7 Publish (`#publish`)

- A list of what will change, in plain words, from the new `agentChanges` read (section 6): one line per changed setting, per added, changed or removed fact, rule, price and knowledge item, per branch whose hours changed, and per pack switched on or off. More than 12 lines of one kind collapse to a count with "Show all".
- "Try it first" with a suggested question when the change set contains hours or an answered gap. Offered, never required. This page keeps today's builder rule: only the disclosures gate Publish. Guided setup keeps its own stricter rule on its own finish stage (D8).
- When the greeting, the AI introduction or (with recording on) the recording disclosure is missing, the sheet names what is missing and links to `#greeting` in place of the Publish button.
- The sheet holds the change token it was drawn from (section 6). Publish sends it. If anything changed since, publish is refused with `CHANGES_MOVED`, and the sheet redraws the list and says "Something changed since you opened this. Check the list again."
- Publish calls `publish`. On success the home shows "Published" and zero changes.

## 6. Behaviour underneath

Edits save themselves.

- Settings fields save through `saveDraft` 800 ms after the last keystroke and on blur, with the agent revision. `saveDraft` takes the whole settings object, so the page sends the last valid whole object. A field that is not valid yet (empty name, no language) is not sent; it shows its message and the line reads "Not saved yet".
- A small line shows "Saving…", "Saved" or the error.
- One client-side queue per page carries every command that checks the agent revision: `saveDraft`, knowledge items, every knowledge-core row form, `resolveGap`, `ignoreGap` where it applies, starting a draft test, `restore` and `publish`. It sends one at a time and carries the new revision forward, so the owner's own quick edits never conflict with each other.
- A write whose response is lost is sent again with the same body and the same idempotency key before anything newer is sent. Only after that does the queue move on.
- A 409 `CONFLICT` makes the page read the draft again. If the server's draft already equals what this page last sent, it carries on silently. Otherwise someone else changed the agent: the page keeps the text the owner was typing in the field in focus and says "Someone else changed the agent. This shows the latest." Nothing is overwritten silently.
- Moving between sub-views waits for the queue. On closing the tab, the page sends the pending write with a keepalive request; if a write is still unsent the browser's own leave warning is shown.
- Hours save through `saveSchedule` with the schedule's own revision when a day row is valid and loses focus, or a switch is flipped. An invalid row (end before start, overlap) is not sent. `BOOKINGS_AFFECTED` leaves the row as typed, marked not saved, with the message.

`agentChanges` (new read, owners and admins).

- Returns the differences between the draft and the published version, and a count. With no published version it returns everything as new.
- Built in TypeScript beside `publish` in `packages/domain/src/agents.ts`: build what publish would freeze, without writing a `catalogue_set`, and compare it with the published snapshot key by key (`settings`, `knowledge`, `packs`, `facts`, `rules`, `catalogue` by row, `hours` by branch).
- Matching: facts by id; rules, knowledge items and price rows by name. Content that is identical counts as unchanged whatever its id, so a restore does not show everything as changed. Where names repeat, that kind falls back to one line ("Price list changed, 3 rows").
- The price list is compared by its hash first; rows are compared only when the hash differs.
- It also returns a change token: a hash of everything it compared, hours included. `publish` accepts the token and refuses with `CHANGES_MOVED` when what it is about to freeze does not match. This closes the hole that a schedule save does not bump the agent revision.
- The part of `freezeCore` that reads and orders the rows is split from the part that writes `catalogue_set` and `knowledge_unit`, so this read writes nothing.
- The home's "N changes not live yet" is this count. It is read on load and two seconds after the queue goes quiet.

Hours in the published version.

- `publish` adds one top-level key, `hours`: for every active location, its id, name, whether it is the main branch, weekdays, and its closed dates from the publish day onward (Kuala Lumpur), earliest first, at most 60. A location with no saved schedule is included as "not set".
- The prompt's facts section renders hours from `hours` for every branch: branch name, the week, then the frozen closed dates. Nothing is filtered by the clock at prompt time, so the cached spoken prefix does not change at midnight. A branch that is "not set" renders as "<name>: hours not set".
- The hours block has its own byte cap, separate from the facts budget and counted against the input budget: branches are written in full, main branch first, until the cap, and the rest are listed by name with "hours on request from staff". Suggested caps: 1500 bytes for a hosted model, 400 for the local model. The builder fixes the numbers and tests them.
- No SQL change: the phone line and the WhatsApp worker already copy or read the whole snapshot. Only `packages/domain/src/knowledge/prompt.ts` and its callers change.
- A snapshot without `hours` is untouched, so every version published before this change reads exactly as before. The first publish after it changes that agent's prompt.
- Phone and WhatsApp still get no "Business: name (type)" line, as today; branch names appear in the hours block. Adding the business line to published versions is out of scope.
- Browser test sessions: a draft test builds `hours` from the live schedules, so it says what Publish would say; a test of a published version uses that version's frozen `hours`. When a snapshot has `hours`, the hours line of the older single-branch `context` is not rendered. The rest of `context` (the business line in tests) stays.
- `restore` puts settings, knowledge and core back as today. It does not restore hours (D4).
- The `Version` type gains `hours`.

Gap list read. `knowledgeGaps` gains a status filter and returns, per gap, the distinct channels among its stored asks (at most the last 20). No schema change.

No migration is expected. If the builder finds one is needed, it is a deviation to record.

## 7. Decisions

- D1 (owner, 2026-11-16). Shape B: one page built around unanswered questions.
- D2 (owner, 2026-11-16). The agent says new hours only after Publish.
- D3 (my call). There is still one stored schedule per branch. Bookings, the agent's booking tool and the after-hours transfer check read it the moment it is saved; what the agent says about hours comes from the published version. Between a save and Publish the agent can state the old hours while a booking is checked against the new ones. The page says so and counts the change as not live. Cost if wrong: a customer is told an hour the booking then refuses. The alternative, a draft copy of every schedule, doubles the hours data and the booking guard, and can be added later without undoing this.
- D4 (my call). Restoring a past version does not change hours. Hours describe the shop today, and bookings depend on them. The restore screen says so.
- D5 (my call). An answered gap is always saved as a fact.
- D6 (my call). No "Save draft" for settings; row forms under What it knows keep Save this round.
- D7 (owner, 2026-11-16). Round one is home, questions, hours and publish. The merged knowledge list is round two.
- D8 (my call). Guided setup stays as the first-run path and keeps its own Publish rule (a new draft test with a completed answer). This page does not add a test rule; like today's builder, only the disclosures gate Publish. Tying a test to the exact draft would need a new column.
- D9 (my call). An answered gap's title comes from the owner (Topic, or the start of the answer), never from the customer's question. Cost: titles are less tidy than the question would be.
- D10 (my call). Closed dates are frozen at publish. A version published long ago can list dates that have passed and miss ones added since without a publish. The page counts a new closed date as a change not live yet.
- D11 (my call). The agent is not told which branch a caller dialled. With several branches it has all their hours and asks which branch when it matters. Routing by number is a later change.

## 8. Risks

- Prompt change. Hours in the facts section change the spoken and typed prompts for every agent at its next publish. The paid 48-case gates (typed and spoken) must be re-run before merge. That needs the owner's go.
- Prompt size. Today the hours lines are not counted in any budget. The cap in section 6 is the guard, and the local model's small budget (1200 bytes of facts, 6000 of input) is the tight case to test.
- Facts made from answered gaps have no pack and sort last, so when the facts budget is full they are the first cut. Not changed here; the What it knows count should show when facts are being cut (round two).
- Autosave and the shared revision. Every write bumps one revision. The queue in section 6 is the guard; it needs a test with two quick edits and one with a second browser.
- `tests/local/voice-picker.test.mjs` reads `web/components/core/agent.tsx` by path. The guard must follow the picker to its new file.
- Byte-for-byte pins in `check:core` (typed prompt, text brain, knowledge core, voice turn, WhatsApp flow) must still pass unchanged. The phone-call pin publishes for real and strips `packs` and `context` to get an old-style snapshot; it must strip `hours` too, and that is the only change allowed to a pin.
- Each autosave adds an audit row and a command receipt row. The 800 ms debounce bounds it; the builder checks the audit screen still reads sensibly.
- `agentChanges` on a 10,000-row price list. The hash-first compare is the guard.
- Staff. Schedules are readable by staff today; the new page must not show staff the draft.

## 9. Owner's answers (2026-11-16)

1. Shape: yes, one page built around unanswered questions.
2. Hours go live on Publish.
3. Four screens first; the merged knowledge list second.

## 10. Left to the builder

- Component split under `web/components/core/agent/`, and whether sub-views are separate files.
- The exact wording in both languages, following the copy in the mock-ups.
- How `agentChanges` words a changed long text (suggested: the field name only, no before and after).
- Where the hours cap in section 8 is enforced.

## 11. How it will be checked

- Unit and API tests for `agentChanges`, hours in `publish`, the prompt with zero, one and many branches, old snapshots unchanged, the gap filter, and the save queue.
- `npm run typecheck`, `npm run test:guards`, `npm run check:core`, `npm run db:verify-migrations`, the three builds.
- A browser pass in the local app at 390 px, English and Bahasa Melayu, light and dark: answer a gap and publish; change Saturday hours and publish; a conflict from a second tab; a missing disclosure.
- The two paid gates, once each, with the owner's go.

## 12. Builder check (2026-11-16)

A reviewer read this design against the code before the owner saw it. Confirmed: no migration is needed; `resolveGap` as a fact is frozen by publish; the hours key has no side effect on tools, budgets or gap recording, because every publish since the knowledge core already uses the core prompt. Folded in above: the change token on publish, the queue covering every writer of the agent revision and lost responses, test sessions and the older `context`, the gap title, the hours cap, the phone pin, the first-publish rule, closed dates frozen at publish, the "+ Branch" form, matching rules for the change list, and half-typed saves. No question was left for the owner.
