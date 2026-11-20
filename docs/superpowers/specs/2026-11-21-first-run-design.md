# First run: from sign-up to the first real call

Status: design only, nothing built. Written 2026-11-21. The owner asked that JomCall's path after sign-up feel like other AI receptionists' and has said setup on staging felt very tedious. Asked which direction to take, the owner answered on 2026-11-21, relayed by the session that started this work: "Just do whatever is recommended for the first run onboarding." Every decision in section 7 is therefore my recommendation, accepted under that delegation. The owner can overrule any of them. That delegation does **not** approve a new outbound call (section 6).

## 1. Why

A market scan (section 5 of `docs/research/2026-11-21-public-pages-seo.md`, branch `feat/public-pages-seo`) found the same first run at other AI receptionists:

1. Build the agent from something the owner already has: a Google business listing or a website.
2. Make a test call.
3. Show a visible "getting started" checklist (for example "1 of 6 done") that runs until the first real call.

An owner who has seen any of them expects that shape. JomCall already has most of the parts. The gaps are at the ends of the path.

## 2. What exists today (read from `main` at `696cce6`)

Note: the research doc's sections 5.2 and 5.3 say JomCall has no checklist and that the agent page is still being designed. Both are out of date.

- **Sign-up**: email and password, email confirmation (`web/components/core/auth.tsx`).
- **Workspace creation** (`web/components/core/local-app.tsx`): business name, business type (picker, or "Something else" with free text), main branch. After it, the owner lands on **Home**.
- **Home checklist** (pull requests #75 and #76; `web/lib/core/home-rules.ts`, `web/components/core/home/home.tsx`). The title is "Get your agent answering", with "N of M done". The steps are:
  1. Set up your business: done when setup is applied or the agent is published.
  2. Test the agent: done when any test session exists.
  3. Publish the agent.
  4. Choose a plan (owners and admins only): done when a paid plan has a started period; the button says "Pay fee" when the fee is unpaid.
  5. Get a phone number (owners and admins only, when a phone line is offered). It reads "Waiting for your number" while a request is open. Its button appears only once the plan includes a number.

  Home switches to the "Today" view (numbers and "Needs you") when `isLive()` is true. That means published, a paid plan chosen and an active number. It happens **before any real call has reached the agent**, and the checklist disappears at that point.
- **Guided setup** (`/app/setup`, `docs/superpowers/specs/2026-11-14-setup-flow-design.md`) runs in four stages:
  1. Business type, which asks again for the type picked at workspace creation, preselected, with optional extra call types.
  2. Bring a document (photo, PDF, CSV, pasted text) or answer up to 8 questions.
  3. Review.
  4. Test, then Publish.

  The "live" page after Publish (`web/components/core/setup/finish.tsx`) lists three hand-written next steps: choose a plan, phone line, WhatsApp.
- **Agent page** (`/app/agent`, pull request #37). It has a status card ("Not published yet" / "is answering") and links to guided setup before the first publish. It shows no list of the whole path.
- **Phone numbers** (pull request #64). The owner asks for a number, and a person sets it up, usually within 2 working hours. With an active number the page shows "Forward your existing number" with the mobile forwarding codes and a line to call your own number from another phone to check.
- **Calls**: `app.call` holds real phone calls only, each tied to a phone number. Browser tests are test sessions, stored apart. Home already reads the latest 100 calls.
- **Forwarding** cannot be seen by JomCall. It happens at the owner's phone company. The first answered real call is the only sign that it worked.

## 3. Goals, non-goals, anti-goals

Goals:

- One visible list from sign-up to the first real call, which an owner on a phone can follow alone.
- The list ends at the step the owner cares about: a real customer's call answered.
- No second list that disagrees with the first.
- Billing problems are never hidden while the list is showing.

Non-goals:

- Changing what setup asks or how the reader reads (the setup design stands).
- WhatsApp in the list while it waits for Meta's approval.
- Google sign-in, a free trial, or self-serve phone numbers.
- The mock preview (port 4181).

Anti-goals (any one makes this a failure):

- The list says a step is done when it is not, or promises a time JomCall does not control.
- A new outbound call is added without the owner's explicit yes.
- An owner who skips a step can no longer reach the rest of the app.

## 4. Approaches

- **A. Extend the Home checklist (chosen).** Add the missing last step, keep the list showing until the first real call, use the same list on setup's live page, and add a small progress link in the sidebar. This builds on pull requests #75 and #76, needs no migration and adds no outbound call.
- **B. A separate full-screen onboarding wizard** that walks sign-up, setup, plan and number in one forced sequence. Rejected:
  - It duplicates guided setup.
  - It blocks owners who want to look around first.
  - The phone step waits up to 2 working hours, and a wizard cannot wait well.
- **C. The list on the agent page.** Rejected: plan, wallet and phone number are not agent settings. The agent page would grow a second job it was redesigned to shed.

## 5. The design

### 5.1 The list (Home)

Six steps. The source of truth stays `checklist()` in `web/lib/core/home-rules.ts`.

| # | Step (EN / BM) | Done when | Button |
|---|---|---|---|
| 1 | Set up your business / Sediakan perniagaan anda | setup applied, or agent published (unchanged) | Setup |
| 2 | Test the agent / Uji ejen | any test session exists (unchanged) | Try it |
| 3 | Publish the agent / Terbitkan ejen | agent published (unchanged) | Publish |
| 4 | Choose a plan / Pilih pelan | paid plan with a started period (unchanged) | Choose plan, or Pay fee |
| 5 | Get a phone number / Dapatkan nombor telefon | an active number (unchanged; "Waiting for your number" while a request is open) | Request number |
| 6 | **Take your first real call** / **Terima panggilan sebenar pertama** | **new:** at least one real call with `state = 'ended'` and an `outcome` other than `refused` or `abandoned` | Show me how (opens `/app/phone-numbers`, where the forwarding codes are) |

Step 6 details:

- Under the label: "Forward your business number to <your JomCall number>, then call your usual business number from another phone to check." The label names only what JomCall can measure, an answered real call. A call dialled straight to the JomCall number also counts and proves nothing about forwarding; nothing in the call row tells the two apart, so the step does not claim forwarding is done. The number is shown in local format, as the forwarding panel does. The step is shown only when step 5 applies (a phone line is offered) and only to owners and admins.
- **Once done, it stays done.** It is not worked out from the latest 100 calls: refused calls are rows in `app.call` too, so a run of refusals (empty wallet, no plan) would push an answered call out of that window and bring the list back. Instead, the new read `firstRun` (5.4) returns the workspace's earliest answered real call (`id`, `started_at`) or none. It uses one indexed query on `app.call` by `org_id`. No migration is needed. A deleted call or a replaced number does not undo the step once a later answered call exists. If every answered call is deleted, the step goes back to not done, which is true.
- The owner's own check call counts. Dialled to the usual business number it proves forwarding works; dialled straight to the JomCall number it proves only that the agent answers.
- It has no "mark as done" button. A self-mark would need storage and could be wrong.

The list's other rules:

- **Order** stays as above. Step 5's button stays hidden until the plan includes a number, as today. A step whose button is hidden shows one line saying what unlocks it ("Choose a plan first").
- **"Live" moves to the end.** `isLive()` also needs step 6 done whenever step 6 applies, so Home keeps the list until a real call has been answered. Staff, and workspaces without a phone line on offer, keep today's rule.
- **"Needs you" also shows under the list.** Today, billing rows (wallet empty, fee unpaid, wallet low) and waiting customers appear only in the "Today" view. With the list staying up longer, the same "Needs you" panel shows under the list whenever it has rows. It is hidden while empty, so a new workspace sees only the list.
- **Completion moment.** On the first load after step 6 turns done, Home shows one line above "Today": "Your agent answered its first real call." It links to that call. The builder decides how "first load after" is remembered; browser storage is acceptable, since showing the line a second time is harmless.
- **WhatsApp** stays out of the list while `WHATSAPP_WAITING_FOR_META` is true. Once Meta approves, a seventh, optional step can be designed then.

### 5.2 Getting there faster

- **After creating a workspace, open setup, not Home.** The owner has just named the business. Step 1 is the obvious next move, and the market goes straight into building. Home is one tap away and shows the list. Today `switchWorkspace` keeps whatever screen the owner was on (Home on `/app`), so this is an explicit move to `/app/setup` after `createOrganization` succeeds, not a change of default.
- **The business-type stage on a first run reads as a confirmation.** It keeps the type picked at workspace creation preselected (as today) and keeps the optional extra call types. Its heading changes to say the type is already chosen: "You picked <type>. Add anything else you do, or continue." The type is not asked as a new question. A second setup run keeps today's wording.
- **The bring stage names where text can come from.** Its pasted-text option gets a hint: "Copy the text from your website, Facebook or Instagram page, or Google Maps listing, and paste it here." This uses the existing reader, adds no outbound call, and covers owners whose only online presence is a social page or a Maps pin.

### 5.2a Your links (owner request, 2026-11-21)

The owner asked that owners can link their company's pages during setup: Facebook, LinkedIn, Google Maps or Business Profile, a website, or similar. This round **stores** the links. It does **not read** them (section 6).

- **What exists.** The always-on pack already has a fact `social_links`, a list labelled "Facebook, Instagram, TikTok or Google profile" (`packages/domain/src/packs/every-business.json`). Its only interview question is number 19 of 20, and it is shared with branches. Under the 8-question cap it is almost never asked, and a question that fills two facts is never prefilled.
- **A "Your links" card on the review page**, optional, beside the hours, address and contact cards. It is on the review page because that page is reached by every owner. The bring stage is shown only when the reader is switched on (`JOMCALL_SETUP_READER`), and whether it is on in production is not recorded here. It has one field per kind, each optional:
  - Website
  - Facebook
  - Instagram
  - TikTok
  - LinkedIn
  - Google Maps

  The card says: "Customers who ask get these links. JomCall does not open or read them."
- **Checks, in the web service, without opening the link.**
  - The text must parse as a URL. A bare address gets `https://` added.
  - Only `http` and `https` are accepted.
  - At most 300 characters each, 6 links in all.
  - The kind's field checks the host loosely: Facebook takes `facebook.com` or `fb.com`, Google Maps takes `google.com/maps`, `maps.google.com`, `maps.app.goo.gl` or `g.page`, and so on. A mismatch shows a warning, not a refusal; the Website field takes any host.
  - Nothing is fetched to check a link: no preview, no icon, no redirect follow.
- **Where they go.** As the owner types, the links are staged as one setup item filling `social_links`, a list of "Kind: URL" lines. The item goes into the agent on apply, as setup does today. Question 19 (branches and links) stays as it is: the review card is where links are given. After setup they are edited where the fact lives, under the agent page's "What it knows".
- **What the agent does with them.** On WhatsApp and typed chat it can give a link when asked. On a phone call it should name the page ("search Kedai Contoh on Facebook") rather than spell out a URL. The current prompt has no rule for this.
  - Adding one is a prompt change and needs both paid gates re-run, with the owner's go.
  - Until then, a spoken URL is a known rough edge, noted in section 8.
  - The fact's label **is** rendered into the prompt (`packages/domain/src/knowledge/prompt.ts`, line 98), so this round leaves the `social_links` label unchanged. The review card's own field labels name Website and LinkedIn. No prompt byte changes and no gate is needed.
- **Privacy.** These are the business's own public pages, not customer data. No new PDPA scope.

### 5.3 One list, three places

- **Home** owns the list (5.1).
- **Setup's live page** (`finish.tsx`) replaces its three hand-written next steps with the same `checklist()` steps from step 4 on, rendered from the same rules and words. The two can then never disagree. The WhatsApp line there stays as today (the "waiting for Meta" text) until WhatsApp joins the list.
- **The sidebar** gets one small link above the navigation for owners and admins until the list is complete: "Getting started: N of M" / "Bermula: N daripada M", with N and M from `checklist()` (four steps for staff, and for workspaces with no phone line on offer). It opens Home and disappears when every step is done. It has no dismiss button. Market products hide theirs on completion, and one line costs little.
- **The agent page** keeps its status card and its setup link before the first publish. It gets no list of its own. When the agent is published but the list is not complete, the card's line already names the channels the agent answers on (pull request #82); it adds nothing about plan or number.

### 5.4 One read for the list

Home has the facts it needs, except the first answered call. The sidebar (`WorkspaceChrome` in `chrome.tsx`, outside `CoreContext`, which today reads only `channels`) and setup's live page (`LiveStage`, which reads no plan, phone or call data) have none of them. Rather than five extra reads on every page, one new read serves all three:

- `firstRun` (owners and admins; staff get the first three steps from what they can already read, as today). It returns the inputs `checklist()` needs: setup applied, a test exists, published, the plan summary fields the plan step reads, the phone-number facts the phone step reads (provider configured, active number, open request, plan includes a number, the active number's E.164), and `firstAnsweredCall` (`id`, `started_at`) or null.
- `checklist()` and `isLive()` stay pure and take these facts. Home may keep its own reads for the Today view and use `firstRun` for the list; the builder decides whether Home's list reads move to it.
- It is a new command in `packages/contracts/src/core.ts`, a route, and the guard tests that every command has. It writes nothing.

### 5.5 Fixes found while checking this design

- Step 5's button links to `/app/phones` (`checklist()` in `web/lib/core/home-rules.ts`, expected by `tests/domain/home-rules.test.ts`). That route does not exist; the page is `/app/phone-numbers`. Both change.

## 6. Reading links and web pages automatically (not approved; not in this work)

Reading a web address the owner types would be a new outbound fetch from JomCall's servers. It needs the owner's explicit yes, and the delegation in the status line does not give it. **Recommendation: do not build it now.** Instead, use the paste hint in 5.2. The reasons:

- **What owners actually have.** Many Malaysian SMEs have no website of their own. They have a Facebook or Instagram page, a WhatsApp catalogue or a Google Maps pin. Those platforms block automated reading or forbid it in their terms, so a URL reader would mostly help owners who are not the typical customer. Not measured: no data on JomCall's sign-ups exists yet.
- **Pasting already works** where the reader is on. The paste box takes up to 20,000 characters (`bring.tsx`), enough for a business's About and Services text though not a whole site, with the same review step that keeps unconfirmed prices away from callers.
- **Site-builder pages.** Many Malaysian SME sites are built with tools that render in the browser. A fetch without a browser engine often gets a near-empty page.

If the owner approves it later, the design should hold at least these:

- The fetch runs in the agent process, never the web service.
- https only.
- Public addresses only, checked after DNS resolution and after every redirect, with a redirect limit.
- Size and time caps.
- No JavaScript rendering.
- A clear notice that the page is sent to Anthropic, as for uploads.
- The fetched text enters the existing pasted-text path and review page unchanged.
- Rate limits per workspace and service-wide, like the reading limits.

**Reading the stored links later, source by source.** Each automatic reader is its own outbound service. Each needs its own explicit yes from the owner, and none is asked for or approved in this work.

| Source | Sanctioned route | What would be sent, by which process, with which key | Recommendation |
|---|---|---|---|
| Google Maps / Business Profile link | Google Places API (New), Place Details, for name, address, phone, opening hours and website | The place reference from the owner's link (a short `maps.app.goo.gl` link first needs Google's redirect followed, a second request). Sent by the agent process. Key: a new Google Maps Platform key restricted to the Places API, held only by the agent process. It is kept separate from the voice worker's `GOOGLE_CLOUD_API_KEY`. | The one worth asking for next: it gives structured hours and an address, which the owner today types by hand. Before asking, check two things: the price per request, and Google Maps Platform's terms on how long Places content may be stored. Published versions freeze their facts, so a time limit on storage would conflict with that; the result would have to become the owner's own confirmed fact on the review page. Both are **not checked**. |
| Website | A plain https fetch, then the existing reader (Anthropic `claude-haiku-5-5`) | The page's text goes to Anthropic, as uploads already do. The fetch runs in the agent process; it needs no new key. | Ask later, with the safety list above. |
| Facebook, Instagram, LinkedIn, TikTok | None for this use. Their terms forbid automated collection. Their official APIs need app review and the page owner's own sign-in. | — | Never fetch. The owner pastes the text (5.2). |

### 6.1 Free options checked (owner asked, 2026-11-21: "anything that's free ... if not, let's park it")

Checked on 2026-11-21 from vendors' public pages and repositories, by web search. Nothing was signed up for or called.

- **Google Maps / Business Profile: parked.**
  - *Cost.* The Places API has a free monthly allowance per SKU. Opening hours, phone number and website are Enterprise fields in Place Details (New), and the Enterprise allowance is 1,000 requests a month. That is enough for setup at JomCall's size. [Usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage), [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details)
  - *Card on file.* Google Maps Platform needs a billing account even within the free allowance. This is from general knowledge and was not re-checked today.
  - *The blocker is the terms, not the price.* Google's Places policy forbids pre-fetching, indexing, storing or caching Places content. Only the place ID may be kept. [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
  - *Why that rules it out.* A published agent version freezes its facts. Copying Google's hours into it would be storing Places content, which conflicts with that policy.
  - *Scrapers.* Free GitHub scrapers for Google Maps exist, but they break Google's terms and are not considered.
- **Facebook, Instagram, LinkedIn, TikTok: parked.** Free scrapers exist on GitHub, but all break the platforms' terms and get accounts blocked. LinkedIn has sued scrapers. The sanctioned APIs need app review and the page owner's sign-in. The owner pastes the text instead (5.2).
- **OpenStreetMap: not useful.** It is free, but few Malaysian SMEs are listed there, and its database licence (ODbL) carries share-alike duties on stored data.
- **Website: free, and allowed by the site's own owner.**
  - *How it would work.* A plain https fetch of the owner's own site, from the agent process. A free open-source extractor, Mozilla Readability (Apache-2.0), would pull the text out of the page.
  - *Structured details.* The fetch would also read schema.org `LocalBusiness` data. Many site builders put opening hours, address and phone there in a machine-readable form.
  - *Cost.* The text then goes through the existing reader, so the only cost is the reader's model call that uploads already make.
  - *Limit.* Pages built only in the browser come back nearly empty. A headless browser (Playwright, Apache-2.0) would fix that, but it is too heavy for the one 1-vCPU, 2 GB server.
  - *Alternative not taken.* Jina's hosted Reader is free with rate limits and its code is Apache-2.0 ([jina.ai/reader](https://jina.ai/reader)). It sends the address to another company, so it is not recommended.
  - *Approval.* This is the only free route left. It is still a new outbound fetch: it needs the owner's explicit yes, with the safety list above.

**Result.** Google, the social platforms and OpenStreetMap are parked. Website reading waits on one yes from the owner. Until then, links are stored, not read (5.2a).

## 7. Decisions (my recommendations, accepted under the owner's delegation of 2026-11-21)

- F1. Approach A: extend the Home checklist.
- F2. Add step 6, "Take your first real call", with the forwarding steps under it, done on the first answered real call, read by `firstRun` so it stays done. No self-mark.
- F3. Home stays on the list until step 6 is done, where it applies. "Needs you" shows under the list when it has rows.
- F4. Setup's live page renders the same steps as Home from step 4 on.
- F5. A sidebar progress link for owners and admins until the list is complete. No dismiss. One new read, `firstRun`, serves Home, the sidebar and the live page.
- F6. A new workspace opens setup, not Home. The first-run type stage reads as a confirmation.
- F7. Where the bring stage is shown, its paste option names website, Facebook, Instagram and Google Maps text as sources.
- F8. No website or Google listing fetch in this work (section 6). It goes back to the owner as a separate yes or no.
- F9. The agent page gets no list of its own.
- F10 (owner's request, 2026-11-21; the form is my call). A "Your links" card on setup's review page stores website, Facebook, Instagram, TikTok, LinkedIn and Google Maps links into the existing `social_links` fact. They are checked without being opened, and are never fetched.
- F11 (owner, 2026-11-21: free only, else park). Google Maps reading, social-page reading and OpenStreetMap are parked (6.1).
- Open for the owner: whether to approve a free website fetch from the agent process (6.1). Asked 2026-11-21.

## 8. Risks

- **A workspace with a number but no calls stays on the list.** Its "Today" view would have shown zeros anyway. The "Needs you" panel under the list (F3) is the guard against hidden billing problems.
- **The first answered call might be a stranger's, not the owner's check.** Fine: it still proves forwarding works.
- **A forwarded call has never reached the line** (noted with pull request #64). If the business's own number arrives as the caller instead of the customer's, step 6 still turns done, but the six-calls-an-hour limit per caller may refuse later customers. That is a phone-line risk, not a list risk, and stays open there.
- **A spoken URL.** Until a prompt rule says otherwise, the agent may read a link aloud on a call (5.2a).
- **A wrong link.** An owner can paste a page that is not theirs. The review page shows the links before apply, and the agent gives only what the owner confirmed.
- **Polling.** Home reloads every 15 seconds. The new `firstRun` read is one small query; the sidebar reads it on page load and window focus only, not on a timer.
- **Pasted page text is unmeasured.** The reader was checked on price lists, not on prose from a website or social page. The review page still stands between what it drafts and the agent. No paid reading run is planned for the hint (my call); the first real owners' pastes are the evidence.
- **Words.** New BM strings need a person's read. The "Getting started" label must not promise a time.

## 9. How it will be checked

- Unit tests in `tests/` for `checklist()` and `isLive()`:
  - step 6 present or absent;
  - done on an answered call, not on a refused or abandoned one;
  - staff unchanged;
  - "Needs you" rows while the list shows.
- A test that the live page and Home produce the same steps from the same facts.
- `npm run typecheck`, `npm run test:guards`, `npm run check:core`, `npm run build:hosted`, `npm run build:mock`.
- A browser pass in the local app at 375 px, English and Bahasa Melayu, light and dark:
  - a new workspace opens setup;
  - the list through each state, with a fake call row for step 6;
  - the sidebar link;
  - the live page after Publish.
- API tests for `firstRun`: tenant isolation, staff refused, the earliest answered call returned, refused and abandoned calls ignored.
- No migration and no paid model gate: no prompt, pack or tool list changes (the `social_links` label stays as it is, 5.2a).

## 10. Left to the builder

- Component split, and whether the list becomes a shared component used by Home and `finish.tsx`.
- Exact wording in both languages, within the meaning above.
- How the completion line is remembered (5.1).
- Where the sidebar link sits at each width.
- Whether the step 5 and step 6 lines show the area or number when known.

## 11. Builder check (2026-11-21)

A reviewer read the first version of this design against the code at `5219ccd`. Folded in above, each as my call:

- Step 6 stays done through a server read, not the latest 100 calls (5.1, 5.4).
- One new read, `firstRun`, because the sidebar and the live page have none of the list's facts (5.4). This replaces the first version's "no new read".
- The links card is on the review page, because the bring stage appears only with the reader on (5.2a).
- The paste limit is 20,000 characters, not 1 MiB (section 6).
- The step 5 link to `/app/phones` is broken today (5.5).
- Opening setup after workspace creation is an explicit move (5.2).
- Pasted page prose is unmeasured by the reading check (section 8).

No question was left for the owner.
