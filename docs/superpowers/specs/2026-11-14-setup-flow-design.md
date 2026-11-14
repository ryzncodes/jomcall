# Setup flow redesign: import first, interview as the fallback

Status: draft for the owner's approval (2026-11-14). Nothing here is built.

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

## 9. Needs the owner's answer

1. **May setup send an owner's real photos, PDFs and spreadsheets to a hosted Claude model (Anthropic)?** Without a yes, the "bring what you have" door cannot be built and the flow is the interview only. The agent's own text already goes to Anthropic; documents may hold more (customer names in a spreadsheet, phone numbers in a pasted chat). This is the same PDPA cross-border question that is still open with the lawyer.
2. **Hide Phone numbers, WhatsApp and Integrations from the sidebar until each is live?** Recommended yes.
3. **Is the RM20 trial credit part of this flow** (claimed automatically so the test call works), or left on the billing page as today?

## 10. Left to the builder

Screen layout within the approved direction, component structure, the exact question wording per pack, table and card design on the review page, error and empty states, and the order in which the pieces ship.
