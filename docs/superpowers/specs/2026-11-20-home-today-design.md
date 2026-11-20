# Home: checklist first, then what needs you

Approved by the owner on 2026-11-20 (option C).

## Why

Home today shows three counts (contacts, draft or published, branches), a booking card and a "Continue setup" box. None of it tells the owner what to do. JomCall is about to be promoted, so every new owner lands on an empty workspace. Home must give them a next step on day one and something to act on every day after.

## Goals

- Before the agent is live: a checklist with one button per step.
- After it is live: one line of today's numbers and a list of things that need the owner, ordered by urgency, with "All clear" when empty.
- English and Bahasa Melayu, 375 px first, dark theme.

## Non-goals

- No new backend command, route or migration. Home reads only commands that exist today.
- No charts and no history beyond today.
- The mock preview (4181) keeps its own Home.

## Anti-goals

- A Home full of zeros for a new owner.
- One failed read blanking the whole page.
- Showing billing to staff (billing routes are owner and admin only; they answer 403 or 404 for staff).

## Approaches considered

- A. To-do list only. A new workspace sees nearly nothing.
- B. Numbers dashboard. All zeros at launch, and numbers do not say what to do.
- C. Checklist before live, to-do list after (chosen by the owner, 2026-11-20).

## Design

### Live

The workspace is live when the agent has a published version and either an active phone number exists, or the phone line is not offered on this service (`channels.phone` false and `phoneNumbers.provider.configured` false). Before live, Home shows the checklist. After live, it shows Today and Needs you.

### Checklist ("Get your agent answering", "N of M done")

| Step | Done when | Button |
|---|---|---|
| Set up your business | setup session state `applied`, or the agent is published | Setup (`/app/setup`) |
| Test the agent | `agentTests` returns at least one session | Try it (`/app/test`) |
| Publish the agent | `workspace.agent.published_version_id` set | Publish (`/app/agent`) |
| Choose a plan | `plan.periodState` is `free` or `charged`, or the plan is `payg` | Choose plan (`/app/billing`) |
| Get a phone number | an active item in `phoneNumbers.items`; an open request shows "Waiting for your number" with no button | Request number (`/app/phones`) |

The plan and phone steps are owner and admin only; staff see the first three. The phone step is left out when the phone line is not offered. WhatsApp is not a step while it waits for Meta (`WHATSAPP_WAITING_FOR_META`).

### Today (one line)

Calls today, not answered today, bookings today, wallet balance (owners and admins only). "Today" is the Kuala Lumpur calendar day. Calls come from `calls` with limit 100, filtered on the page; "not answered" is `state === "refused"`. Bookings come from `bookings` for today's Kuala Lumpur day, not cancelled.

### Needs you (ordered)

1. Billing: wallet `exhausted` or `grace`; plan `unpaid` (with `graceUntil`); wallet `low`. Owners and admins only.
2. Bookings to confirm: `bookings` with status `requested` from now to 30 days ahead.
3. WhatsApp chats waiting: `conversations` with `attention: "needs"`.
4. Questions the agent could not answer: `knowledgeGaps` with status `open`.

Each row has a count, one sentence and opens its page. Rows with a zero count are not shown. No rows: "All clear".

### Failure

Each read is separate. A failed or forbidden read hides only its own row or step and never shows mock data. If every read fails, Home shows one line saying it could not load, with a Retry button.

## Left to the builder

Exact copy within these meanings, component split, styles within the existing core panel look.
