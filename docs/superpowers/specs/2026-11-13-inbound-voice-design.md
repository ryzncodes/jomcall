# Inbound voice: browser call first, phone line second

Date: 2026-11-13. Status: approved by the owner on 2026-11-13, not implemented. This is design spec §9 sub-project 3, cut into two milestones. Only milestone A is designed here in detail.

## 1. Intent

A Malaysian business owner should be able to talk to their own JomCall agent and hear it answer, in the language they spoke, quickly enough to feel like a phone call. That is the first moment the product is believable. A real phone number matters only after that works.

The owner approved this shape on 2026-11-13: prove speed in a browser call first, connect a Malaysian number second.

## 2. Verified starting point

- **Brain.** `engine/src/agent/runner.ts` runs one text turn: shared rules (`packages/domain/src/agent-test/prompt.ts`), knowledge search, up to two tool calls, citation checks, proposals recorded through `app_private.agent_work`. `anthropic/claude-haiku-5.5` through OpenRouter passes the 48-case gate ([QA record](../../qa/2026-11-13-agent-tool-calling.md)).
- **How a text turn travels today.** Browser → web API → outbox → pg-boss queue → agent worker, which polls once a second. The model returns one complete JSON decision; nothing is streamed. Median whole-case time is about 2.8 s.
- **Speech.** Google `gemini-3.5-transcribe-live` returns a final transcript 1.4 s after the speaker stops, with interim text before that; Google `gemini-3.8-flash-lite-tts` starts audio in 0.6 to 0.7 s when streamed ([decision 0001](../../decisions/0001-speech-providers.md)). Both ran on one Google Cloud key against the Agent Platform endpoint.
- **Test panel.** `web/components/core/agent-test.tsx` shows sessions, turns, citations, tool traces and proposals, and carries a "Voice testing is not connected yet" line.
- **LiveKit Agents, from its current docs.** `google.beta.GeminiTTS(model=..., voice_name=...)` exists. `google.STT` supports Gemini models only in non-streaming mode behind a voice-activity detector, and its model list does not include `gemini-3.5-transcribe-live`. An agent can override `stt_node`, `llm_node` and `tts_node`. Turn handling offers preemptive generation, which starts the reply before the end of turn is confirmed. A small turn-detector model runs locally.
- **Licences, checked 2026-11-13.** LiveKit server, LiveKit Agents and the LiveKit browser client are Apache-2.0; the Silero voice-activity detector is MIT. LiveKit's turn-detector model is **not** open: it ships under the proprietary LiveKit Model License, free to use but only together with LiveKit Agents.
- **Quota.** The owner's Google project allows about eleven text-to-speech requests a minute and refuses the rest with `429 RESOURCE_EXHAUSTED`. Measured before and minutes after the billing account was upgraded from free trial to paid on 2026-11-13: 17 successes in 90 seconds of continuous requests. No per-minute quota row for this model appears on the console's Quotas page, so the limit cannot be raised there. Its cause is not established.
- **Streaming spike, 2026-11-13 (throwaway script, four runs per question).** The hosted model does stream its JSON decision through OpenRouter, and the reply text can be read out of the stream as it arrives. But streaming saves only 0.2 to 0.3 s: the wait is almost all before the first byte, 1.0 to 2.5 s. The same requests without the JSON schema waited 1.0 to 1.4 s. So the model's time to first token, not the output format, is the main cost. Added to about 1.0 s for the transcript and 0.6 s for first audio, a turn is 2.6 to 4 s unless the model wait is cut. The 1.5 s target is at risk and the §9 decision point may arrive early.
- **Not verified.** That `google.beta.GeminiTTS` accepts `gemini-3.8-flash-lite-tts` and an Agent Platform key; that the LiveKit server binary runs cleanly on this Mac with loopback-only binding; that structured output can be streamed from the hosted model.

Measured piecewise, a spoken turn takes three to four seconds today. The target below needs roughly half of that removed.

## 3. Goals, non-goals, anti-goals

**Goals for milestone A**

1. From the test panel, an owner or admin starts a voice test in the browser, speaks, and hears the agent reply.
2. The agent replies in the caller's language, using the same rules, knowledge, tools and safety checks as the text test.
3. A spoken booking, message or handoff request records the same reviewable proposal a typed one does.
4. Every turn's delay is measured and shown: end of speech → final transcript → first model text → first audio.
5. Median delay from end of speech to first agent audio is at most 1.5 s on turns that need no tool, over the test script in §8.

**Non-goals for milestone A:** phone numbers, SIP, call forwarding, transfer to staff, call recording, after-call summaries, billing, WhatsApp, deployment outside this machine, more than one call at a time, Mandarin sign-off.

**Anti-goals: these make it a failure even if it runs**

- The agent says a booking is confirmed, or a message was sent.
- The agent acts on something it misheard. Speech-to-text gets about one word in five wrong on phone audio, so the agent must read back the day, time and service before it records a booking proposal.
- Microphone audio leaves the machine without the panel saying so first.
- A voice failure falls back to mock data or to a canned answer presented as the agent.
- Dead air: more than three seconds of silence from the agent with no spoken filler.

## 4. Approaches

| Approach                                                                         | What it gives                                                                | Why it was or was not chosen                                                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Three-step pipeline in a Python LiveKit worker that calls the existing brain** | Keeps the tested brain, the spec's swappable providers and its service split | **Chosen by the owner.** Its risk is speed, which milestone A exists to prove                                                       |
| Speech-to-speech model (`gemini-3.8-live`)                                       | Likely the lowest delay and the most natural rhythm                          | Replaces the brain that passed the gate, with an untested one, and weakens language and wording control. Kept as the fallback in §9 |
| Phone line first                                                                 | The real product surface                                                     | Blocked on a Malaysian SIP trunk nobody has verified; nothing demonstrable meanwhile                                                |

Two narrower alternatives inside the chosen approach were considered and rejected as the assistant's calls: rewriting the turn logic in Python (duplicates tested rules and safety checks in a second language), and using LiveKit's Node.js agent framework so the worker shares a runtime with the brain (departs from the approved spec's Python worker; revisit only if the HTTP hop in §5.2 proves to be a real cost).

## 5. Design of milestone A

### 5.1 Pieces

```
browser (mic, speaker) ──WebRTC──> LiveKit server (local, loopback)
                                        │
                                  voice worker (Python, LiveKit Agents)
                                   ├─ speech-to-text: Google live transcribe
                                   ├─ brain: HTTP stream to the agent service ──> existing rules, tools, proposals
                                   └─ text-to-speech: Google Flash Lite
```

- **`voice/`**: new Python service, LiveKit Agents. One job per test call. It holds the Google key and no database credential.
- **Agent service turn endpoint**: a loopback-only HTTP endpoint in the existing TypeScript agent process that runs one turn immediately and streams the result. It reuses the runner's rules, knowledge search, tool execution, citation checks and proposal recording. The queued path for typed turns stays as it is.
- **Web**: a "Start voice test" control in the test panel, a server route that issues a short-lived LiveKit room token, and the LiveKit browser client.
- **LiveKit server**: run locally, started and stopped by `scripts/local` commands in the style of the existing model scripts.

### 5.2 How a spoken turn runs

1. The worker streams microphone audio to speech-to-text and receives interim and final text.
2. On end of turn it posts the transcript to the turn endpoint with a credential bound to this one test session.
3. The endpoint runs the turn. For a plain answer it streams the reply text as it is generated. For a tool call it first streams a short filler line in the caller's language, runs the tool, then streams the answer.
4. The worker sends reply text to text-to-speech sentence by sentence and plays audio as it arrives.
5. If the caller speaks over the agent, playback stops and the new speech becomes the next turn.
6. The turn, transcript, citations, tool steps and proposals are stored on the session exactly as a typed turn would be, marked as spoken, so the existing panel shows them.

A voice test is an ordinary test session with a voice channel. It pins the agent snapshot and the model on the first turn like any other.

### 5.3 Where the speed has to come from

In order of expected gain. The builder measures each before keeping it.

1. **No queue hop.** The direct endpoint removes the outbox, queue and one-second poll.
2. **Streamed reply text.** Speech starts on the first sentence, not after the whole reply. The model's output is a JSON decision today; the spike in §2 showed its answer text can be read from the stream as it arrives, so the format can stay. The gain is small.
3. **Shorter model wait.** The largest single cost. Candidates, each to be measured: calling the model provider directly instead of through OpenRouter, prompt caching for the fixed rules, a shorter prompt, and starting the model on interim text.
4. **Shorter end-of-speech wait.** The 1.4 s final transcript includes silence detection. Start from voice-activity detection plus the transcriber's interim text, with preemptive generation so the model starts before the final text arrives. Then add LiveKit's turn-detector model and keep it only if it measurably shortens the wait or cuts interruptions on the §8 script. Its licence is proprietary; the owner accepted it for this one model on 2026-11-13 (§7).
5. **At most two speech requests per turn.** The first sentence, then the rest of the reply, to stay inside the request limit in §2.
6. **Fixed lines cached.** The greeting, the disclosure and the fillers are synthesized once per session.

### 5.4 What the caller hears

- The call opens with the agent's AI disclosure line, then its greeting. Both come from the agent settings; if the disclosure is empty the voice test refuses to start and says why.
- The preset voice is the agent's `voicePreference`, limited to presets that passed the listening test (Kore, Sulafat, Leda, Achird, Charon). Default Kore.
- Before a booking proposal the agent reads back service, day and time and waits for a yes. In milestone A this is a rule in the voice prompt, checked on every booking turn of the §8 script; it is not enforced in code, because a proposal still needs a person to apply it. Code enforcement belongs to milestone B, where a spoken yes can lead to a real booking.
- Messages and handoffs are not read back first. After recording one, the agent says what it noted, so the caller can correct it.
- Replies are written for speech: short sentences, amounts and times spelled the Malaysian way. This is a voice-only addition to the rules, covered by its own tests; the text rules and their gate are not changed.

### 5.5 Configuration and boundaries

- `JOMCALL_VOICE_PROVIDER` is `disabled` by default and `google` to opt in. Readiness for voice reports configuration only, like hosted text.
- The Google key lives in the ignored `.env.hosted` and is read only by the voice worker.
- The LiveKit server, the turn endpoint and all media ports bind to loopback. LiveKit's API secret is held by the web server and the worker, never sent to the browser.
- When voice is selected, the panel states before the call starts that microphone audio and the conversation are sent to Google and OpenRouter, outside Malaysia, and that real customer details must not be spoken.
- No audio is stored in milestone A. Transcripts are stored as test turns and expire with the session.
- A voice test ends by itself after five minutes.
- `AGENTS.md` gains the Google speech exception in the same terms as the OpenRouter one.

### 5.6 Failure behaviour

| Failure                                           | Behaviour                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Voice not configured, LiveKit down, worker absent | Control disabled with the reason; typed testing still works                  |
| Speech-to-text or model fails mid-call            | One spoken fallback line, the turn marked failed in the panel, call stays up |
| Text-to-speech fails                              | The reply appears as text in the panel and the call says nothing false       |
| Session expired or deleted during a call          | Call ends; panel clears as it does for typed tests                           |

## 6. Milestone B, outline only

A real Malaysian number over SIP into the same worker; the disclosure for recorded calls; transfer to a staff number with a timeout; recording with retention; the after-call summary job; forwarding instructions and a verification call. It starts with finding and verifying a trunk supplier (spec §11), which is the owner's task as much as an engineering one. It gets its own design once milestone A's numbers are in.

## 7. Constraints

- Original work only; dependencies under MIT, Apache-2.0, BSD or ISC. One exception, accepted by the owner on 2026-11-13: LiveKit's turn-detector model under the LiveKit Model License, which is free but may only be used with LiveKit Agents. It is optional, is never copied into this repository, and the voice service must run without it. LiveKit server, agents and browser client are Apache-2.0 by their repositories; confirm at install.
- Mock preview on 4181 stays independent. No fallback to mock records on any local error.
- Interface text in BM and English.
- Model IDs come from the providers' current lists and are named in one place each.
- Python is confined to `voice/`; product logic stays in TypeScript.

## 8. How success is measured

- **Script.** Twenty spoken turns: eight BM, eight Manglish, four English; twelve plain questions answerable from the fixture knowledge, four booking requests, two messages, two handoffs. The owner speaks them; the same turns are also replayed from recorded clips so runs are comparable.
- **Speed.** Median end-of-speech → first audio at most 1.5 s on the twelve plain turns; a spoken filler within 1.5 s on the eight tool turns; no silence over three seconds.
- **Correctness.** Reply language matches on all twenty; all eight tool turns record the right proposal; no reply claims a completed action; bookings are read back before the proposal.
- **Regression.** `npm run check:phase2` and `npm run check:hosted-model` still pass.
- **The gate follows the brain.** The 48 evaluation cases also run through the direct turn endpoint with the speech rules switched on, as text in and text out, with the same thresholds. If the shared output format changes to allow streaming, the typed path must pass the 48 cases again as well. A voice brain that has only seen the twenty-turn script is not accepted.
- **Throttling is recorded.** Any refused or delayed speech request during a run is counted. A run with throttled requests does not count toward the speed target.

## 9. Decision point after milestone A

If the median stays above 2.5 s after the measures in §5.3, stop and evaluate the speech-to-speech model against the 48 cases and the listening test before any phone work. Between 1.5 s and 2.5 s, the owner decides whether it is good enough to continue.

## 10. Left to the builder

Known limits the builder must handle: a session allows twenty turns and one active turn at a time today, which read-back turns, interruptions and preemptive generation will exceed or collide with; tools that record something must run only on confirmed speech, never during preemptive generation; citations must be validated before the sentence that relies on them is spoken.

The turn endpoint's wire format and credential scheme; how reply text is streamed out of the model's decision; whether speech-to-text is a custom streaming adapter or LiveKit's batch Gemini adapter behind voice-activity detection, chosen by measurement; turn-detection tuning; where the latency numbers are stored; the layout of the voice controls in the panel; test structure.

## 11. Calls made by the assistant, for the owner to check

- A voice test is a normal test session, not a new kind of record.
- No audio is stored in milestone A.
- Five-minute cap per voice test.
- The voice preset list is limited to the five that passed the listening test.
- The voice test refuses to start without an AI disclosure line.
- Python worker kept, as in the approved spec, over LiveKit's Node.js framework.
- Mandarin is not part of milestone A's acceptance.
- Read-back before bookings is a prompt rule in milestone A, enforced in code from milestone B; messages and handoffs are confirmed after recording, not before.
- The 48 cases must pass through the voice path's own format and rules.

## 12. Open with the owner

1. **Google quota.** Settled for milestone A: one caller stays under the limit if a turn makes at most two speech requests (first sentence, then the rest) and fixed lines are cached. It is a blocker for milestone B, where several callers share the limit. Retest after the upgraded account has aged; if it holds, ask Google support.
2. **Turn-detector licence.** Settled: accepted by the owner on 2026-11-13 for the turn-detector model only.
