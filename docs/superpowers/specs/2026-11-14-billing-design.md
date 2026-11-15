# Billing design: prepaid MYR wallet

Status: built on branch `feat/billing-wallet` (2026-11-14). The payment provider is Curlec (Razorpay Curlec), chosen by the owner on 2026-11-14. It runs against a fake provider that speaks Curlec's payload shapes and has never touched Curlec. Sub-project 5 of the main spec (§9). Research and the owner checklist: `docs/research/payment-providers-malaysia.md`.

## 1. Scope

**Built:**
- one prepaid wallet per organization, in integer sen, MYR only;
- usage metering through one call that other services make;
- versioned prices;
- low-balance and zero-balance states;
- top-ups through a payment provider interface;
- idempotent callback handling;
- reconciliation, receipts, operator adjustments and refunds;
- the local-app wallet screen.

**Not built:**
- a merchant account;
- any real payment;
- automatic top-up (FPX has no stored mandate at Curlec);
- SST charging;
- MyInvois submission;
- the hosted-admin web screen (operator actions are a command for now).

## 2. Data model

All tables are in schema `app`, carry `org_id` (except the platform price table), and use forced row-level security. Migrations:
- `supabase/migrations/20261114150000_billing_wallet.sql`
- `supabase/migrations/20261114150100_billing_wallet_fixes.sql`
- `supabase/migrations/20261114200100_billing_curlec.sql` (crediting payment, refunds from the provider)

| Table | Purpose | Writable by |
|---|---|---|
| `billing_price` | Price per usage kind and version: `unit_sen` per `per_quantity`, effective date. Rows are never edited; a new price is a new version in a new migration. | Migrations only |
| `usage_event` | One billable unit as reported: kind, quantity, idempotency key, price used, amount in sen, when it happened. Unique on `(org_id, idempotency_key)`. | `app_private.record_usage` |
| `wallet_ledger` | Every money movement: `topup`, `trial_credit`, `usage`, `refund`, `adjustment`. `amount_sen` is an integer, signed by kind (checks). Currency check is `MYR`. Unique idempotency key per organization; at most one ledger row per usage event and per top-up; one trial per organization and per claiming user. | Billing functions only |
| `billing_topup` | A top-up's life: `created`, `pending`, `paid`, `failed`, `expired`, `review`. Holds the provider order id (`provider_ref`), the payment that credited it (`provider_payment_ref`) and the refunded total. Amount RM10 to RM5,000. | Billing functions only |
| `billing_provider_event` | One row per provider result (webhook, reconciliation or operator), kind `payment` or `refund`. Unique `(provider, event_key)` makes a replay a no-op. No payer details. | `settle_topup`, `settle_refund` |
| `billing_receipt` | One per paid top-up: number `JC-<year>-<n>`, amount, tax (0), buyer name, provider reference, e-invoice state. | `settle_topup` |

**Balance.** The balance is `sum(amount_sen)` over the ledger, computed on read (`app_private.wallet_snapshot`). There is no stored balance column.

**Append-only.** There are two layers:
1. No login role has insert, update or delete on these tables. Every write goes through a `security definer` function owned by the `nologin` role `jomcall_billing`.
2. Triggers refuse `update`, `delete` and `truncate` on the ledger, usage events, receipts and provider events. The refusal applies to the database owner too. The one exception is a delete cascading from a deleted organization.

Tests check both layers.

## 3. Metering: the call other services make

`packages/billing/src/usage.ts`:

```ts
recordUsage(db, { orgId, kind, quantity, idempotencyKey, occurredAt?, ref? })
walletState(db, orgId)
```

- **Kinds:**
  - `voice_second`: quantity is call seconds.
  - `whatsapp_conversation`: quantity is a count.
  - `typed_turn`: quantity is a count.

  The unit is in the kind's name so that nobody passes minutes.
- **Amount.** `ceil(quantity × unit_sen ÷ per_quantity)` per event, with the price version in force at `occurredAt`.
- **Idempotency.** The same key returns the first result. The same key with another kind or quantity fails with `CONFLICT`. Callers key on their own record, for example `call:<call id>`.
- **Timing.** Bill only after the provider confirms the event (main spec §6).
- **Low balance.** Usage is always recorded, even below zero. Usage that happened is a debt, not something to drop.
- **Callers.** Roles `jomcall_worker` and `jomcall_agent` may call it; the web app role may not. The WhatsApp and phone-line sessions call this function; this branch does not edit their code.

Price version 1 is provisional (owner's call):

| Kind | Price |
|---|---|
| Voice | 32 sen per 60 seconds |
| WhatsApp conversation | 15 sen |
| Typed turn | 2 sen |

## 4. Low and zero balance

`wallet_snapshot` returns `balanceSen`, `state` and `serviceAllowed`:

| State | Balance | New calls and chats |
|---|---|---|
| `unfunded` | No ledger rows yet | Not answered by the agent |
| `ok` | Above RM10 | Answered |
| `low` | RM0.01 to RM10 | Answered; the wallet screen warns |
| `grace` | RM0 down to −RM4.99 | Answered; the screen warns strongly |
| `exhausted` | −RM5 or lower | Not answered by the agent |

Behaviour:
- **A live call is never cut.** The check happens only before a new call or conversation starts. A call in progress finishes and is billed, even into grace or past it.
- **When service is not allowed,** the phone line falls back to what the business had before JomCall: the call rings through or goes to the carrier's missed-call handling. The owner is told by email or WhatsApp. That is for the phone-line and WhatsApp sessions to build using `walletState`.
- **Browser test calls and typed tests stay free** and are not gated.
- The thresholds sit in the database function, so changing them takes a reviewed migration.

## 5. Top-up flow (Curlec)

Facts and sources: research note section 3. Where a behaviour comes from the owner's own Curlec integration in Jomjual rather than Curlec's documentation, it says **(Jomjual)**; everything else was checked on Curlec's pages on 2026-11-14.

1. **Owner or admin picks an amount** (RM20, RM50, RM100 or RM200 on screen). `POST /api/v1/billing/topups` runs as an idempotent command:
   - `create_topup` makes the top-up;
   - the provider creates a Curlec order (`POST /v1/orders`, amount in sen, `receipt` = top-up id);
   - `attach_topup` stores the order id;
   - the response carries a one-time checkout hand-off: the public Key Id, order id, amount, name, description, the owner's email and the return URL. No secret.

   If the provider call fails, the transaction rolls back and nothing is stored or charged. A Curlec order with no payment is harmless.
2. **The browser opens Curlec's Standard Checkout** (`checkout.js`, loaded only when the owner pays) with `callback_url` = `/api/billing/return/curlec` and `redirect: true`, which Curlec requires for FPX.
3. **Curlec posts the return** (`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`) after a successful authorisation. `/api/billing/return/<provider>`:
   - checks the signature, HMAC-SHA256 of `order_id|payment_id` with the key secret, in constant time;
   - fetches the order's payments with JomCall's own keys and settles only a captured payment **(Jomjual: a valid signature alone is not proof of payment)**;
   - always answers 303 to `/app/billing?payment=received|processing|review|unverified`. It never shows "failed" while a payment may still complete, so owners do not pay twice **(Jomjual)**.
4. **Curlec sends webhooks** to `POST /api/billing/webhook/<provider>`. The route sits outside `/api/v1`, so it has no cookie, CSRF or session check; the signature is the only authority. It:
   - answers 404 unless that provider is configured;
   - caps the body at 64 KiB;
   - verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body with the webhook secret) with a constant-time compare before parsing;
   - requires `application/json`;
   - handles `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`; anything else answers 200 and is ignored;
   - answers 200 for every verified event (Curlec wants a 2xx within 5 seconds and disables a webhook after 24 hours of failures), and 500 only when the database fails, so Curlec delivers again.
5. **`settle_topup` decides once, under a per-wallet lock:**
   - **No matching top-up yet:** stored under a unique `unmatched:` key, so a retry still settles.
   - **Event key already seen:** `duplicate`. The key is `pay:<payment id>:<state>`, so `payment.captured`, `order.paid` and reconciliation of the same payment are one event; `x-razorpay-event-id` is not needed for exactly-once **(Jomjual: dedupe on server-owned ids)**.
   - **Currency not MYR, or amount differs:** `review`, audit row, nothing credited; an operator decides.
   - **Captured:** state `paid`, the payment id stored, one `topup` ledger row, one receipt, one audit row. A capture after `failed` or `expired` still credits, because Curlec can authorise a payment up to 3 days after it first failed.
   - **A second captured payment on an order already paid:** `extra_payment`, audited, never credited. Curlec auto-refunds duplicates on a paid order; the refund event is then recorded with no wallet change.
   - **Failed:** `pending` becomes `failed` (soft).

**Reconciliation.**
- "Check status" on a top-up, or `npm run billing:reconcile` for all recent ones, asks Curlec for the order's payments (`GET /v1/orders/:id/payments`); a captured payment wins over failed attempts.
- Only a captured answer is applied, through the same `settle_topup`.
- `billing:reconcile` looks at pending, failed and expired top-ups from the last 7 days (late authorisation) and expires unpaid ones older than 24 hours.

**Refunds.**
- `npm run billing:admin -- refund <org> <top-up> <sen> "<reason>" "<operator>"`. With Curlec configured it calls `POST /v1/payments/:id/refund` with `X-Refund-Idempotency`, then records the result through `settle_refund`. Without a provider (money returned by bank transfer) it records a refund with `admin_refund`.
- Refunds started in the Curlec dashboard arrive as webhooks and go through the same `settle_refund`.
- `settle_refund` debits the wallet only when the refund is `processed`, once per Curlec refund id. A refund larger than what is left on the top-up is held for an operator; a refund of a payment that never credited the wallet changes nothing. The full processed amount is recorded even if it takes the balance below zero, because the money has left.
- The operator command refuses a refund larger than the current balance (spent credit is not refundable) **(Jomjual caps at the balance and sends the shortfall to an admin)**.
- Each Curlec refund costs RM0.50 and is paid from the Curlec balance.

**Adjustments.** `npm run billing:admin -- adjust` adds a signed adjustment with a reason, the operator's name and an audit row. Both operator functions are granted to no application role.

## 6. Provider interface

`packages/billing/src/provider.ts`: `createCheckout`, `getPayment`, `parseWebhook`, `verifyReturn`, `refund`. Shared settlement calls: `packages/billing/src/settle.ts`.

- **Curlec** (`curlec.ts`): `https://api.razorpay.com/v1`, Basic auth with `key_id:key_secret`, 10-second timeout, no redirects, safe error codes (`PAYMENT_CREDENTIALS_REJECTED`, `PAYMENT_PROVIDER_BUSY`, `PAYMENT_PROVIDER_UNAVAILABLE`, `PAYMENT_PROVIDER_ERROR`). Ids are checked against `order_`, `pay_` and `rfnd_` patterns before any request. Written from Curlec's documentation and checked against the owner's Jomjual integration; it has never sent a request.
- **Fake** (`fake.ts`): orders in memory; webhooks and returns in Curlec's exact shapes, signed with fixed local secrets, so tests and `npm run billing:simulate` exercise the production Curlec parser and signature checks.
- **Removed:** the Billplz client, when the owner chose Curlec. Keeping it correct would have meant a second webhook and refund path to maintain.

**Switch.** `JOMCALL_PAYMENT_PROVIDER` takes these values:
- `disabled` (default): the wallet screen shows "Not connected" and top-up is refused with `PAYMENTS_NOT_CONNECTED`. Balance, usage and trial credit still work.
- `fake`: allowed only when `JOMCALL_MODE=local`.
- `curlec`: needs `CURLEC_KEY_ID`, `CURLEC_KEY_SECRET`, `CURLEC_WEBHOOK_SECRET` and an `https` public origin (`JOMCALL_PUBLIC_ORIGIN`, or `APP_ORIGIN` in hosted mode). `CURLEC_ENVIRONMENT` is `test` (default) or `live`; a key whose `rzp_test_`/`rzp_live_` prefix contradicts it is refused.

Settings are read from the gitignored `.env.payments`, which `scripts/billing/with-payment-env.mjs` loads for `dev:local` and `start:local` (only the payment names; model and speech keys never reach the web process). Hosted settings: `infra/hosted/.env.hosted.example`, owner steps `infra/hosted/RUNBOOK.md` section D. `npm run dev:local:fake-payments` starts the web app with the fake provider. `paymentReadiness` reports the state without a network call. The mock preview (port 4181) is unchanged and imports none of this.

## 7. Roles, audit, privacy

- **Billing access.** Only owner and admin read billing or pay. Staff get 403 from the API and zero rows from the tables. Other organizations get 404 and zero rows.
- **Audit actions:** `billing.trial_claimed`, `billing.topup_created`, `billing.topup_paid`, `billing.topup_mismatch`, `billing.topup_extra_payment`, `billing.refund_mismatch`, `billing.refund_exceeds_topup`, `billing.extra_payment_refunded`, `billing.adjusted`, `billing.refunded`. Operator actions record the operator's name and reason.
- **What goes to the provider:** the top-up id, the amount and (to the browser checkout, as a prefill) the signed-in owner's email. It goes only when the switch is on.
- **What is never stored:** card numbers, bank accounts, payer names from callbacks.

## 8. Receipts and invoices

- One receipt per paid top-up, downloadable from the wallet screen as text.
- It is marked as a payment receipt, not a tax invoice, with service tax RM0.00.
- Tax situation: below RM3 million turnover JomCall is exempt from e-invoicing, and ordinary receipts serve as proof. Below RM500,000 of taxable services there is no service tax registration. Both must be confirmed by an accountant.
- `tax_sen` and `einvoice_state` exist, so adding SST or MyInvois later is a job plus a receipt layout change.

## 9. Decisions (marked as my call; the owner may overrule)

1. **Provider:** Curlec, the owner's decision (2026-11-14). My earlier pick was Billplz; research note section 1.
2. **Ledger shape:** a single-entry, append-only ledger per organization, with the balance derived on read. A full double-entry book adds a platform side with no reader yet. The unique keys and triggers give the guarantees that matter: no edits, no double credit, no double charge.
3. **Thresholds:** low at RM10; grace down to −RM5; never cut a live call; new calls not answered by the agent when exhausted or unfunded.
4. **Trial:** RM20 once per organization and once per user, claimed by a button rather than given at sign-up, so an abandoned workspace costs nothing.
5. **Prices:** RM0.32 per voice minute billed per second (as on the public pricing page), WhatsApp 15 sen per conversation, typed turn 2 sen. All provisional. A monthly number fee is recommended once numbers are sold.
6. **Top-up limits:** RM10 to RM5,000; at most 5 unsettled top-ups in 24 hours.
7. **Amount mismatch** holds the top-up for an operator instead of crediting the paid amount.
8. **Provider call inside the database transaction:**
   - It is simpler and needs no compensation step.
   - It costs a held transaction for at most 10 seconds.
   - A bill created at the provider by a rolled-back transaction is unpaid and harmless; if it is ever paid, it lands as `unmatched` for an operator.
9. **`settle_topup` is callable by the web role.** It does not check a user, because the provider is the caller. The database trusts the web process's signature check. Hardening item for the hosted mode: a separate settlement role used only by the webhook route.
10. **Operator actions are a command**, not a hosted-admin screen, until real authentication for operators exists.
11. **Event keys are per payment and state**, not Curlec's event id, so every route to the same captured payment collapses to one ledger row.
12. **Checkout uses Curlec's redirect flow** (`redirect: true`) for every method, because FPX requires it and one flow is simpler to reason about.

## 10. Stubbed until a merchant account exists

- Every real payment. The Curlec client has never sent a request.
- Callback delivery from the internet: this needs the hosted deployment and a public HTTPS address. The webhook route runs in `local` and `hosted` mode (`requireApp()`); hosted mode uses `APP_ORIGIN` as the callback address unless `JOMCALL_PUBLIC_ORIGIN` is set.
- A real Curlec refund (the code path exists and is tested against recorded shapes only).
- Card saving and automatic top-up.
- SST and e-invoice submission.

## 11. Known limits

- The shared local database records migration versions `20261114150000`, `20261114150100`, `20261114200100` and `20261114210000` (Curlec was recorded as `20261114200000` until main's knowledge core took that version; the row was renumbered). A checkout without these files gets "remote migration versions not found" from `supabase db push`. WhatsApp's `20261114120000` and `20261114120100` sort earlier; on a database where billing was applied first, pushing them needs `--include-all`.

- The webhook has no rate limit of its own. A forged callback costs one HMAC check and is refused before any database read.
- The migration-check command creates `jomcall_billing` as a cluster-wide role. Run `npm run db:migrate:local` before `npm run db:verify-migrations` on a database where this migration is not yet applied. Otherwise the push fails with `permission denied to grant role "jomcall_billing"`; drop the stray role first.
- Fake orders live in the web process's memory. After a restart, "Check status" on a fake top-up reports unpaid; the simulator still settles it.

## 12. Monthly plans (price table version 2)

Added 2026-11-14 on the parent's instruction. Migration `20261114210000_billing_plans.sql`; helpers in `packages/billing/src/plans.ts`; tests in `tests/billing/plans.test.ts`. Every figure below is an **owner placeholder, changeable**. It lives in `app.billing_plan` and `app.billing_price` with `status = 'owner_placeholder'`. A change is a new version row; version 1 stays in history.

| Plan | Monthly fee | Phone numbers | Voice included | Voice after that | WhatsApp agent |
|---|---|---|---|---|---|
| `starter` | RM49 (4,900 sen) | 1 | 100 min (6,000 s) | RM0.32 a minute, billed per second | Not included |
| `growth` | RM129 (12,900 sen) | 1 | 400 min (24,000 s) | RM0.32 a minute (same `voice_second` price; the brief gave no Growth rate) | Included |
| `payg` | none | 0 | none | RM0.32 a minute | Not included |

WhatsApp: the business connects its **own** WhatsApp number, and Meta bills its message fees to the business directly. JomCall meters only its own agent fee per conversation: `whatsapp_conversation`, 15 sen in version 2 (placeholder, same as version 1). Typed turns stay at 2 sen.

### Model

- **No card is charged automatically.** The monthly fee is a `plan_fee` debit from the prepaid wallet.
- **Period.** Each organization's periods are anchored to its start date in `Asia/Kuala_Lumpur` (`org_plan.anchor_date`, set from `organization.created_at` when it first chooses a plan). Period *k* runs from anchor + *k* months to anchor + *k*+1 months, at Kuala Lumpur midnight. A 31 January anchor gives 31 Jan, 28 Feb, 31 Mar and does not drift.
- **Charging.** `app_private.charge_plan_period(org, at)` starts or retries the period containing `at`, and `charge_due_plans(at)` does it for every organization with a plan. At the first call in a period it does three things:
  - creates one `plan_period` row per organization and period start;
  - freezes the plan, fee, allowance and entitlements on that row, so a later price version never changes a running period;
  - debits the fee with ledger key `plan_fee:<period id>`.

  Retries return the same row. The fee is debited at most once per period.
- **Allowance.** The included seconds are granted only once the period is `charged`. They expire at the period end: unused minutes do not roll over. `record_usage` keeps its signature and does two new things:
  - for `voice_second`, it takes seconds from a charged period that contains the call first, and bills the rest from the wallet at the version's `voice_second` price;
  - it records the drawn seconds on `usage_event.included_seconds` and `period_id`, and returns `includedSeconds`.

  WhatsApp and typed usage always bill from the wallet.
- **Plan change.** `choose_plan(org, code)` (owner or admin) sets `pending_plan_code`. The change takes effect when the next period is created. This includes moving from `payg` to a paid plan. Asking for the current plan cancels a pending change.
- **Not enough balance for the fee.**
  - The fee is never debited into a negative balance. The period starts `unpaid` with `grace_until` = period start + `grace_days`, which is 7 for both paid plans (placeholder, in data).
  - During grace the plan's phone number and WhatsApp agent stay on, but there is no allowance. Calls bill from the wallet at the overage rate, so nothing is charged twice when the fee lands later.
  - Any retry that finds the balance sufficient debits the fee and turns the allowance on.
  - A retry after `grace_until` marks the period `downgraded` and moves the organization to `payg`.
  - A live call is never cut: `record_usage` still never refuses.
- **Entitlements.** `app_private.plan_entitlements(org, at)` returns these fields:
  - `plan` and `periodState`;
  - `phoneNumbers` and `whatsappAgent`, which stay on while the period is `charged` or `unpaid`;
  - `includedVoiceSeconds`, which is on only while `charged`;
  - `usedIncludedSeconds`.

  The function is granted to the worker role (and, since section 13, to the owner of the agent functions instead of the agent login role); `plan_summary(org)` is for owners and admins. The phone line and the WhatsApp worker read it at admission (section 13).
- **Roles.** Owners and admins of the organization read `org_plan` and `plan_period` (forced RLS). The app role cannot write them or charge a period. `billing_plan` is readable by any signed-in session.

### Tests (`tests/billing/plans.test.ts`, 7)

1. Version 2 rows are in sen and marked placeholder; version 1 is kept; period bounds across February and the Kuala Lumpur date line.
2. Allowance consumed before the wallet, including a call split across the allowance boundary and a replayed call.
3. Expiry at period end, with no rollover into the next period.
4. Fee debited once under six concurrent calls plus two `charge_due_plans` runs.
5. Insufficient balance: unpaid, grace, a call billed from the wallet, payment on retry; a second organization downgraded to `payg` after grace, a call still recorded below zero, and the next period free.
6. Plan change takes effect next period (from `payg` and between paid plans), and a pending change can be cancelled.
7. Tenant and role isolation: another organization's allowance is untouched, rows are not visible across organizations, staff and outsiders cannot choose a plan, and the app role cannot write plan rows or charge.

### Open owner decisions

- **First subscription timing.** Under the next-period rule, an organization that moves from `payg` to Starter waits until its next anchor date for the number and minutes. Two alternatives: start the first paid period immediately with a full or pro-rated fee, or re-anchor on the day of the first subscription.
- Final figures: fees, allowances, Growth overage rate, the WhatsApp agent fee, grace length.

### Follow-ups (not built)

- ~~Wire `plan_entitlements` into the phone line~~: answering is gated since section 13. Refusing to *assign* a number the plan does not cover is still open.
- Schedule `charge_due_plans` (daily) in the worker.
- Retry the fee automatically when a top-up is credited during grace.
- A plan picker and plan status on the local-app wallet screen (`choose_plan`, `plan_summary`).

## 13. Metering and admission on the real channels (2026-11-15)

Added on branch `claude/usage-metering-e13eb4` (pull request #26). Migration `supabase/migrations/20261115123000_channel_metering.sql`; tests `tests/billing/phone-metering.test.ts` (18), `tests/billing/whatsapp-metering.test.ts` (9) and `voice/tests/test_phone.py` (3 new). Everything was tested against the fake telephony, the fake WhatsApp provider and the local database only. Revised the same day after review (items numbered as in that review where it helps).

### What was built

- **Phone calls.** A call is billed `voice_second` once, with key `call:<call id>`, in the same transaction that ends it. There are two end paths:
  - `agent_call('call_end')`: caller hang-up, transfer, and the worker's error path;
  - `agent_call('maintain')`: a worker crash, through token expiry.

  The quantity is the call row's `duration_seconds`, counted from `answered_at`. It is copied to `billed_seconds`, and `usage_event_id` links the bill. Never billed: a call never answered, a call of 0 seconds (`usage_state='free'`), a refused call, and browser test calls (section 4).
- **What counts as answered.** The voice worker reports the answer (`/answered`) once the opening has played. That report now checks the status and retries up to three times (3 s timeout each, short back-off), in the background so the caller is heard meanwhile; a 4xx other than 429 is final. If every attempt is lost, the caller's first turn sets `answered_at` (`turn_begin`), so a call in which the caller spoke is never free. `disclosure_played_at` is not backfilled: it records what was played. `call_bill` also treats a call with turns as answered if `answered_at` is somehow empty.
- **Priced at the start.** A call is billed under the price version and the plan period in force at `answered_at` (the usage event's `occurred_at` is the answer time, not the end). A call answered at 23:55 on the last day of a period and ended at 00:05 draws on the period it was answered in; a call answered before a price change pays the old price.
- **Crash cut-off.** After a worker crash, `maintain` ends the call at token expiry and sets its duration from `answered_at` to the latest sign it was alive: the latest `call_turn.completed_at` (new column, set when a turn completes, fails or is cancelled), or that turn's `created_at` if it never finished. No turns: 0 seconds, free. A late `/end` from the worker after `token_expires_at` is refused (`VOICE_EXPIRED`), so the call takes this duration from `maintain`.
- **A failed bill never blocks the end of a call.** The call ends with `usage_state='pending'`, and every `maintain` pass retries each owed call on its own, least-tried first. `usage_attempts` counts failures; after 20 `maintain` stops trying it, so one that can never be billed does not hold up the rest. A duplicate or late end gets 401 because the token is already cleared. The idempotency key is a second guard; two concurrent ends, or an end racing `maintain`, bill once (tested).
- **Stuck bills.** `npm run billing:admin -- usage-pending` lists every owed call and conversation (ids, organization, namespace, kind, attempts, since; `stuck` at 20 attempts; never a phone number or WhatsApp id). `npm run billing:admin -- usage-retry <id>` tries one bill once more past the cap and counts a failure. Code: `scripts/billing/usage-admin.ts`. Local database only, like the rest of `billing:admin`.
- **WhatsApp.**
  - **Window:** one `app.conversation` row. A new one starts after 24 hours without a customer message (WhatsApp design §5).
  - **Billing:** `whatsapp_conversation`, quantity 1, key `wa:<conversation id>`, when the first agent-authored message in the conversation reaches `sent` in `whatsapp_work('send_result')`. This includes the template that replaces it outside the 24-hour window, and a late send result that turns `unknown` into `sent` (both tested). The moment is stored in `usage_at`, and the bill is priced at it even when a retry lands later.
  - **Not billed:** notices (opt-out, handoff, unsupported message), staff replies, and conversations the agent never answered.
  - **A failed bill** never undoes the send: the message stays `sent`, the conversation stays `usage_state='pending'` for `maintain` to retry (tested with a real failure inside `send_result`).
- **Admission.** `app_private.channel_admission(org, 'phone'|'whatsapp', at)` is internal, owned by `jomcall_agent_jobs` and granted to no role. It does three things in order:
  1. starts or retries the current plan period (`charge_plan_period`);
  2. reads `plan_entitlements`;
  3. reads `wallet_state`.

  It returns `NO_PHONE_ENTITLEMENT` or `NO_WHATSAPP_ENTITLEMENT`, then `WALLET_UNFUNDED` or `WALLET_EXHAUSTED`, or null. Grace is admitted. It never raises: any error gives `BILLING_CHECK_FAILED`, and so does a failed period charge that leaves no entitlement (it is not reported as a missing plan). `BILLING_CHECK_FAILED` refuses for now; whether it should admit instead is an open owner decision.
  - **Phone:** it runs inside `call_start`'s lock, **after every other refusal** (suspended, unpublished, disclosure, caller limit, busy line), so a call refused for any other reason never starts or charges a plan period. The plan period is read at the **database** clock, never the agent's `at` (which still decides opening hours), so the agent process cannot choose which period is charged or checked. A fault refuses that call with its own refused row and code; it never turns into a bare `CALL_START_FAILED`.
  - **WhatsApp:** it runs in `turn_claim` for agent turns, and only while the conversation has not been billed. A refusal (or a fault) skips that turn with the code, sets `needs_attention` with the code as `attention_reason`, and sends nothing; the claim moves on to the next queued turn, so one organization's fault never stalls the others. The inbox screen that shows the flag is on another pull request. A skipped turn is not answered later, after a top-up say, unless the customer writes again.
- **Never cut off.** Nothing re-checks the plan or the wallet during a call, or in a conversation already answered in its window. Those keep going and are billed into grace or below.
- **Roles.**
  - `jomcall_agent_jobs`, the owner of `agent_call` and `whatsapp_work`, gained EXECUTE on `record_usage`, `wallet_state`, `plan_entitlements` and `charge_plan_period`.
  - The login role `jomcall_agent` lost EXECUTE on `record_usage`, `wallet_state` and `plan_entitlements`. It can no longer bill an organization or read any balance; it learns only a refusal code for the number dialled.
  - The web role `jomcall_app` now reads `app.call` and `app.conversation` column by column, without the billing columns (`usage_state`, `billed_seconds`, `usage_event_id`, `usage_attempts`, `usage_at`), so staff see no billing data (section 7).
  - `jomcall_worker` is unchanged.
- **Operator plan command.** `npm run billing:admin -- plan <org> <starter|growth|payg> "<operator>"` stands in for the missing plan picker:
  - with no period running, it starts the plan now; otherwise the change takes effect next period;
  - it records `billing.plan_set_by_operator` in the audit log, then starts or retries the period.
- **Every organization needs a plan.** After this migration, an organization without a plan is refused on the phone line (`NO_PHONE_ENTITLEMENT`) and gets no WhatsApp agent replies (`NO_WHATSAPP_ENTITLEMENT`) until an operator gives it one, because there is no plan picker. Browser test calls and typed tests are unaffected. `billing:admin` refuses any database but the local one, so on hosted staging the owner runs the equivalent SQL as the database owner (see the pull request).

### Deviations from this design and the channel designs

1. **Metering runs in SQL, not through the TypeScript `recordUsage`.** Section 3 says the phone and WhatsApp sessions call `recordUsage` as `jomcall_agent`. They call the same `app_private.record_usage` from inside their own security-definer functions instead. This makes the bill atomic with the end or the send, so no ended-but-unbilled window exists outside a failed bill. It also lets the agent login role lose its direct grant.
2. **What is measured.** Section 3 says to bill only after the provider confirms the event. No provider call-end record exists: phone design §11 lists "billing per provider-confirmed minute" as not built. Voice seconds are therefore measured by JomCall, from the answer (or the first turn) to the end the worker reports. After a crash they run to the end of the last turn.
3. **Refused calls are silent.** Section 4 says a refused call rings through to the business and the owner is told. Neither exists (phone design open decision 4). These refusals are silent like the other configuration refusals: the room is deleted and a refused row stays in the call log.
4. **The WhatsApp unit.** WhatsApp design O7 says to bill per delivered message from Meta's `pricing` status. This follows section 12 instead: JomCall's own fee per conversation.
5. **Lazy period start.** Section 12 expects `charge_due_plans` to start periods, but nothing schedules it. Admission starts or retries the period itself, so the first admitted call or chat of a period can debit the monthly fee.
6. **Owners and admins cannot read the billing columns either.** Section 7 is about staff, but every member connects as the same web role, so the column grant hides `usage_state` and the rest from owners and admins too. They see what was billed through the wallet and usage events.

### Known limits (found in review, not fixed here)

- **WhatsApp: a send whose result never arrives is not billed.** If the worker dies after Meta accepted the message and no late send result comes, maintenance marks it `unknown`, and the status webhook does not move `unknown` forward. The customer got the answer; the conversation is billed only if a later agent message is sent. Under-billing, not double billing.
- **WhatsApp: a Meta `failed` status after `sent` does not reverse the bill.** The 15 sen stays charged; no reversal is built.
- **Admission runs inside the global call-start lock.** A long transaction that holds one organization's wallet lock delays every call start until it ends.
- **Maintenance takes several organizations' wallet locks in one transaction.** A deadlock with `charge_due_plans` is possible. Inside maintenance it only defers that bill; a `charge_due_plans` run would abort and must be retried.
- **Billing a crashed call shortens `duration_seconds`**, which the call log shows, to the end of the last turn. An answered call with no turns becomes 0 seconds and is free.
- **New columns need a grant.** A later migration that adds a column to `app.call` or `app.conversation` must grant it to `jomcall_app`, or the web role cannot read it. A migration that grants the whole table again would expose the billing columns.

### Open owner decisions

- **When the billing check itself fails:** refuse (today, `BILLING_CHECK_FAILED`) or admit.
- **An exhausted wallet with unused paid allowance:** whether a paid plan's remaining minutes should still be served when the wallet is exhausted. Today the wallet decides.
- **On a plan or wallet refusal:** silent (today) or a notice; on the phone, ringing the owner's own number (phone open decision 4).
- **After staff resolve a flagged conversation:** whether the agent answering it again in the same window should bill again. Today one conversation is one bill.
- Whether WhatsApp conversations longer than 24 hours of continuous activity should bill again per 24 hours.
- Whether the crash cut-off (the end of the last turn) is acceptable, or whether a provider call-end time is required before real callers.
- A plan picker on the wallet screen, and specific call-log text for the new refusals (currently "Not answered").
