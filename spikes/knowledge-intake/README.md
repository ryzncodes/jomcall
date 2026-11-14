# Knowledge intake spike

Throwaway measurement spike (2026-11-14). It tests two assumptions behind the "one knowledge core" design (facts, a searchable catalogue, rules):

1. Can the agent find the right fact, across BM / English / Manglish / Mandarin, fast enough for a voice turn?
2. Can a vision-capable Claude model turn the messy things owners actually have (photos, PDFs, spreadsheets, pasted chat) into structured rows and facts without wrong prices?

Nothing in the product imports from here. All data is fake. Raw outputs are in `results/` (git-ignored). Re-run: `npm run search`, `npm run docs`, `npm run extract`, `npm run score` from this folder (keys come from the main checkout's `.env.hosted`; no key is read into a file or printed).

## Headlines

- **Search.** An embedding model on one unit per fact or catalogue row finds the right source in the top 3 for **99-100%** of answerable questions (gemini-embedding-001: top 1 = 96%, English and BM paraphrase, cross-language and part numbers all ≥ 90%). The current keyword code gets 56% top 1 and 74% top 3 on today's 1200-character chunks, and 33% / 52% for Mandarin.
- **Voice budget.** The embedding call alone is **130 ms p50 / 200 ms p90** (Vertex, from this laptop). That does not fit the 150 ms budget with room to spare. Keyword/trigram lookup (1-3 ms) fits; embeddings need the call to start early or run in parallel with something else.
- **Not-in-knowledge questions are the weak spot.** Even the best method returns a hit for all 15 absent questions, and 5 of 15 clear a threshold that keeps 90% of correct answers. The agent needs an "I don't have that" rule that does not rely on score alone.
- **Extraction.** All three Claude models read all 12 synthetic documents with **0 wrong prices out of 212 gradable rows, 0 missed rows, and 99-100% name/variant accuracy**. Haiku 5.5 does this at **$0.0015 per document** (Opus 5.5: $0.043, Sonnet 5.5: $0.019). Covered or unreadable prices were left blank or flagged in every case. **Caveat: the documents are crisp renders, so this is an upper bound, not a promise for real photos.**
- **Spend.** About $1.85 in total (extraction $1.75, Haiku tool-argument test about $0.003, embeddings under $0.05). Estimated before starting: "a few dollars".

## Method

### Part 1: search

**Test set** (`search/knowledge.ts`, `search/catalogue.ts`, `search/questions.ts`). Four fake businesses written the way owners write (mixed languages, abbreviations, MYR): a salon (27 facts), an aircon company (30), a tuition centre (29) and an auto parts shop (30 facts + a **300-row catalogue**, built from 15 car fitments × 18 parts + 30 universal items, invented part numbers). 120 questions, exactly 30 per language, each labelled with the source id(s) that answer it: 14 direct, 23 paraphrase, 33 cross-language (question and knowledge in different languages), 17 model-name lookups, 8 part-number lookups (spaced, dashless, lowercase, one wrong digit), 10 speech-to-text misspellings and 15 not in the knowledge.

**Methods.**
- *keyword-current*: `searchKnowledge` imported read-only from `packages/domain/src/agent-test/knowledge.ts`, run (a) on the product's own 1200-character chunks and (b) on one unit per fact/row.
- *BM25*: standard ranked keyword scoring, as a stand-in for Postgres full-text search.
- *Embeddings*, cosine on normalised vectors, brute force. Which models the approved keys reach: OpenRouter exposes 39 embedding models; Google's key reaches `gemini-embedding-001` and `text-multilingual-embedding-002` on Vertex and `gemini-embedding-001/-2` on the Gemini API. Tested: `gemini-embedding-001` (Vertex, 3072 dims and truncated to 768), `baai/bge-m3` (OpenRouter, MIT licence, 1024 dims), `google/gemini-embedding-2` (OpenRouter, 3072 dims). **`text-multilingual-embedding-002` was not measured:** Vertex returned HTTP 429 (quota exceeded for its base model) on every attempt. No local model was tried because hosted ones were reachable.
- *Hybrid*: reciprocal-rank fusion of BM25 and embedding ranks. Not tuned (equal weights, depth 30).
- *Catalogue*: embedding over the 300 rows; trigram match on part-number and item/fitment columns (the shape `pg_trgm` gives); a router (part number first, else trigram fused with embedding); and trigram where `claude-haiku-5-5` writes the lookup arguments (part number, car model, item) first.

**Scoring.** A hit counts when the retrieved unit covers a labelled source. For the 1200-character chunks a chunk "covers" a fact if it holds at least 60% of its characters. "Confident" means the top score is above a threshold chosen per method to keep 90% of the correct top-1 answers; the table reports how many of the 15 absent questions clear it. The threshold is crude (set on the same questions) and a real system should calibrate on separate data. Latency is the measured query-embedding round trip (one text per call, from a laptop in Malaysia) plus local scoring; the local scoring is 0-3 ms here.

### Part 2: extraction

**Documents** (`extraction/make-docs.ts`, ground truth in `extraction/truth.ts`): four photo-style images (salon price list with a taped-over price and a handwritten correction; chalkboard kopitiam menu with hot/iced columns and glare over one price; aircon flyer with a promo sticker over one cell; handwritten tuition sheet with one smudged digit), two PDFs (a 36-row text table with one "TBA", and an image-only scanned rate card with a rubber stamp over prices), three spreadsheets (merged title and header rows, side-by-side tables, "tanya boss", "dari 80", "+15", one text price), and three pasted chats (a price dictation with a correction and an "about RM65", a Manglish + Mandarin catering message, and a shop-rules chat with a forwarded advert and banter around it). Each has hand-written rows (item, variant, price in sen, unit) and facts (hours, address, policies). 212 rows in total, 68 facts.

Images are HTML screenshotted through Chrome with rotation, perspective, blur, noise, shadow and JPEG compression. Spreadsheets are read locally (cells with addresses and merge ranges, as text) and the model never sees the file. PDFs go to the model as documents.

**Models and prompts.** `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (ids in `models.ts`), effort `medium`, structured JSON output, no refusal fallback. Two prompt designs: *plain* (extract; give null and list what could not be read) and *checked* (adds per-row `confidence`, `needs_owner_check` and `check_reason`, and facts get `needs_owner_check`). 72 calls.

**Scoring** (`extraction/score.ts`): rows are matched to truth by name similarity (and price) with a one-to-one assignment. A price is wrong only if present and different. "Hidden" prices (physically covered or not given) are right only if left blank or flagged. Facts are found when regexes for all their key parts appear.

## Results: search

All 120 questions, one index per business (105 answerable, 15 absent). Cells: share of answerable questions whose correct source is in the top 1 / 3 / 5.

| Method | Top 1 | Top 3 | Top 5 | Absent: confident hit | Answerable: confident but wrong | p50 / p90 ms | $ per 1k queries | $ per 1k units indexed |
|---|---|---|---|---|---|---|---|---|
| keyword-current, 1200-char chunks (today) | 56% | 74% | 75% | 11/15 | 31/105 | 0.1 / 0.4 | 0 | 0 |
| keyword-current, one unit per fact/row | 44% | 53% | 56% | 11/15 | 44/105 | 0.1 / 0.5 | 0 | 0 |
| BM25, one unit per fact/row | 44% | 52% | 58% | 7/15 | 24/105 | 0 / 0.2 | 0 | 0 |
| gemini-embedding-001 3072d, 1200-char chunks | 80% | 94% | 98% | 10/15 | 20/105 | 130 / 200 | 0.0014 | 0.070 |
| **gemini-embedding-001 3072d, per fact/row** | **96%** | **99%** | **100%** | 5/15 | 3/105 | 131 / 200 | 0.0014 | 0.0064 |
| gemini-embedding-001 768d (truncated), per fact/row | 96% | 100% | 100% | 5/15 | 2/105 | 130 / 200 | 0.0014 | 0.0064 |
| hybrid BM25 + gemini-001 768d | 70% | 90% | 96% | 4/15 | 13/105 | 130 / 200 | 0.0014 | 0.0064 |
| bge-m3 1024d, 1200-char chunks | 71% | 91% | 94% | 8/15 | 21/105 | 584 / 706 | 0.0001 | 0.0040 |
| bge-m3 1024d, per fact/row | 84% | 94% | 98% | 4/15 | 11/105 | 584 / 707 | 0.0001 | 0.0004 |
| gemini-embedding-2 3072d, per fact/row | 88% | 97% | 98% | 10/15 | 10/105 | 746 / 831 | 0.0019 | 0.0085 |
| hybrid BM25 + gemini-2 | 69% | 87% | 95% | 9/15 | 22/105 | 746 / 831 | 0.0019 | 0.0085 |

The two OpenRouter models are slower mainly because of the extra hop (their latency is the HTTP round trip, not model time). "Absent: any hit" is 11/15 for keyword methods and 15/15 for every embedding method (an embedding always returns something).

By language (top 1 / 3 / 5, answerable only; n ≈ 26-27 each):

| Method | BM | English | Manglish | Mandarin |
|---|---|---|---|---|
| keyword-current, 1200-char chunks | 65 / 92 / 96 | 42 / 58 / 58 | 85 / 96 / 96 | 33 / 52 / 52 |
| keyword-current, per fact/row | 54 / 62 / 69 | 35 / 38 / 42 | 62 / 85 / 85 | 26 / 30 / 30 |
| gemini-001 3072d, per fact/row | 96 / 100 / 100 | 100 / 100 / 100 | 92 / 96 / 100 | 96 / 100 / 100 |
| gemini-001 768d, per fact/row | 96 / 100 / 100 | 100 / 100 / 100 | 96 / 100 / 100 | 93 / 100 / 100 |
| bge-m3, per fact/row | 92 / 100 / 100 | 88 / 92 / 100 | 77 / 96 / 100 | 78 / 89 / 93 |
| gemini-2, per fact/row | 92 / 100 / 100 | 88 / 96 / 100 | 85 / 100 / 100 | 85 / 93 / 93 |

By question kind (top 1 / 3):

| Method | direct | paraphrase | cross-language | speech misspelling | model name | part number |
|---|---|---|---|---|---|---|
| keyword-current, 1200-char chunks | 100 / 100 | 65 / 91 | 33 / 42 | 40 / 60 | 53 / 100 | 75 / 75 |
| keyword-current, per fact/row | 86 / 100 | 65 / 78 | 9 / 12 | 10 / 20 | 53 / 71 | 75 / 75 |
| gemini-001 3072d, per fact/row | 100 / 100 | 100 / 100 | 97 / 100 | 90 / 90 | 88 / 100 | 100 / 100 |
| gemini-001 768d, per fact/row | 100 / 100 | 100 / 100 | 94 / 100 | 90 / 100 | 94 / 100 | 100 / 100 |
| bge-m3, per fact/row | 93 / 100 | 91 / 96 | 82 / 94 | 70 / 100 | 82 / 88 | 75 / 88 |
| gemini-2, per fact/row | 93 / 100 | 87 / 100 | 91 / 97 | 70 / 100 | 100 / 100 | 63 / 75 |

Note that chunking by itself hurts keyword search once units get small (cross-language falls from 33% to 9%) and helps embeddings a lot (80% → 96%): small units are what makes embeddings sharp, but a keyword scorer needs the surrounding context. Part numbers on 1200-character chunks fail for embeddings (0% top 1 for gemini): a 300-row table in one chunk gives a part number nothing to latch onto.

### Catalogue only (300 rows; 24 questions, 4 of them absent)

| Method | Top 1 | Top 3 | Top 5 | Absent: confident hit | Confident but wrong | p50 / p90 ms |
|---|---|---|---|---|---|---|
| trigram on columns, raw caller text | 79% | 83% | 83% | 0/4 | 4/24 | 1.4 / 2.3 |
| **trigram on columns, arguments written by Haiku 5.5** | **92%** | **96%** | **96%** | 0/4 | 2/24 | 2.1 / 3.4 (+ the model call, see below) |
| embedding over rows, gemini-001 768d | 92% | 100% | 100% | 0/4 | 1/24 | 132 / 168 |
| embedding over rows, gemini-001 3072d | 88% | 96% | 100% | 0/4 | 2/24 | 132 / 169 |
| part-number trigram first, else trigram + embedding (gemini-001 768d) | 83% | 96% | 96% | 0/4 | 4/24 | 123 / 167 |
| embedding over rows, bge-m3 | 71% | 88% | 96% | 2/4 | 4/24 | 579 / 663 |
| embedding over rows, gemini-2 | 79% | 92% | 92% | 1/4 | 2/24 | 754 / 842 |

Exact/fuzzy part-number matching alone is 8/8 on the part-number questions (including spaced, dashless and lowercase forms) and stays at 1-3 ms. Raw caller text against item names fails mostly on Mandarin and on model names ("Myvi 2019" vs a row labelled "Myvi 1.3/1.5 2018+ (G3)"). Letting the agent model write the lookup arguments fixes most of that at no search cost, because the model already writes its tool call in the same turn. The model call itself took 1.7 s p50 here as a standalone call and is not part of the 150 ms (the agent turn pays that time anyway). The 4 absent catalogue questions are too few to judge.

### What a pgvector set-up would need

Facts from the pgvector README (v0.8.7) and Supabase docs, sizes computed here (the index sizes are estimates, not measured):

- **Type and dimensions.** `vector` indexes (HNSW and IVFFlat) stop at **2,000 dimensions**; `halfvec` stops at 4,000. So `gemini-embedding-001` at its default 3072 needs `halfvec(3072)` or truncation. This spike found **768 dimensions as accurate as 3072** (96% / 100% top 1/3), so use `vector(768)` (or `halfvec(768)`). Truncated vectors must be re-normalised (the spike does this; embedding-001 is not auto-normalised when truncated).
- **Index.** HNSW (`vector_cosine_ops`; Supabase says HNSW should be the default). Defaults: `m = 16`, `ef_construction = 64`, `hnsw.ef_search = 40`. A tenant filter (`WHERE business_id = …`) is applied after the index scan, so with many tenants enable iterative scans (`hnsw.iterative_scan`, pgvector ≥ 0.8.0) or partition/filter by business so the result list is not emptied. At a few thousand rows per business a plain exact scan with a `business_id` btree index is also fast enough and has perfect recall: consider no vector index until a tenant crosses roughly 10k rows. The Supabase pgvector version was not stated in the docs; check with `select extversion from pg_extension where extname='vector'`.
- **Storage per 10,000 chunks** (`4 × dims + 8` bytes per `vector`, `2 × dims + 8` per `halfvec`): 768d `vector` = 30.8 MB; 1024d = 41 MB; 3072d `halfvec` = 61.5 MB; 3072d `vector` = 123 MB (and too big to index). Add roughly the same again for an HNSW index (estimate), plus the text. Embedding the 10,000 chunks once costs about $0.06 with gemini-embedding-001 (about 43 tokens per unit here, measured).
- **Catalogue columns.** Keep `part_no` normalised (upper-case, alphanumerics only) in its own column with a `pg_trgm` GIN index (supports `%` similarity); `<->` distance needs GiST. Item and fitment text get a GIN trigram index too.

### Which options fit the 150 ms voice budget

| Option | Search time | Fits? |
|---|---|---|
| Keyword / BM25 / trigram on structured columns | 0-3 ms | Yes, but accuracy is not good enough alone (cross-language 6-33%) |
| Embedding with Vertex `gemini-embedding-001` | 130 ms p50, 200 ms p90 (client-side, from Malaysia, one text per call) | No: leaves nothing for the database query, and p90 is over the budget |
| Embedding through OpenRouter (bge-m3, gemini-2) | 580-750 ms | No |
| Catalogue: part number matched by trigram, arguments written by the agent model | 2-3 ms | Yes |

To use embeddings in a voice turn: start the embedding as soon as the caller's final transcript arrives and run it in parallel with the model's decision to call the tool; run the call from a server near the provider endpoint (the latency measured here includes a laptop's network path and was not tried from a hosted server); cache embeddings of repeated questions; or evaluate a small local multilingual model on the host (not measured here). For WhatsApp and text there is no such constraint.

## Results: extraction

212 gradable rows and 68 facts across 12 documents. "Price errors" counts a price present but different from truth.

| Model / prompt | Rows found | Missed | Invented | Name | Variant | Unit | Price exact | Price errors | Hidden price: blank / guessed+flagged / guessed silently | "About" price flagged | Corrections right | Facts found | $ per doc | Time p50 / p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 plain | 212/212 | 0 | 1 | 100% | 100% | 92.8% | 98.5% | 0 | 7 / 0 / 0 of 7 | 1/2 | 4/4 | 68/68 | 0.043 | 12.1 / 15.9 |
| Opus 5.5 checked | 215/215 | 0 | 3 | 100% | 100% | 97.1% | 99.0% | 0 | 7 / 1 / 0 of 8 | 2/2 | 4/4 | 68/68 | 0.055 | 14.9 / 22.2 |
| Sonnet 5.5 plain | 213/213 | 0 | 3 | 100% | 100% | 97.1% | 98.5% | 0 | 7 / 0 / 0 of 7 | 0/2 | 4/4 | 68/68 | 0.019 | 5.9 / 12.5 |
| Sonnet 5.5 checked | 214/214 | 0 | 5 | 100% | 100% | 97.1% | 99.0% | 0 | 6 / 1 / 0 of 7 | 2/2 | 4/4 | 68/68 | 0.025 | 9.3 / 13.9 |
| Haiku 5.5 plain | 213/213 | 0 | 1 | 99.5% | 100% | 92.8% | 98.5% | 0 | 7 / 0 / 0 of 7 | 1/2 | 4/4 | 65/68 | 0.0015 | 8.7 / 12.3 |
| Haiku 5.5 checked | 213/213 | 0 | 1 | 100% | 100% | 97.1% | 99.0% | 0 | 7 / 0 / 0 of 8 | 2/2 | 4/4 | 68/68 | 0.0019 | 13.0 / 18.0 |

Price exact is below 100% only on one document, and the fault is in the test document, not the models: the rubber stamp on the scanned rate card (d06) also covers the Queen comforter, the carpet and the shoe-wash prices, which the ground truth lists as readable. All six configurations correctly left those prices blank (the checked prompt flagged them, and gave "RM3.5, best guess" for the carpet as a flagged best reading). Counting them as correct would put price exact at 100% for every configuration. No configuration produced a wrong price, silently or flagged. "Invented" rows are splits or extra fee lines the truth did not list (e.g. a "towing beyond 5 km" row with no price), not made-up prices. The full per-document breakdown with every miss, invented row and fact is in `results/extraction.json`.

Per source kind (price exact, all configurations): images 100%, spreadsheets 100%, chats 100%, PDFs 93-96% (the stamped scanned rate card; see above, the models were right). Median seconds per document: images 10-18, PDFs 12-27, spreadsheets 6-15, chats 5-12. See `results/extraction.md` for the full per-kind table.

**Flagging behaviour.** The *checked* prompt did what it is meant to do: both smudged-digit rows were answered correctly in all three models (and flagged for the owner when unsure), the "about RM65" and "dari 80" prices were flagged in 2 of 2 cases (the plain prompt flagged 0-1 of 2), and the one hidden price a model guessed (Opus; Sonnet) was flagged, never silent. Over-flagging is the cost: the checked prompt marked 4.6% (Opus), 7.1% (Sonnet) and 10.2% (Haiku) of rows whose price was correct and clearly readable as needing an owner check. The same figure for plain is 10-12% but is a scorer artefact (a plain row counts as flagged when its item name overlaps a line in `unreadable`), so compare plain and checked only on the other columns.

## What is good enough to build on

- **Embeddings over small units (one fact, rule or catalogue row per unit), in a per-business index.** 96% top 1 and 99-100% top 3 across all four languages, including cross-language and speech-garbled questions. The current keyword search is not (56% / 74%, 52% top 3 for Mandarin, 11 of 15 absent questions returning a confident wrong hit).
- **Structured catalogue lookup.** Part-number trigram matching (8/8) plus lookup arguments written by the agent model (92% / 96% / 96%) is as good as embeddings over rows, runs in 2-3 ms and avoids the "which unit does a part number belong to" problem.
- **Reading documents with a vision model into rows and facts, with an owner review step.** No wrong prices on 212 rows, no missed rows, hidden prices left blank or flagged. Haiku 5.5 gets there at about 1/30 the price of Opus 5.5.

## What is not good enough (or not proven)

- **"Not in the knowledge" detection from search scores.** Embeddings always return something; the best method still passes the confidence threshold for 5/15 absent questions, and the threshold was tuned on the same questions. The agent prompt must handle "answer is not in these results", the thresholds must be calibrated on real traffic, and the product must make "I will ask staff" an easy path.
- **Embedding latency for voice.** 130 ms median (200 ms p90) through Vertex is over a 150 ms budget once the database is added.
- **BM25/keyword fusion as tested.** Equal-weight rank fusion made accuracy worse than embeddings alone (70% top 1 against 96%): the keyword side adds noise for cross-language and misspelt questions. Untuned; if it is wanted for exact terms, weight it low or use it only for the part-number and model-code fast path.
- **bge-m3 and gemini-embedding-2 through OpenRouter.** Weaker on Manglish/Mandarin top 1 and part numbers (gemini-2: 63% top 1), 580-750 ms.
- **The extraction result is an upper bound.** The documents are crisp HTML renders with deliberate faults, 36 rows at most, and were written by the same author as the truth. Real owner photos (motion blur, shadows, small handwriting, folded paper, a catalogue of 2,000 rows over many pages) are not covered. The 16,000 output-token ceiling used here would truncate a very long list; chunking long documents was not tested.
- **The question set is small and written by the same author as the knowledge** (120 questions, 26-27 per language, 4-24 per sub-cut). Differences of a few points are not significant, and a real test with owners' own questions will be harder. Mandarin and Manglish are written by a model, not collected from callers.

## Recommended search design

1. **One unit per fact, rule or catalogue row**, each stored with `business_id`, `language`, a short title, the text, and a normalised `part_no` for catalogue rows. Embed `title + text`. This is a change to the intake pipeline, not to search: extraction must produce these units.
2. **Two lookup paths in one tool.** (a) Semantic search over facts and rules: query embedding → cosine on `vector(768)` (gemini-embedding-001 truncated, re-normalised), top 3-5 with scores. (b) Catalogue lookup with structured arguments the agent model fills in (`part_number`, `car_model`, `item`): normalised part number first (exact, then trigram), otherwise trigram on item/fitment, falling back to embedding search over rows when nothing matches.
3. **Voice latency.** Start the embedding when the caller finishes a turn, in parallel with the model's tool decision; call the provider from the same region as the app; cache by normalised question text. Measure it again from a hosted server before promising 150 ms. Keep "facts always shown" in the prompt (opening hours, address, policies that most calls need) so common questions need no search at all.
4. **Score-aware answers.** Return the top score with each hit and keep a floor below which the agent says it does not know and offers a message or transfer. Calibrate the floor on real calls, not on this set.
5. **Postgres.** `vector(768)` + HNSW (cosine) with iterative scans, or exact scan per business under about 10k rows; `pg_trgm` GIN on `part_no` and item/fitment text. Re-embedding on model change needs a version column.

## Recommended extraction design

1. **Model.** Start with `claude-haiku-5-5` and the *checked* prompt: 0 wrong prices here at $0.0019 per document, with `needs_owner_check` and `check_reason` per row. Treat Sonnet 5.5 (about $0.025) as the fallback for documents Haiku flags heavily, and run a few hundred real owner documents through all three before trusting the ranking, since this test cannot separate them.
2. **Always an owner review screen.** Show flagged rows first (hidden, partly hidden, "about", "call", conflicting), and show unflagged rows as a table beside the source image. Never publish a row with a null price; a price from "approximately" or a smudged digit is never published without the owner's confirmation. The over-flag rate (5-10% of clean rows) is acceptable for an owner clicking through.
3. **Spreadsheets** parsed locally into a cell dump with addresses and merge ranges, then given to the model as text (worked on all three: merged headers, side-by-side tables, text prices). **Chat paste**: pass the pasted text as is; the model handled corrections and ignored adverts and banter. **PDFs** with a text layer and scanned PDFs both go in as documents.
4. **Long inputs.** Split by page or section, extract each part, merge, and de-duplicate by (item, variant). Needs its own test at the 1,000-row scale.
5. **Facts** are extracted in the same call and shown as editable cards (hours, address, contact, policies). All 68 facts were found by all three models in the checked runs.

## Risks

- **Confidently wrong answers on questions outside the knowledge**; wrong price if the extraction ever misses a flag. Mitigations above; keep the PDPA and "agent never invents price" tests in the QA suite.
- **Hosted providers.** Both parts sent fake text and images to Anthropic, OpenRouter and Google, the three approved providers. Real owner documents and caller questions would contain business and sometimes personal data (spreadsheets with customer names, chat exports with phone numbers). The PDPA cross-border decision recorded in `.agent/handoff.md` applies here too: embeddings of caller questions leave the country.
- **Provider quota.** Vertex returned 429 for `text-multilingual-embedding-002` even at a trivial rate; embedding and extraction capacity should be checked (and a quota raised) before a launch. The Vertex express-mode API-key route was not documented in the pages read, so confirm that production would use the same auth and be allowed to.
- **Price listings not verified.** The `gemini-embedding-001` price used ($0.15 per 1M tokens) is the figure from the Gemini API pricing page and the OpenRouter listing; the Vertex pricing table could not be fetched. `text-multilingual-embedding-002` has no price in this report.
- **Vendor lock-in on embeddings.** Switching embedding model means re-embedding everything; store the model id and dimension with each vector.
- **Spike limitations** listed under "What is not good enough".

## Questions for the owner

1. Is a latency of about 130-200 ms for semantic search acceptable if it runs in parallel with the model's own turn, or must the voice path stay under 150 ms in all cases (then facts-always-in-prompt plus structured catalogue lookup only, semantic search for WhatsApp and text)?
2. Which embedding provider may be used in production: Google (Vertex or Gemini API) directly, OpenRouter, or only a model that runs on JomCall's own host? This affects latency, the PDPA position and the cost of re-embedding.
3. How should the agent behave when nothing relevant is found: say it will ask staff and take a message (recommended), or transfer to a human immediately?
4. Is an owner review step before anything goes live acceptable for every upload (recommended), or should high-confidence rows publish automatically after the first few weeks?
5. May the intake path send owners' real photos, PDFs and spreadsheets to a hosted Claude model (this spike only used fake data)? If not, is a smaller locally hosted vision model an acceptable trade for accuracy?
6. Which languages need to be fully supported for **document text** (as opposed to calls)? Handwritten Jawi, Tamil and Chinese-only price lists were not tested.
7. What is the largest catalogue to support at launch (hundreds, thousands, tens of thousands of rows)? Above about 10k rows per business the index type and the long-document extraction path both need a second look.
