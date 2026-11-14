# Payment providers for JomCall top-ups (Malaysia)

Read on 2026-11-14 from the providers' and regulators' own pages, unless marked otherwise. "Unconfirmed" means no official page said it that day. Nothing was signed up for; no account, key or payment was made.

JomCall sells prepaid MYR credit (top-ups of roughly RM20 to RM500) to small businesses. The seller is a Malaysian Sdn Bhd or sole proprietorship ("Enterprise") registered with SSM.

## 1. Recommendation

- **Start with Billplz.** FPX costs a flat RM1.25 per payment on the free plan. FPX is usable within about a day of sign-up. Callbacks are signed with HMAC-SHA256. A sandbox exists. Sole proprietors and Sdn Bhd are both accepted.
- **Fallback: Curlec (by Razorpay).** It has a refund API that returns money to the payer's source, webhooks signed with HMAC-SHA256 over the raw body, test mode right after sign-up, and accepts SSM sole proprietors. Its FPX fee is 1.5% with a RM1 minimum, which is cheaper than Billplz below about RM83 and dearer above.
- **Not recommended now:**
  - Stripe Malaysia: FPX costs 3% + RM1, settles in up to 5 business days, has no DuitNow QR, Touch 'n Go or Boost, and sole-proprietor eligibility is unconfirmed.
  - toyyibPay: callbacks use an MD5 hash, the return URL carries no hash, and there is no refund API.
  - Fiuu and iPay88: no public price list.

The code in this branch implements Billplz behind an off-by-default switch, plus a fake provider that speaks Billplz's callback format with a local key. A Curlec client would be a second implementation of the same interface (`packages/billing/src/provider.ts`).

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

## 3. Billplz details that shaped the code

API reference: <https://support.billplz.com/api> (`billplz.com/api` redirects there).

- **Hosts.** Production `https://www.billplz.com/api/`, sandbox `https://www.billplz-sandbox.com/api/`. They are separate accounts with separate keys.
- **Authentication.** HTTP Basic, with the API Secret Key as the username and an empty password.
- **Money.** MYR only, amounts in sen ("cents").
- **Bills.** Bills are a v3 resource. v4 does not document bills.
  - Create: `POST /v3/bills` with `collection_id`, `email` or `mobile`, `name`, `amount`, `callback_url`, `description` (max 200), and optional `redirect_url`, `reference_1_label`, `reference_1`.
  - Read: `GET /v3/bills/{id}` returns `paid`, `state` (`due`, `paid`, `deleted`), `amount` and `paid_amount`.
  - Bills expire 30 days after creation.
  - No idempotency key is documented. So the code creates a bill only inside the top-up's own idempotent command.
- **Callback.**
  - `POST`, `application/x-www-form-urlencoded`, fields `id`, `collection_id`, `paid`, `state`, `amount`, `paid_amount`, `due_at`, `email`, `mobile`, `name`, `url`, `paid_at`, `x_signature`.
  - Optional `transaction_id` and `transaction_status` arrive if "Extra Payment Completion Information" is enabled.
  - A failed attempt can send `paid=false` while the bill stays payable.
  - Callback and redirect arrive in no fixed order.
  - Retries: 5 attempts in total over about 24 hours. A failed attempt lowers the account's webhook rank.
  - Billplz expects HTTP 200 within 20 seconds.
- **X Signature.**
  1. Take every field except `x_signature`.
  2. Join each key to its value with no separator. An empty value stays empty.
  3. Sort these strings, ignoring case.
  4. Join them with `|`.
  5. Compute HMAC-SHA256 with the X Signature key, as lowercase hex.

  The documentation's Security section says "sort keys", but both worked examples sort the joined strings. The difference matters, because `paid_amount…` and `paid_at…` sort before `paidtrue`. The code follows the worked examples, and both reproduce exactly:
  - Callback example: email `tester@test.com` (masked on the page, recovered from the page source), key `S-s7b4yWpp9h7rrkNM1i3Z_g`, signature `0fe0a20b…a4d00e`.
  - Redirect example: signature `4aab095f…02b47b`.

  Both are test vectors in `tests/billing/signature.test.ts`.
- **Deleted bills.** A deleted bill "reappears" if the customer completes payment, so a late paid callback must still credit.
- **Sandbox callbacks need a public URL;** localhost does not work.
- **Fees.** FPX fees come out of a prepaid Billplz Credit Balance, not out of the payment. Card and wallet fees are deducted from the payment. When the Credit Balance reaches zero, Billplz refills it from collections in RM100 steps.
- **E-wallets.** From 12 November 2026 all e-wallet payments go through DuitNow QR. It must be ticked per collection in the dashboard; there is no API setting for it.

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

1. **Approve the outbound exception.** A payment provider is not yet an approved outbound service (`AGENTS.md`). Approve Billplz (or another provider) in writing, as was done for the speech providers.
2. **Decide the selling entity.** Use a Sdn Bhd or an Enterprise. Card and e-wallet activation needs more documents; the list per entity type is in section 2 and at <https://support.billplz.com/guide/activate-payments>.
3. **Get a public HTTPS address for the web app.** Billplz cannot call localhost, so real top-ups wait for the hosted deployment (`docs/superpowers/specs/2026-11-14-production-hosting-design.md`).
4. **Open a Billplz sandbox account** at <https://www.billplz-sandbox.com> (dummy data is accepted). In Settings > Keys & Integration:
   - copy the API Secret Key;
   - tick "Enable X Signature Payment Completion" and copy the X Signature key.
   Then create a Collection and copy its ID.
5. **Paste the sandbox values** into the gitignored `.env.hosted` (never into git):
   ```
   JOMCALL_PAYMENT_PROVIDER=billplz
   BILLPLZ_ENVIRONMENT=sandbox
   BILLPLZ_API_KEY=...
   BILLPLZ_X_SIGNATURE_KEY=...
   BILLPLZ_COLLECTION_ID=...
   JOMCALL_PUBLIC_ORIGIN=https://<your hosted web address>
   ```
   The callback address Billplz is told to use is `<JOMCALL_PUBLIC_ORIGIN>/api/billing/webhook/billplz`.
6. **Run one sandbox top-up** with the test bank `BP-FKR01`. Check that:
   - the wallet is credited once;
   - a receipt appears;
   - `npm run billing:reconcile` reports it paid.
7. **Apply for the production Billplz account** with MyKad, an eKYC selfie, the SSM number, a bank account in the business's name and the TIN. FPX takes minutes to 24 business hours; card and DuitNow QR take "a few days".
8. **Fund the Billplz Credit Balance** (FPX fees are taken from it). Tick DuitNow QR on the collection.
9. **Optional:** load a Payment Order limit for refunds.
10. **Switch the values** to production with `BILLPLZ_ENVIRONMENT=production`. Then make one small real top-up and refund it with `npm run billing:admin -- refund`.
11. **Set final prices.** This is a new `billing_price` version in a new migration. Version 1 is provisional.
12. **Ask an accountant** to confirm the e-invoice exemption and the SST registration position (section 4).
