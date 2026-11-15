# Setup flow redesign: import first, interview as the fallback

Status: approved by the owner on 2026-11-14, with the answers recorded in section 9. Both doors are built on branches. The interview door is merged to `main` (pull request #24, commit `6d2caa3`, 2026-11-15). The import door is on branch `feat/setup-import` (pull request not yet open, not merged); see the note "Import door as built" at the end.

## 1. Why

On 2026-11-14 the owner set up a real agent on staging for the first time and found it "very very tedious". Measured from the code that day:

- About 9 screens or tabs from sign-up to a first test.
- About 19 separate save actions. Each fact has its own Save; the always-on pack alone has 22 facts.
- About 115 inputs for a typical business (the always-on pack, one more pack, one opening interval a day).
- The same thing asked twice: business name and type (workspace creation, then Settings), branch name (creation, then Hours), time zone (twice on the Hours page), and the kind of business (free text, then pack checkboxes).
- "Guided setup" and "Agent builder" are one screen (`LocalAgent`) with two sidebar entries.
- Half the sidebar leads to pages that are not live (Phone numbers, WhatsApp, Integrations).
- A test already works on the seeded draft after 6 inputs, but nothing tells the owner so.

A stranger must be able to sign up and reach a working, tested agent alone. Today the owner himself could not do it comfortably.

## 2. Goal

A new owner reaches a first test call in a few minutes, with real prices and hours in the agent, and publishes with one button.

Success looks like:

- From an empty workspace to a first test turn: one flow, no dead ends, no screen that asks for something already given.
- One Publish. No per-field Save in the flow; answers are kept as the owner goes.
- An owner with a price list gets it into the agent without typing it row by row.
- An owner with nothing prepared can still finish.
- Nothing reaches a caller that the owner has not seen and confirmed.

Not goals for this piece:

- Changing how the agent answers (prompt, search, rules). The knowledge core stays as it is, with one exception that this work depends on: the catalogue lookup tool must work on real phone calls and WhatsApp (section 7).
- Phone-line, WhatsApp or payment set-up. They stay out of the flow.
- Removing the existing agent builder. It stays as the detailed editor.
- Catalogues above a few hundred rows, or documents in scripts other than Latin and Chinese. Not tested by the spike.

Would make this a failure even if it works:

- A price the owner never confirmed is quoted to a caller.
- The flow is shorter but an owner still cannot tell what the agent knows.
- Real documents leave the country without the owner of JomCall having agreed to it (section 9).

## 3. Approaches considered

Three directions were mocked up on a canvas and shown to the owner on 2026-11-14.

- **A. Interview.** The agent asks about six questions, the owner answers, one review page follows. Least effort and needs nothing prepared. Weak for price lists, and only as good as the owner's memory.
- **B. Import first.** The owner brings a price-list photo, a document, or a message they often send. JomCall drafts; the owner confirms line by line. Best for accuracy and real prices. An owner with nothing prepared is stuck.
- **C. One page.** Five sections on one screen, saved as the owner goes, questions prefilled by business type. Fastest to build, still a form.

**Chosen by the owner: B, with A as the fallback.** One flow with two doors. Both doors end on the same review page (C's layout), then a test call, then Publish.

## 4. The flow

One route, `/app/setup`, replaces the current guided setup. Four stages; the owner can leave and return, and the flow resumes where it stopped.

1. **Your business.** Asked once, at workspace creation as today: business name, type of business, main branch. The type is picked from a short list that maps to the pattern packs (plus "something else"), so the pack question is not asked again.
2. **Bring what you have, or answer questions.**
   - *Bring*: a photo, a PDF, a spreadsheet, or pasted text (for example a WhatsApp reply the owner sends often). More than one item may be added.
   - *Answer*: a short typed interview. Questions come from the chosen pack's required facts, plus opening hours and the AI introduction. One question at a time, skippable.
   - The two can be mixed: after an import, the interview asks only for what is still missing.
3. **Check what we understood.** One review page:
   - Opening hours, address and contact as editable cards.
   - Prices and services as a table. Lines the reader was unsure about come first and are marked; each must be confirmed, corrected or removed. A line with no price is never published.
   - The agent's first words (greeting and AI introduction), prefilled in the owner's language and editable.
   - A list of what is still missing, each with "add now" or "skip".
4. **Try a call, then publish.** A test (typed or voice, as the test panel works today) opens on the draft. Publish is offered after at least one test turn. Publishing is the existing publish; it does not connect a phone line or WhatsApp.

After publishing, the owner lands on Home. The agent builder remains under Agent for detailed edits, and "Guided setup" leaves the sidebar once the first version is published.

Answers are saved as the owner moves on. There is no Save button in the flow; a small "Saved" mark shows that it happened. Leaving mid-stage loses nothing.

## 5. What is reused and what is new

Reused as built:

- Workspace creation, the draft agent, publish and its rules (greeting and AI introduction required; recording disclosure when recording is on).
- Knowledge core storage: facts, rules, catalogue rows frozen by reference, pattern packs. Draft catalogue rows already stay out of the agent until confirmed.
- The test panel and its sessions.
- The branch and schedule records.

New:

- **Document reading.** A server step that sends one uploaded item to a vision model with the spike's "checked" prompt and returns draft rows and draft facts, each with `needs_owner_check` and a reason. Spreadsheets are parsed to a cell dump first; pasted text goes in as is.
- **Upload handling.** Size and type limits, storage of the original for the review page, deletion when the owner removes it or after a retention period.
- **The interview.** A question list built from the chosen pack's required facts and the missing basics. No model is needed to ask the questions; a model turns a free-text answer into the right fact fields.
- **The review page** and the stage shell with resume.
- **One write path** that turns confirmed review items into facts, catalogue rows, schedule and agent draft in one go, replacing the many per-field saves for this flow.
- **Sidebar**: pages for channels that are not connected are hidden rather than shown as "not connected".

## 6. Rules that must hold

- Nothing extracted is visible to the agent until the owner confirms it. Unconfirmed items live only as drafts.
- A row with no price, an "about" price, or a digit the reader was unsure of is never confirmed automatically.
- The agent's existing rule stays: an answer not in the confirmed knowledge is "I will take a message", never a guess.
- Uploads belong to one workspace and follow the same tenant rules as everything else. Staff cannot run setup; owners and admins can, as with the test panel today.
- Uploaded files and extracted drafts are covered by PDPA export and delete.
- Every step works in BM and English, at phone width.

## 7. Decided here (my calls, for the owner to overrule)

- **First release takes photo, PDF, spreadsheet and pasted text.** A website or Google Maps link is left for later: fetching a page the owner names is a new kind of outbound request with its own safety work.
- **The interview is typed first.** Answering by voice is left for later; it needs the voice path inside setup.
- **Reader model: `claude-haiku-5-5` with the checked prompt**, as the spike recommends, with a stronger Claude model only for an item Haiku flags heavily. Model IDs to be confirmed against the provider's documentation when the plan is written.
- **Limits for the first release:** up to 5 items per setup, 10 MB each, about 300 rows per item. Above that the owner is told to split the file. Long-document splitting is a later piece.
- **Publish needs one test turn first.** It costs the owner a few seconds and catches a wrong greeting or a missing price before a caller does.
- **Originals are kept 30 days** after the review is confirmed, then deleted; the confirmed rows remain.
- **The old per-fact editor stays** on the Agent page, unchanged, for owners who want the detail.

### Settled after an independent builder's read (2026-11-14)

- **Imported prices become catalogue rows, and catalogue lookup must reach every channel.** Today only the browser test may call `lookup_catalogue`; real phone calls and WhatsApp cannot read catalogue rows, and the price-holding pack facts are capped at 4,000 bytes. A price that works in the setup test but never reaches a real caller would be a failure, so widening the phone and WhatsApp tool allow-lists to include `lookup_catalogue` (and `take_message.unanswered`) is part of this work and ships before the import door. It was already on the backlog.
- **Setup drafts live in their own staging store**, not as ordinary knowledge drafts. The Agent page's "I checked the drafts: confirm" confirms every ordinary draft at once, which would confirm flagged lines nobody looked at. A separate table (per workspace, row-level security, covered by PDPA export and delete) keeps section 6 true and leaves the old editor unchanged.
- **The interview asks a short starter set, not every required fact.** It uses each pack's own `interview` list (with its `fills` targets), capped at 8 questions: opening hours, where the business is and the area it serves, what callers ask most, the main services and prices when nothing was imported, how to reach a person (message or transfer target), and the AI introduction. Required facts left unanswered appear on the review page's "still missing" list. They do not block publishing; only today's publish rules block.
- **The reader runs in the agent process**, the only process that holds a model key, through the existing job queue. The web app gains no key. Uploads go to a private Supabase Storage bucket per workspace (local Supabase locally, the hosted project on staging); the engine's scheduled work deletes originals after 30 days. The flow is built for local and hosted modes; the mock preview shows it with fictional data and reads nothing.
- **Setup merges, it never overwrites.** In a workspace that already has confirmed facts or a published agent, confirmed setup items are added; where an item would replace an existing value, the review page shows both and the owner chooses. A published version is untouched until the owner publishes again.
- **Business type maps to one main pack**, with the packs it pairs with (`pairsWith`) offered as optional ticks on the same screen. Workspaces created before this keep their free-text type and are asked to pick once, when they first open setup.

## 8. Risks

- **The reading result is an upper bound.** The spike read 212 rows with no wrong price, but on clean renders. Real photos (blur, shadow, handwriting, folded paper) are untested. The review step is what makes this safe; the over-flag rate on real photos is unknown.
- **A new model call on owner content.** Cost per item was about USD 0.002 with Haiku in the spike. A stuck or slow read must not block the flow: the owner can go on to the interview and the read finishes behind.
- **Upload is a new attack surface** on a public sign-up: file type checks, size limits, rate limits per workspace, and no processing of files from unconfirmed accounts.
- **Scope.** This touches workspace creation, the setup route, the knowledge core's write path and the sidebar. It should be planned as several small pieces, each shippable.

## 9. The owner's answers

1. **May setup send an owner's real photos, PDFs and spreadsheets to a hosted Claude model (Anthropic)?** **Answered: yes (owner, 2026-11-14).** This is an approved outbound use for setup's document reading only, through the agent process, which already holds the Anthropic key. The upload screen must say plainly that the document is sent to Anthropic, outside Malaysia, and that the owner should not upload files with customers' personal details. The PDPA cross-border question with the lawyer stays open and still gates real callers.
2. **Hide Phone numbers, WhatsApp and Integrations from the sidebar until each is live?** **Answered: yes (owner, 2026-11-14).** A page appears once its channel is connected for that workspace.
3. **Is the RM20 trial credit part of this flow?** **Answered: yes, claimed automatically during setup (owner, 2026-11-14)**, once per workspace as today, so the first test call works without a visit to the billing page. The amount stays an owner placeholder.

## 10. Left to the builder

Screen layout within the approved direction, component structure, the exact question wording per pack, table and card design on the review page, error and empty states, and the order in which the pieces ship.

## 11. Build note (2026-11-15)

Written after the interview door was built on branch `feat/setup-flow`.

**Deviation from this design.** Section 3 says a model turns a free-text interview answer into fact fields. The web app holds no model key, so in this build an answer is stored as the text of the fact its question fills, with no model call. Model help arrives with the import plan, which adds the reader to the agent process. Questions with no fact to fill (rules only, catalogue only) are left out until then.

**Decisions made during the build that change what this design describes.**

- The question list is frozen when setup starts, at most 8 questions. It is stored on the session. A later change of pack keeps answered questions and drops answers of packs no longer chosen.
- Packs carry 17 to 20 interview entries each. The pick is round-robin: main pack first, then the base pack, then extras. Questions that fill a fact already asked are skipped.
- The review page's "still missing" list leaves out facts an answered question fills, and shows 3 entries with a "Show all" button. An "Add now" answer is stored through `answerSetup` with an id of the form `missing:<pack>:<field>`; it does not count against the 8.
- The business-name question is prefilled with the organization name. A question that fills more than one fact is never prefilled.
- Apply merges: the agent's packs become the old packs plus the session's packs. A conflicting item the owner does not name in `replace` is marked removed, so the current value stays. Apply always closes the session. The existing check for bookings outside new opening hours stays and fails the whole apply.
- Publish unlocks only after a test turn on a fresh draft. A test from an older draft does not count. Only the setup screen enforces this; the server does not.
- After publishing, the owner stays on a "live" page with links to the Agent page and to a test call, instead of landing on Home (section 4).
- Running setup again shows the business-type picker first, with the type chosen at workspace creation preselected; the optional extra ticks start empty (sections 4 and 7).
- "Something else" keeps a free-text field. At workspace creation the owner types what kind of business it is (required, up to 80 characters) and those words are stored as the business type; the other types store their label. The pack always comes from the picked type, never from the words.
- Hours and first words are not asked again when they are already saved: hours when the location has saved opening hours, first words when the draft has both a greeting and an AI introduction. Starting setup and changing packs follow the same rule.
- A fact that two chosen packs share (for example deposit and payment) is listed as missing once, under the pack of the earlier answer or question. "Add now" keeps that pack, so a skipped question does not come back and the answer is kept. A skip never throws away an answer given another way.
- Apply locks the branch before reading its opening hours. A schedule save in progress finishes first, and its hours then count as the current value the owner chose to keep or replace.
- The sidebar rule (section 9, answer 2) is the `channels` command: Phone numbers shows when the phone provider is set and the workspace has a number; WhatsApp shows when its provider is not `disabled`; Integrations stays hidden.

**Contact export and delete.** Setup rows are not linked to a contact, so contact export and delete do not list them. They hold the business's own answers and are removed with the agent or the organization. The import plan must revisit this when uploaded files can contain customer details.

**What the import plan must add.**

- The reader in the agent process, through the existing job queue, with its model call and the Anthropic notice on the upload screen.
- Private storage for uploads, the 30-day deletion of originals, upload limits and rate limits.
- Catalogue rows as setup items (today they are only reported as unconfirmed), and a place in the interview for the rules and catalogue questions left out here.
- Model help to turn a free-text interview answer into fact fields, if the owner still wants it.
- Contact export and delete coverage for setup rows that may hold customer details.
- Smaller items left over from review: a hidden tab keeps polling on the finish stage; the Agent page still says "Penerbitan menyimpan versi tetap..." outside setup; the sidebar's setup entry flashes while the workspace loads and channels refresh only on window focus. (A skipped name question coming back empty, a duplicate save on Continue and an "Add now" answer leaving another pack's question open were fixed in the final fix wave.)

**Known and left for a follow-up (found in the last review and browser check, 2026-11-15).** (1) After changing the main business type mid-interview, a question from the dropped type that shares a fact with the new type can come back and cannot be skipped away; the way out is Back and picking again. Narrow: it needs a type change after answering a late question. (2) When hours are already saved, the hours grid is not asked again, but the always-on pack's text question about opening hours still is.

**What no person has checked.** The flow was clicked through once in the local app at 375 px and at desktop width, in English and Bahasa Melayu, at commit `548560d`, with a fake workspace. A second, shorter check was made at commit `fb222f9` (local app, fake workspace): at 375 px in English, setup was run again on a workspace with saved hours, through the questions, the review page and apply; the Publish button stayed locked until a new test on the draft was answered, then unlocked; the sidebar showed no Phone numbers, WhatsApp or Integrations. The finish page was also opened in Bahasa Melayu at desktop width. Not checked by a person: the free-text field for "Something else", the reload when another tab applies, the Bahasa Melayu interview and review pages after the wording changes, and publishing itself. The dark theme, accessibility and a real owner have not been checked. Nothing ran on hosted staging and the migrations are not applied there. The paid 48-case gates were not re-run: this branch changes no prompt, pack or tool list (it only moves two existing writers into shared functions and adds new commands).

## 12. Import door as built (2026-11-15)

Written after the import door was built on branch `feat/setup-import`. Plan: `docs/superpowers/plans/2026-11-15-setup-flow-import.md`. Reading evidence: `docs/qa/2026-11-15-setup-reader.md`.

**The five decisions at the top of the plan (approved by the owner on 2026-11-15).**

1. Uploads are stored in Postgres, not in a Storage bucket (this differs from section 7). Per setup, up to 5 files of 10 MB. As built, a file's bytes are deleted 30 days after the file was added (or at once with Remove). The plan said 30 days after apply; the built rule is stricter. For the owner to confirm. Object storage is a later piece.
2. Images are shrunk in the browser before upload (longest side 2,400 px, JPEG). The stored original is the shrunk copy.
3. The reading prompt changes from the spike: the model also fills the fact fields of the chosen packs, so the interview asks only what is still missing. The spike's "0 wrong prices in 212 rows" does not prove this prompt; the paid runs in the QA note measure it.
4. A new opt-in outbound switch, `JOMCALL_SETUP_READER=disabled|anthropic`, default `disabled`. With `anthropic`, the agent process sends the owner's document to Anthropic (`claude-haiku-5-5`; `claude-sonnet-5-5` only as a fallback for text and CSV) and needs `ANTHROPIC_API_KEY` even when voice is off. The web service holds no key.
5. PDPA: uploads and drafts belong to the workspace, not to a contact, so contact export and delete do not list them. The build gives a plain notice on the upload screen, delete by the owner, automatic deletion of file bytes after 30 days, and removal with the agent or organization.

**Later owner decisions (2026-11-15).**

- No .xlsx file in the first release. The inputs are a photo, a PDF, a CSV file and pasted text; cells copied from a spreadsheet arrive as pasted text. "Spreadsheet" in sections 3 to 7 means CSV or pasted cells. A zip-signature upload is refused with a message that says to paste the cells or save as CSV or PDF.
- In the first paid reading run, two documents had real wrong prices with no flag (three rows); the script counted four. After it, the owner chose: read photos and PDFs twice and flag any row the two reads disagree on; an old and a new price give the new one, flagged; surcharges, add-ons, "from", conditional and "free above" amounts are flagged. Then re-run. The third run was clean.

**Build-time rulings that change what this design describes.**

- Uploads go to the web service in chunks of at most 3 MiB, are stored in Postgres, and are read by the agent process through one allow-listed database function with a lease. A read is tried at most twice (counted by leases); the stronger-model fallback happens inside the same lease.
- Images are shrunk in the browser. A picture whose long side is more than four times its short side is refused with a message to crop it into parts.
- CSV and pasted text are passed to the model without parsing in our code. Files over 1 MiB or with more than 300 rows are refused as too long (a delimited file over 1 MiB at finish, before it is read).
- The review page and apply use one planner (`packages/domain/src/setup/rows.ts`). The screen shows the planned outcome of each row and the count that will be saved before the one-shot apply.
- "Replace" keeps the owner's item name and changes only price, unit and notes of the existing row. A staged row matches an existing one on the whole normalised name, with no separators.
- A row is confirmed only by an edit that changes its price, or by an explicit confirm. A notes-only edit or a resent unchanged price does not confirm it. A row with no price is never applied.
- Rows stay in place on the review page for the whole visit, and every confirming or removing control ignores taps for half a second after the page changes, so a moving list cannot confirm the wrong row. A removed row stays folded with Undo.
- Removing a file ("Remove everything from this file" once it is read) deletes the file and its unconfirmed and removed rows and facts. Rows the owner already confirmed stay.
- A minimum order or minimum quantity is not a condition: such a price is not flagged and the minimum goes in the notes. This narrows the owner's decision that conditional amounts are flagged, and is for him to confirm.
- Facts found in a document fill the text facts of the packs; hours found fill the `opening_hours` text fact only. The hours grid is still asked in the interview when no schedule is saved. A fact the reader flagged for checking does not count as answered: its interview question is still asked.
- With the reader on, setup opens on the bring stage, so an owner with nothing to upload sees one extra screen and one extra tap ("Answer questions instead"). The owner may overrule this.

**What stays open.**

- Whether uploads and drafts must be covered by PDPA export and delete is a question for a lawyer. Today they are not listed there.
- The server allows removing a file after the setup is saved, but no screen offers it.
- Real phone photos, handwriting and blur have not been read. The reading check used 15 made-up documents and each paid run was done once.
- If both reads of a photo make the same mistake, nothing flags it. CSV and pasted text are read once.
- Deferred items an owner might care about: a hard crash can leave an upload showing "reading" for up to about 8 minutes; file bytes are deleted 30 days after upload even while the setup is still open; retention sweeps are not scoped to one hosted namespace; an import fact replaces a skipped interview row, and if the file is later removed that row is deleted with it, so the question is asked again; the prompt does not force one row per quantity tier (a suggested line was left out so the measured prompt stays the one in the QA note); the review page's "settling" guard refuses taps silently; the model's own words in a reason stay in English in the Bahasa Melayu view (our fixed reason sentences are translated); a few Bahasa Melayu strings were written by the build and not checked by a person.
- Before public sign-up: reading is not metered or capped, reads run one at a time across all organizations, and uploads are stored in the database. An upload can take up to four model calls (two calls per try: the double read, or a read and its fallback; at most two tries). In the worst case one organization's 5 slow uploads queue everyone else's reads for about 20 to 30 minutes. One account could fill a 500 MB database in under 3 days (up to 20 files of 10 MB in 24 hours, about 200 MB a day, kept 30 days).
- Not built, from the plan's "Not in this plan": a website or Google Maps link as a source; answering the interview by voice; splitting long documents; object storage for originals; rules-only and catalogue-only interview questions; the mock preview's version of this flow; structured opening hours read from a document.
- The hosted steps are the owner's: apply the two migrations to staging, check that the agent's role bypasses row-level security, set the switch for both services, rebuild (`infra/hosted/RUNBOOK.md` step 12). Nothing has run on hosted staging.
