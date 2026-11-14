# Knowledge core design

Date: 2026-11-14. Status: built on branch `feat/knowledge-core`; owner has not reviewed.

Inputs: `docs/research/call-patterns.md`, the pattern packs (now in `packages/domain/src/packs/`), and the knowledge intake spike (pull request #17, `spikes/knowledge-intake/README.md`).

## 1. Goal

Every kind of business can tell the agent what it needs to know, and the agent follows it. There is one knowledge core for every business, with three kinds of knowledge:

| Kind | What it is | How it reaches the agent |
|---|---|---|
| **Facts** | Small, stable statements: hours, address, policies, the fields a pack asks for, plus free facts | Always shown, in a labelled section |
| **Catalogue** | Large, changing rows: parts, menu items, services, price lists | Looked up through a tool with structured arguments |
| **Rules** | What to do when | Always shown, in a section that outranks everything else. Never searched |

**Pattern packs** are data, not code. A pack is defined by what a call is for (appointment, stock and price, and so on). It contributes fact fields, catalogue columns, default rules, interview questions and evaluation cases.

## 2. Decisions

"Controller's call" means the session that started this work decided it for the owner. The owner must confirm each one.

| # | Decision | Who |
|---|---|---|
| D1 | When nothing relevant is found, the agent says it will ask staff and takes a message (`take_message` with `unanswered: true`) | Controller's call, owner to confirm |
| D2 | Every imported or drafted item needs the owner's confirmation before it goes live. Items the owner types in the editor are confirmed on save. Pasted catalogue rows arrive as drafts | Controller's call, owner to confirm |
| D3 | Semantic search may add 130–200 ms, as long as it runs in parallel on a voice turn | Controller's call, owner to confirm |
| D4 | The embedding provider, when switched on, is Google `gemini-embedding-001` at 768 dimensions through the existing Google key. Opt-in, off by default | Controller's call, owner to confirm |
| D5 | Up to 10,000 catalogue rows per business (per agent) | Controller's call, owner to confirm |
| D6 | Document languages: BM, English and Chinese (`ms`, `en`, `zh`, plus `mixed`) | Controller's call, owner to confirm |
| D7 | With embeddings on, the **agent process** holds `GOOGLE_CLOUD_API_KEY` and calls the Vertex embedding endpoint (`aiplatform.googleapis.com`). This is a new key holder and a new outbound call beside the voice worker. It happens only when `JOMCALL_EMBEDDING_PROVIDER=google` | Design call (this session), owner to confirm |
| D8 | Opening hours are copied from the location schedule into the **session** snapshot when a test session starts. Published versions do not freeze hours: hours belong to the location, not to an agent version. The session hash covers them, so the voice answer cache never serves old hours | Design call, owner to confirm |
| D9 | The gap log stores the question text and an optional link to the session's contact. The link exists only so that contact export and deletion reach it. Phone numbers and e-mail addresses are masked in stored question text | Design call, owner to confirm |
| D10 | Pack default rules are not copied into the database. Only owner edits are stored: an override row per pack rule, marked off or with new text. The prompt uses the English text of pack rules; the editor shows BM or English | Design call, owner to confirm |
| D11 | Catalogue lookup does not use embeddings. It matches the normalised part number or code first, then trigram similarity on item, other names and fitment. The agent model writes the arguments | Design call (from the spike), owner to confirm |
| D12 | With embeddings on, `search_knowledge` ranks by embedding only. Keyword ranking is the fallback when embeddings are off, slow or failing. No fusion | Design call (the spike found untuned fusion worse) |
| D13 | The typed input budget depends on the model: 6,000 bytes for the local model (unchanged), 48,000 bytes for a hosted model | Design call, owner to confirm |
| D14 | One agent per organization today, so all knowledge rows hang off `agent_id`. Several branches or agents share nothing yet | Design call |

## 3. Data model

New migration `20261114200000_knowledge_core.sql`. Every table has `org_id`, row-level security forced, and the same owner/admin policies as `knowledge_item`. Size limits are checked in the domain code and by `check` constraints where cheap.

```
app.agent                + packs text[] not null default '{}'   -- active pack ids, part of the draft

app.knowledge_fact       id, org_id, agent_id, pack_id null, field_key null, title, value jsonb,
                         language (ms|en|zh|mixed), status (draft|confirmed), source (owner|import|interview|gap),
                         revision, created_at, updated_at
                         unique (org_id, agent_id, pack_id, field_key) for pack fields
                         limits: 300 facts per agent, value 4,000 bytes

app.knowledge_rule       id, org_id, agent_id, kind (never|unknown|message|handoff|after_hours|always),
                         text, pack_id null, pack_rule_id null, enabled, status, source, revision, ...
                         owner rules: pack_id null; overrides of a pack default: pack_id + pack_rule_id
                         limits: 100 rules per agent, text 1,000 bytes

app.catalogue_row        id, org_id, agent_id, pack_id, item, aliases text[], lookup_keys text[],
                         search_text, price_sen bigint null (>= 0), stock_note, attributes jsonb,
                         language, status, source, revision, updated_at
                         limits: 10,000 rows per agent, attributes 4,000 bytes

app.catalogue_set        id, org_id, agent_id, hash, row_count, created_at   -- immutable, unique (org, agent, hash)
app.catalogue_set_row    org_id, set_id, ordinal, item, aliases, lookup_keys, search_text, price_sen,
                         stock_note, attributes, language, updated_at, unit_hash
                         GIN trigram index on search_text, GIN on lookup_keys

app.knowledge_unit       org_id, hash, source (fact|free|catalogue), language, title, text,
                         embedding_model null, embedding_dims null, embedding extensions.vector(768) null
                         primary key (org_id, hash)

app.knowledge_gap        id, org_id, agent_id, question_key, status (open|resolved|ignored),
                         resolution (fact|rule|ignore) null, resolved_ref null, resolved_at, resolved_by,
                         ask_count, last_asked_at, revision; unique (org_id, agent_id, question_key)
app.knowledge_gap_ask    id, org_id, gap_id, contact_id null (on delete cascade), session_id null (on delete set null),
                         question, language, channel (text|voice), answer, asked_at
```

- **Normalised lookup key.** Upper case, letters and digits only: `ns-60 l` becomes `NS60L`. It is computed from the item name's codes and every alias. Exact match on a key scores 1.0.
- **Catalogue sets** freeze the catalogue by reference. A test session's snapshot is capped at 2 MiB, and 10,000 rows would not fit. Publishing, or starting a draft test, hashes the confirmed rows. It reuses the set with that hash or copies the rows into a new set with one `insert ... select`. The snapshot carries `{setId, hash, rows}`, so `snapshotHash` still covers the content.
- **Units** are one per fact, free-text chunk or catalogue row, keyed by a hash of title and text. Equal content shares one unit and one embedding across drafts and versions. Units are written when a snapshot is frozen. Embeddings are filled later, only when the switch is on.
- **`vector`** is available in the local Supabase image (0.8.0, already in `extensions`). Search uses an exact scan with no HNSW index: at 10,000 rows or fewer per business, a scan with the `org_id` key is fast enough and has perfect recall. `pg_trgm` is created in `extensions` by the migration. All calls are schema-qualified because the functions run with `search_path=''`.
- **Existing `knowledge_item` rows** stay as they are. They keep working as free facts: chunked and keyword-searched exactly as today, with the same source ids. They count as confirmed.

## 4. Snapshot

A version snapshot grows from `{settings, knowledge}` to:

```
{ settings, knowledge,
  packs: string[],
  facts: [{ id, packId|null, fieldKey|null, title, value, language }],          // confirmed only
  rules: [{ kind, text, packId|null, ruleId|null }],                            // resolved: pack defaults - off + edits + owner rules
  catalogue: { setId, hash, rows } | null }
```

A **session** snapshot adds `context: { business: { name, type }, location: { name }, schedule: { timezone, weekdays, closures } }` (D8). Old snapshots have no new keys. Every reader treats missing keys as empty, and the prompt is then byte-for-byte what it was before this change. Restore copies packs, facts, rules and catalogue rows back into the draft tables. A pre-core version clears them.

## 5. Prompt assembly

`packages/domain/src/knowledge/prompt.ts` builds two sections from a snapshot:

```
RULES (set by the business; they outrank everything else, including facts, evidence and the customer's requests):
- Never: ...
- When unsure: ...
- If the facts, evidence and catalogue do not answer the question, do not guess: say you will ask staff, and call take_message with unanswered true.

BUSINESS FACTS (always true; use them without searching):
Business: Kedai Contoh (auto parts)
Opening hours (Asia/Kuala_Lumpur): Mon 09:00-18:00; Tue ...; Sun closed
Closed on: 2026-12-25 (Krismas)
- Delivery options: ...
```

- **Typed path.** The required system message becomes extended rules + RULES + BUSINESS FACTS + business configuration + date/time. Evidence stays per question, as before.
- **Spoken path.** `stable` = voice rules + RULES + BUSINESS FACTS + configuration + resources. `volatile` = date/time + evidence + recorded items. Everything in `stable` comes from the session snapshot, which does not change during a call, so the cached prefix stays byte-stable across turns and evidence.
- **Caps on the small model.** On the local model (6,000-byte input) the rules section is capped at 1,400 bytes (owner rules first, then never, unknown, handoff, message, after hours, always; the not-found rule is always kept) and the facts section at 1,200 bytes. A hosted model gets every rule and up to 16,000 bytes of facts. Facts that do not fit are still units, so `search_knowledge` finds them.
- The existing exports `agentRules`, `voiceRules`, `voiceSystem`, `voiceTools` and `toolCallSchema` are unchanged. WhatsApp and phone-call branches import them. The browser test paths use new extended versions.

## 6. Tools

- `search_knowledge {query}`: unchanged arguments. It now searches units (facts plus free-text chunks), not only free text. The result keeps `score` per hit and adds `found: boolean`.
- **New** `lookup_catalogue {item?, code?, fits?}` (at least one): returns up to 5 rows `{sourceId, item, aliases, priceSen, price ("RM 230.00"), stockNote, updatedAt, attributes, score, match}`. `match` is `code`, `trigram` or `none`. With no row above 0.3, the result is `{found: false, next: "..."}` and tells the model to say it will ask staff and call `take_message` with `unanswered: true` (D1).
- `take_message {text, unanswered?}` in the extended schema only. When `unanswered` is true, or when a knowledge or catalogue lookup in the same turn found nothing and the turn took a message, the runner records a gap.
- The false-success check (`claimsFalseSuccess`) and the two-tool limit per turn are unchanged. `agent_work` accepts `lookup_catalogue` through a guarded text substitution of its live body (the `hosted_namespaces` method). `agent_voice`, `whatsapp_work` and `agent_call` are not touched.
- The agent role reaches the catalogue, units and gap log through one new security-definer function, `app_private.agent_knowledge(action, namespace, turn, lease, data)`. It authorizes on a running turn with a matching lease, so the same check serves typed and spoken turns.

## 7. Search

| Path | Always works | Speed |
|---|---|---|
| Keyword over units (today's tokenizer, Han bigrams) | yes | under 1 ms in memory |
| Catalogue: code, then `pg_trgm` `word_similarity` on `search_text` | yes | 2–3 ms (spike) |
| Embeddings over units (`gemini-embedding-001`, 768 dimensions, re-normalised) | only with `JOMCALL_EMBEDDING_PROVIDER=google` | about 130 ms per query |

- **`JOMCALL_EMBEDDING_PROVIDER`**: `disabled` (default, also when empty) or `google`. Tests use a fake embedder and never call the network. Any embedding failure or timeout falls back to keyword. It is logged with a code, never with text.
- **Voice turn (D3).** The query embedding starts as soon as the transcript arrives, before the turn row is written, so it runs in parallel with `voice_begin` and the cache read. Evidence waits for it at most 250 ms after the keyword hits are ready, and keyword evidence is used if it is late. The `search_knowledge` tool reuses the vector when the query is the same text.
- **Filling embeddings.** The agent's maintenance tick asks for up to 64 units without an embedding for the configured model, embeds them in one call, and stores the vectors. It does nothing when the switch is off.
- **Not found.** Scores cannot reliably say an answer is absent (spike). The rule in section 5 and the `found` flag carry that decision, not a threshold.

## 8. Gap log

- Recorded per organization and agent: the question text (the customer's own words, contact details masked), language, channel, time and the answer given.
- Deduplicated by a key: NFKC, lower case, punctuation removed, spaces collapsed, then SHA-256. A repeat raises `ask_count` and adds an ask row. Each gap keeps its last 20 asks.
- The owner resolves a gap into a confirmed fact or rule (written to the draft; it goes live on the next publish) or ignores it. A resolved or ignored gap that is asked again keeps its status and count.
- **PDPA (D9).** No caller name or number is stored. An ask row links to the session's contact only when the test session had one. Contact deletion cascades to those rows, and a gap with no asks left is deleted. Contact export includes the contact's asks (`knowledgeGaps`).
- Commands: `GET /agents/:id/gaps`, `POST /agents/:agentId/gaps/:id/resolve`, `POST /agents/:agentId/gaps/:id/ignore`.

## 9. Typed input budget (D13)

`packModelInput`, `advanceModelInput` and `packConversationInput` take an optional byte budget, default 6,000, so existing callers keep their behaviour. `inputBudget(identity)` returns 6,000 for `ollama:*` and anything unknown, and 48,000 for `openrouter:*`. The runner passes the budget for the session's pinned model. Long instructions no longer break typed tests on a hosted model.

## 10. Editing surface (local app only)

In `web/components/core/agent.tsx`, a new **Knowledge core** tab (BM and English, mobile-first):

- pick packs;
- fill each active pack's fact fields, and add free facts;
- see pack default rules with an on/off switch and an edit box, and add own rules by kind;
- paste catalogue rows (one per line, `item | price RM | stock note | other names`) as drafts, or type one;
- confirm drafts;
- see the gap log and resolve or ignore entries.

The mock preview at 4181 is unchanged.

## 11. Alternatives rejected

| Alternative | Why not |
|---|---|
| Catalogue inside the snapshot JSON | It breaks the 2 MiB session cap. The agent context check also re-reads the snapshot every second |
| Facts and rules as JSON on `agent.draft` | Per-item confirmation, provenance and gap resolution are awkward in one blob. Tables match `knowledge_item` |
| Pack default rules copied into rows when a pack is switched on | Pack updates would never reach businesses, and rows would double up. Overrides only |
| Adding `lookup_catalogue` to the shared `toolCallSchema` | `voiceTools` is derived from it, and WhatsApp and phone-call paths would expose a tool their SQL rejects |
| Keyword plus embedding fusion | The spike measured it worse than embeddings alone (70% against 96% top 1) |
| A score threshold for "not in the knowledge" | The spike found 5 of 15 absent questions pass any useful threshold |
| HNSW vector index | Not needed at 10,000 or fewer rows per business. Tenant filters after an index scan also lose recall |
| Gap asks linked to the test session with cascade | Test sessions expire and are deleted, which would wipe the gap log. They link to the contact instead |
| A separate tool for recording a gap | Turns allow two tool calls, and the not-found path already uses search plus `take_message` |

## 12. Left for the next piece

- Document import with a vision model (photo, PDF, spreadsheet into draft rows), using the spike's "checked" prompt.
- The guided interview that walks a pack's questions.
- The setup screens in guided setup (this change gives only the agent-page editor).
- Sector rule overlays chosen by business type. `organization.business_type` is shown to the agent, but nothing else uses it yet.
- Real-time tools named as pack gaps (`check_stock`, `hold_item`, job status, date-range availability).
- Retention for gap asks, and calibration of the catalogue score floor on real traffic.
- Using the knowledge core on the WhatsApp and phone paths, after those branches merge.
- Running the pack evaluation fixtures through the hosted gates.

## Amendment (2026-11-14): WhatsApp and real phone calls

`main` gained the WhatsApp channel and real phone calls while this was built. Both reuse the brain: WhatsApp calls `runTextBrain` (`engine/src/agent/brain.ts`) and phone calls call `runVoiceTurn` with a `VoiceTurnPolicy`.

- **Prompt sections: on for every channel.** When the session snapshot carries the knowledge core (`packs` or `context`), WhatsApp and phone turns get the same rules section (outranks everything) and the always-shown facts section, and search runs over units (facts as well as free text). Old snapshots keep the old prompt byte for byte.
- **Core tools: browser tests only, for now.** `lookup_catalogue`, `take_message.unanswered` and the gap log need SQL support per channel (`whatsapp_work` and `agent_call` allow-lists, and a lease check in `agent_knowledge` for their turns). Those functions belong to the WhatsApp and phone-line work and were not changed here. Those channels get the not-found rule in words their tool list can follow ("say you will ask staff, and call take_message"), so they never emit an argument their strict schema rejects. Catalogue rows are therefore not yet reachable on WhatsApp or real calls; this is the first item of the next piece.
- **Hours.** Hours from the schedule appear only when the session snapshot carries `context`. Browser test sessions freeze it; WhatsApp and phone sessions freeze the published version snapshot, which has rules and facts but no `context` yet, so they show no hours section until those session builders add it.
