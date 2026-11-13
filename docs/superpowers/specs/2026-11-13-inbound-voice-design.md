# Inbound voice: browser call first, phone line second

Date: 2026-11-13. Status: approved by the owner on 2026-11-13 and revised the same day after a measurement spike; not implemented. This is design spec §9 sub-project 3, cut into two milestones. Only milestone A is designed here in detail.

## 1. Intent

A Malaysian business owner should be able to talk to their own JomCall agent and hear it answer, in the language they spoke, quickly enough to feel like a phone call. That is the first moment the product is believable. A real phone number matters only after that works.

The owner's bar for "quickly enough": a response within one to two seconds where possible, and where the real answer takes longer, a short spoken acknowledgement that covers the wait without sounding like a loop.

## 2. What was measured

Everything in this section comes from throwaway scripts run on 2026-11-13 (`spikes/voice-skeleton` on the local branch `spike/voice-skeleton`). Test speech was the 48 evaluation questions spoken by machine voices, plus 118 real Malaysian clips from the Revolab benchmark for speech-to-text. Clean audio, single turns, one run each unless stated.

### 2.1 Two shapes on the same 48 spoken questions

|                                                    | Pipeline, first version                                                                            | Speech-to-speech (`gemini-3.8-live`)                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Parts                                              | Google live speech-to-text → Haiku 5.5 through OpenRouter, JSON decision → Gemini Flash Lite voice | One Google model, same rules and tools                                                               |
| Real answer starts, no tool                        | 3.40 s median                                                                                      | 1.10 s median                                                                                        |
| Real answer starts, tool turn                      | 5.62 s median                                                                                      | 2.01 s median                                                                                        |
| 48 cases                                           | 47/48 with the brain fed what the ears heard                                                       | 45/48; two of the three misses were scoring artefacts                                                |
| Safety flags, wrong-language replies               | none                                                                                               | none                                                                                                 |
| Cost of a three-minute call, speech and model only | about USD 0.04                                                                                     | about USD 0.09, rising with call length because the whole conversation is billed again on every turn |
| Hosting                                            | Singapore for speech                                                                               | United States endpoint only                                                                          |

The owner chose the pipeline: cheaper, each part swappable, and the brain is the one that passed the gate. Speech-to-speech stays the fallback (§9).

### 2.2 Making the pipeline faster

| Change                                                                               | Effect                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speech-to-text: Deepgram `nova-3`, multilingual, instead of Google live              | Final text 0.25 s after the speaker stops instead of 1.40 s. Accuracy on Malaysian phone audio about the same: 23.4% of words wrong against 19.3%, intervals overlapping. See [decision 0001](../../decisions/0001-speech-providers.md) |
| Calling Anthropic directly instead of through OpenRouter                             | No real change: first sentence at 1.2 to 1.4 s either way                                                                                                                                                                               |
| Prompt caching                                                                       | Hits on 20 of 21 calls; no speed change at this prompt size; lowers cost                                                                                                                                                                |
| Brain output: plain spoken text plus native tool calls, instead of one JSON decision | First sentence at 1.04 s instead of 1.2 to 1.4 s, and no slow outliers. Tool call ready at 0.93 s                                                                                                                                       |
| Thinking switched off                                                                | Not usable: the model spoke its own reasoning aloud on tool turns. With thinking on at low effort this did not happen, at the same speed                                                                                                |

### 2.3 The faster pipeline, end to end, 30 spoken turns

Deepgram ears with a 0.3 s silence wait before a turn is declared over; Haiku 5.5 direct, plain speech plus native tools, thinking on at low effort, cached prompt; Gemini Flash Lite voice.

|                                                                      | Result                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Plain answer, real answer starts                                     | 2.27 s median, 2.89 s at the 90th percentile, 3.31 s worst (19 turns) |
| Where the time goes                                                  | ears 0.54 s, brain 1.04 s, voice 0.67 s                               |
| Tool turn, action known                                              | 2.07 s median                                                         |
| Tool turn, real answer starts                                        | 3.64 s median, 4.68 s at the 90th percentile (11 turns)               |
| Right tool chosen                                                    | 11 of 12; no tool used where none was needed                          |
| Wrong-language replies, spoken reasoning, errors, throttled requests | none                                                                  |

Each turn in that run opened new connections to all three services, and ran from a home network in Malaysia.

### 2.4 Other facts the design rests on

- **Existing brain.** `engine/src/agent/runner.ts` runs one text turn: shared rules, knowledge search, up to two tool calls, citation checks, proposals recorded through `app_private.agent_work`. It passes the 48-case gate as a JSON decision through OpenRouter ([QA record](../../qa/2026-11-13-agent-tool-calling.md)). A typed turn travels browser → web API → outbox → queue → worker, which polls once a second.
- **Test panel.** `web/components/core/agent-test.tsx` shows sessions, turns, citations, tool traces and proposals, and carries a "Voice testing is not connected yet" line.
- **LiveKit Agents, from its docs.** An agent can override its speech-to-text, model and text-to-speech steps. `google.beta.GeminiTTS` exists. Turn handling offers preemptive generation. Whether its Deepgram adapter exposes multilingual `nova-3` with the settings used here is not verified.
- **Licences, checked.** LiveKit server, agents and browser client are Apache-2.0; Silero voice-activity detection is MIT; the Anthropic SDK is MIT. LiveKit's turn-detector model is proprietary (LiveKit Model License).
- **Google request limit.** About eleven text-to-speech requests a minute on the owner's project, unchanged just after the billing account was upgraded from free trial. No quota row exists to raise it; the owner has asked Google's sales team.
- **Voice presets.** Kore, Sulafat, Leda, Achird and Charon passed the owner's listening test.
- **The fillers.** The owner heard the same turns with and without a filler line and judged the filler version acceptable.

## 3. Goals, non-goals, anti-goals

**Goals for milestone A**

1. From the test panel, an owner or admin starts a voice test in the browser, speaks, and hears the agent reply.
2. The agent replies in the caller's language, with the same knowledge, tools and safety rules as the text test.
3. A spoken booking, message or handoff request records the same reviewable proposal a typed one does.
4. Every turn's stage timings are measured, shown and stored: end of speech → final transcript → first model sentence → first audio.
5. Speed, on the §8 script: first sound within 1.5 s on every turn; real answer starting within 2.5 s median on turns without a tool and 4 s median on turns with one.

**Non-goals for milestone A:** phone numbers, SIP, call forwarding, transfer to staff, call recording, after-call summaries, billing, WhatsApp, Google Calendar, deployment outside this machine, more than one call at a time, Mandarin sign-off, real bookings without human approval.

**Anti-goals: these make it a failure even if it runs**

- The agent says a booking is confirmed, or a message was sent.
- The agent acts on something it misheard. Roughly one word in five is wrong on phone audio, so the agent reads back service, day and time before it records a booking proposal.
- Microphone audio leaves the machine without the panel saying so first.
- A voice failure falls back to mock data or to a canned answer presented as the agent.
- Dead air: more than three seconds without any sound from the agent.
- The agent speaks its own reasoning, a tool name or a source ID.
- Fillers that sound like a loop: the same line twice running, or "one moment" before a refusal.

## 4. Approaches

| Approach                                                                               | What it gives                                                           | Decision                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Three-step pipeline: Deepgram → Haiku → Gemini voice, with a fast lane and fillers** | Cheapest, each part swappable, keeps the tested brain's rules and tools | **Chosen by the owner after hearing and measuring both.** Real answers land near 2.3 s, so it relies on the fast lane and fillers for the feel |
| Speech-to-speech (`gemini-3.8-live`)                                                   | Real answers near 1.1 s with no tricks                                  | Fallback. Two to three times the cost, one vendor for everything, United States hosting, no source citations                                   |
| Phone line first                                                                       | The real product surface                                                | Rejected: blocked on an unverified Malaysian SIP supplier                                                                                      |

Narrower calls inside the chosen approach, made by the assistant: the turn logic stays in TypeScript and is not rewritten in Python; the worker is Python on LiveKit Agents as the approved spec says, not LiveKit's Node.js framework.

## 5. Design of milestone A

### 5.1 Pieces

```
browser (mic, speaker) ──WebRTC──> LiveKit server (local, loopback)
                                        │
                                  voice worker (Python, LiveKit Agents)
                                   ├─ ears: Deepgram nova-3 multilingual, live
                                   ├─ brain: HTTP stream to the agent service ──> rules, knowledge, tools, proposals
                                   └─ voice: Gemini 3.8 Flash Lite, preset chosen by the business
```

- **`voice/`**: new Python service on LiveKit Agents. One job per test call. It holds the Deepgram and Google keys and no database credential.
- **Voice turn endpoint**: a loopback-only HTTP endpoint in the existing TypeScript agent process. It runs one spoken turn immediately and streams events back. It holds the Anthropic key.
- **Web**: a "Start voice test" control in the test panel, a server route that issues a short-lived LiveKit room token, and the LiveKit browser client.
- **LiveKit server**: run locally, started and stopped by `scripts/local` commands in the style of the existing model scripts.

### 5.2 The voice brain

The spoken path gets its own turn function beside the typed one. It shares the knowledge search, the tool executor, the authority checks and proposal recording with the typed path. It differs in three ways:

1. **Output shape.** The model answers in plain text meant to be spoken, and calls tools natively. No JSON decision.
2. **Provider.** Anthropic's API directly, `claude-haiku-5-5`, thinking on at low effort, the stable part of the prompt cached. The typed path keeps OpenRouter and the JSON decision until the owner decides to move it.
3. **Rules for speech.** One or two short sentences; amounts and times said the Malaysian way; never a tool name, source ID or reasoning aloud; read-back before a booking.

**Grounding without spoken citations.** The typed path proves grounding by making the model cite source IDs. A spoken answer cannot carry IDs. The voice turn instead stores, with each turn, the evidence that was supplied to the model, and the 48-case gate checks spoken answers on content. This is weaker than citation and is the assistant's call for the owner to check (§11).

The spoken path must pass the 48 cases through this endpoint, as text in and text out, with the same thresholds, before it is used in a call.

### 5.3 How a spoken turn runs

1. The worker streams microphone audio to Deepgram and receives interim and final text.
2. Deepgram declares the end of the turn after 0.3 s of silence. The worker posts the transcript to the voice turn endpoint with a credential bound to this one test session.
3. **Fast lane.** The endpoint first matches the transcript against the session's frozen knowledge with the existing local search. On a strong match it returns a prepared answer immediately, without the model. Below the bar it goes on to step 4. The bar and the "prepared answer" form are fixed by measurement on the 48 cases plus paraphrases; a wrong fast answer is worse than a slow right one.
4. **Brain.** The endpoint starts the model and streams events: `sentence` as each sentence completes, `tool` when a tool is chosen, `done`.
5. **Race the clock.** If no sentence has arrived 0.8 s after the transcript, the worker plays a short neutral acknowledgement. If a tool is chosen, it plays a filler tied to that action. If a sentence arrives first, no filler plays.
6. The worker sends each sentence to the voice and plays audio as it arrives, at most two voice requests per turn: the first sentence, then the rest.
7. If the caller speaks over the agent, playback stops and the new speech becomes the next turn.
8. The turn, transcript, supplied evidence, tool steps, proposals and stage timings are stored on the session, marked as spoken, so the existing panel shows them.

A voice test is an ordinary test session with a voice channel.

### 5.4 Fillers

- **Tied to the action.** Checking slots, taking a message, looking something up and handing off each have three or four lines per language.
- **Echo the caller's detail** where a template can: "Esok pukul sepuluh ya, jap saya semak." This doubles as the read-back.
- **Never the same line twice running**, and none at all when the answer is quick.
- **Plain acknowledgements for slow plain answers:** "Okay", "Baik", "Hmm". Short enough not to clash with a refusal that follows.
- **Recorded once per agent version**, in its chosen voice, when the voice test first needs them, then cached. Fixed lines cost no voice request during a turn. Echo lines are generated live and count toward the two-request limit.

The greeting and the AI disclosure are cached the same way.

### 5.5 Where further speed comes from

In order of expected gain; each is kept only if it measures better on the §8 script.

1. Keep one connection per call to Deepgram, Anthropic and Google instead of one per turn.
2. Start the brain on the interim transcript and restart if the final text differs.
3. Preload the agent, its knowledge and the next two days of free slots while the greeting plays.
4. Give Deepgram the business's vocabulary (its name, services, staff) if the multilingual model accepts hints; it heard "Contoh" as "Chanto".
5. LiveKit's turn-detector model in place of the fixed 0.3 s wait. Its licence is proprietary; the owner accepted it for this one model on 2026-11-13. It is optional and the service must run without it.

### 5.6 What the caller hears

- The call opens with the agent's AI disclosure line, then its greeting. If the disclosure is empty the voice test refuses to start and says why.
- The preset voice is the agent's `voicePreference`, limited to the five presets that passed. Default Kore.
- Before a booking proposal the agent reads back service, day and time and waits for a yes. In milestone A this is a prompt rule checked on every booking turn of the §8 script. Code enforcement belongs to milestone B, where a spoken yes can lead to a real booking.
- Messages and handoffs are confirmed after recording, not before.
- If the ears return nothing, the agent asks the caller to repeat. It does not guess.

### 5.7 Configuration and boundaries

- `JOMCALL_VOICE_PROVIDER` is `disabled` by default. Opting in selects Deepgram, Anthropic and Google together for milestone A. Readiness reports configuration only, like hosted text.
- Keys live in the ignored `.env.hosted`: `DEEPGRAM_API_KEY` and `GOOGLE_CLOUD_API_KEY` are read only by the voice worker, `ANTHROPIC_API_KEY` only by the agent service. The web process holds none of them.
- The LiveKit server, the voice turn endpoint and all media ports bind to loopback. LiveKit's API secret is held by the web server and the worker, never sent to the browser.
- When voice is selected, the panel states before the call starts that microphone audio goes to Deepgram and the conversation to Anthropic and Google, outside Malaysia, and that real customer details must not be spoken.
- No audio is stored in milestone A. Transcripts are stored as test turns and expire with the session.
- A voice test ends by itself after five minutes.
- Model IDs are named in one place each and taken from the providers' current lists.
- `AGENTS.md` gains these three hosted services as owner-approved, opt-in exceptions to the local-only rule, in the same terms as the OpenRouter one.

### 5.8 Failure behaviour

| Failure                                           | Behaviour                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Voice not configured, LiveKit down, worker absent | Control disabled with the reason; typed testing still works                                  |
| Ears or brain fail mid-call                       | One spoken fallback line, the turn marked failed in the panel, call stays up                 |
| No answer four seconds after the transcript       | The agent says it is having trouble and offers to take a message                             |
| Voice fails                                       | The reply appears as text in the panel and the call says nothing false                       |
| Google refuses a voice request for rate           | Counted on the turn; the reply appears as text; the run does not count toward the speed goal |
| Session expired or deleted during a call          | Call ends; panel clears as it does for typed tests                                           |

## 6. Milestone B, outline only

A real Malaysian number over SIP into the same worker; the disclosure for recorded calls; transfer to a staff number with a timeout; recording with retention; the after-call summary; forwarding instructions and a verification call; bookings without human approval if the owner wants them; Google Calendar. Blocked on two things: a verified SIP supplier, and Google's eleven-requests-a-minute voice limit, which one caller fits under and several do not.

## 7. Constraints

- Original work only; dependencies under MIT, Apache-2.0, BSD or ISC. One exception, accepted by the owner on 2026-11-13: LiveKit's turn-detector model under the LiveKit Model License, which is free but may only be used with LiveKit Agents. It is optional, is never copied into this repository, and the voice service must run without it.
- Mock preview on 4181 stays independent. No fallback to mock records on any local error.
- Interface text in BM and English.
- Python is confined to `voice/`; product logic stays in TypeScript.
- The typed text path and its accepted gate are not changed by this milestone.

## 8. How success is measured

- **Script.** Twenty spoken turns: eight BM, eight Manglish, four English; twelve plain questions answerable from the fixture knowledge, four booking requests, two messages, two handoffs. The owner speaks them through the browser; the same turns are also replayed from recorded clips so runs are comparable.
- **Speed.** First sound within 1.5 s on all twenty. Real answer starting within 2.5 s median on the twelve plain turns and 4 s median on the eight tool turns. No stretch of more than three seconds without sound.
- **Correctness.** Reply language matches on all twenty; all eight tool turns record the right proposal; no reply claims a completed action; bookings are read back first; no reasoning, tool name or source ID is spoken.
- **Fast lane.** On the 48 cases and their paraphrases, no fast-lane answer is wrong. Coverage is reported, not targeted.
- **The gate follows the brain.** The 48 cases pass through the voice turn endpoint with the same thresholds.
- **Regression.** `npm run check:phase2` and `npm run check:hosted-model` still pass.
- **Throttling is recorded.** A run with refused voice requests does not count toward the speed goal.

## 9. Decision point after milestone A

If the speed goals in §8 are missed after the measures in §5.5, the owner chooses between accepting the measured numbers and switching the call path to the speech-to-speech model, whose figures are in §2.1.

## 10. Left to the builder

The voice turn endpoint's wire format and credential scheme; the fast lane's matching bar and how prepared answers are produced; whether Deepgram is reached through LiveKit's adapter or a custom one, by measurement; where filler audio is cached; the layout of the voice controls in the panel; test structure.

Known limits the builder must handle: a session allows twenty turns and one active turn at a time today, which read-back turns, interruptions and restarts on a changed transcript will exceed or collide with; tools that record something run only on the final transcript, never on an interim one; a cancelled turn must not leave a proposal behind.

## 11. Calls made by the assistant, for the owner to check

- Spoken answers are grounded by storing the evidence supplied with each turn and by the gate's content checks, not by citations.
- The typed path keeps OpenRouter and the JSON decision for now; only the spoken path uses Anthropic directly and the new output shape.
- Speed goals: first sound 1.5 s, real answer 2.5 s median without a tool and 4 s with one.
- A voice test is a normal test session, not a new kind of record.
- No audio is stored in milestone A. Five-minute cap per voice test.
- The voice preset list is limited to the five that passed the listening test.
- The voice test refuses to start without an AI disclosure line.
- Read-back before bookings is a prompt rule in milestone A and enforced in code from milestone B; messages and handoffs are confirmed after recording.
- Mandarin is not part of milestone A's acceptance.

## 12. Open with the owner

1. **Google's voice request limit.** Fine for one caller. A blocker for milestone B until Google raises it or the voice provider changes.
2. **Data leaving Malaysia.** Caller audio to Deepgram, conversation text to Anthropic and Google. The PDPA cross-border position must be settled before real callers.
3. **Prices not yet checked:** Deepgram multilingual streaming, and all phone-line and WhatsApp costs.
