import test from "node:test";
import assert from "node:assert/strict";
import { toE164 } from "../../packages/domain/src/phone/numbers.ts";
import { isAffirmative } from "../../packages/domain/src/phone/readback.ts";
import { livekitSipConfig } from "../../packages/domain/src/phone/sip-config.ts";
import {
  telephonyConfig,
  telephonyReadiness,
} from "../../packages/domain/src/phone/telephony.ts";

test("provider number shapes normalise to E.164; withheld IDs give null", () => {
  assert.equal(toE164("+60312345678"), "+60312345678");
  assert.equal(toE164("60312345678"), "+60312345678");
  assert.equal(toE164("0312345678"), "+60312345678");
  assert.equal(toE164("sip:+60123456789@example.invalid"), "+60123456789");
  assert.equal(toE164("anonymous"), null);
  assert.equal(toE164(""), null);
  assert.equal(toE164(undefined), null);
});

test("a plain yes in BM, English, Manglish and Mandarin; any no wins", () => {
  for (const yes of ["Ya", "ya betul", "Boleh", "ok lah", "Yes please", "correct", "好的", "对", "可以"])
    assert.equal(isAffirmative(yes), true, yes);
  for (const no of ["tak", "Ya tapi tak boleh pukul 9", "bukan esok", "no", "wait", "不对", "不要", "esok pukul sepuluh", ""])
    assert.equal(isAffirmative(no), false, no);
});

test("the SIP config uses a callee rule, never the caller's number in room names", () => {
  const c = livekitSipConfig({ numbers: ["+60312345678", "+60312345678"], allowedAddresses: ["203.0.113.10"] });
  assert.deepEqual(c.inboundTrunk.trunk.numbers, ["+60312345678"]);
  const rule = c.dispatchRule.dispatch_rule as any;
  assert.deepEqual(rule.rule, { dispatch_rule_callee: { room_prefix: "call-", randomize: true } });
  assert.equal(rule.hide_phone_number, false);
  assert.deepEqual(rule.room_config.agents, [{ agent_name: "jomcall-voice", metadata: '{"channel":"phone"}' }]);
  assert.ok(!JSON.stringify(c).includes("auth_password"));
  assert.throws(() => livekitSipConfig({ numbers: ["+60312345678"] }), /TRUNK_NEEDS_ADDRESSES_OR_USERNAME/);
  assert.throws(() => livekitSipConfig({ numbers: [], authUsername: "x" }), /NO_PHONE_NUMBERS/);
  assert.throws(() => livekitSipConfig({ numbers: ["0312345678"], authUsername: "x" }), /INVALID_PHONE_NUMBER/);
});

test("telephony is off by default and names what is missing, never a value", () => {
  assert.equal(telephonyConfig({}).config, null);
  const r = telephonyReadiness({ JOMCALL_TELEPHONY_PROVIDER: "livekit_sip", LIVEKIT_API_SECRET: "s3cret" });
  assert.equal(r.configured, false);
  assert.ok(!r.reason!.includes("s3cret"));
  assert.match(r.reason!, /JOMCALL_VOICE_PROVIDER=hosted/);
  const on = telephonyConfig({
    JOMCALL_TELEPHONY_PROVIDER: "livekit_sip",
    JOMCALL_VOICE_PROVIDER: "hosted",
    LIVEKIT_URL: "ws://127.0.0.1:54630",
    LIVEKIT_API_KEY: "k",
    LIVEKIT_API_SECRET: "s",
  }).config!;
  assert.equal(on.maxConcurrent, 1);
  assert.equal(on.capSeconds, 600);
  assert.equal(on.transferUri, "tel:{e164}");
  assert.throws(() => telephonyConfig({ JOMCALL_TELEPHONY_PROVIDER: "twilio" }), /TELEPHONY_PROVIDER_INVALID/);
});
