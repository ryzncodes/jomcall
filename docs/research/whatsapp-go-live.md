# WhatsApp go-live requirements for JomCall

Date: 2026-11-14. Status: research, for the owner. Nothing here has been tried against Meta.

## How to read this

- Every fact gives its source page. All pages were read on 2026-11-14.
- Meta moved its developer documentation from `developers.facebook.com/docs/whatsapp/...` to `developers.facebook.com/documentation/business-messaging/whatsapp/...`. Below, **DOCS** stands for `https://developers.facebook.com/documentation/business-messaging/whatsapp`.
- Most pages were read through a tool that summarises pages, so short quotes are as relayed. Re-read the page before relying on exact wording, especially for legal or billing questions.
- **UNCONFIRMED** means no official page confirmed the point. **THIRD-PARTY** means the source is not Meta or a Malaysian government body.
- Section 11 lists every open point in one place.

## 1. Short answer

1. **Business verification.** Verify the JomCall company with Meta. Meta says a decision "may take up to 14 working days".
2. **Tech Provider.** Register JomCall as a Tech Provider: a Meta app, two screen recordings, then App Review for two permissions. Meta says App Review averages about 24 hours.
3. **Embedded Signup.** Each Malaysian SME connects its own number through Embedded Signup, inside JomCall. The SME pays Meta directly for messages.
4. **Before the first real customer.** Do these in parallel with the steps above:
   - write the PDPA notice in BM and English;
   - sign processor terms with Meta and the model provider;
   - create one approved "please reply" utility template per language.

The code in this repository already covers receiving, replying, consent, do-not-contact, the 24-hour window and disclosure (see the design document). What remains is accounts, approvals and keys.

## 2. What a Malaysian company needs

### 2.1 Meta Business verification

- **Where.** A business portfolio admin starts it in Meta Business Suite, Security Centre, "Start verification". It is "required to access certain advertising, developer, billing and spending features". (https://www.facebook.com/business/help/2058515294227817)
- **Steps:**
  - Enter the legal name, address, phone and website. The website must use HTTPS and must load.
  - Upload documents if Meta finds no matching record.
  - Confirm the link to the business by email, phone, SMS, WhatsApp or domain check (DNS or meta tag). (same page)
- **Time.** "A decision on your verification submission may take up to 14 working days." Editing the business details later means verifying again. (same page)
- **Accepted documents:** (https://www.facebook.com/business/help/159334372093366)
  - certificate or articles of incorporation;
  - business registration or licence;
  - government business tax document (self-filed documents are not accepted);
  - business bank statement;
  - utility bill, for address or phone only.
- Documents must be current. Malay ("Malaysian"), English and Mandarin are accepted languages. (same page)
- **SSM.** No Meta page names Malaysia's SSM. An SSM registration document should count as a "business registration document" (UNCONFIRMED). Have it, plus a bank statement in the same legal name, ready.
- **Tech Providers.** "Your business must be verified before you can start the app review process." (DOCS/solution-providers/get-started-for-tech-providers.md)

### 2.2 WhatsApp Business Account (WABA), limits and quality

- **Account model.** Meta is splitting the WABA into a "WhatsApp account" and a "Messaging account". Existing `waba_id` values stay the same and now identify the Messaging account. (DOCS/embedded-signup/overview.md)
- **Messaging limits** are per business portfolio and shared by all its numbers. They count unique users messaged outside a customer-service window in a moving 24 hours. (DOCS/messaging-limits.md)
  - The tiers are 250, then 2,000, 10,000, 100,000 and unlimited. The old 1,000 tier is gone.
  - A portfolio reaches 2,000 in one of three ways:
    - business verification;
    - verification by a partner;
    - 2,000 delivered template messages to unique users in 30 days, with good quality.
  - Above 2,000 the limit rises one level "within 6 hours". This needs good quality and use of at least half the current limit in the last 7 days. (same page)
  - Replies inside the 24-hour window are not described as capped. **For JomCall's inbound use, the 250 limit mostly affects missed-call text-back and reminders, not replies.**
- **Numbers per portfolio.** A portfolio is "capped at two registered business phone numbers". This rises to 20 once the portfolio is verified or reaches the 2,000 limit. (DOCS/business-phone-numbers/phone-numbers.md)
- **Template quality** is GREEN, YELLOW, RED or UNKNOWN. A RED template can still be sent but risks being paused. (DOCS/templates/template-quality.md)
- **Phone number states:**
  - The full list of number quality ratings and number statuses is UNCONFIRMED. The pages show only `GREEN`, `NA`, `UNKNOWN` and `CONNECTED`.
  - Display name states (`name_status`) are `APPROVED`, `AVAILABLE_WITHOUT_REVIEW`, `PENDING_REVIEW`, `DECLINED`, `EXPIRED` and `NONE`. (phone-numbers.md)

### 2.3 Phone numbers

- **Eligible numbers.** The business must own the number. It needs a country code and area code, and no short codes. It must be able to receive an SMS or voice call for the code. Mobile is best; SMS to a landline or VoIP number is "not recommended". (phone-numbers.md)
- **Registering.** Add the number in WhatsApp Manager and verify it. Then call `POST /<PHONE_NUMBER_ID>/register` with `messaging_product` and a 6-digit `pin`. (DOCS/business-phone-numbers/registration.md)
  - Each number allows 10 register requests per 72 hours (error 133016).
  - Numbers from Embedded Signup must be registered within 14 days. (get-started-for-solution-partners.md)
- **The PIN.** The two-step PIN is being phased out for eligible Cloud API numbers. (DOCS/business-phone-numbers/two-step-verification.md)
- **Number already on the WhatsApp Business app ("coexistence").** This matters most to SMEs: their customers already know the number.
  - **Requirements.** App version 2.24.17 or later. The onboarding must go through a Tech Provider or Solution Partner, using Embedded Signup with `featureType: whatsapp_business_app_onboarding`. (DOCS/embedded-signup/onboarding-business-app-users.md)
  - **Limits:**
    - throughput is fixed at 20 messages per second;
    - group chats do not sync and broadcast lists become read-only;
    - up to 4 companion devices.
  - **History.** Up to 180 days, synced once, within a 24-hour window.
  - **Inactivity.** The link drops after about 14 days without the phone, or 30 days without a companion device. (same page)
  - Messages the owner sends from the app do not open or extend the Cloud API window. (same page)
  - **Malaysia: UNCONFIRMED.** The page has no country list. A changelog entry on 2025-10-23 added other countries, and Malaysia was not among them.
- **Without coexistence.** The number must be deleted from the WhatsApp app first, and "your existing messaging history will be lost". (DOCS/solution-providers/migrate-existing-whatsapp-number-to-a-business-account.md)
- **Number held by another provider.** Moving it is "not supported for accounts on the new WhatsApp account model". The customer instead shares the WhatsApp account that owns the number. (DOCS/solution-providers/support/migrating-phone-numbers-among-solution-partners-via-embedded-signup.md)

### 2.4 Display name

- A display name is required when the number is registered. Review is automatic and starts when the business reaches a higher messaging limit. An edit restarts the review. (DOCS/display-names.md)
- After approval, re-register within 14 days. A name can be changed at most 10 times in 30 days. Completion arrives as the `phone_number_name_update` webhook. (same page)
- **Review time: UNCONFIRMED.** The page states none. The naming rules are in a Help Centre article that was not read.

### 2.5 How a SaaS onboards many businesses

| Option | What it takes | Who pays Meta | Fit for JomCall |
|---|---|---|---|
| **Tech Provider + Embedded Signup** (recommended) | A verified JomCall business, a Meta app with the WhatsApp use case, a privacy policy, two screen recordings (sending a message; creating a template), and App Review for Advanced access to `whatsapp_business_messaging` and `whatsapp_business_management` (DOCS/solution-providers/get-started-for-tech-providers.md) | Each SME, with its own card in WhatsApp Manager (DOCS/solution-providers/overview) | Self-serve; the SME owns its number and account |
| Solution Partner | Meta Business Partner status and a credit line. "Becoming a Solution Partner is a lengthy process." (same) | JomCall, which re-bills | Later, if ever |
| Each SME brings its own app and system-user token | The SME creates a business portfolio, an app and a system user, then pastes the token. No App Review is needed for its own use. (DOCS/solution-providers/app-review.md) | Each SME | Workable for self-hosters and a first pilot. Too hard for most SMEs. Whether a SaaS may run many customers this way is UNCONFIRMED. |

- **Embedded Signup today is v4.** v2 and v3 were deprecated on 2026-10-15. Pages for v5 exist; whether v5 is generally available is UNCONFIRMED. (DOCS/embedded-signup/overview.md; changelog)
- **How it works:**
  1. The browser calls `FB.login` with a `config_id` and `response_type: 'code'`.
  2. The returned code expires in 30 seconds.
  3. The `WA_EMBEDDED_SIGNUP` message event carries `phone_number_id`, `waba_id` and `business_id`. (DOCS/embedded-signup/implementation.md)
  4. The server exchanges the code at `GET /oauth/access_token` for a business token.
  5. The server subscribes the app with `POST /<WABA_ID>/subscribed_apps`.
  6. The server registers the number.
  7. The SME adds a payment method. (DOCS/embedded-signup/onboarding-customers-as-a-tech-provider.md)
- **Onboarding cap.** 10 new customers per rolling 7 days by default, and 200 after verification and App Review. Meta's pages conflict on whether "Access Verification" is also needed: the changelog (2025-10-03) says no, and the overview still lists it. (DOCS/embedded-signup/overview.md)
- **App Review.** It needs a written explanation and one screen recording per permission. The "average turnaround time for App Review is about 24 hours." (DOCS/solution-providers/app-review.md)

### 2.6 Access tokens

(DOCS/access-tokens.md)

- **User token.** Expires "every few hours". For testing only.
- **System user token.** Long-lived; the expiry is chosen when it is generated. It needs `business_management`, `whatsapp_business_management` and `whatsapp_business_messaging`. Use it when an SME brings its own app.
- **Business integration system user token** ("business token"). Comes from the Embedded Signup code exchange. Its expiry is not stated (UNCONFIRMED). Use it on the Tech Provider path.

## 3. Webhooks

| Point | Fact | Source |
|---|---|---|
| Handshake | Meta sends `GET` with `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`. Answer 200 with the challenge only when the token matches; otherwise answer with a non-200 status. | DOCS/webhooks/create-webhook-endpoint.md |
| Signature | `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 keyed with the **app secret** | same; https://developers.facebook.com/docs/graph-api/webhooks/getting-started |
| Signed bytes | The WhatsApp pages do not say whether the HMAC covers the raw bytes or a form with non-ASCII escaped as lowercase `\uXXXX` (a Messenger page describes the escaped form). **UNCONFIRMED.** JomCall checks both. | as above |
| Retries | Meta retries "for up to 7 days" on current pages. An older page says 36 hours. No backoff schedule is given. | DOCS/webhooks/overview.md; getting-started |
| Batching and duplicates | Up to 1,000 updates in one POST. Duplicates are possible, so dedupe by message id, and by status id plus status. | DOCS/webhooks/overview.md |
| Ordering | Not documented (**UNCONFIRMED**). JomCall assumes there is none. | — |
| Size | Payloads "up to 3 MB" | DOCS/webhooks/overview.md |
| TLS | A valid certificate is required. Optional mTLS uses Meta's client certificate, CN `client.webhooks.fbclientcerts.com`. | getting-started |
| Fields | `messages` (needs `whatsapp_business_messaging`). Template, quality and account fields need `whatsapp_business_management`. | DOCS/webhooks/overview.md |
| Subscribing an account | `POST /<WABA_ID>/subscribed_apps` with no body returns `{"success":true}` | DOCS/solution-providers/manage-webhooks/ |

**Payload shapes** (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components and its reference pages):

```json
{ "object": "whatsapp_business_account",
  "entry": [ { "id": "<WABA_ID>", "changes": [ { "field": "messages", "value": {
    "messaging_product": "whatsapp",
    "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
    "contacts": [ { "profile": { "name": "..." }, "wa_id": "...", "user_id": "<BSUID>" } ],
    "messages": [ { "from": "...", "from_user_id": "<BSUID>", "id": "wamid...", "timestamp": "1700000000",
                    "type": "text", "text": { "body": "..." } } ],
    "statuses": [ { "id": "wamid...", "status": "sent|delivered|read|failed", "timestamp": "...",
                    "recipient_id": "...", "pricing": { "billable": true, "pricing_model": "...", "category": "..." },
                    "errors": [ { "code": 131047 } ] } ] } } ] } ] }
```

- **Media.** `image`, `audio`, `document` and similar carry `id`, `mime_type`, `sha256`, plus `caption` or `filename`. Fetch the media with `GET /<MEDIA_ID>`; the returned URL is valid for **5 minutes**. Media IDs from webhooks expire after 7 days. (DOCS/business-phone-numbers/media.md)
- **Button and list replies.** `type: "interactive"` with `button_reply` or `list_reply`. Template quick replies use `type: "button"`.
- **Usernames (new).** When a customer has adopted a WhatsApp username, `wa_id` and `from` can be **absent**; only the business-scoped user ID (`user_id`, `from_user_id`) is present. A message can then be sent with `recipient` set to that ID. (https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages) JomCall currently keys contacts on phone numbers and records such messages as ignored. This is an open item in the design.

## 4. Sending, the 24-hour window and templates

- **API version.** v27.0, released 2026-11-04. (https://developers.facebook.com/docs/graph-api/changelog)
- **Send call.** `POST https://graph.facebook.com/v27.0/<PHONE_NUMBER_ID>/messages` with `Authorization: Bearer <token>`. (send-messages page)
  - Success returns `messages[0].id` (a `wamid`). This means the message was accepted, **not** delivered.
  - `message_status` can be `accepted` or `held_for_quality_assessment`, for paced templates only. (DOCS/templates/template-pacing.md)
- **Errors.** The body has `error.code`, `error.message`, `error.error_data.details` and `fbtrace_id`. Act on the code. (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)

  | Code | Meaning |
  |---|---|
  | 130429 | Throughput limit |
  | 131026 | Undeliverable |
  | 131047 | Outside the 24-hour window; send a template |
  | 131048 | Spam rate limit |
  | 131049 | Withheld to protect engagement |
  | 131050 | Customer stopped marketing messages |
  | 131056 | Pair rate limit |
  | 132000–132016 | Template errors |
  | 190 | Token expired |
  | 368 | Account restricted |

- **Customer-service window.** 24 hours from the customer's last message or call. Each new message restarts it. Inside the window, any message can be sent. Outside it, only approved templates. (send-messages page; DOCS/pricing/non-template-messages.md)
  - The free entry-point window after a Click-to-WhatsApp ad is **7 days** on the current page, not 72 hours. (DOCS/pricing.md)
- **Templates:** (DOCS/templates/overview.md)
  - Categories are MARKETING, UTILITY and AUTHENTICATION.
  - Review takes "up to 24 hours", and only APPROVED templates can be sent.
  - Names use lowercase letters, digits and underscores, up to 512 characters.
  - Pacing can hold or pause a new template; a paused template fails with 132015. (template-pacing.md)
  - The full API status list is UNCONFIRMED. APPROVED and PAUSED are confirmed; the UI also shows In review, Rejected and Disabled.
- **Language codes.** Malay `ms`. English `en`, `en_US`, `en_GB`, `en_MY`. Chinese `zh_CN`, `zh_HK`, `zh_TW`. (DOCS/templates/supported-languages.md)
- **Mark as read and typing.** `POST .../messages` with `{"messaging_product":"whatsapp","status":"read","message_id":"..."}`. Add `"typing_indicator":{"type":"text"}` to show typing for up to 25 seconds. (DOCS/messages/mark-message-as-read.md; DOCS/typing-indicators.md) Not used yet.
- **Opt-in.** It must "clearly state that a person is opting in", name the business, and follow local law. It can be collected by SMS, website, phone menu (IVR) or paper. Separate opt-in per message category is recommended. (DOCS/getting-opt-in.md; https://whatsappbusiness.com/policy/)

## 5. Pricing (model in force today)

- **Per-message pricing** since 2025-07-01. Meta charges for delivered messages by category and by the customer's country. Messages from customers are free. (DOCS/pricing.md)
- **Since 2026-10-01**, service replies and utility templates sent **inside** an open window are also charged per delivered message, at the market's utility or authentication rate. Businesses without a payment method stop delivering service messages. (DOCS/pricing/non-template-messages.md)
- One Meta page mentions 1,000 free service messages per number per month from 2026-10-01; the other does not. **UNCONFIRMED, conflicting.**
- **Volume tiers** apply to utility and authentication only, counted across the portfolio. (DOCS/pricing.md)
- **Malaysia (+60)** is its own market, and rates in MYR exist since 2026-04-01. **The official Malaysian rates were not obtained**: the rate card renders in the browser and was not read.
  - THIRD-PARTY figures: marketing about RM0.35, utility and authentication about RM0.056 per delivered message (respond.io and others).
  - Another vendor shows RM0.42 and RM0.068.
  - **Check the official rate card before setting JomCall prices.** Store amounts in sen, as reported per message.
- **Effect on JomCall.** Every reply the agent sends now costs the SME roughly one utility rate. This affects `usage_event` and wallet design (spec §6), not the code here.

## 6. Rate limits

- **Throughput.** 80 messages per second per number by default, counting inbound and outbound. It rises automatically to 1,000 at high volume. A coexistence number is fixed at 20. Over the limit returns 130429. (DOCS/throughput.md)
- **Pair limit.** Error 131056 for too many messages to one person. One Meta page gives about 1 message per 6 seconds (https://developers.facebook.com/docs/whatsapp/cloud-api/overview); not confirmed elsewhere.
- **Management API.** About 200 calls per hour per app per account, and 5,000 for active accounts. Applies to calls like `subscribed_apps` (UNCONFIRMED in general).

## 7. Meta policy on AI assistants and handoff

- **The WhatsApp Business Messaging Policy** was last updated 2026-09-23. (https://whatsappbusiness.com/policy/)
  - "You may use automation when responding during the 24-hour window."
  - Businesses must "have available prompt, clear, and direct escalation paths". The listed paths include transfer to a human agent in the chat, a phone number, email, website support, in-store support and a form. (same page)
  - The policy has **no** rule requiring disclosure of a bot. This is a reading of the summarised text; confirm by searching the page.
- **Meta Terms for WhatsApp Business Platform §4.7, "AI Providers".** Builders of general AI may not offer it where it is the "primary (rather than incidental or ancillary) functionality". Meta decides "in its sole discretion". (https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform?locale=en_US)
  - THIRD-PARTY: TechCrunch reports that Meta said the rule targets general assistants, not businesses using AI for customer service, effective 15 January 2026.
- **The same §4.7 bans training AI models on WhatsApp data.** This includes anonymised or derived data. The one exception is fine-tuning a model used only by that business. (same page) **JomCall must not train, or let a model vendor train, on chat content.** Check the model providers' data terms.
- **Our reading.** A business-specific front desk on the official API is ordinary business automation. Keep it scoped to the business, with no general-assistant mode. Keep a deterministic path to a human. JomCall does both: typing "staff", "staf" or "人工" hands off without the model.
- **Restricted businesses.** Tobacco and real-money gambling are not allowed in Malaysia. Telemedicine and health data are restricted. Never ask for full card numbers. The summarised §5 tables list Malaysia for alcohol and over-the-counter medicine; re-check the live tables. (https://whatsappbusiness.com/policy/)

## 8. Malaysian law that applies

- **PDPA 2010 (Act 709, 2026 reprint, BM).** Source: https://www.pdp.gov.my/wp-content/uploads/2026/10/Akta-709-cetakan-semula-2026-BM.pdf
  - **Consent and notice.** s6 requires consent to process, with exceptions such as performing a contract. s7(3) requires the notice "dalam bahasa kebangsaan dan bahasa Inggeris" (in Malay and English). **The business needs a BM and English privacy notice that covers WhatsApp and the AI agent.**
  - **Retention.** s10: keep data no longer than needed.
  - **Direct marketing.** s43: a person may require the business to stop at any time. JomCall treats "STOP" and "BERHENTI" as that request, records it and sends nothing more.
  - **Cross-border transfer.** s129 now has no whitelist. Transfer is allowed where the destination's law is similar or protection is adequate, or on one of the s129(3) grounds, such as consent or reasonable precautions. **Messages go to Meta (US) and to the model provider abroad.** The practical basis is consent in the notice plus processor contracts. This is the open "PDPA cross-border" owner decision.
- **2024 amendments (Act A1727).** Source: law-firm copy of the gazette text, https://christopherleeong.com/wp-content/uploads/2024/12/PDPA-Amendment-Act-A1727.pdf
  - **Obligations:**
    - data processors have their own security duty;
    - controllers and processors must appoint a Data Protection Officer;
    - breaches must be reported to the Commissioner "as soon as practicable";
    - data portability;
    - penalties of up to RM1,000,000 or 3 years.
  - **In force** on 1 April and 1 June 2025, according to THIRD-PARTY Skrine (https://www.skrine.com/insights/alerts/december-2024/amendments-to-the-personal-data-protection-act-201). The gazette order was not read.
  - **JomCall is a processor.** It needs its own DPO and a breach process.
- **Unsolicited commercial messages.** The new CMA 1998 s233A (spam) was passed in 2025. It was **not in force** as of August 2025, pending MCMC rules (THIRD-PARTY, Skrine). Its 2026 status is UNCONFIRMED.
  - The proposed rules require express consent, an opt-out in every message, sender identification and consent records. JomCall's design already meets these for templates.
  - No national Do-Not-Call registry was found. That is absence of evidence only.
- **AI disclosure.** Malaysia's AI governance guidelines (AIGE, 2024) are voluntary (THIRD-PARTY; primary text not read). The AI Governance Bill is a draft, expected to be tabled in early 2027 (THIRD-PARTY). **No binding duty exists today. JomCall discloses anyway**, once per conversation.

## 9. The unofficial self-host connector: recommendation

- **WhatsApp's Terms of Service forbid it.** (https://www.whatsapp.com/legal/terms-of-service) They bar:
  - use "through automated or other means";
  - "bulk messaging, auto-messaging";
  - software that functions "substantially the same as our Services";
  - reverse engineering.
- **WhatsApp can disable an account at any time.** A connector that emulates WhatsApp Web (for example Baileys, MIT licence; whatsmeow, MPL-2.0) is exactly this kind of use.
- **The risk falls on the SME's own phone number**, the one its customers know. No ban-rate data was found. The 2019 press reports are THIRD-PARTY. The only known lawsuit is WhatsApp v. Rockey Tech (modded apps, trademark), and its outcome was not read.
- **Licences.** MPL-2.0 is compatible with the repository's licence rule, but the terms-of-service problem stands regardless.
- **Recommendation: do not build it.** It would put SMEs' main customer lines at risk, contradict the "compliance visible" principle, and give Meta a reason to refuse JomCall's Tech Provider status.
  - If self-hosters need WhatsApp, the existing provider port lets them bring their own Cloud API app and token, the third option in §2.5.
  - Spec §8 ("Unofficial WhatsApp connector") should be changed to "not planned". This is owner decision D6 in the design.

## 10. Owner checklist

Steps can overlap where noted. Lead times are Meta's own statements unless marked.

| # | Do this | Where | Lead time | Then paste/set |
|---|---|---|---|---|
| 1 | Make sure the company website loads over HTTPS and shows the legal name. Publish a privacy policy in BM and English that covers WhatsApp, the AI agent and cross-border transfer. | Own site | Your effort | — |
| 2 | Create or confirm a Meta business portfolio in the company's legal name. | business.facebook.com | Same day | — |
| 3 | Start Business verification. Upload the SSM registration and a bank statement with the same name and address. | Business Suite, Security Centre | "up to 14 working days" | — |
| 4 | While waiting: create a Meta app with the WhatsApp use case. Add the icon, privacy policy URL and category. Use the test number Meta provides to make the two screen recordings. | developers.facebook.com | 1 day | — |
| 5 | After verification: request Advanced access to `whatsapp_business_messaging` and `whatsapp_business_management`, then submit App Review. | App Dashboard | about 24 h average; plan for re-submissions (THIRD-PARTY experience: often several days) | — |
| 6 | Create an Embedded Signup configuration (v4). Note its `config_id`. | App Dashboard, Facebook Login for Business | Same day | Later code needs `config_id` and the app ID (Embedded Signup is not built yet; see the design) |
| 7 | Set the webhook: callback `https://<jomcall host>/api/whatsapp/webhook`, plus a verify token of your choice (at least 16 characters). Subscribe the `messages` field. Needs a public HTTPS host (production hosting session). | App Dashboard, WhatsApp, Configuration | Minutes | `.env.hosted`: `WHATSAPP_VERIFY_TOKEN` (same value as the dashboard) and `WHATSAPP_APP_SECRET` (App settings, Basic) |
| 8 | Generate the credentials key with `openssl rand -hex 32`. | Terminal | Minutes | `.env.hosted`: `WHATSAPP_CREDENTIALS_KEY` (web and agent must share it) |
| 9 | Owner approval for the outbound exception, then set `JOMCALL_WHATSAPP_PROVIDER=cloud` for web and agent. | `AGENTS.md` and env files | Your decision | `.env.local` / `.env.hosted` |
| 10 | Pilot business, before Embedded Signup exists: in that business's portfolio, add and verify the number. Create a system user with the three permissions, generate a token, and note the phone number ID and WABA ID. | WhatsApp Manager, Business settings | 1 day, plus display name review (time UNCONFIRMED) | JomCall, WhatsApp, Connect: phone number ID, WABA ID, token. JomCall checks the number. Then call `POST /<WABA_ID>/subscribed_apps` once (not built yet). |
| 11 | Submit the "please reply" utility template in `ms`, `en` and `zh_CN` (wording in the design) and wait for approval. Record each one in JomCall as approved, with purpose "reengage". | WhatsApp Manager, Templates | "up to 24 hours" each | JomCall, WhatsApp, Templates |
| 12 | Add a payment method for the business. Without one, service replies stop since 2026-10-01. | WhatsApp Manager | Same day | — |
| 13 | Send one real message containing non-ASCII text (BM or Chinese) and confirm the webhook signature check passes. | Phone | Minutes | — |
| 14 | Check the official Malaysian rate card and set JomCall's pricing. | DOCS/pricing.md rate card | — | Billing design |

Expected elapsed time to the first real pilot conversation is **about 3 weeks**, dominated by business verification (up to 14 working days) plus App Review. A pilot under step 10 does not need App Review, because the business uses its own app and token. It still needs a public HTTPS host and the owner's approval of the outbound exception.

## 11. Not confirmed

1. Malaysian rates (official), and the 1,000-free-service-messages conflict.
2. Coexistence support in Malaysia.
3. Display name review time and naming rules.
4. Business token expiry.
5. Access Verification still needed for 200 per week.
6. Whether Embedded Signup v5 is generally available.
7. Bytes covered by the webhook signature (raw or escaped).
8. Retry duration (7 days or 36 hours); ordering.
9. The full template status enum; the number status and quality enums; the pair rate limit value.
10. Whether a SaaS may run many SMEs through their own apps.
11. SSM explicitly accepted; Malaysia on the alcohol and over-the-counter lists in policy §5.
12. Gazette commencement of A1727; whether CMA s233A is in force; AIGE text.
13. WhatsApp's own FAQ on unofficial apps; the outcome of the Rockey Tech case.
