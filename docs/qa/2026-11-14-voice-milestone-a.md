# Voice milestone A: measurement record

Date: 2026-11-14. Branch `feat/voice-milestone-a`, not merged, not pushed. Design: `docs/superpowers/specs/2026-11-13-inbound-voice-design.md` (goals in section 8, decision in section 9). All calls are scripted, with fake data. No real caller has used this.

## Method

A scripted caller (`npm run check:voice-speed`, `voice/tools/replay.py`) joins a real LiveKit room, plays synthesized clips of the twenty script turns (Gemini text to speech, voice Puck, made once with `npm run check:voice-speed -- --prepare`; synthetic speech may endpoint faster than a human caller), and records the agent's audio as it arrives. The definitions below come from the `definitions` block in `voice/tools/replay_core.py`.

- **First sound** is the time from the last caller speech frame (t0) to the first agent audio burst. A burst is audio above an energy threshold for a minimum length, so a filler phrase counts.
- **Answer start** is the time from t0 to the first burst at or after the earliest time the real answer could sound. That time comes from the voice worker's stage log, or is estimated from the brain's first-sentence time. Earlier bursts are fillers.
- Arrival times are measured at the client, so network and jitter-buffer delay are inside every number. Turns that are truncated, contaminated, unverified or hit the ceiling are left out of the answer statistics, and a goal gets no verdict when data is missing.

- Answer start on tool turns is the spoken lead-in sentence, which the prompt requires before the tool runs, not the tool's outcome. `heardAtMs` is the worker's estimate (end-of-speech arrival minus 600 ms).

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
| Turns with first sound within 1.5 s        | 16 of 20                                                  | 20 of 20                  |
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

| Goal                                                | Outcome                                                                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First sound within 1.5 s on all twenty              | Missed. 16 of 20 within 1.5 s (over: t01 5.42 s, t11 2.13 s, t14 2.02 s, t07 1.54 s); median 1.42 s.                                                     |
| Plain answer start, median 2.5 s                    | Missed by about 0.5 s (3.02 s, 11 of 12 turns observed).                                                                                                 |
| Tool answer start, median 4 s                       | Not decided by the tool (6 of 8 turns observed). Partial median 3.67 s, under 4 s; two of the six observed turns were over 4 s (t05 4.77 s, t19 4.50 s). |
| No stretch of more than three seconds without sound | Missed. Longest gap 5.4 s (t01, the same first-turn outlier); every other turn's longest gap was at most 2.8 s.                                          |

Two Manglish utterances were split mid-sentence by endpointing, and their message and booking were not recorded. This counts as a product defect, not a timeout.

## After run 3

The review found that a split utterance lost its first half whenever a filler was playing (the cause of the two lost Manglish turns in run 3). It was fixed in this branch after the run and is covered by unit tests; it was not re-measured live.

## Run 4: smoke run on the final code

Run 4 used the same scripted caller on the final code of this branch (after the review fixes, commit `6701afe` for the worker and `61e053e` for the brain). Its purpose was to catch a regression, not to replace run 3, and one run does not separate a real change from run-to-run variation.

- 20 of 20 turns answered, no timeout, no refused voice request.
- First sound: median 1.40 s, 90th percentile 1.98 s, longest 2.14 s. The 5.4 s first-turn outlier of run 3 did not recur.
- Answer start without a tool: median 3.32 s over 12 of 12 turns (run 3: 3.02 s over 11 of 12). Goal 2.5 s missed.
- Answer start with a tool: partial median 4.08 s over 7 of 8 turns (run 3: 3.67 s over 6 of 8). Not decided by the tool.
- Longest silent gap 3.11 s (goal 3 s missed by 0.11 s).
- Brain first sentence median 1.47 s (run 3: 1.20 s); speech first byte median 0.66 s.
- One Manglish utterance was still split mid-sentence and its message was not recorded: the agent had already begun answering the first half, so the two halves are treated as separate turns by design. One handoff turn recorded no handoff proposal; the cause was not investigated.

The speed picture is unchanged: first sound is near the goal, answers are about 0.5 to 0.8 s slower than the goal.

## Owner's spoken test

On 2026-11-14 the owner spoke to the agent through the browser panel in Chrome (local app at `http://127.0.0.1:4182`), using an agent set up as an auto parts receptionist. Verdict, in the owner's words: "sounds great tbh". The owner noted the agent needs business knowledge filled in (basic prices and similar) before its answers are useful.

This was a free conversation, not the scripted twenty turns, and no timings were recorded for it. It confirms the microphone prompt, the call start, playback and the conversation itself on one desktop browser. Still not checked: 390 px width, dark theme, BM interface text, the stop-during-connect cases and the accessibility check.

The first start was refused because that agent had no greeting, AI introduction or recording notice. The refusal is correct, but its text says "before publishing" when it means "before a voice test".

## Open decision for the owner

Per design section 9: accept the measured numbers, or switch the call path to the speech-to-speech model (figures in design section 2.1). This is the owner's call; nothing here chooses.

## Correctness evidence

The spoken-path 48-case gate (`npm run check:voice-model`), latest full run (run 4): 48 of 48, 12 per language, no safety flags, the booking read-back before the first tool on 8 of 8 booking cases. Details: `docs/qa/2026-11-13-agent-tool-calling.md`, "Spoken path". A later small rule rewording (commit 61e053e) was not re-gated.

## Known limits

- The Google speech limit of about 11 requests per minute blocks more than roughly one concurrent call. This blocks milestone B. The owner is in contact with Google.
- The fast-lane answer cache uses word lists that cannot fully exclude time-dependent questions. Before real callers, the owner must decide: an allow-list, model-labelled cacheability, or clock-free answers, plus expiry.
- The false-success check does not catch past-tense delivery claims such as "I've passed your message on". It also misses common booking claims such as "I've booked you in" or "dah tempah". Widened on branch `fix/voice-prelaunch-hardening` (table of 86 sentences in `tests/inference/safety.test.ts`); it is still a word list, so new phrasings can slip through, and it was not re-run against the hosted model.
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
- The final whole-branch review was done on 2026-11-14 and its fixes are on this branch; those fixes were checked by unit tests and one scoped review, not by another live run. Pull requests #5 (speech provider decision) and #6 (design and plan) are open and unmerged; this branch builds on #6.
