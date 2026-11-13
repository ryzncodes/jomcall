# 0001 — Speech providers for calls

Date: 13 November 2026. Status: text-to-speech chosen; speech-to-text chosen after a second round the same day (see "Second round"). Owner: decided by the project owner in session, evidence gathered by the coding assistant.

This closes sub-project 1 of the design spec (§9) far enough to start inbound voice. It supersedes the provider shortlist in the [speech benchmark plan](../superpowers/plans/2026-10-15-speech-benchmark-spike.md) and the recommended path in [voice options](../research/voice-options.md). The plan's USD 0 rule no longer applies: the owner allowed paid hosted services on this date.

## Decision

| Part of a call | Choice                                                                                             | Standing                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Text-to-speech | Google `gemini-3.8-flash-lite-tts`, direct from Google. The business owner picks the preset voice. | Chosen                                                                                              |
| Speech-to-text | Deepgram `nova-3`, multilingual mode, live streaming, direct from Deepgram                         | Chosen in the second round. First round's provisional pick was Google `gemini-3.5-transcribe-live`. |
| Language model | `anthropic/claude-haiku-5.5` through OpenRouter                                                    | Decided earlier; see [the QA record](../qa/2026-11-13-agent-tool-calling.md)                        |

Text-to-speech runs on a Google Cloud project key and was served from `asia-southeast1`. Speech-to-text must stay swappable, as the spec already requires.

## Text-to-speech evidence

**Listening test.** Seven hosted voices read the same lines through fal.ai; the owner judged them blind, one preset voice per model, clean audio.

| Voice (preset)                   | Malay | Manglish | Price in Malay |
| -------------------------------- | ----- | -------- | -------------- |
| Gemini 3.8 Flash Lite TTS (Kore) | pass  | pass     | pass           |
| Gemini 3.8 Flash TTS (Kore)      | pass  | pass     | pass           |
| ElevenLabs v4 Turbo (Rachel)     | pass  | pass     | fail           |
| xAI TTS (eve)                    | pass  | fail     | fail           |
| Chatterbox Multilingual          | fail  | fail     | fail           |
| Seed Speech v2 (vivi)            | fail  | fail     | fail           |
| MiniMax Speech 2.8 Turbo         | fail  | fail     | fail           |

A second blind round tried seven Flash Lite presets on the same three lines. Kore, Sulafat, Leda, Achird and Charon passed; Vindemiatrix and Aoede did not. Five of seven passing is why the preset is left to the business owner instead of fixed.

**Speed, streamed, direct from Google, preset Kore.** Time from request to first audio.

| Model                       | Reply                      | Median | Slowest | Whole reply ready | Runs |
| --------------------------- | -------------------------- | ------ | ------- | ----------------- | ---- |
| `gemini-3.8-flash-lite-tts` | short                      | 0.58 s | 0.66 s  | 0.89 s            | 10   |
| `gemini-3.8-flash-lite-tts` | long (about 6 s of speech) | 0.73 s | 0.83 s  | 1.62 s            | 8    |
| `gemini-3.8-flash-tts`      | short                      | 0.72 s | 0.88 s  | 1.22 s            | 10   |
| `gemini-3.8-flash-tts`      | long                       | 0.85 s | 0.95 s  | 2.18 s            | 8    |

The same voices through fal.ai, not streamed, took 3 to 5 s per reply, so fal is for comparing voices and not for calls.

**Cost.** Third-party price trackers list USD 6.00 per million audio output tokens for Flash Lite. One measured reply used 135 audio tokens for 5.56 s, about 24 tokens per second, which makes roughly USD 0.009 per spoken minute. One tracker reports the rate doubling after the end of 2026. Google's own pricing page was not read.

## Speech-to-text evidence

**Test set.** The public split of the Revolab ASR Benchmark: real Malaysian speech, 820 clips. We used the 66 telephony clips and the 52 short-input clips. The audio is gated and stays out of this repository.

**Our runs.** Word error rate with the spike's Malaysian-aware scorer; the bracket is a 95% bootstrap interval. No language hint was set.

| Model                                | Mode        | Phone audio (66)  | Short phrases (52) |
| ------------------------------------ | ----------- | ----------------- | ------------------ |
| ElevenLabs Scribe v2, through fal.ai | batch       | 13.1% [9.1–17.7]  | 29.9% [16.8–43.8]  |
| Google `gemini-3.5-transcribe`       | batch       | 18.7% [12.5–25.9] | 39.3% [24.3–56.3]  |
| Google `gemini-3.5-transcribe-live`  | live stream | 19.3% [13.8–25.5] | 35.5% [20.6–52.0]  |

**The leaderboard's published transcripts under the same scorer**, for models we did not run ourselves:

| Model                           | Phone audio (66) | Short phrases (52) | Note                                                                                                          |
| ------------------------------- | ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `aisyah-1.0-pro`                | 7.1%             | 8.4%               | Appears to belong to the benchmark's maintainers; no public API found. Not pursued.                           |
| ElevenLabs `scribe_v2` (batch)  | 11.6%            | 17.8%              |                                                                                                               |
| ElevenLabs `scribe_v2_realtime` | 18.9%            | 19.6%              | The live version is much weaker than batch on phone audio                                                     |
| Google `gemini-3.5-transcribe`  | 19.3%            | 13.1%              |                                                                                                               |
| Deepgram `nova-3`               | 67.4%            | 42.1%              | 28 of 66 phone clips came back empty, which points at a configuration fault in that run, not at true accuracy |

Our scorer is stricter than the leaderboard's own (Scribe v2 scores 9.0% there and 11.6% here on identical transcripts), so compare numbers within this document only.

**Live timing, Google.** Audio sent in real time with two seconds of trailing silence: first interim word at 1.53 s into the clip (median); final transcript 1.40 s after the speaker stops (median), 1.62 s at the 90th percentile.

**What the numbers mean.**

- Streaming costs Google nothing in accuracy: live and batch are within a point on phone audio.
- Scribe v2 batch looks better on phone audio, but the intervals overlap at 66 clips, and its live version scores like Google's.
- Roughly one word in five is wrong on phone audio. Some errors change the meaning: "I mana ada subscribe service you" was heard as "I want to unsubscribe service you". The agent must confirm anything it is about to act on.
- Short-phrase scores are inflated by the scorer (digits against spelled-out numbers) and by one-word clips.

## Second round: Deepgram and Speechmatics

The owner supplied Deepgram and Speechmatics keys later on 13 November. Same 118 clips, same scorer, audio streamed in real time.

| Model                                             | Phone audio (66)  | Short phrases (52) | Final text after the speaker stops           |
| ------------------------------------------------- | ----------------- | ------------------ | -------------------------------------------- |
| Deepgram `nova-3`, `language=multi`               | 23.4% [16.9–30.8] | 33.6% [22.2–47.9]  | 0.25 s median, 0.44 s at the 90th percentile |
| Deepgram `nova-3`, `language=ms`                  | 37.1% [30.2–45.0] | 23.4% [14.0–33.7]  | 0.29 s median                                |
| Google `gemini-3.5-transcribe-live` (first round) | 19.3% [13.8–25.5] | 35.5% [20.6–52.0]  | 1.40 s median, 1.62 s at the 90th percentile |

- Deepgram in multilingual mode is about as accurate as Google on phone audio (the intervals overlap heavily) and returns its final text more than a second sooner.
- Malay-only mode is clearly worse on phone audio, where callers mix in English.
- Deepgram returned nothing for 1 phone clip and 5 short clips. The agent must handle hearing nothing.
- The leaderboard's 67% for Deepgram does not reproduce: 28 empty phone results there, 1 here.
- With a 0.3 s silence wait before the end of a turn is declared, as a real call needs, Deepgram's part of a turn measured 0.54 s median in the end-to-end run recorded in the [voice design](../superpowers/specs/2026-11-13-inbound-voice-design.md).
- Speechmatics was dropped by the owner before a clean score existed: on one clip its final text arrived 0.7 to 0.9 s after the speaker stopped, and its free tier's two-session limit made the run fail intermittently.

Not checked: Deepgram's price for multilingual streaming; Mandarin; data location (Deepgram is a United States service).

## Risks and open items

- **Turn delay.** With Google for speech-to-text a turn measured 3.4 s end to end; with Deepgram and a changed model output shape, 2.27 s. Details are in the voice design.
- **Not tested:** any language hint or vocabulary hint; Mandarin for either service; phone-quality audio for text-to-speech; more than three live streams at once.
- **Rate limits.** The owner's trial Google project refused text-to-speech requests beyond about ten a minute per model. Production limits are unknown.
- **Data leaves Malaysia.** Caller audio goes to Deepgram and agent text to Google. The PDPA cross-border position (spec §10) is still open and must be settled before real callers.
- **Prices** come from third-party trackers and fal.ai's API, not from the providers' own pages.
- **Small samples.** One listener; 66 phone clips; speed measured from one machine in Malaysia.

## Where the evidence lives

Scripts and raw outputs are local and ignored: the spike worktree's `tts/fal_voices.py`, and `spikes/speech-benchmark/data/` for clips, transcripts and listening-test audio. Nothing in this record depends on files that are not reproducible from the public benchmark and the providers' APIs.
