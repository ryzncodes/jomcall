# TTS fallback spike (throwaway)

Date: 2026-11-14. Branch `spike/tts-fallback`. Throwaway code: nothing in the product may import it.

**Question.** `gemini-3.8-flash-lite-tts` on the owner's Google project allows about 11 requests a minute (about one call at a time), and Google's price is expected to double on 2027-01-01. Which voice could replace or back it up?

**Listen first:** open `listen.html` (3 MB, self-contained, works offline on a phone). Blind test, letters shuffled, key at the bottom.

## Recommendation

| | Candidate | Why | Main risks |
|---|---|---|---|
| **Fallback** | **MiniMax Speech 2.8 Turbo via fal, `/stream` endpoint** | Only tested candidate that streams: first audio median 0.89 s (max 1.31 s), whole clip 1.43 s. About USD 0.034 per spoken minute. Malay is a named `language_boost`. | Voice quality for BM/Manglish is **unjudged until you listen**. One 19.7 s cold first call. Digits line came out slow (12.5 s vs 7.4–8.9 s for the others). fal account concurrency starts at 2. Output is MP3 at 24 kHz, so the worker needs a decoder. Third party in the data path (PDPA cross-border is already open). |
| **Runner-up** | **ElevenLabs Eleven v4 Turbo, called direct (needs an account)** | Same voice as tested via fal, but direct has real streaming (vendor claims about 100 ms) and its own rate limits instead of fal's. Malay is in ElevenLabs' language list. USD 0.04 per 1K characters (about USD 0.027 per minute). | **Not tested direct** (no account). Via fal it is not streamed: 4.77 s median, too slow. The direct latency is a vendor claim only. |
| Bulk only | Gemini 3.8 Flash Lite via fal | Same voice as the reference (same words, same prosody), on fal's quota instead of the owner's Google project. | Not streamed: 6.46 s median. Good only for pre-warming fixed lines into the disk cache, never for live turns. |

Not recommended: Chatterbox Multilingual (9.5 s median, real-time factor 1.7, 300-character limit).

If Google sales raise the Gemini limit, the reference stays the best known option on speed (first audio 0.73 s) and price (owner's figure USD 0.009 per minute, not verified here). Re-check after 2027-01-01.

## Method

- 12 lines written for the spike with fake details (`lines.json`): 4 BM, 3 Manglish, 3 English, 2 Mandarin. They include "RM 85", "pukul sepuluh pagi", a date, "Jalan Melati Indah 3" address, a digit-by-digit phone number (`ml2`) and the filler "Sekejap ya, saya semak."
- `bench.py` (Python, `httpx`, needs `ffmpeg`). Keys come from the environment (`set -a; . .env.hosted; set +a`) and are never printed or written. Stages: `synth`, `latency`, `analyze`, `build`, `summary`. Raw audio and JSON results go to `results/` (git-ignored).
- **Latency.** Time from sending the request to the first audio byte (streamed) or to the finished clip including the download (not streamed; first audio = total). Median of 5 runs on each of 3 lines (`bm2`, `ml3`, `en2`), one warm-up per line discarded, 15 runs per candidate. Measured from this Mac to fal's and Google's servers, not from a Singapore server, so absolute numbers will differ in production. One run is not a distribution: treat 0.1 s differences as noise.
- **Reference (Gemini direct).** 12 calls only, 10 s apart (one per line, the clips you hear). Its latency is those 12 single runs, not 5 repeats. I made 3 extra calls to `gemini-2.5-*` model names that returned 404 (no audio, none billed as far as I know). No other Google calls.
- **Real-time factor** = total synthesis time / audio duration (median over the 12 clips). Under 1 means faster than real time.
- **Price per spoken minute** = measured characters per spoken second × 60 × list price per character. Gemini direct uses the owner's quoted USD 0.009, not recomputed.
- **Leading silence** = first sample above −40 dBFS in the decoded 24 kHz mono audio (median over 12 clips).
- **Transcript check.** Deepgram `nova-3` (`ms` for BM/Manglish, `en`, `zh`), compared to the script with a character-level similarity (0 to 1, mean over 12 lines). It is a **weak flag only**: it mixes speech-to-text error with voice error, and the script says "RM 85" and "0 1 2" where the transcript says words, so similarity is capped on those lines. Nothing here replaces listening. Number, MYR and Malay-name correctness is therefore **by ear**.
- **Voices.** One female voice per candidate, language set per line: Gemini `Kore`; MiniMax `Calm_Woman` with `language_boost` Malay/English/Chinese; ElevenLabs `Aria` with `language_code` `ms`/`en`/`zh`; Chatterbox default voice with language `malay`/`english`/`chinese`. Other voices may sound better or worse.
- **listen.html.** Every clip loudness-normalised to −20 LUFS and encoded AAC 48 kbps mono in MP4 (plays on iOS Safari). Candidate letters are shuffled with a fixed seed; the reference is not A.

## Results

| Candidate | Streamed | First audio, median (max) | Whole clip | RTF | Format as received | Lead silence | USD / spoken min | Transcript flag |
|---|---|---|---|---|---|---|---|---|
| Gemini 3.8 Flash Lite, Google direct (reference) | yes (SSE) | **0.73 s** (0.86) *n=12 single runs* | 1.78 s | 0.29 | PCM 16-bit 24 kHz | 11 ms | 0.009 (owner's figure) | 0.86 |
| MiniMax Speech 2.8 Turbo via fal `/stream` | yes (MP3 chunks) | **0.89 s** (1.31) | 1.43 s | 0.25 | MP3 24 kHz 128 kbps mono (I requested 24 kHz) | 194 ms | **0.034** | 0.88 |
| ElevenLabs Eleven v4 Turbo via fal | no | 4.77 s (5.67) | 4.77 s | 0.78 | PCM 24 kHz (requested `pcm_24000`) | 56 ms | 0.027 | 0.82 |
| Gemini 3.8 Flash Lite via fal | no | 6.46 s (7.58) | 6.46 s | 0.91 | WAV 24 kHz | 236 ms | 0.019 | 0.86 |
| Chatterbox Multilingual via fal | no | 9.54 s (19.99) *n=12 single runs* | 9.54 s | 1.70 | WAV | 40 ms | 0.017 | 0.85 |

Notes on the numbers:

- Prices per spoken minute: characters per second measured here (about 9.4 to 11.4) × fal's list price per 1,000 characters: Gemini 0.03, MiniMax 0.06, ElevenLabs v4 Turbo 0.04, Chatterbox 0.025 (each from `https://fal.ai/models/<id>/llms.txt`, read 2026-11-14). So **Gemini through fal costs about twice the owner's quoted direct price** and MiniMax about 3.8 times. fal bills the same list price as ElevenLabs direct for v4 Turbo (USD 0.04 per 1K characters, `https://elevenlabs.io/pricing/api`, 2026-11-14).
- MiniMax: the first request of the run took 19.7 s (cold start); later ones 0.9 to 2.1 s. Production needs keep-warm or an accepted rare slow first turn. Its digit line (`ml2`) lasted 12.5 s against 7.4 to 8.9 s elsewhere, so check the spacing by ear.
- Clips start with 190 to 240 ms of silence from the two Gemini-via-fal and MiniMax paths. The product's `LeadTrimmer` already trims lead silence; nothing else needed.
- fal's `/stream` returned audio only for MiniMax. The ElevenLabs and Gemini fal endpoints expose only queue and sync calls (OpenAPI paths list status, cancel and result only).
- Transcript flag is nearly identical across candidates (0.82 to 0.88), so it does not separate them. Lowest on `ml2` (digits) for everyone.

## Limits and what they mean in calls

Assumption: a caller turn every 15 s, two speech requests per turn (8 requests a minute per call), each request occupying a concurrency slot for its measured synthesis time.

| Service | Documented limit | Source (read 2026-11-14) | Simultaneous calls |
|---|---|---|---|
| Gemini direct (owner's project) | about 11 requests a minute | task brief, not a public page | 11 / 8 = **1.4 calls** |
| fal (any model, one account) | global concurrency: new accounts 2, self-serve up to 40 as credit purchases grow; requests queue, none dropped | https://fal.ai/docs/model-apis/rate-limits.md | MiniMax (1.4 s): 0.19 slots per call, so 2 slots ≈ **10 calls**, 40 slots ≈ 200. Non-streamed Gemini via fal (6.5 s): 0.87 slots per call, so 2 slots ≈ **2 calls** |
| Google classic TTS (Chirp 3 HD) | 200 requests a minute and 100 concurrent streaming sessions per project | https://docs.cloud.google.com/text-to-speech/quotas | 25 calls (not usable: no Malay, see below) |
| Azure Speech standard voices | Free: 20 transactions per 60 s. Paid S0: 30 transactions per second default, adjustable to 1,000. Note: many 429s come from per-voice regional capacity, not quota | https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits | far above need on paper |
| Cartesia | TTS concurrent requests: Free 2, Pro 3, Startup 5, Scale 15 | https://docs.cartesia.ai/use-the-api/concurrency-limits-and-timeouts | at 1.4 s hold: 5 slots ≈ 25 calls |
| ElevenLabs direct | concurrency by plan; the plan table I could read is for WebSocket dialogue sessions (Free 14 … Pro 70), not the HTTP TTS limit | https://elevenlabs.io/docs/overview/models | not determined |

Your own fal limit is on its dashboard Concurrency page (https://fal.ai/dashboard/usage-billing/concurrency); I did not look at the account.

## Google Cloud Text-to-Speech (classic API): blocked, and not useful for Malay anyway

- Exact result with the existing key, on `texttospeech.googleapis.com` (`voices.list` and `text:synthesize`, key in header and in query string):

  `401 UNAUTHENTICATED: API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal.` (`reason: CREDENTIALS_MISSING`)

- The official authentication page (https://docs.cloud.google.com/text-to-speech/docs/authentication) describes only OAuth, Application Default Credentials and service-account impersonation. It does not mention API keys at all. The existing key works on the Gemini endpoint on `aiplatform.googleapis.com` only.
- **Owner step if wanted:** in project `our-foundry-514605-c6`, enable "Cloud Text-to-Speech API" (APIs & Services → Library), create a service account with a Text-to-Speech role, and have the worker send an OAuth access token instead of `x-goog-api-key`. That is a code change in the worker, not a console switch.
- **Chirp 3 HD does not list Malay.** The Chirp 3 HD language table (https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd, 2026-11-14) has Indonesian `id-ID`, Mandarin `cmn-CN` and Malayalam but no `ms-MY`. Malay (Malaysia) appears in two places only: Standard voices `ms-MY-Standard-A` and following (https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types), and Gemini-TTS as "Preview" (https://docs.cloud.google.com/text-to-speech/docs/gemini-tts). Chirp 3 HD price: USD 30 per 1M characters (https://cloud.google.com/text-to-speech/pricing). So this path would only add Standard voices, which are not natural enough for a call. I did not try them.
- I also tried three other Gemini TTS model names on the Agent Platform endpoint with the existing key (`gemini-2.5-flash-tts`, `gemini-2.5-flash-lite-preview-tts`, `gemini-2.5-pro-tts`): all 404.

## Candidates considered and left out

- fal list checked 2026-11-14 (`https://fal.ai/api/models`, 62 text-to-speech entries). Pages with no mention of Malay in their model text: Inworld TTS-1.5, Qwen 3 TTS, Seed Speech v2, Eleven v4 (full), xAI TTS, Zonos2, Async. Not tested for that reason. Eleven v4 Turbo is included because ElevenLabs lists Malay (`ms`) among its supported languages; I did not verify Malay for the v4 Turbo model specifically beyond the vendor's "90+ languages" line.
- MiniMax Speech 2.8 HD (USD 0.10 per 1K characters) would cost about 1.7 times Turbo; not run.
- OpenAI `gpt-audio-mini` through OpenRouter: callable, but it is a chat model that may paraphrase instead of reading, and I did not find an official page claiming Malay support, so it was not tested.
- Deepgram Aura and Speechmatic TTS (keys exist): English-centred; not checked for Malay and not tested.

## Documented only (not called, no accounts opened)

Read 2026-11-14. "Not extracted" means the page did not give a figure in a form I could read; check before deciding.

| | Azure Speech | ElevenLabs direct | Cartesia direct |
|---|---|---|---|
| Malay | `ms-MY` listed with neural text-to-speech support (https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support). Voice names `ms-MY-YasminNeural` and `ms-MY-OsmanNeural` come from a secondary search result, not the official page | `Malay (ms)` appears in the language list on https://elevenlabs.io/docs/overview/models; v4 Turbo advertises "90+ languages" (https://elevenlabs.io/pricing/api). Per-model Malay not confirmed | `ms` is in the language list of `sonic-3.6-2026-08-27` (https://docs.cartesia.ai/build-with-cartesia/tts-models/latest) |
| Streaming latency claim | not extracted | v4 Turbo "ultra-low latency (~100ms)" (https://elevenlabs.io/pricing/api), vendor claim | not extracted from official pages; third-party reports say 40–190 ms, unverified |
| Price | page rendered "$-" for every rate, not extracted. The free tier is 0.5 million neural characters a month (https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/). Use the Azure pricing calculator for the Southeast Asia region | v4 Turbo USD 0.04 per 1K characters; v4 USD 0.08; v3 USD 0.08 (https://elevenlabs.io/pricing/api). At about 10.5 characters per second that is about USD 0.025 per spoken minute for v4 Turbo | credits per character (or per second); the page text did not give USD per credit. Not extracted |
| Concurrency | see table above: 30 TPS default on S0, adjustable to 1,000 | by plan; HTTP table not read | Free 2, Pro 3, Startup 5, Scale 15 |
| Sign up | Azure subscription, then create a Speech resource in a region (for example Southeast Asia) and use its key. Needs a payment card on the subscription | elevenlabs.io account, API key in profile; usage billed by plan | cartesia.ai account (free plan available), API key from the dashboard |

## What changing `voice/jomcall_voice/voice_out.py` to a second provider involves

I did not change it. The class `Voice` is a single provider's streaming client with a disk cache. A second provider means:

1. **Pick the provider per call, not per request.** A caller must not hear two voices mid-call. Choose once at call start, and if the first provider returns 429 on the *first* spoken line, fall back for the whole call. Also decide what the business-owner "voice preset" means for each provider (Kore is Gemini-specific; MiniMax and ElevenLabs have their own voice names).
2. **Split `Voice` into a small interface** (`speak(text) -> async iterator of 16-bit mono PCM chunks at 24 kHz`) with one class per provider. MiniMax `/stream` returns MP3 chunks, so the worker needs a streaming MP3-to-PCM decoder and a resample to 24 kHz; the pinned `av` library can do this but check the codec path is still licence-clean (the FFmpeg/GPL question in `AGENTS.md` is already open).
3. **Cache key.** `_path()` hashes model, preset and text. It must also include the provider name, or two providers will share clips. Fixed lines (opening, fillers) must be **prewarmed per provider**; Gemini via fal is acceptable for that since latency does not matter.
4. **Non-streaming providers lose the speed advantage.** The ElevenLabs and Gemini fal routes return a finished clip after 4 to 7 s, which breaks the 1.5 s first-sound goal. The fallback must be a streaming provider, or must be used only for cached lines.
5. **Errors and limits.** `VoiceRefused` (429) means "do not retry" today; fal queues instead of refusing, so a slow request is the signal, not a 429. Add a timeout per provider shorter than the current 20 s, and keep at most two requests per turn.
6. **Keys and config.** Add the key name to `config.py` and `.env.hosted`; `AGENTS.md` lists approved outbound services, so a new provider (fal and MiniMax) needs the owner's explicit approval there before it is used by the product.

## Reproduce

```bash
set -a; . /path/to/.env.hosted; set +a
python3 bench.py synth gemini_direct   # 12 Google calls, 10 s apart
python3 bench.py synth minimax eleven gemini_fal chatterbox
python3 bench.py latency
python3 bench.py analyze
python3 bench.py build
python3 bench.py summary
```

Estimated spend (from billed characters, not from account statements): fal about USD 0.35, Deepgram a few cents, Google 12 Gemini calls under one cent.
