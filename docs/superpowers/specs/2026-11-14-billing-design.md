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
- **A live call is never cut.** A call in progress finishes and is billed, even into grace or past it. The check runs before a new call starts, and on WhatsApp before the agent's first answer in each 24-hour billing window, not only before a new conversation starts (section 13). A WhatsApp thread can therefore stop getting agent replies part-way through, once its window ends, if the wallet is exhausted or the entitlement is gone; the conversation is flagged for staff and the owner is emailed. This is awaiting the owner's decision (2026-11-16).
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
- **Charging.** `app_private.charge_plan_period(org, at)` starts or retries the period containing `at`, and `charge_due_plans(at)` does it for every organization with a plan (manual use only since 2026-11-16: the engine lists the organizations due with `plan_orgs_due` and charges each in its own transaction; see the plan picker note at the end of section 13). At the first call in a period it does three things:
  - creates one `plan_period` row per organization and period start;
  - freezes the plan, fee, allowance and entitlements on that row, so a later price version never changes a running period;
  - debits the fee with ledger key `plan_fee:<period id>`.

  Retries return the same row. The fee is debited at most once per period.
- **Allowance.** The included seconds are granted only once the period is `charged`. They expire at the period end: unused minutes do not roll over. `record_usage` keeps its signature and does two new things:
  - for `voice_second`, it takes seconds from a charged period that contains the call first, and bills the rest from the wallet at the version's `voice_second` price;
  - it records the drawn seconds on `usage_event.included_seconds` and `period_id`, and returns `includedSeconds`.

  WhatsApp and typed usage always bill from the wallet.
- **Plan change.** `choose_plan(org, code)` (owner or admin) sets `pending_plan_code`. A change between paid plans, or down to `payg`, takes effect when the next period is created. Asking for the current plan cancels a pending change. Since 2026-11-16 a first paid plan (from `payg`) no longer waits: it starts at once with the full fee and a new monthly date, or not at all when the wallet is short (see the plan picker note at the end of section 13).
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

- ~~**First subscription timing.**~~ Decided by the owner on 2026-11-16: the first paid plan starts now with the full fee and a new monthly date (plan picker note at the end of section 13). Under the earlier next-period rule, an organization that moves from `payg` to Starter waits until its next anchor date for the number and minutes. Two alternatives: start the first paid period immediately with a full or pro-rated fee, or re-anchor on the day of the first subscription.
- Final figures: fees, allowances, Growth overage rate, the WhatsApp agent fee, grace length.

### Follow-ups (not built)

- ~~Wire `plan_entitlements` into the phone line~~: answering is gated since section 13. Refusing to *assign* a number the plan does not cover is still open.
- ~~Schedule `charge_due_plans` (daily) in the worker~~: built 2026-11-16; the engine visits the organizations due every hour, one transaction each.
- ~~Retry the fee automatically when a top-up is credited during grace~~: built 2026-11-16, in the same transaction as the credit.
- ~~A plan picker and plan status on the local-app wallet screen (`choose_plan`, `plan_summary`)~~: built 2026-11-16 (plan card on `/app/billing`).

## 13. Metering and admission on the real channels (2026-11-15)

Added on branch `claude/usage-metering-e13eb4` (pull request #26). Migration `supabase/migrations/20261115123000_channel_metering.sql`; tests `tests/billing/phone-metering.test.ts` (21), `tests/billing/whatsapp-metering.test.ts` (12) and `voice/tests/test_phone.py` (3 new). Everything was tested against the fake telephony, the fake WhatsApp provider, the local engine with its local mail catcher, and the local database only. Revised twice on the same day: once after review, then for the four owner decisions below.

### Owner decisions (2026-11-15)

- **A. A failed billing check answers anyway (fail open).** If reading the plan, the entitlement or the wallet fails on either channel, the call or WhatsApp turn is admitted. The code `BILLING_CHECK_FAILED` is stored on the call row (`app.call.billing_check`) or the turn row (`app.conversation_turn.billing_check`), and a database warning `BILLING_CHECK_FAILED channel=<phone|whatsapp> org=<org id>` is logged (no phone number, WhatsApp id or text). The admitted call or chat is still metered. One organization's fault never affects another's. A plan or wallet that was read successfully and says no is still a refusal. `npm run billing:admin -- usage-pending` lists the calls and turns of the last 7 days that were answered this way (kinds `call_check_failed`, `whatsapp_check_failed`). This replaces the earlier interim, which refused with a refused row.
- **B. An exhausted or unfunded wallet does not block a charged plan's unused minutes on the phone.** A phone call is admitted when the current plan period is charged and has unused included seconds (`includedVoiceSeconds > usedIncludedSeconds` from `plan_entitlements`), whatever the wallet state. The call is never cut off when the allowance runs out during it; the overage is billed as before, which can take the wallet below the exhausted threshold. Once the allowance is used up, the wallet rule applies again. WhatsApp is unchanged: no plan includes conversations at no charge (every conversation is a 15 sen wallet debit), so the wallet still decides there.
- **C. A plan or wallet refusal emails the organization's owners.**
  - **When:** on `NO_PHONE_ENTITLEMENT`, `NO_WHATSAPP_ENTITLEMENT`, `WALLET_UNFUNDED` or `WALLET_EXHAUSTED`, at most once per organization, reason and Kuala Lumpur day (table `app.billing_notice`, unique on organization, reason and day). A second channel refused for the same reason that day gets no second email. No email for configuration refusals (unpublished agent, missing disclosure, busy line, caller limit, unknown number, suspension) or for `BILLING_CHECK_FAILED`.
  - **How:** `channel_admission` calls `app_private.queue_billing_notice`, a security-definer function owned by `jomcall_jobs` (the engine's job owner, which already writes the outbox) and executable only by `jomcall_agent_jobs`. It inserts the notice row and one outbox row of the fixed kind `billing.refusal_notice`, nothing else. The agent login role gains nothing; the agent process never sends mail. The engine claims the outbox row like an invitation, reads the active owners' emails through `app_private.billing_notice_payload` (using the existing `auth_user_email`), sends one email per owner and acknowledges it (`ack_billing_notice`). A queueing failure never changes the admission result (`BILLING_NOTICE_DEFERRED` warning).
  - **What it says:** English then Bahasa Melayu (`engine/src/billing-notice.ts`): whether phone calls or WhatsApp replies are not being answered, why (no phone number in the plan, no WhatsApp agent in the plan, no credit, balance run out), that callers and customers are not told and get no answer, and the wallet page link (`/app/billing`). It contains no customer phone number, no WhatsApp id, no message text and no organization name.
  - **The caller and the customer still get nothing.** A refused phone call is ended silently (room deleted, refused row); a refused WhatsApp turn is skipped and the conversation flagged for staff. Ringing through to the business is not built (phone design open decision 4).
  - **No mail in mock mode:** the engine refuses to start outside local and hosted mode (`LOCAL_ONLY`), so nothing is sent.
- **D. WhatsApp is billed once per customer per 24 hours**, however many times staff resolve the chat and it reopens.
  - **Customer:** one contact on one WhatsApp channel (`channel_id`, `contact_id`).
  - **Window start:** the moment `whatsapp_work('send_result')` records the provider's `sent` for an agent-authored message (including the template that replaces it outside the 24-hour customer-service window, and a late result that turns `unknown` into `sent`) while that customer has no window that started less than 24 hours earlier. That moment (the database `now()` of that transaction) is `starts_at` of a new row in `app.whatsapp_usage_window`. Notices, staff replies and unanswered chats never start a window.
  - **Window end:** `starts_at + 24 hours`. Agent answers after that, in the same conversation or a new one, start a new window and a new bill.
  - **Key:** `wa:<channel id>:<contact id>:<starts_at as whole Unix seconds>`, quantity 1, `whatsapp_conversation`, priced at `starts_at`. An advisory lock per customer makes two concurrent sends open one window.
  - **Admission** (`turn_claim`) is skipped while the customer has an open window, so a paid chat is never refused mid-window, including after a resolve and reopen. After the window ends, the next agent turn is checked again, even in the same long-running conversation (commit f343c16). **Awaiting the owner's decision:** a WhatsApp thread can then go without an agent reply part-way through, when the wallet is exhausted or the entitlement is gone; the conversation is flagged for staff (`needs_attention`) and the owners get the daily email (decision C). The migration header's line that a conversation under way is never cut off predates this and is superseded here; that migration is merged and is not edited.

### What was built

- **Phone calls.** A call is billed `voice_second` once, with key `call:<call id>`, in the same transaction that ends it. There are two end paths:
  - `agent_call('call_end')`: caller hang-up, transfer, and the worker's error path;
  - `agent_call('maintain')`: a worker crash, through token expiry.

  The quantity is the call row's `duration_seconds`, counted from `answered_at`. It is copied to `billed_seconds`, and `usage_event_id` links the bill. Never billed: a call never answered, a call of 0 seconds (`usage_state='free'`), a refused call, and browser test calls (section 4).
- **What counts as answered.** The voice worker reports the answer (`/answered`) once the opening has played. That report checks the status and retries up to three times (3 s timeout each, short back-off), in the background so the caller is heard meanwhile; a 4xx other than 429 is final. If every attempt is lost, the caller's first turn sets `answered_at` (`turn_begin`), so a call in which the caller spoke is never free. `disclosure_played_at` is not backfilled: it records what was played. `call_bill` also treats a call with turns as answered if `answered_at` is somehow empty.
- **Priced at the start.** A call is billed under the price version and the plan period in force at `answered_at`. A call answered at 23:55 on the last day of a period and ended at 00:05 draws on the period it was answered in; a call answered before a price change pays the old price. A WhatsApp window is priced at its `starts_at`, even when a retry lands later.
- **Crash cut-off.** After a worker crash, `maintain` ends the call at token expiry and sets its duration from `answered_at` to the latest sign it was alive: the latest `call_turn.completed_at` (set when a turn completes, fails or is cancelled), or that turn's `created_at` if it never finished. No turns: 0 seconds, free. A late `/end` after `token_expires_at` is refused (`VOICE_EXPIRED`), so the call takes this duration from `maintain`.
- **A failed bill never blocks the end of a call or undoes a send.** The call ends, or the message stays `sent`, and the call or window stays `usage_state='pending'`. Every `maintain` pass retries each owed call and window on its own, least-tried first. `usage_attempts` counts failures; after 20 `maintain` stops trying it. The idempotency key is a second guard; two concurrent ends, or an end racing `maintain`, bill once (tested).
- **Stuck bills.** `npm run billing:admin -- usage-pending` lists owed calls and WhatsApp windows (ids, organization, namespace, kind, attempts, since; `stuck` at 20 attempts; never a phone number or WhatsApp id), plus the calls and turns answered after a failed check (decision A). `npm run billing:admin -- usage-retry <call id or window id>` tries one bill once more past the cap and counts a failure. Code: `scripts/billing/usage-admin.ts`. Local database only, like the rest of `billing:admin`.
- **Admission.** `app_private.channel_admission(org, 'phone'|'whatsapp', at, namespace)` is internal, owned by `jomcall_agent_jobs` and granted to no role. In order it:
  1. starts or retries the current plan period (`charge_plan_period`);
  2. reads `plan_entitlements`: no entitlement gives `NO_PHONE_ENTITLEMENT` or `NO_WHATSAPP_ENTITLEMENT`, unless the period charge failed, which gives `BILLING_CHECK_FAILED`;
  3. reads `wallet_state`: a state that allows service (ok, low, grace) admits; on the phone, unused included seconds in a charged period admit (decision B); otherwise `WALLET_UNFUNDED` or `WALLET_EXHAUSTED`;
  4. for those four refusal codes, queues the owner email (decision C).

  It never raises: any error gives `BILLING_CHECK_FAILED`, which both channels admit (decision A).
  - **Lock timeout (2026-11-16, migration `20261116100000_channel_admission_timeout.sql`).** `channel_admission` carries `lock_timeout = 500ms` as a function setting, so it applies only while admission runs. A wait on the organization's `wallet:` lock (held by a maintenance pass or a top-up) longer than that no longer stalls every organization's call starts behind the global call-start lock. If the wait is in the period charge, the charge is deferred; when the already-charged period still gives the entitlement, the plan and wallet are read as usual (neither read takes a lock), otherwise the result is `BILLING_CHECK_FAILED`. Tested in `tests/billing/admission-timeout.test.ts`.
  - **Phone:** it runs inside `call_start`'s lock, **after every other refusal** (suspended, unpublished, disclosure, caller limit, busy line), so a call refused for any other reason never starts or charges a plan period. The plan period is read at the **database** clock, never the agent's `at` (which still decides opening hours).
  - **WhatsApp:** it runs in `turn_claim` for agent turns, only when the customer has no open window (decision D). A refusal skips that turn with the code, sets `needs_attention` with the code as `attention_reason`, and sends nothing; the claim moves on to the next queued turn. The inbox screen (pull request #25) shows the flag. A skipped turn is not answered later, after a top-up say, unless the customer writes again.
- **Never cut off.** Nothing re-checks the plan or the wallet during a call or inside an open WhatsApp window. Those keep going and are billed into grace or below. A WhatsApp conversation that outlives its window is checked again (see decision D; awaiting the owner's decision).
- **The answer report does not hold up the end (2026-11-16).** The voice worker cancels the background answer report when the call ends instead of waiting for its retries (up to about 10 s), so a quick hang-up is not billed for that time and the line is freed at once. A lost report is still covered by the first caller turn.
- **Roles.**
  - `jomcall_agent_jobs`, the owner of `agent_call` and `whatsapp_work`, gained EXECUTE on `record_usage`, `wallet_state`, `plan_entitlements`, `charge_plan_period` and `queue_billing_notice`, and select, insert and update on `app.whatsapp_usage_window`.
  - `jomcall_jobs` gained select, insert and update on `app.billing_notice` and EXECUTE on `auth_user_email`; it owns `queue_billing_notice`, `billing_notice_payload` and `ack_billing_notice`. `claim_outbox` now also claims `billing.refusal_notice`.
  - `jomcall_worker` (engine login) gained EXECUTE on `billing_notice_payload` and `ack_billing_notice`.
  - The login role `jomcall_agent` lost EXECUTE on `record_usage`, `wallet_state` and `plan_entitlements`, and has none on the new functions. It can no longer bill an organization, read any balance or queue mail; it learns only a refusal code for the number dialled.
  - The web role `jomcall_app` reads `app.call` column by column, without `usage_state`, `billed_seconds`, `usage_event_id`, `usage_attempts` and `billing_check`, and has no access to `app.whatsapp_usage_window` or `app.billing_notice`. `app.conversation` is unchanged.
- **What staff can and cannot see.** Every member, staff included, connects as `jomcall_app`; row-level security limits them to their own organization.
  - **Cannot see:** `app.call.usage_state`, `billed_seconds`, `usage_event_id`, `usage_attempts` and `billing_check` (column grants); `app.whatsapp_usage_window` and `app.billing_notice` (no grant). Wallet ledger and usage events are readable by owners and admins only (row-level security on `manager_read`).
  - **Can see:** `app.call.refusal` (for example `NO_PHONE_ENTITLEMENT`, `WALLET_EXHAUSTED`), `app.conversation.needs_attention` and `attention_reason` (the same codes on a skipped WhatsApp turn), and `app.conversation_turn.error_code` and `billing_check` (including `BILLING_CHECK_FAILED`). These reveal that the workspace was refused for its plan or wallet, or that a billing check failed, but no amount, balance or price.
- **Operator plan command.** `npm run billing:admin -- plan <org> <starter|growth|payg> "<operator>"` stood in for the plan picker until 2026-11-16 and remains for operators:
  - with no period running, it starts the plan now; otherwise the change takes effect next period;
  - it records `billing.plan_set_by_operator` in the audit log, then starts or retries the period.
- **Every organization needs a plan.** After this migration, an organization without a plan is refused on the phone line (`NO_PHONE_ENTITLEMENT`) and gets no WhatsApp agent replies (`NO_WHATSAPP_ENTITLEMENT`) until it has one (until 2026-11-16 only an operator could give it one; since then its owner can pick a plan on the wallet screen); its owners get one email a day per reason (decision C). Browser test calls and typed tests are unaffected. `billing:admin` refuses any database but the local one, so on hosted staging the owner runs the equivalent SQL as the database owner (see the pull request).

### Deviations from this design and the channel designs

1. **Metering runs in SQL, not through the TypeScript `recordUsage`.** Section 3 says the phone and WhatsApp sessions call `recordUsage` as `jomcall_agent`. They call the same `app_private.record_usage` from inside their own security-definer functions instead, so the bill is atomic with the end or the send and the agent login role loses its direct grant.
2. **What is measured.** Section 3 says to bill only after the provider confirms the event. No provider call-end record exists (phone design §11). Voice seconds are measured by JomCall, from the answer (or the first turn) to the end the worker reports. After a crash they run to the end of the last turn.
3. **Refused calls are silent to the caller.** Section 4 says a refused call rings through to the business and the owner is told. The owner is now told by email (decision C); ringing through is not built (phone design open decision 4).
4. **The WhatsApp unit.** WhatsApp design O7 says to bill per delivered message from Meta's `pricing` status. This follows section 12 and decision D instead: JomCall's own fee per customer per 24 hours.
5. **Lazy period start.** Section 12 expects `charge_due_plans` to start periods, but nothing scheduled it until 2026-11-16. Admission starts or retries the period itself, so the first admitted call or chat of a period can debit the monthly fee before the engine's hourly visit does.
6. **Owners and admins cannot read the billing columns either.** Every member connects as the same web role, so the column grant hides them from owners and admins too. They see what was billed through the wallet and usage events.

### Known limits (not fixed here)

- **WhatsApp: a send whose result never arrives is not billed.** If the worker dies after Meta accepted the message and no late send result comes, maintenance marks it `unknown`, and the status webhook does not move `unknown` forward. No window opens until a later agent message is sent. Under-billing, not double billing.
- **WhatsApp: a Meta `failed` status after `sent` does not reverse the bill.**
- **The usage event key holds the contact's internal id** (`wa:<channel>:<contact>:<seconds>`). Contact export and delete do not touch usage events, which are kept as billing records; the id is an opaque uuid, not a phone number.
- **A lost owner email is not re-sent by reconciliation.** If the engine's queue job for a `billing.refusal_notice` row is lost, `unsettled_outbox` does not pick it up (it reconciles invitations only); the notice row stays `pending` and the next day's refusal sends a new one. A send that keeps failing is marked `failed` after five tries.
- **Admission runs inside the global call-start lock.** Since 2026-11-16 a wait on one organization's wallet lock is capped at 500 ms (`lock_timeout`), so a long maintenance pass or top-up delays other organizations' call starts by at most about that, and the waiting call is answered and marked `BILLING_CHECK_FAILED` when its period is due.
- **Unused allowance is not reserved for calls in progress** (awaiting the owner's decision). Decision B admits a call while any included seconds are unused, but calls already running are not counted against them. With a little allowance left on an exhausted wallet, every call admitted before the first one ends is billed as overage. Bound: concurrent lines × call cap at 32 sen a minute; RM3.20 at the defaults of one line (`JOMCALL_MAX_CONCURRENT_CALLS=1`) and 600 s (`JOMCALL_CALL_CAP_SECONDS=600`); RM64 at the maximum of 20 lines and 600 s.
- **A call admitted just before a period boundary and answered after it is billed wholly as overage** (awaiting the owner's decision). It is priced at the answer, when the new period has not been charged yet, so it draws on no allowance. Bound: one call cap per line at 32 sen a minute (RM3.20 at the defaults).
- **A WhatsApp turn claimed just inside a 24-hour window and sent just after it opens a new 15 sen window with no admission check** (awaiting the owner's decision), even on an exhausted wallet or without the entitlement. Bound: 15 sen per customer per window edge.
- **The owner email is at-least-once.** If the engine sends the email but fails before it is acknowledged, the retry sends it again (up to five tries).
- **Maintenance takes several organizations' wallet locks in one transaction.** A deadlock with a plan charge is possible. Inside maintenance it only defers that bill; since 2026-11-16 the engine charges each organization in its own transaction, so only that organization's charge fails and the run retries it after five minutes (a manual `charge_due_plans` run rolls back that organization alone).
- **Billing a crashed call shortens `duration_seconds`**, which the call log shows, to the end of the last turn.
- **New columns need a grant.** A later migration that adds a column to `app.call` must grant it to `jomcall_app`, or the web role cannot read it. A migration that grants the whole table again would expose the billing columns.

### Open owner decisions

- Whether the crash cut-off (the end of the last turn) is acceptable, or whether a provider call-end time is required before real callers.
- ~~A plan picker on the wallet screen~~ (built 2026-11-16), specific call-log text for the new refusals (currently "Not answered"), and an inbox view of `BILLING_CHECK_FAILED` turns.
- Ringing a refused call through to the business (phone open decision 4).
- Whether a WhatsApp thread may go without an agent reply after its 24-hour window ends on an exhausted wallet or a removed entitlement (today it does; the conversation is flagged and the owner emailed).
- Whether to reserve allowance for calls in progress, how to treat calls across a period boundary, and the WhatsApp window-edge send (bounds in the known limits above).

### Plan picker as built (2026-11-16)

Branch `feat/plan-picker`, pull request not yet open, not merged; nothing on hosted staging. Migration `supabase/migrations/20261116120000_plan_picker.sql`; web commands `plan` and `choosePlan`; the plan card on `/app/billing` (`web/components/core/plan-card.tsx`, rules in `web/lib/core/plan-rules.ts`) and a link on setup's finish stage; engine `engine/src/engine.ts`.

- **Owner decisions (2026-11-16).**
  1. A first paid plan starts now: the monthly date becomes today (Kuala Lumpur) and the full fee is debited at once. "First" means the organization is on `payg` now, including one that fell back after an unpaid period.
  2. Nothing starts on a short wallet: `choose_plan` answers `wallet_short` with the amount needed and the balance, and no plan row, period or grace is created. A first pick never starts unpaid in grace.
  3. A change between paid plans, or down to `payg`, still waits for the next period. A renewal or such a change on a short wallet still starts `unpaid` with the plan's grace (unchanged).
- **What else changed.** A credited top-up retries an unpaid plan fee in the same transaction (a failure there never undoes the credit; it is audited as `billing.plan_retry_failed`). The engine visits the organizations due every hour (`app_private.plan_orgs_due`: no period covering now, or an unpaid one) and charges each with `charge_plan_period` in its own transaction with a one-second lock timeout, at most 25 per tick with the rest carried to the next ticks; a failed organization or a failed list logs `PLAN_CHARGE_RUN_FAILED` with the ok and failed counts only and retries after five minutes. `charge_due_plans` stays for manual use. An organization with no plan is still refused on the phone and gets no WhatsApp agent replies until its owner picks a plan, which is now possible in the app.
- **Review defects and fixes (same day).**
  1. *A late clock created a backdated period with a second fee.* A caller whose clock was a little behind a first pick (a transaction that began before Kuala Lumpur midnight) made `charge_plan_period` create the period before the new monthly date, with its own fee. Fix: no period is ever created before `anchor_date`; an earlier time is treated as that day's midnight. A paid plan waiting on a `payg` row (left by the earlier rule) now starts only when the wallet holds the fee and is dropped otherwise (`billing.plan_start_skipped`).
  2. *The hourly run held every wallet lock in one transaction.* The engine wrapped `charge_due_plans` in a single transaction, so each organization's wallet lock stayed held until the end of the run and every charge used the run's starting clock. Fix: one short transaction per organization, as above.
- **Known limits.**
  - A call answered earlier the same day as a first pick but billed after it can draw from the new allowance.
  - The operator `plan` command can still start a plan unpaid in grace when no period is running.
  - Prices remain owner placeholders.
- Second review (same day): a paid plan left waiting on a pay-as-you-go row would have been started by the scheduled run on the old monthly date, with a full fee for a period that might be nearly over. The scheduled run now drops such a waiting plan in every case (audit `billing.plan_start_skipped`); the owner picks the plan and it starts that day. Hosted staging had no plan rows when this was checked (read-only query, 2026-11-16), so the first hourly pass there does nothing. Left as is: `plan_entitlements` does not apply the same late-clock rule as `charge_plan_period`, so a call start that began just before midnight and waited behind a first pick made just after it can be refused once (`NO_PHONE_ENTITLEMENT`).
