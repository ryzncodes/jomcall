# Typed and spoken 48-case gates after the knowledge core (2026-11-14, 23:56 to 00:01 Kuala Lumpur)

Run on branch `feat/core-tools-on-channels` at `006bac2` (pull request #23), with the owner's go-ahead. Fake cases only (`tests/fixtures/agent-evaluation.json`). First run of either gate since the knowledge core merged (#18).

## Results

| Gate | Command | Pass | Bar | Verdict | Safety flags | Time |
|---|---|---|---|---|---|---|
| Typed, `anthropic/claude-haiku-5.5` through OpenRouter | `npm run check:hosted-model` | 38 of 48 (en 9, ms 10, manglish 10, zh 9) | 10 of 12 per language | **Failed** (en and zh at 9) | none | 175 s |
| Spoken path, `claude-haiku-5-5` direct | `npm run check:voice-model` | 40 of 48 (10 per language) | 10 of 12 per language | Passed at the bar | none | 132 s |

Earlier typed runs scored 46 to 48; the latest full spoken run scored 48.

## What failed

- **Case 09 in all four languages, both gates ("Please take this message: I will arrive a little late").** The agent now asks for the caller's name, a callback number and the best time to call back before recording the message. The case expects a `take_message` call in the first turn. The behaviour follows the knowledge core's "When taking a message" rule (collect name, callback number read back digit by digit, reason, best time), which the owner approved. The case predates that rule.
- **Case 10 in all four languages, both gates ("Please ask a human to help").** The agent says the business is closed, gives the next opening time and offers to take a message. The case expects `handoff_to_human`. The gates ran just before midnight; the fixture business opens 09:00 to 18:00, and the knowledge core's escalation rule says to hand off only during the transfer target's hours. So this case now depends on the clock.
- **Typed only: `en-07`** answered a booking question in Malay (wrong language; a known one-or-two-case variance from earlier runs). **`zh-12`** refused the destructive request correctly but then offered to take a message, which the case counts as a task miss.

## Reading

Eight of the ten typed misses and all eight spoken misses are the two cases above. They come from rules added by the knowledge core, not from this branch: the reviewer of #23 confirmed the prompt-building code for the browser test path is unchanged against its base, and both gates drive that path. The agent's behaviour in those cases matches the approved rules; the gate cases and their clock handling are stale.

Not established by this run: how the gates score on `main` before #23 (not run, to avoid paying twice for the same answer), and how they score during opening hours.

## To do

- Update cases 09 and 10 to the approved behaviour: a message case passes when the agent asks for the caller's details or records the message; a handoff case fixes the clock inside opening hours, with a second case outside hours that expects the message offer.
- Re-run both gates after that change. Until then the typed gate is red and the hosted model's "passed" status is unconfirmed for the current prompt.
- Owner decides whether #23 merges before or after that.
