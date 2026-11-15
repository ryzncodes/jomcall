import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VOICE,
  VOICE_DETAILS,
  VOICE_PRESETS,
  presetVoice,
  voiceFor,
} from "../../packages/contracts/src/voices.ts";
import { VOICE_PRESETS as DOMAIN_PRESETS } from "../../packages/domain/src/agent-test/voice-session.ts";

test("a saved voice counts only when it names a preset exactly", () => {
  assert.equal(presetVoice("Leda"), "Leda");
  for (const old of ["", "leda", " Leda", "warm female voice", "Nova", null, undefined, 3])
    assert.equal(presetVoice(old), null, String(old));
});

test("a saved value that is not a preset uses the default voice", () => {
  assert.equal(DEFAULT_VOICE, VOICE_PRESETS[0]);
  assert.equal(voiceFor("Charon"), "Charon");
  assert.equal(voiceFor(""), DEFAULT_VOICE);
  assert.equal(voiceFor("something the owner typed before"), DEFAULT_VOICE);
});

test("one voice list: the domain re-exports the contracts list", () => {
  assert.equal(DOMAIN_PRESETS, VOICE_PRESETS);
  assert.deepEqual(Object.keys(VOICE_DETAILS), [...VOICE_PRESETS]);
  for (const d of Object.values(VOICE_DETAILS)) assert.ok(d.en && d.ms);
});
