# Billing design: prepaid MYR wallet

Status: built on branch `feat/billing-wallet` (2026-11-14). It runs against a fake provider and has never touched a real one. Sub-project 5 of the main spec (§9). Research and the owner checklist: `docs/research/payment-providers-malaysia.md`.

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
- automatic top-up (FPX has no stored mandate at Billplz, Stripe or Curlec);
- SST charging;
- MyInvois submission;
- the hosted-admin web screen (operator actions are a command for now).

## 2. Data model

All tables are in schema `app`, carry `org_id` (except the platform price table), and use forced row-level security. Migrations:
- `supabase/migrations/20261114150000_billing_wallet.sql`
- `supabase/migrations/20261114150100_billing_wallet_fixes.sql`

| Table | Purpose | Writable by |
|---|---|---|
| `billing_price` | Price per usage kind and version: `unit_sen` per `per_quantity`, effective date. Rows are never edited; a new price is a new version in a new migration. | Migrations only |
| `usage_event` | One billable unit as reported: kind, quantity, idempotency key, price used, amount in sen, when it happened. Unique on `(org_id, idempotency_key)`. | `app_private.record_usage` |
| `wallet_ledger` | Every money movement: `topup`, `trial_credit`, `usage`, `refund`, `adjustment`. `amount_sen` is an integer, signed by kind (checks). Currency check is `MYR`. Unique idempotency key per organization; at most one ledger row per usage event and per top-up; one trial per organization and per claiming user. | Billing functions only |
| `billing_topup` | A top-up's life: `created`, `pending`, `paid`, `failed`, `expired`, `review`. Holds the provider reference and checkout URL. Amount RM10 to RM5,000. | Billing functions only |
| `billing_provider_event` | One row per provider result (callback or reconciliation). Unique `(provider, event_key)` makes a replay a no-op. No payer details. | `settle_topup` |
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

## 5. Top-up flow

1. **Owner or admin picks an amount** (RM20, RM50, RM100 or RM200 on screen). `POST /api/v1/billing/topups` runs as an idempotent command:
   - `create_topup` makes the top-up;
   - the provider creates a bill;
   - `attach_topup` stores the bill ID and checkout URL;
   - the browser goes to the checkout URL.

   If the provider call fails, the transaction rolls back and nothing is stored or charged.
2. **Provider calls back** to `POST /api/billing/webhook/<provider>`. The route sits outside `/api/v1`, so it has no cookie, CSRF or session check; the signature is the only authority. The route:
   - answers 404 unless that provider is configured;
   - caps the body at 16 KiB;
   - requires `application/x-www-form-urlencoded`;
   - refuses unknown or repeated fields;
   - verifies the HMAC-SHA256 X Signature with `timingSafeEqual` before reading anything;
   - calls `settle_topup`.
3. **`settle_topup` decides once, under a per-wallet lock:**
   - **No matching top-up yet** (callback before attach): stored under a unique `unmatched:` key, so the provider's retry still settles.
   - **Event key already seen:** `duplicate`, no change. The key is bill ID + paid state + transaction ID, so a failed attempt followed by a paid one is two events.
   - **Currency not MYR, or paid amount differs from the stored amount:** the top-up goes to `review`, an audit row is written, nothing is credited. A later correct callback does not auto-credit a top-up under review. An operator decides.
   - **Paid:** state becomes `paid`, one `topup` ledger row (unique per top-up), one receipt, one audit row. A paid result after `failed` or `expired` still credits, because Billplz bills stay payable and deleted bills "reappear" when paid.
   - **Unpaid:** `pending` becomes `failed` (soft). It changes nothing if already paid.
4. **The browser returns** to `/app/billing?topup=<id>`. Redirect parameters are not trusted; the screen polls the wallet.

**Reconciliation.**
- "Check status" on a top-up, or `npm run billing:reconcile` for all recent ones, asks the provider through `getPayment`.
- Only a paid answer is applied, through the same `settle_topup`, so it credits at most once.
- `billing:reconcile` also expires unpaid top-ups older than 24 hours.
- Only top-ups from the last 24 hours count toward the five-pending limit.

**Refunds.**
- `npm run billing:admin -- refund` records a refund ledger row against a paid top-up.
- It needs a reason and the operator's name.
- It cannot exceed the top-up's unrefunded amount or the current balance; spent credit is not refundable.
- Moving the money happens at the provider. Billplz has no refund API; it uses a Payment Order to the payer's bank account.

**Adjustments.** `npm run billing:admin -- adjust` adds a signed adjustment with a reason, the operator's name and an audit row. Both operator functions are granted to no application role.

## 6. Provider interface

`packages/billing/src/provider.ts`: `createCheckout`, `getPayment`, `parseCallback`.

- **Billplz** (`billplz.ts`):
  - v3 bills;
  - Basic auth with the API key;
  - amounts in sen;
  - 10-second timeout, no redirects;
  - checks that the returned URL is on a Billplz host and the amount matches.

  It is written from the API reference and has never been run against Billplz.
- **Fake** (`fake.ts`):
  - keeps bills in memory;
  - its checkout URL returns to the local wallet page;
  - signs callbacks in Billplz's exact format with a fixed local key.

  So tests and `npm run billing:simulate` exercise the production parser and signature check.

**Switch.** `JOMCALL_PAYMENT_PROVIDER` takes these values:
- `disabled` (default): the wallet screen shows "Not connected" and top-up is refused with `PAYMENTS_NOT_CONNECTED`. Balance, usage and trial credit still work.
- `fake`: allowed only when `JOMCALL_MODE=local`.
- `billplz`: needs `BILLPLZ_API_KEY`, `BILLPLZ_X_SIGNATURE_KEY`, `BILLPLZ_COLLECTION_ID` and an `https` `JOMCALL_PUBLIC_ORIGIN`. `BILLPLZ_ENVIRONMENT` is `sandbox` (default) or `production`.

Settings are read from the gitignored `.env.payments`, which `scripts/billing/with-payment-env.mjs` loads for `dev:local` and `start:local` (only the six payment names; model and speech keys never reach the web process). `npm run dev:local:fake-payments` starts the web app with the fake provider. `paymentReadiness` reports the state without a network call. Bootstrap's `capabilities.payments` follows it. The mock preview (port 4181) is unchanged and imports none of this.

## 7. Roles, audit, privacy

- **Billing access.** Only owner and admin read billing or pay. Staff get 403 from the API and zero rows from the tables. Other organizations get 404 and zero rows.
- **Audit actions:** `billing.trial_claimed`, `billing.topup_created`, `billing.topup_paid`, `billing.topup_mismatch`, `billing.adjusted`, `billing.refunded`. Operator actions record the operator's name and reason.
- **What goes to the provider:** the organization name, the signed-in owner's email and the amount. It goes only when the switch is on.
- **What is never stored:** card numbers, bank accounts, payer names from callbacks.

## 8. Receipts and invoices

- One receipt per paid top-up, downloadable from the wallet screen as text.
- It is marked as a payment receipt, not a tax invoice, with service tax RM0.00.
- Tax situation: below RM3 million turnover JomCall is exempt from e-invoicing, and ordinary receipts serve as proof. Below RM500,000 of taxable services there is no service tax registration. Both must be confirmed by an accountant.
- `tax_sen` and `einvoice_state` exist, so adding SST or MyInvois later is a job plus a receipt layout change.

## 9. Decisions (marked as my call; the owner may overrule)

1. **Provider:** Billplz first, Curlec as fallback. Section 1 of the research note gives the reasons.
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
11. **Billplz callback event keys** include the transaction ID, which requires "Extra Payment Completion Information" to be enabled. Without it, `paid_at` is used. Both are covered.

## 10. Stubbed until a merchant account exists

- Every real payment. The Billplz client has never sent a request.
- Callback delivery from the internet: this needs the hosted deployment and a public HTTPS address. The webhook route runs in `local` and `hosted` mode (`requireApp()`); hosted mode uses `APP_ORIGIN` as the callback address unless `JOMCALL_PUBLIC_ORIGIN` is set.
- Refund money movement (Billplz Payment Order) and its callback.
- Card saving and automatic top-up.
- SST and e-invoice submission.

## 11. Known limits

- The shared local database records migration versions `20261114150000` and `20261114150100`. A checkout without these files gets "remote migration versions not found" from `supabase db push`. WhatsApp's `20261114120000` and `20261114120100` sort earlier; on a database where billing was applied first, pushing them needs `--include-all`.

- The webhook has no rate limit of its own. A forged callback costs one HMAC check and is refused before any database read.
- The migration-check command creates `jomcall_billing` as a cluster-wide role. Run `npm run db:migrate:local` before `npm run db:verify-migrations` on a database where this migration is not yet applied. Otherwise the push fails with `permission denied to grant role "jomcall_billing"`; drop the stray role first.
- Fake bills live in the web process's memory. After a restart, "Check status" on a fake top-up reports unpaid; the simulator still settles it.
