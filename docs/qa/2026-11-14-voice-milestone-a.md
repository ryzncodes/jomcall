# Voice milestone A: measurement record

Date: 2026-11-14. Branch `feat/voice-milestone-a`, not merged, not pushed. Design: `docs/superpowers/specs/2026-11-13-inbound-voice-design.md` (goals in section 8, decision in section 9). All calls are scripted, with fake data. No real caller has used this.

## Method

A scripted caller (`npm run check:voice-speed`, `voice/tools/replay.py`) joins a real LiveKit room, plays recorded clips of the twenty script turns, and records the agent's audio as it arrives. The definitions below come from the `definitions` block in `voice/tools/replay_core.py`.

- **First sound** is the time from the last caller speech frame (t0) to the first agent audio burst. A burst is audio above an energy threshold for a minimum length, so a filler phrase counts.
- **Answer start** is the time from t0 to the first burst at or after the earliest time the real answer could sound. That time comes from the voice worker's stage log, or is estimated from the brain's first-sentence time. Earlier bursts are fillers.
- Arrival times are measured at the client, so network and jitter-buffer delay are inside every number. Turns that are truncated, contaminated, unverified or hit the ceiling are left out of the answer statistics, and a goal gets no verdict when data is missing.

The owner chose a short path on 2026-11-14: one clean measured run instead of a three-run median.

## Runs

| Run | State                                                        | What it showed                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Invalid                                                      | A defect in the measurement tool. Not used.                                                                                                                                                                         |
| 2   | Before the fixes                                             | First sound median 2.07 s. Plain answer about 3.96 s. Tool answer about 4.7 to 5.2 s. The model retracted an earlier answer in 10 of 19 turns, and three times told the caller a recorded request was not recorded. |
| 3   | After the fixes (worker at commit 009f480, brain at d07a93e) | 20 of 20 turns answered over three calls, 0 timeouts, 0 refused voice requests. See below.                                                                                                                          |

Run 3 numbers:

| Measure                                    | Result                                                    | Goal                      |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------- |
| First sound, median                        | 1.42 s                                                    | 1.5 s on all twenty turns |
| First sound, 90th percentile               | 2.02 s                                                    |                           |
| Turns with first sound within 1.5 s        | 15 of 20                                                  | 20 of 20                  |
| Slowest first sound                        | 5.4 s, the first turn of one call (cause not established) |                           |
| Answer start, turns without a tool, median | 3.02 s (11 of 12 turns observed)                          | 2.5 s                     |
| Answer start, turns with a tool, median    | 3.67 s (6 of 8 turns observed)                            | 4 s                       |
| Brain first sentence, median               | 1.20 s                                                    |                           |
| Speech first byte, median                  | 0.64 s                                                    |                           |

## What changed between run 2 and run 3

- The brain now receives what the call already established (earlier evidence and a "Recorded in this call" block), so it stops retracting earlier answers and stops denying recorded requests.
- A tool is announced as soon as the model starts calling it.
- Fillers are timed from the caller's estimated end of speech, not from when the transcript arrived.
- Fixed clips are trimmed of silence at both ends, and streamed answers lose leading silence.
- An answer cuts a filler short instead of waiting for it.
- Connections are reused within a call (one HTTP client for speech, one for the brain).
- A flush timer delivers words that have had no end of speech for 1,000 ms, and joins a split utterance.

## Outcome against the four goals (design section 8)

| Goal                                                | Outcome                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| First sound within 1.5 s on all twenty              | Missed. 15 of 20 within 1.5 s; median 1.42 s; one turn took 5.4 s.                  |
| Plain answer start, median 2.5 s                    | Missed by about 0.5 s (3.02 s, 11 of 12 turns observed).                            |
| Tool answer start, median 4 s                       | Met on the observed turns (3.67 s, 6 of 8). Two tool turns were not observed.       |
| No stretch of more than three seconds without sound | No figure is recorded in this write-up. Read it from the run output before judging. |

Two Manglish utterances were split mid-sentence by endpointing, and their message and booking were not recorded. This counts as a product defect, not a timeout.

## Open decision for the owner

Per design section 9: accept the measured numbers, or switch the call path to the speech-to-speech model (figures in design section 2.1). This is the owner's call; nothing here chooses.

## Correctness evidence

The spoken-path 48-case gate (`npm run check:voice-model`), latest full run (run 4): 48 of 48, 12 per language, no safety flags, the booking read-back before the first tool on 8 of 8 booking cases. Details: `docs/qa/2026-11-13-agent-tool-calling.md`, "Spoken path". A later small rule rewording (commit 61e053e) was not re-gated.

## Known limits

- The Google speech limit of about 11 requests per minute blocks more than roughly one concurrent call. This blocks milestone B. The owner is in contact with Google.
- The fast-lane answer cache uses word lists that cannot fully exclude time-dependent questions. Before real callers, the owner must decide: an allow-list, model-labelled cacheability, or clock-free answers, plus expiry.
- The false-success check does not catch past-tense delivery claims such as "I've passed your message on".
- Read-back before a booking is a prompt rule, not enforced in code, in milestone A.
- Deepgram endpointing sometimes splits Manglish utterances.
- Call audio and conversation text cross the border to Deepgram, Anthropic and Google. A PDPA decision is needed before real callers.
- Each scripted measurement run leaves fake test organizations in the local database.
- The LiveKit turn-detector model is not installed. `livekit-agents` is pinned at 1.6.0 because 1.6.1 to 1.8.11 require `livekit-local-inference` (LiveKit Model License).

## Not verified

- No human has spoken to the agent through the browser panel. Unchecked: the microphone prompt, audio playback, the stop-during-connect races, 390 px width, dark theme, BM text and the accessibility check. This is the owner's next step (plan Task 12, Step 5).
- Whether the cause of the 5.4 s first turn is a cold connection or something else.
- The effect of the 61e053e rule rewording on the 48-case gate.
- Real phone audio, real callers, and more than one concurrent call.
- A three-run median. One run only, by the owner's choice.
- The final whole-branch review has not been done. Pull requests #5 (speech provider decision) and #6 (design and plan) are open and unmerged; this branch builds on #6.
