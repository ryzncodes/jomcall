# Legal pages: what is settled and what is not

The public site shows a privacy notice (`/privacy`) and terms of use (`/terms`) in English and BM, and every public footer names the operator. They were written for JomCall from the product's real data flows, not copied from another company's policy.

**Neither document has been reviewed by a lawyer. A Malaysian lawyer should review both, and the business customer data processing agreement they imply, before JomCall handles real customer data.**

## Where the text lives

- Operator facts, the contact email and the effective date: `web/lib/operator.ts` (one place; change them there).
- Privacy notice, terms and footer text, both languages: `web/messages/legal.ts`. Tokens `{name}`, `{reg}`, `{address}`, `{email}` and `{date}` are filled from `operator.ts` at render.
- Rendering: `web/components/public-pages.tsx` (`OperatorDetails`, legal layout) and the home page footer in `web/components/marketing.tsx`.

## Statements that depend on something not yet settled

| # | Statement on the site | What is open |
|---|---|---|
| 1 | Privacy requests and terms questions go to `privacy@jomcall.com` | Placeholder. The mailbox is not confirmed to exist or be monitored. Change `PRIVACY_CONTACT_EMAIL`. |
| 2 | Effective date 14 November 2026 | Set to the drafting date. Update `LEGAL_EFFECTIVE_DATE` to the merge date if they differ. |
| 3 | "We keep personal data only as long as needed"; deleted records may remain in encrypted backups "for a limited time"; a retention schedule "will be published before JomCall opens to the public" | No retention periods are implemented or decided (transcripts, recordings, logs, backups). The hosting design suggests 14 to 30 days for offsite dumps. A schedule must be written and published before public launch. |
| 4 | Processor list: Deepgram, Anthropic, OpenRouter, Google, Meta, Supabase, Vercel, a Singapore server provider, Cloudflare, Curlec, phrased "use or will use" | None handles real customer data yet. Not decided: whether OpenRouter stays in production, whether Google embeddings are switched on, which server provider, Cloudflare account not created, WhatsApp Cloud API not approved (decision D1). Update the list as each goes live. |
| 5 | Personal data is transferred outside Malaysia to these providers | The PDPA section 129 cross-border position is an open owner decision: transfer impact assessments, vendor data processing addenda and the legal basis (consent, contract or due diligence) are not in place. |
| 6 | Curlec named as the "planned payment processor", "not live yet"; "We do not store card numbers" | A Curlec client exists in code (billing, PR #14) but no merchant account or live call. The owner still has to ask Curlec whether a prepaid usage wallet is acceptable. |
| 7 | No data protection officer is named | Not appointed. Check the PDPA (Amendment) Act 2024 duty to appoint one and to notify data breaches; the notice only says we will notify "those we are required to". |
| 8 | Security: encrypted connections, per-business access controls, limited staff access, keys outside code, encrypted backups | Describes the design and code. Nothing is hosted yet; encrypted backups exist only as an owner-run job (`npm run hosted:backup`). No audit or certification exists and none is claimed. |
| 9 | AI and recording notice at the start of each conversation; "our terms require every business to keep this notice on" | Phone line and WhatsApp code enforce a disclosure, but recording storage is not built (milestone B). Confirm the wording once recording exists. |
| 10 | "On WhatsApp, replying STOP records a do-not-contact request" | Built against a fake provider only. |
| 11a | Terms fees clause: plans and rates from the pricing page, MYR before SST, prepaid wallet, Meta bills its own WhatsApp fees | Prices on the pricing page are owner placeholders; final prices and SST registration are open. |
| 11 | Terms: liability capped at fees paid in the previous three months; price changes announced in the app; unused wallet balance handled by future billing terms | Business choices made in the draft. The owner and a lawyer should confirm them, and refund rules must be written before payments go live. |
| 12 | Terms: courts of Malaysia decide disputes; governing law Malaysia | No specific state or arbitration chosen. |
| 13 | BM text | Not reviewed by a native editor. |
