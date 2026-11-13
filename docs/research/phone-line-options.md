# Phone line options for JomCall

Date: 2026-11-14. Status: research for an owner decision. Nothing was built, bought or signed up for.

This document covers milestone B of `docs/superpowers/specs/2026-11-13-inbound-voice-design.md`: a caller dials a Malaysian number and reaches the `jomcall-voice` worker through SIP.

## How to read this

Every page was fetched on 2026-11-14 unless a different date is given. Three labels mark the weaker claims:

- **Unconfirmed** means no page from the provider or regulator settled it. Treat it as a question, not a fact.
- **Secondary** means the claim comes from a forum, a blog or a search snippet.
- **Assumption** means a figure this document chose so that a sum could be done.

Provider pages were read through a tool that summarises pages, so check any exact price on the provider's own page before signing. Prices in ringgit exclude SST. Dollar prices are converted at RM4.20 to USD 1, which is an assumption and was not checked against today's rate.

This is not legal advice. Section 5 lists the points that need a Malaysian lawyer.

## 1. Short answer

There are two workable ways to get a Malaysian number into LiveKit, and they suit different moments.

1. **A foreign provider with a LiveKit guide (Twilio, Plivo or Telnyx).** Self-serve, documented, and likely the quickest route to a first real call. It costs more per minute, depends on one local carrier partner, and requires company documents for each number.
2. **A small Malaysian VoIP provider (SIPPALS or INVITE Communications).** Much cheaper, local interconnect, no contract. Five technical and commercial questions are unanswered on their pages, and one of them can block the whole route: whether their trunk can deliver calls to a cloud server by fixed IP address.

The large carriers (TM, Maxis, TIME) publish no prices, need a sales process and contracts of 12 to 36 months, and mostly tie the trunk to their own access line. They are not a route to production in weeks.

The recommendation is in section 7. In one line: call SIPPALS and INVITE this week, and buy one Twilio or Plivo number at the same time so engineering does not wait for the answers.

## 2. What the product needs from a phone line

From the design spec, in order of importance:

1. Inbound calls to a Malaysian number, delivered by SIP to LiveKit.
2. The dialled number must reach the worker, because it selects the business and the published agent version.
3. The caller's own number must survive call forwarding, because the product sends a WhatsApp follow-up to the caller.
4. Transfer to a staff number, which needs either the SIP REFER method at the provider or an outbound call.
5. A pool of numbers that JomCall holds and gives to customers ("hosted number pool" in the spec).
6. Self-hosters must be able to bring their own trunk.

Points 3 and 5 are the ones no provider page answers.

## 3. Providers

### 3.1 Comparison table

"In" and "out" are per-minute prices for inbound and outbound calls. An empty answer is written as "not published".

| Provider | Malaysian number types | Number, per month | In, per minute | Out to Malaysia, per minute | Sign-up | Documents | SIP details | LiveKit status |
|---|---|---|---|---|---|---|---|---|
| **SIPPALS** (VoIP dotMY, KL) | 03 to 09 state prefixes, 0154, 1800 | RM10 to RM49, plus RM50 or RM100 set-up and RM10 activation | Not published | RM0.11 to RM0.13 | Online form, prepaid or postpaid, no contract | MyKad, director's MyKad, SSM forms, recent utility bill or bank statement | G.711 A-law and u-law, G.729; public internet; transport and authentication not stated | Untested |
| **INVITE Communications** (Puchong) | "Numbers across Malaysia" | RM50 package with 1 number and 2 channels; up to RM500 with 10 numbers | Not published | RM0.11 to RM0.13 | Quote form or phone, no contract, fees waived | Not published | Listed by Yeastar as registration-based | Untested |
| **BeONE** | Not stated | RM50 package with 1 number, 2 channels, 375 minutes | No charge | RM0.12 | Not stated | Not published | Registration-based (Yeastar) | Untested |
| **AlienVoIP** | Not stated | Number price not on current pages; trunk from RM100 on 12 months, or prepaid from RM50 | Not published | RM0.07 to RM0.10 | Postpaid for registered companies only | Not published | Registration with username and password | Untested |
| **REDtone** | Landline number tied to office address | SIPhony RM23.50 with 1 number and 2 calls; full trunk by enquiry | Not published | Not published | SIPhony online; trunk by enquiry | Company name, registration number, TIN, address | Registration-based (Yeastar) | Untested |
| **TIME dotCom** (VOBB-Biz) | State prefixes, 1300 and 1800 as add-ons | Set in the order form | Set in the order form | Set in the order form | Sales | Sales | Requires a static IP and a PABX "within the customer's premises" | Untested |
| **Maxis Business** (Voice SIP) | State prefixes, in blocks of 10 or 100 | Not published | Not published | Not published | Sales; 24 or 36 months | Sales | Only over Maxis broadband or IPMAN | Untested |
| **TM** (Multi-Line SIP) | State prefixes, 30 to 960 numbers | Not published | Not published | Not published | "Register interest" | Sales | Not published | Untested |
| **Twilio** (Elastic SIP Trunking) | Local, toll-free 1800; mobile listed without a price | USD 4.00 (about RM17); toll-free USD 25 | USD 0.0278 (about RM0.12) | Landline USD 0.0515, mobile USD 0.0760 | Self-serve | SSM copy and proof of a Malaysian address inside the number's area code | UDP, TCP, TLS, SRTP; IP list or credentials; Singapore edge | Official guide |
| **Plivo** (SIP trunking) | Local only | USD 4.00 (about RM17) | USD 0.0150 (about RM0.06) | USD 0.0450 | Self-serve (unconfirmed today) | Not confirmed; pages returned 404 | G.711 only; UDP, TCP, TLS, SRTP; Singapore data centre | Official guide |
| **Telnyx** | Local confirmed; national, toll-free and mobile in its requirements article | From USD 4.45 (about RM19) | Not retrievable | Not retrievable | Portal account | Representative ID, signed letter under one month old, Malaysian address proof under three months old; about 72 hours | G.711, G.722, Opus, G.729; UDP, TCP, TLS, SRTP; Asia proxy in beta | Official guide |
| **DIDlogic** | Local 03 and 082, national, mobile, 1800 | From USD 5, with a USD 20 monthly minimum | From USD 0.01 | Not published | Online sign-up, engineer arranges a test number | "Some markets require documents", up to 48 hours | G.711, G.729; UDP, TCP, TLS, SRTP | On LiveKit's tested list |
| **DIDWW** | Local and toll-free | Price list is a download; not read | Not read | Local termination by request to sales | Portal for inbound | Registration before activation | Not read | On LiveKit's tested list, with a guide |

Sources, one per row, in the same order:

- SIPPALS: <https://sippals.com/register/malaysia-phone-number>, <https://sippals.com/our-services/sip-trunk>
- INVITE: <https://www.invite.my/sip-trunking-provider>, <https://www.yeastar.com/itsp-partners/malaysia/>
- BeONE: <https://www.beone.my/plans-pricing>
- AlienVoIP: <https://alienvoip.com/siptrunk.php>
- REDtone: <https://www.redtone.com/telecommunications/siphony/>, <https://redtone.com/telecommunications/sip-trunking/>
- TIME: <https://business.time.com.my/wp-content/uploads/2026/04/Service-Schedule-A.pdf> (version dated 16 July 2025)
- Maxis: <https://www.business.maxis.com.my/en/faq/voice/voice-sip/>
- TM: <https://biz.unifi.com.my/products/multi-line-sip>
- Twilio: <https://www.twilio.com/en-us/sip-trunking/pricing/my> ("current as of October 2026"), <https://www.twilio.com/en-us/guidelines/my/regulatory>
- Plivo: <https://www.plivo.com/sip-trunking/pricing/my/> ("as of May 2026"), <https://www.plivo.com/docs/sip-trunking/concepts/technical-specifications>
- Telnyx: <https://telnyx.com/phone-numbers/malaysia.md>, <https://support.telnyx.com/en/articles/3739509-malaysia-did-requirements>, <https://sip.telnyx.com/>
- DIDlogic: <https://didlogic.com/virtual-phone-numbers/malaysia/>, <https://didlogic.com/voice/sip-trunks/sip-trunking/>
- DIDWW: <https://www.didww.com/resources/regulatory-requirements>

Checked and set aside: Zadarma sells only 1800 numbers in Malaysia at USD 54 a month. Bandwidth, AVOXI, Vonage, 8x8, Infobip, Toku, Exotel, Sinch and Wavix either publish no Malaysian price, are sales-led, or could not be confirmed to sell Malaysian numbers over plain SIP. CelcomDigi, MyKRIS, Orient Telecoms, IP ServerOne, XOX, Exabytes and YTL showed no SIP trunk page with Malaysian numbers.

### 3.2 What the table does not show

**Fixed-line numbers cannot be ported.** Maxis states that existing fixed-line numbers cannot move between providers (<https://www.business.maxis.com.my/en/faq/voice/voice-sip/>). Fixed number portability was consulted on in 2020 and has not launched (secondary: <https://soyacincau.com/2022/04/27/why-is-malaysia-taking-so-long-to-implement-fixed-number-portability/>). The spec's choice of forwarding over porting is therefore not a preference; it is the only route for a business with an `03` number.

**Local trunks mostly expect the customer's equipment to register.** Yeastar's partner list marks AlienVoIP, BeONE, Bournshell, INVITE and REDtone as registration-based. LiveKit's inbound trunk accepts calls that a provider sends to it, checked by source IP address or by a username and password. The LiveKit pages read for this document do not describe LiveKit registering itself with a provider, so a registration-only trunk probably cannot reach LiveKit directly (unconfirmed). The fix would be a small SIP proxy in front of LiveKit. The common open-source ones, Asterisk and Kamailio, are GPL, which the project rules ask us to avoid. This is the first question to put to SIPPALS and INVITE.

**A geographic number is tied to a place.** MCMC's numbering plan says a call to a geographic number must terminate at a location in its area code (clause 6.1.2) and that geographic numbers must be used for services in Malaysia (6.1.1): <https://www.mcmc.gov.my/skmmgovmy/media/General/registers/Numbering-and-Electronic-Addressing-Plan.pdf>. Twilio, Telnyx and SIPPALS all enforce the practical form of this: the registered address must match the number's prefix. Whether a server in Singapore answering an `03` number breaks the clause is not addressed by any page found. An `0154` number has no area code and may avoid the question, but one reseller reports `015` numbers as inbound-only with a lead time near 30 business days (secondary: <https://www.cloudtalk.io/virtual-number-malaysia>).

**Foreign providers need documents for each real user.** Twilio's regulatory bundle must name the business that actually answers the calls. That reading comes from a search summary of <https://www.twilio.com/docs/phone-numbers/regulatory/api/bundles> and is secondary. If it holds, a pool of numbers on Twilio means collecting each customer's SSM copy and address proof.

**Foreign providers ride on one local partner.** Twilio had an outage on a subset of Malaysian numbers for about 8.5 hours on 4 and 5 December 2025 (<https://status.twilio.com/incidents/lsk2dthx04lx>) and a second incident in October 2025 (secondary).

**Calls that show a Malaysian number but enter from abroad are a target.** MCMC and the carriers run a gateway that blocked 101.66 million spoofed calls from February to August 2026 (<https://www.nst.com.my/amp/news/nation/2026/09/1542528/mcmc-blocked-10166m-spoof-calls-over-seven-months>). Its target is overseas calls showing local numbers. Inbound calls are not affected. Outbound calls and transfers placed through a foreign provider may be, and Twilio already states that verified Malaysian caller IDs are not supported for calls to Malaysia (<https://www.twilio.com/en-us/guidelines/my/voice>). Whether the gateway touches a foreign provider's own Malaysian numbers is unconfirmed.

**1300 and 1800.** In the numbering plan `1300` is charged to the caller at a local rate and `1800` is paid by the called party. Only SIPPALS, TIME, TM and Twilio list them, and only Twilio publishes a price. They are not needed for a forwarding product and are left out of the recommendations.

## 4. Setting up LiveKit SIP

All field names below come from LiveKit's documentation or source, read on 2026-11-14. LiveKit's telephony pages have moved from `docs.livekit.io/sip/` to `docs.livekit.io/telephony/`.

### 4.1 The two objects

An **inbound trunk** tells LiveKit which calls to accept. It lists the numbers and either the provider's IP addresses or a username and password (<https://docs.livekit.io/telephony/accepting-calls/inbound-trunk.md>).

```json
{
  "trunk": {
    "name": "jomcall-my-did",
    "numbers": ["+60XXXXXXXXX"],
    "allowed_addresses": ["<provider IP or range>"],
    "media": { "only_listed_codecs": true, "codecs": [{ "name": "PCMA" }] }
  }
}
```

A **dispatch rule** decides which room the caller joins and which agent is sent to it (<https://docs.livekit.io/telephony/accepting-calls/dispatch-rule.md>).

```json
{
  "dispatch_rule": {
    "name": "jomcall inbound",
    "trunk_ids": ["<trunk ID>"],
    "rule": { "dispatch_rule_individual": { "room_prefix": "call" } },
    "room_config": {
      "agents": [{ "agent_name": "jomcall-voice", "metadata": "{\"channel\":\"pstn\"}" }]
    }
  }
}
```

They are created with `lk sip inbound create` and `lk sip dispatch create`. One rule serves every call. The worker already registers under the name `jomcall-voice`, so explicit dispatch works without a change to how it starts.

### 4.2 Names and call details

- The room name is the prefix, an underscore, the caller's number, an underscore and a random part: `call_+60123456789_<random>`. The caller's number is personal data inside a room name. Setting `hide_phone_number` on the rule removes it, but also removes the number attributes below, so the choice needs care.
- The caller joins as a participant of kind SIP with identity `sip_<caller number>`.
- The worker reads the caller's number from the participant attribute `sip.phoneNumber` and the dialled number from `sip.trunkPhoneNumber`. Other attributes include `sip.callID`, `sip.callStatus`, `sip.trunkID` and `sip.ruleID` (<https://docs.livekit.io/reference/telephony/sip-participant.md>).
- LiveKit answers the call only when the agent publishes audio. Until then the caller hears ringing. A wrong agent name shows up as a call that rings and is never answered.

### 4.3 The forwarded call

`sip.trunkPhoneNumber` is the number in the SIP "To" field. On a forwarded call that should be the JomCall number, which is what the product needs. The business's original number, if the carrier passes it at all, travels in a "Diversion" or "History-Info" header. LiveKit's documentation does not mention either header. It can be read with `include_headers: SIP_ALL_HEADERS` on the trunk, which should expose it as `sip.h.diversion`, or with the `lk.sip.GetRemoteHeaders` call (<https://docs.livekit.io/telephony/accepting-calls/workflow-setup.md>). Neither was tested.

This matters for cost. If carriers pass the Diversion header reliably, one shared JomCall number could serve many businesses. If they do not, each business needs its own number, which is what the spec assumes. Only a test call can settle it.

### 4.4 Self-hosted or LiveKit Cloud

**Self-hosted.** SIP is a separate service, `livekit/sip`, under Apache-2.0 (<https://github.com/livekit/sip>). It needs:

- Redis, shared with the LiveKit server. The local set-up on `feat/voice-milestone-a` runs LiveKit in development mode on loopback, without Redis, so Redis is new.
- A public IP address. Ports: 5060 over UDP and TCP for signalling, 5061 for TLS, and UDP 10000 to 20000 for audio, all reachable from the internet (<https://docs.livekit.io/transport/self-hosting/ports-firewall.md>).
- `use_external_ip: true`, otherwise the caller hears nothing.
- Docker host networking, because of the wide audio port range. That does not work for real carrier traffic on a Mac behind home broadband. A Linux server with a public address is needed even for the first test.

LiveKit's enhanced noise removal for phone audio is offered only when LiveKit Cloud carries the call. Whether the trunk setting `krisp_enabled` does anything on a self-hosted server is unconfirmed.

**LiveKit Cloud.** The provider sends calls to `<project>.sip.livekit.cloud`. The worker can stay on our own machine and connect to Cloud with a URL and keys. Prices (<https://livekit.com/pricing>):

| Plan | Monthly | SIP minutes from another provider | Agent minutes |
|---|---|---|---|
| Build | USD 0 | 1,000 included | 1,000 included |
| Ship | from USD 50 | 5,000 included, then USD 0.004 | 5,000 included, then USD 0.01 |
| Scale | from USD 500 | 50,000 included, then USD 0.003 | 50,000 included, then USD 0.01 |

Agent minutes are charged only for agents deployed on LiveKit Cloud, so a self-hosted worker should not use them.

Two limits apply. LiveKit's own phone numbers are United States only. The regional SIP endpoints are `eu`, `india`, `sa`, `us`, `japan`, `aus` and `canada`, with no Singapore or Malaysia entry, and region pinning is a Scale feature (<https://docs.livekit.io/deploy/admin/regions/endpoints.md>). Whether the global endpoint has a point of presence in Singapore is unconfirmed, so the delay added to a Malaysian call is unknown until measured.

### 4.5 Phone audio and the chosen speech services

Phone calls carry audio at 8 kHz, which keeps sound only up to about 4 kHz. LiveKit SIP accepts G.711 u-law, G.711 A-law and G.722, not Opus (<https://docs.livekit.io/reference/telephony/codecs-negotiation.md>). Malaysia uses A-law. G.722 would give wider sound, but it depends on every carrier in the path and should not be expected on a forwarded call.

The path for a caller's voice is: 8 kHz from the carrier, raised to 48 kHz by the SIP service, lowered to 24 kHz by the agent framework, then to 16 kHz for Deepgram. Raising the rate adds no detail. In practice:

- **Deepgram `nova-3` multilingual** stays the right model. Deepgram's phone-call models are English only and belong to older generations (<https://developers.deepgram.com/docs/models-languages-overview>). LiveKit's sample code switches phone callers to `nova-2-phonecall`; do not copy that, since it drops BM and Mandarin.
- The speech-to-text accuracy already measured (23.4% of words wrong) came from Malaysian phone-style clips, so it is the relevant baseline. It was not measured through a real carrier, a real forward and a real handset. Expect it to be somewhat worse, and measure it.
- **Gemini text to speech** produces 24 kHz audio, which is lowered to 8 kHz for the caller. The five presets were chosen by listening at full quality. They need a second listening test over a real phone, because some voices lose more than others.
- Keypad tones are supported in both directions.

### 4.6 Later features

- **Transfer to staff.** `TransferSIPParticipant` sends a SIP REFER, so the provider must accept REFER. Plivo allows it by default and Twilio needs it switched on (<https://docs.livekit.io/telephony/features/transfers/cold.md>). No Malaysian provider page mentions REFER. The fallback is an outbound call joined to the same room, which costs an outbound minute.
- **Outbound calls** need an outbound trunk and `CreateSIPParticipant`.
- **Recording** uses LiveKit Egress, which is another service to run when self-hosting.
- **Testing without a carrier.** A softphone calling the SIP service with a trunk username and password should work but is not documented (unconfirmed). It would let engineering start before any provider answers.

## 5. Malaysian rules

Dates in this section are publication dates of the source.

### 5.1 Recording a call

Section 234 of the Communications and Multimedia Act 1998 makes it an offence to intercept communications without lawful authority, and the text has no exception for a person who is part of the call (<https://www.mcmc.gov.my/skmmgovmy/media/General/pdf/Act588bi_3.pdf>). Whether a business recording its own call counts as interception is unconfirmed. A newspaper fact-check of 15 September 2026 says secret recording is illegal even for a party, without citing a case. The safe design is the one the spec already has: say at the start of every call that it is recorded.

### 5.2 Personal data

The Personal Data Protection Act 2010 was amended in 2024, and every phase is in force: 1 January, 1 April and 1 June 2025 (<https://www.dfdl.com/insights/legal-and-tax-updates/malaysia-implementation-of-the-personal-data-protection-amendment-act-2024/>). What matters here:

- **Roles.** The business is the data controller. JomCall is its data processor. Deepgram, Anthropic and Google are sub-processors. Since 1 April 2025 a processor is directly bound by the security principle.
- **Notice.** Section 7 requires a written notice in Bahasa Malaysia and English at or before collection. Whether a spoken notice alone is enough is unconfirmed. The safe design is a short spoken line in both languages plus a written notice sent by WhatsApp or linked from the business's page.
- **Breach notice.** The Commissioner must be told within 72 hours and affected people within a further 7 days where significant harm is likely. The controller must bind its processor by contract to report promptly (DLA Piper, 4 March 2025: <https://privacymatters.dlapiper.com/2025/03/malaysia-guidelines-issued-on-data-breach-notification-and-data-protection-officer-appointment/>).
- **Data protection officer.** Required above 20,000 data subjects, or 10,000 where the data is sensitive, and the rule covers processors. JomCall could cross that line across all its customers together.
- **Voice as biometric data.** Biometric data became sensitive personal data on 1 April 2025. Whether a plain recording counts is unconfirmed. It probably does not unless voiceprints are made. Do not build speaker identification until a lawyer confirms.
- **Clinics.** Health details are sensitive personal data and need explicit consent. The agent should take only what a booking needs, and a no-recording mode is worth considering for clinics.

### 5.3 Sending audio abroad

Since 1 April 2025 the old list of approved countries is gone. A transfer is allowed where the destination has a similar law or adequate protection, or under an exception such as consent, or under contract clauses. The guidelines of 29 April 2025 ask the controller for a transfer impact assessment, valid for three years, and accept the ASEAN model clauses or the EU standard clauses (Rahmat Lim, 27 May 2025: <https://www.rahmatlim.com/publication/articles/30646/new-guidelines-on-cross-border-personal-data-transfer>).

For JomCall this means a data processing agreement with transfer clauses with each speech and model provider, the destination countries named in the privacy notice, and a template assessment handed to each customer. It should not rest on the caller's consent alone. This closes open item 2 in the inbound voice spec only once a lawyer has agreed the route.

### 5.4 Saying it is an AI

No binding rule today requires telling a caller that they are speaking to an AI. The National Guidelines on AI Governance and Ethics of 20 September 2024 are voluntary and list transparency as a principle. An AI Governance Bill was put to consultation in July 2026 and is expected in Parliament by the first quarter of 2027; a ministerial reply of 5 October 2026 mentions a planned bot disclosure mechanism (<https://www.bakermckenzie.com/en/insight/publications/2026/07/malaysia-public-consultation-on-the-ai-governance-bill>). Keep the disclosure. It is already a product rule and it matches where the law is heading.

### 5.5 Caller ID and automated calls

- The numbering plan forbids concealing caller identity and requires the real originating number (clause 3.8.1.12).
- No rule was found that is specific to a machine answering a call. That is an absence of evidence, not a confirmation.
- For outbound follow-up calls, section 43 of the PDPA lets a person stop direct marketing by written notice. MCMC consulted in August 2025 on rules for unsolicited commercial messages; whether they cover voice calls and whether they are in force is unconfirmed. No do-not-call registry was found in operation.
- SMS containing a link or a callback number has been blocked on all routes since 1 September 2024. Follow-ups must go through WhatsApp, as the spec already plans.

### 5.6 Does JomCall need a licence?

"PSTN telephony" and "IP telephony" are Applications Service Provider class licence activities. Registration costs RM2,500 a year and is open to a Malaysian company (<https://www.mcmc.gov.my/skmmgovmy/media/General/Licence/2025/MCMC_Licensing-Guidebook_150425.pdf>, 15 April 2025). Numbers are assigned only to network licensees and may not be passed to another service provider (numbering plan, clauses 3.2.1 and 4.1.4).

Whether JomCall needs its own registration is unconfirmed, and it is the main regulatory fork. It turns on who provides the telephone service to the business: JomCall, or a licensed provider with JomCall as its customer. INVITE's white-label offer to service providers suggests the second arrangement exists in practice.

### 5.7 Points for a Malaysian lawyer

1. Is recording by a party, or by its AI agent, "interception" under section 234, and is a spoken notice enough?
2. Does a spoken BM and English notice satisfy section 7 of the PDPA?
3. Is call audio sent for transcription "biometric data"?
4. Does JomCall need the class licence to hold numbers and give them to customers?
5. Which transfer route applies to the United States providers, and who writes the assessment?
6. Do the data protection officer thresholds apply to JomCall across all customers together?
7. What extra limits apply to clinics?

## 6. How a business forwards its number

The spec expects owners to forward on no answer or busy, or to forward everything. The research found this harder than the spec assumes.

| Carrier | Forwarding available | Cost to the business | Source |
|---|---|---|---|
| Maxis mobile | Yes: busy, no answer, unreachable, all calls. Switched on as an add-on in the Maxis app | RM3 a month, plus each forwarded call at normal call charges | <https://www.maxis.com.my/en/services/call-management-services/> |
| Maxis Home Fibre voice line | **No** | | <https://www.maxis.com.my/en/faq/network/home-fibre/voip> |
| Maxis Business Voice Connect | Yes, listed as a feature | RM25 a month for the line | <https://www.business.maxis.com.my/en/faq/voice/voice-connect> |
| CelcomDigi | Yes, through phone settings | Secondary and old: no fee, normal call rate | <https://help.celcomdigi.com/en/support/solutions/articles/70000665825-how-to-turn-on-off-call-forwarding-> |
| U Mobile | Yes, to Malaysian mobile and fixed numbers only | Postpaid RM0.05 per 30 seconds, outside bundled minutes | <https://www.u.com.my/en/personal/support/faqs/value-added-services/call-forwarding> |
| unifi Mobile Biz 39 and 59 | **No** | | <https://unifi.com.my/sites/default/files/page/mobile/business/postpaid/doc/FAQ_Biz_Quota_Plan.pdf> |
| Yes | Yes, in the MyYes app (secondary) | Unconfirmed | |
| TM or unifi fixed line | Unconfirmed for an ordinary line; included with IP Centrex and Multi-Line SIP (secondary) | Unconfirmed | |
| TIME business voice | Yes, a standard feature | Unconfirmed | Service Schedule A, linked in section 3.1 |

What follows from this:

- **The dial codes are unverified.** No Malaysian carrier page that could be opened lists `**21*`, `**61*`, `**67*` or `**62*`. They are the international GSM standard and very likely work on mobile lines, but each must be tested on a real SIM before it appears in a setup screen.
- **Forwarding costs the business money.** On U Mobile postpaid, 300 forwarded minutes cost about RM30 a month on top of the JomCall fee. On Maxis it is RM3 plus call charges. Whether unlimited-call plans cover the forwarded leg is unconfirmed for every carrier. The pricing page should say this plainly.
- **Some lines cannot forward at all.** The setup flow needs a carrier question early and an honest "this line cannot forward" answer.
- **Forwarding to `0154`, `1300` or `1800` may be refused.** An old Digi forum reply excludes `1300` and `1800` (secondary). An ordinary `03` number is the safest forwarding target.
- **Whether the caller's number survives the forward is unconfirmed for every carrier.** If it does not, the WhatsApp follow-up to the caller cannot be sent.
- The verification call in the spec is necessary, not optional.

## 7. Recommended set-ups

The cost figures are for one business taking 300 minutes of inbound calls a month on one number. They cover the phone line only, not speech, model or server costs.

### Set-up A: Malaysian provider into self-hosted LiveKit SIP (recommended for production)

A Malaysian `03` number from SIPPALS or INVITE, delivered over the internet to `livekit/sip` on a Linux server with a public address, in Malaysia if a lawyer or the provider says the number must terminate here.

- **Cost.** SIPPALS: RM10 to RM49 a month for the number, RM60 to RM110 once, and per-minute outbound only when a call is transferred. If inbound is free, as BeONE states for its own service, 300 minutes cost about **RM10 to RM49 a month**. INVITE: **RM50 a month** for one number and two simultaneous calls. Inbound per-minute charges are not published by either and must be asked.
- **For.** Cheapest by a wide margin. Local interconnect, so transfers and later outbound calls show a real local number from inside Malaysia. No contract. Matches the self-hosted design in the spec.
- **Against.** Untested with LiveKit. May be registration-only. Reselling terms unknown. We run and watch the SIP service ourselves.
- **Blocked on.** The first five questions in section 8.

### Set-up B: Twilio or Plivo into LiveKit (recommended as the first working line)

One `03` number in JomCall's own name, delivered by a documented route.

- **Cost.** Twilio: USD 4.00 plus 300 minutes at USD 0.0278, about USD 12.34 or **RM52 a month**. Plivo: USD 4.00 plus 300 minutes at USD 0.0150, about USD 8.50 or **RM36 a month**. LiveKit Cloud's free plan includes 1,000 SIP minutes, so LiveKit adds nothing at this volume.
- **For.** Official LiveKit guides. Self-serve. Singapore edge. REFER transfers. Twilio's document rules are published, so the lead time is knowable.
- **Against.** Two to five times the cost of set-up A. One local partner behind it. Documents per customer if used as a pool. Outbound calls showing a Malaysian number from abroad are at risk.
- **LiveKit side.** Start on LiveKit Cloud's free plan to avoid opening ports, and measure the delay, since there is no Singapore SIP region. Move to self-hosted SIP if the delay is audible.
- **Needs.** JomCall's SSM registration and proof of an address in the Klang Valley for an `03` number.

### Set-up C: stay on set-up B for the pilot customers

Use set-up B for the first handful of paying businesses, one number each, and collect each one's documents. At about RM36 to RM52 a month per business it is affordable for a pilot and too expensive and slow for self-serve sign-up. It is the fallback if no Malaysian provider can deliver to a cloud server.

### Top recommendation

Do A and B together. Buy one Plivo or Twilio number now so that milestone B engineering, the phone listening test and the forwarding tests can start on a line known to work with LiveKit. Phone SIPPALS and INVITE in the same week. Move production to set-up A if they answer the first five questions well, and stay on set-up C if they do not. The worker and the dispatch rule are the same in both, so little work is thrown away.

Between Plivo and Twilio: Plivo is cheaper and allows transfers by default, but its Malaysian document rules could not be read. Twilio costs more and its rules are published. If Plivo's sign-up shows a clear document list, choose Plivo.

## 8. Unknowns that need a phone call or a trial

**Ask SIPPALS and INVITE (and TIME, if a carrier-grade option is wanted):**

1. Can the trunk deliver calls to a cloud server by fixed IP address, with no registration?
2. May that server be in Singapore, or must it be in Malaysia?
3. On a forwarded call, do we receive the original caller's number, and is the forwarding number sent in a Diversion or History-Info header?
4. May one account hold many numbers and give one to each of our customers? In whose name is each number registered, and must each match that customer's address?
5. Do we need our own MCMC class licence for that, or are we covered as your customer?
6. Is inbound charged per minute? What does a number cost at 50 and at 500 numbers? How many simultaneous calls per number?
7. Are TLS, SRTP and REFER supported? Which codecs?
8. What is the real time from documents to a working number?

**Settle by trial, with one number and a few SIM cards:**

1. Does a call forwarded from Maxis, CelcomDigi, U Mobile and a TM fixed line arrive, and with which caller number and headers?
2. Do the standard dial codes work on each carrier, and what does the forwarded leg cost on an unlimited plan?
3. What is the answer delay through LiveKit Cloud from Malaysia, compared with a self-hosted server nearby?
4. How much worse is Deepgram on a real forwarded phone call than on the benchmark clips?
5. Which of the five voice presets still sound acceptable at phone quality?
6. Does a softphone reach the self-hosted SIP service, so that tests can run without a carrier?

**Not confirmed from a primary page:** Telnyx per-minute prices for Malaysia; Plivo's Malaysian document rules; stock of `03` numbers at any foreign provider; today's exchange rate.

## 9. Questions for the owner

1. **Speed or cost first?** Set-up B can carry a real call soonest. Set-up A is the cheaper production answer but waits on phone calls. Is doing both acceptable?
2. **Who holds the number?** JomCall holding a pool is the spec's plan and raises the licence question. The alternative is that each business buys its own number from a provider and points it at JomCall, which is slower to onboard and needs no pool.
3. **Is JomCall registered with SSM, and at what address?** Every provider asks for it, and the address decides which area code is available.
4. **Where does the phone server live?** Malaysia is the safe reading of the numbering plan. Singapore may be acceptable. This also affects the hosting decision being made in another session.
5. **LiveKit Cloud or self-hosted for SIP?** Cloud is quicker and gives phone noise removal. Self-hosted matches the spec and keeps call audio off one more foreign service.
6. **Is a GPL SIP proxy acceptable as a separate service** if a Malaysian provider can only do registration? It would not be linked into JomCall's code, but the project rules say to avoid GPL.
7. **Will you pay for a lawyer's hour** on the seven points in section 5.7 before real callers? Recording, the licence and cross-border transfer are the three that could force a redesign.
8. **Who pays for forwarding?** It can cost a business RM30 a month or more. Should the price page say so, and should JomCall's pricing allow for it?
9. **Is outbound needed in the first release?** Transfers to staff can use REFER on a foreign provider. Anything that places a call showing a Malaysian number is safer on a Malaysian provider.
