# Payment providers for JomCall top-ups (Malaysia)

Read on 2026-11-14 from the providers' and regulators' own pages, unless marked otherwise. "Unconfirmed" means no official page said it that day. Nothing was signed up for; no account, key or payment was made.

JomCall sells prepaid MYR credit (top-ups of roughly RM20 to RM500) to small businesses. The seller is a Malaysian Sdn Bhd or sole proprietorship ("Enterprise") registered with SSM.

## 1. Decision: the owner chose Curlec (2026-11-14)

- **Curlec (Razorpay Curlec) is the provider the product is built for.** The owner chose it on 2026-11-14. The owner already runs a working Curlec integration in another product (Jomjual), which this branch reuses as a reference (see the design, section 5).
- My earlier recommendation was Billplz (flat RM1.25 FPX fee, next-day settlement). The Billplz client was removed when Curlec was chosen; the comparison below is kept for the record.
- **Why Curlec fits:** a refund API that returns money to the payer's source; webhooks signed with HMAC-SHA256 over the raw body; test mode with separate keys from sign-up; SSM sole proprietors accepted; an idempotency header on refunds.
- **What does not fit a prepaid wallet well (raise with Curlec before applying):**
  - Curlec's Terms list as prohibited credits that can be "converted to physical or digital goods or services". A wallet spent on JomCall call minutes arguably matches. The same list names merchants in intangible goods and services, and gives "web-based telephony" as an example of a business whose legality is "not absolutely clear". Get Curlec's written confirmation that a SaaS prepaid usage wallet for an AI phone answering service is acceptable. Source: <https://curlec.com/s/terms-of-use/> (read 2026-11-14).
  - FPX costs 1.5% with a RM1 minimum, so a RM20 top-up pays 5% in fees.
  - Each refund costs RM0.50, is paid from the Curlec balance, and the original fee is not returned.
  - DuitNow QR needs Curlec's approval and has no test mode.
- **Not recommended:** Stripe Malaysia (FPX 3% + RM1, up to T+5, no DuitNow, Touch 'n Go or Boost); toyyibPay (MD5 callbacks, no refund API); Fiuu and iPay88 (no public price list).

## 2. Comparison

| | Billplz | Curlec | Stripe MY | toyyibPay | CHIP | Fiuu | iPay88 |
|---|---|---|---|---|---|---|---|
| FPX fee | RM1.25 (Basic, free); RM0.75 (Standard, RM999/yr) | 1.5%, min RM1 (Basic); 1.0% (Premium, RM999 setup) | 3% + RM1.00 | RM1.00 (Standard) | RM1.00 | Not public | Not public |
| Card fee, MYR | 1.8% (Basic); 1.5% (Standard) | 2.4% (Basic); 2.0% (Premium) | 3% + RM1.00 | 1.5%, plus RM100 onboarding and RM100/yr | Credit 2.0%, debit 1.0% | Not public | Not public |
| DuitNow QR / e-wallet | 1.5% | DuitNow Pay 1.2%; TNG/Boost/GrabPay 1.5% | GrabPay 3%; no DuitNow, TNG or Boost seen | 1.00% or RM1.00 | DuitNow 1.0%; e-wallets 1.4% | Not public | Not public |
| SST on provider fees | 8% stated | Page prints "18% GST", likely a template error; unconfirmed | Unconfirmed | Unconfirmed | 8% stated | Unconfirmed | Unconfirmed |
| FPX settlement | Next business day | T+2 working days | Up to T+5 | 1 to 4 business days (pricing page) | Next day | Unconfirmed | Unconfirmed |
| Refunds | No refund API; return money by Payment Order (RM1.25 per transfer, needs payer's bank account) | API and dashboard, to source, within 6 months | API, within 180 days | None documented | Unconfirmed | Refund API, up to 180 days | Unconfirmed |
| Saved payment | Card only ("Auto-Deduct"); no FPX mandate | Cards and TNG; no FPX mandate | Cards; FPX recurring not supported | None | Card recurring | Card tokens; direct debit listed | "Recurring Payment" listed |
| Callback signature | HMAC-SHA256, X Signature key | HMAC-SHA256 over raw body (`X-Razorpay-Signature`) | HMAC-SHA256 over `t.body` (`Stripe-Signature`) | MD5 of secret + fields | Unconfirmed | MD5-based `skey` | Unconfirmed |
| Sandbox | Yes, separate account | Test mode with separate keys | Test mode | Yes, dev.toyyibpay.com | Unconfirmed | Yes | Unconfirmed |
| Sole proprietor | Yes | Yes (SSM) | Unconfirmed | Unconfirmed | Unconfirmed | Unconfirmed | Unconfirmed |
| Approval time | FPX: minutes to 24 business hours; card and e-wallet: "a few days" | Unconfirmed | Unconfirmed | Unconfirmed | Unconfirmed | Within a week (non-card); about a month (card) | Unconfirmed |

Fee for one top-up, FPX, before SST on the fee:

| Top-up | Billplz Basic | Curlec Basic | Stripe | CHIP / toyyibPay |
|---|---|---|---|---|
| RM20 | RM1.25 (6.3%) | RM1.00 (5.0%) | RM1.60 (8.0%) | RM1.00 (5.0%) |
| RM50 | RM1.25 (2.5%) | RM1.00 (2.0%) | RM2.50 (5.0%) | RM1.00 (2.0%) |
| RM100 | RM1.25 (1.3%) | RM1.50 (1.5%) | RM4.00 (4.0%) | RM1.00 (1.0%) |
| RM500 | RM1.25 (0.3%) | RM7.50 (1.5%) | RM16.00 (3.2%) | RM1.00 (0.2%) |

CHIP is cheapest on FPX, but its refund, signature and onboarding terms were not checked today. It is worth one sales question before choosing the fallback.

Sources:
- Billplz: <https://main.billplz.com/pricing>, <https://support.billplz.com/guide/pricing>, <https://support.billplz.com/guide/settlement-schedule>, <https://support.billplz.com/guide/issue-a-refund>, <https://support.billplz.com/guide/auto-deduct>, <https://support.billplz.com/guide/activate-payments>, <https://support.billplz.com/guide/understanding-verification>, <https://support.billplz.com/guide/create-account>
- Curlec: <https://curlec.com/pricing/>, <https://curlec.com/docs/payments/settlements.md>, <https://curlec.com/docs/payments/business-types-kyc-documents.md>, <https://curlec.com/docs/payments/refunds.md>, <https://curlec.com/docs/webhooks/validate-test.md>, <https://curlec.com/docs/payments/subscriptions/supported-payment-methods.md>
- Stripe: <https://stripe.com/en-my/pricing>, <https://docs.stripe.com/payments/fpx>, <https://docs.stripe.com/payouts>, <https://docs.stripe.com/webhooks>, <https://docs.stripe.com/currencies>
- toyyibPay: <https://www.toyyibpay.com/pricing-plans/>, <https://toyyibpay.com/apireference/>
- CHIP: <https://www.chip-in.asia/pricing>
- Fiuu: <https://fiuu.com/faq/>, <https://booster.fiuu.com/>, <https://fiuu.com/recurring-payment/>
- iPay88: `ipay88.com` now redirects to <https://my.nttdatapay.com/en/payment-services/adaptis-e-commerce>; no prices published.
- Also seen, not compared: HitPay (FPX 1.8% + RM0.40, <https://hitpayapp.com/my/pricing>) and senangPay (from RM199 a year, FPX RM1 or 1.5% whichever is higher, <https://senangpay.com/pricing/>).

## 3. Curlec details that shaped the code

All from Curlec's documentation (pages fetched as Markdown from `curlec.com/docs/...md`), read 2026-11-14. Behaviours taken from the owner's Jomjual integration are marked **(Jomjual)**.

- **Host and keys.** API base `https://api.razorpay.com/v1/` in both test and live mode; only the keys differ. HTTP Basic with `key_id:key_secret`. <https://curlec.com/docs/api/sandbox-setup.md>, <https://curlec.com/docs/api/authentication.md>
  - Test and live keys are separate sets; only the Key Id is shown again after generation; one key pair per merchant id; only Owner or Admin can see them. <https://curlec.com/docs/payments/dashboard/account-settings/api-keys.md>
  - Key prefixes (`rzp_test_`, `rzp_live_`) are not stated on Curlec's pages. **(Jomjual)** live keys on Curlec use `rzp_live_`. The code refuses a key whose prefix contradicts `CURLEC_ENVIRONMENT` and accepts any other format.
  - Live keys need a verified website, which Curlec says takes up to 3 working days. Test mode needs no website.
- **Orders.** `POST /v1/orders` with `amount` in sen, `currency` `MYR`, `receipt` (at most 40 characters, unique, "treated as an idempotency key") and `notes` (at most 15 pairs of 256 characters). Minimum RM1.00. Statuses `created`, `attempted`, `paid`; a paid order takes no further payments. `GET /v1/orders/:id/payments` lists failed and captured attempts. <https://curlec.com/docs/api/orders/create.md>, <https://curlec.com/docs/api/orders/entity.md>, <https://curlec.com/docs/api/orders/fetch-payments.md>
  - The code sends the top-up id as `receipt` and in `notes`, and checks that the returned order amount equals the top-up. **(Jomjual)** amounts can come back as strings; the code accepts numeric strings.
  - Order expiry is not documented.
- **Payments.** Statuses `created`, `authorized`, `captured`, `refunded`, `failed`. Auto-capture is the default (Account & Settings → Payments Capture). An authorized payment not captured within the timeout is auto-refunded. <https://curlec.com/docs/api/payments/entity.md>, <https://curlec.com/docs/payments/payments/capture-settings.md>
  - **Late authorisation:** a payment marked `failed` after 10 minutes can become authorized and captured up to 3 days later (fewer than 0.5% of payments). The ledger therefore credits a capture that arrives after a failure, and reconciliation re-checks failed top-ups for 7 days. <https://curlec.com/docs/payments/payments/late-authorisation.md>
  - A duplicate payment on an order already `paid` is auto-refunded by Curlec. <https://curlec.com/docs/payments/refunds/auto-refunds.md> The code never credits a second payment on one order and audits it.
- **Checkout.** Standard Checkout, `https://checkout.razorpay.com/v1/checkout.js`, options `key`, `amount` (sen), `currency`, `name`, `order_id`, `description`, `prefill`. **`callback_url` and `redirect: true` are mandatory for FPX**, and the callback domain must be allow-listed. Curlec posts `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` to the callback after a successful authorisation only. <https://curlec.com/docs/payments/payment-gateway/web-integration/standard/integration-steps.md>
  - Return signature: HMAC-SHA256 hex of `order_id|razorpay_payment_id` with the API **key secret**, with `order_id` taken from your own server. The code checks it, then fetches the order's payments with its own keys and credits only a captured payment of the exact amount. **(Jomjual)** a valid signature alone is not proof of a captured payment of the right amount.
  - Another Curlec page says the callback is for WebView and redirect flows and to rely on webhooks for confirmation. The code treats the return as a convenience; the webhook and reconciliation are the source of truth. <https://curlec.com/docs/webhooks.md>
- **Webhooks.** Header `X-Razorpay-Signature`: HMAC-SHA256 hex of the raw request body with the webhook secret (chosen when the webhook is created; different from the key secret). Delivery is at least once and in no fixed order; `x-razorpay-event-id` identifies an event. Answer 2xx within 5 seconds; failures are retried for 24 hours, after which the webhook is disabled. Ports 80 and 443 only; localhost is rejected. <https://curlec.com/docs/webhooks/validate-test.md>, <https://curlec.com/docs/webhooks/setup-edit-payments.md>
  - Curlec's own Node sample re-serializes a parsed body before checking, which contradicts its raw-body rule; the code verifies the bytes as received.
  - Events handled: `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`. Others answer 200 and are ignored. **(Jomjual)** the same set, with `order.paid` added here because it carries the same payment.
  - Exactly once does not rely on the event id: the key is the payment id and state (`pay:<id>:captured`), so `payment.captured`, `order.paid` and reconciliation of the same payment collapse to one ledger row. **(Jomjual)** dedupe on server-owned ids, not on notes.
- **Refunds.** `POST /v1/payments/:id/refund` with `amount`, `speed` (`normal`), `receipt`, `notes`; header `X-Refund-Idempotency` (at least 10 characters). Only captured payments; paid from the Curlec balance; minimum RM1.00; statuses `pending`, `processed`, `failed`; cannot be cancelled. RM0.50 per refund, original fee not returned. Time to customer: FPX and e-wallets 0 to 3 days, cards 5 to 10 days. <https://curlec.com/docs/api/refunds/create-normal.md>, <https://curlec.com/docs/api/refunds/normal-refunds-idempotent.md>, <https://curlec.com/docs/payments/refunds/normal.md>
  - The wallet is debited when a refund is `processed`, once per Curlec refund id, whether it came from the operator command or the Curlec dashboard. **(Jomjual)** e-wallet refunds often come back `pending`; the webhook finishes them.
- **Methods (Malaysia).** Cards (Visa, Mastercard; Amex not listed), FPX, e-wallets (Touch 'n Go, Boost, GrabPay, MCash), Apple Pay. DuitNow QR needs approval and has no test mode. <https://curlec.com/docs/payments/payment-methods.md>, <https://curlec.com/docs/payments/payment-methods/wallets.md>, <https://curlec.com/docs/payments/payment-methods/duitnow/qr.md>
- **Fees (Basic, RM0 setup).** Cards 2.40%, foreign cards 3.30%, FPX 1.50% or RM1 whichever is greater, DuitNow Pay 1.20% or RM0.30, e-wallets 1.50%. Premium (RM999 setup): cards 2.00%, FPX 1.00% or RM1. No annual fee. The page says "18% GST", which looks copied from India; the Terms say Curlec issues an SST invoice. <https://curlec.com/pricing/>, <https://curlec.com/s/terms-of-use/>
- **Settlement.** T+2 working days in MYR; can vary by business risk. No standing reserve stated; the Terms allow withholding after termination. <https://curlec.com/docs/payments/settlements.md>
- **Onboarding (SSM sole proprietorship).** Business type "Proprietorship"; SSM registration number (Curlec fetches the SSM profile from CTOS); category; addresses; bank account; first page of the latest bank statement. A personal bank account needs Curlec's authorisation letter. Website pages required: About us, Contact us, Pricing, Terms and conditions, Privacy policy, Refund policy, plus a sample invoice and test login if paying needs a login. An account is capped at RM30,000 before full activation. Approval time is not stated. <https://curlec.com/docs/payments/set-up.md>, <https://curlec.com/docs/payments/business-types-kyc-documents.md>, <https://curlec.com/docs/payments/dashboard/account-settings/business-website-details.md>

## 4. Tax and invoices

These are summaries of official guidance, not tax advice. The owner should confirm them with an accountant.

- **E-invoice (LHDN MyInvois).**
  - Taxpayers with annual turnover or revenue below RM3,000,000 are exempt (e-Invoice Guideline v4.8, 1.6.1(e), <https://www.hasil.gov.my/wp-content/uploads/IRBM-e-Invoice-Guideline.pdf>; General FAQ Q15 to Q16, <https://www.hasil.gov.my/wp-content/uploads/lhdnm-e-invoice-general-faqs.pdf>).
  - The exemption is lost if a related company or shareholder company has turnover of at least RM3,000,000 (Guideline 1.6.10). For a sole proprietor, all businesses under the owner's name are added together.
  - An exempt supplier issues ordinary receipts. Buyers may use these as proof of expense (Guideline 1.6.2). A buyer cannot require an e-invoice from an exempt supplier (FAQ Q107).
  - Once JomCall is no longer exempt:
    - A consolidated monthly e-invoice is allowed for buyers who do not ask for one, except for single transactions above RM10,000 (Specific Guideline Table 3.6, <https://www.hasil.gov.my/wp-content/uploads/IRBM-e-Invoice-Specific-Guideline.pdf>).
    - "Credit reload" is covered by FAQ Q71 to Q74. Refundable prepaid value needs an e-invoice when it is used, not when it is sold; non-refundable value needs one when it is sold. Treating a JomCall top-up as "credit reload" is our reading, not an LHDN statement.
- **Service tax (SST).**
  - The rate is 8% for taxable services other than the 6% group (<https://mysst.customs.gov.my/faq-services-tax/>).
  - IT and digital services are Group G. Registration is required when taxable services exceed RM500,000 in 12 months (Guide on Information Technology Services V7, 26 February 2026, linked from <https://mysst.customs.gov.my/industry-guides/>). Below that, registration is voluntary.
  - Tax is accounted on a payment basis.
  - Whether an unregistered business must not charge service tax was not read on an official page today; that is the usual rule.
  - No official statement on prepaid credit was found.
  - The foreign-provider digital services regime applies to foreign providers, not to a Malaysian company.
  - A rate amendment order dated 17 March 2026 is listed on <https://mysst.customs.gov.my/> but was not read. Check it before charging tax.
- **What the code does.**
  - A receipt is issued for each paid top-up, with number `JC-<year>-<n>`, tax 0 and e-invoice state `not_submitted`.
  - The receipt screen says it is a receipt, not a tax invoice.
  - Adding SST or MyInvois submission later is a column change and one job, not a redesign.

## 5. Pricing check against measured cost

Assumptions (labelled because they are not measured here):
- USD 1 = RM4.25. This is the rate implied by `docs/research/phone-line-options.md`.
- Server, database and support costs are excluded.
- Speech and model fees are about USD 0.013 per spoken minute (`docs/qa/2026-11-14-voice-milestone-a.md`), which is about RM0.055.
- Inbound telephony per minute comes from `docs/research/phone-line-options.md`:
  - Plivo: USD 0.015, about RM0.064.
  - Twilio: USD 0.0278, about RM0.118.
  - Local SIP providers (SIPPALS, INVITE): inbound not published; BeONE states inbound free.

The only public price today is the pricing page: RM0.32 per voice minute and 5 sen per message (`web/components/public-pages.tsx`). There are no plans, only usage. This branch's price table version 1 keeps RM0.32 per minute. It meters WhatsApp per conversation at 15 sen and typed turns at 2 sen. Those two figures are placeholders for the owner, because Meta's current Malaysian conversation price and the per-turn model cost were not measured here.

Margin per voice minute at RM0.32:

| Line | Cost per minute | Margin per minute | Margin |
|---|---|---|---|
| Local SIP, free inbound | RM0.055 | RM0.265 | 83% |
| Plivo | RM0.119 | RM0.201 | 63% |
| Twilio | RM0.173 | RM0.147 | 46% |

Payment fees reduce this further, per top-up (Billplz FPX RM1.25 + 8% SST = RM1.35):

| Top-up | Fee | Share of top-up | Margin left on Plivo minutes |
|---|---|---|---|
| RM20 | RM1.35 | 6.8% | about 56% |
| RM50 | RM1.35 | 2.7% | about 60% |
| RM100 | RM1.35 | 1.4% | about 62% |

- **The number itself is not covered by per-minute pricing.** A Malaysian number costs RM10 to RM49 a month locally, or about RM17 on Plivo or Twilio. A business taking 300 minutes a month pays RM96 in usage, so a RM17 number takes 18% of that revenue. A business taking 30 minutes pays RM9.60 and loses money on the number.
- **Recommendation:** add a monthly number fee (or a monthly minimum) when numbers go live. Set the minimum top-up at RM20 (the code's limit is RM10 to RM5,000; the screen offers RM20, RM50, RM100 and RM200).
- **What the cost figures leave out.** The voice cost comes from one measured run. Long calls with tool use cost more model tokens. Re-check after the first real calls.

## 6. Owner checklist, in order

The hosted steps, with where each key goes, are in `infra/hosted/RUNBOOK.md` section D.

1. **Ask Curlec in writing** whether a prepaid usage wallet for an AI phone answering SaaS is acceptable under its prohibited list (credits, intangible services, web-based telephony; section 1).
2. **Approve Curlec as an outbound service.** A payment provider is not yet an approved outbound service (`AGENTS.md`).
3. **Publish the website pages Curlec checks:** About us, Contact us, Pricing, Terms and conditions, Privacy policy, Refund policy; prepare a sample receipt.
4. **Sign up at Curlec** as Digitalize Plus Enterprise: business type Proprietorship, SSM number, category, address, a bank account in the business's name and the first page of its latest statement.
5. **Test mode:** generate test keys (Account & Settings → API Keys) and create a test webhook (Account & Settings → Webhooks) at `https://<staging host>/api/billing/webhook/curlec` with events `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, and a secret you choose. Allow-list the staging domain for the checkout callback.
6. **Put the test values** in the staging environment (Vercel) or, for a local check, the gitignored `.env.payments`: `JOMCALL_PAYMENT_PROVIDER=curlec`, `CURLEC_ENVIRONMENT=test`, `CURLEC_KEY_ID`, `CURLEC_KEY_SECRET`, `CURLEC_WEBHOOK_SECRET`, and `JOMCALL_PUBLIC_ORIGIN` unless hosted mode's `APP_ORIGIN` applies.
7. **One test top-up** with a mock FPX bank: the wallet is credited once, a receipt appears, `npm run billing:reconcile` reports it; then refund part of it with `npm run billing:admin -- refund` and check the wallet is debited once.
8. **Activate live mode;** wait for website verification (up to 3 working days); generate live keys and a live webhook; set `CURLEC_ENVIRONMENT=live`.
9. **One small real top-up,** then refund it.
10. **Set final prices** as a new `billing_price` version (versions 1 and 2 are owner placeholders).
11. **Ask an accountant** to confirm the e-invoice exemption and the SST position (section 4).
