# Voice options for natural Malaysian calls

Research notes, 2026-10-15. Prices and free tiers come from provider pages and may change; items marked "unverified" were not confirmed from an official source. No provider has a published test of how natural it sounds in Malay or Manglish, so the final choice comes from a blind listening test with Malaysian listeners, at phone quality (8 kHz).

## Text-to-speech candidates

| Option | Malay | Free tier | Card at sign-up | Paid price (approx.) | Notes |
|---|---|---|---|---|---|
| Cartesia Sonic 3.6 | listed (`ms`) | 20k credits/month (~20 min speech) | unverified | ~USD 38-65 per 1M chars (~USD 0.03-0.05/min) | Fastest reported time to first audio (third-party figure); LiveKit plugin |
| ElevenLabs Flash v2.5 / v4 | listed | 10k credits/month (~10 min) | unverified | per-character price not published | Voice cloning; v4 has expressive audio tags; LiveKit plugin (connect directly, not via LiveKit's hosted inference) |
| Azure ms-MY Yasmin / Osman (incl. DragonHD) | native Malaysian voices | 0.5M chars/month (~9 h) | yes | historically ~USD 16 per 1M chars (~USD 0.015/min), unverified | Only native Malaysian voices confirmed in official docs; code-switching unproven |
| Google Gemini TTS ms-MY | listed (preview) | unverified | yes | unverified | Streaming, style prompt |
| MeloTTS-MS / Malaysian-F5-TTS (mesolitica, open) | Malaysian speakers | free, self-hosted | no | own server cost | License unknown; one training speaker is a public figure: never ship a voice resembling a real person without written consent |
| MMS-TTS (Meta, open) | Malay | free | no | n/a | Non-commercial license: benchmark only |

One minute of speech is roughly 800-900 characters. The agent speaks for only part of each call, so the real voice cost per call minute is lower.

**Recommended path:** test with Cartesia and ElevenLabs free credits plus open models; launch on the cheapest option that passes the blind test. Long term, consider cloning a voice from a hired Malaysian voice actor (with written consent), because accent matters more than the model.

## Techniques that make calls sound natural

1. **Fast first reply:** aim for the agent to start speaking within ~800 ms. Stream the reply, synthesize the first sentence first, and cache fixed lines (greeting, disclosure) as pre-made audio.
2. **Fill the wait:** while a tool runs (checking the calendar), say a short line ("Okay, jap ya, saya check slot...") and play a soft hold or typing sound.
3. **Write the way people speak:** short sentences, spoken register rather than formal BM, local particles (ya, kan, lah, okay), code-switch the way the caller does. This is a prompt rule for the language model.
4. **Say numbers the Malaysian way:** phone numbers in groups ("kosong satu dua, tiga empat lima..."), "RM dua ratus lima puluh", "pukul tiga petang". Keep a pronunciation dictionary for places (KLCC, Cyberjaya, SS15).
5. **Turn-taking:** a turn detector that knows when the caller has finished, barge-in so callers can interrupt, and short backchannels ("mm", "okay") during long caller turns.
6. **Small imperfections:** an occasional "erm", slightly faster pace, short pauses between clauses. Perfectly smooth speech sounds robotic.
7. **Light background ambience:** a faint office sound hides small audio artifacts.
8. **Judge at phone quality:** voices that sound good in high quality can sound bad on an 8 kHz phone line; always listen through the phone simulation.
9. **Speech-to-speech models** (e.g. OpenAI Realtime) give the best rhythm and emotion, but their voices are tuned for English; test Malay accent before relying on them.
