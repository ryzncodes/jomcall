import test from "node:test";
import assert from "node:assert/strict";
import { toE164 } from "../../packages/domain/src/phone/numbers.ts";
import { isAffirmative } from "../../packages/domain/src/phone/readback.ts";
import { livekitSipConfig } from "../../packages/domain/src/phone/sip-config.ts";
import { ensureSipConfig, type SipApi } from "../../packages/domain/src/phone/sip-apply.ts";
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

function fakeSip() {
  const trunks: { sipTrunkId: string; name: string; numbers: string[]; allowed: string[] }[] = [];
  const rules: { sipDispatchRuleId: string; trunkIds: string[]; rule: unknown; opts: any }[] = [];
  const api: SipApi = {
    listSipInboundTrunk: async () => trunks,
    createSipInboundTrunk: async (name, numbers, opts) => {
      const t = { sipTrunkId: "ST_" + (trunks.length + 1), name, numbers, allowed: opts.allowedAddresses };
      trunks.push(t);
      return t;
    },
    listSipDispatchRule: async () => rules,
    createSipDispatchRule: async (rule, opts) => {
      const r = { sipDispatchRuleId: "SDR_" + (rules.length + 1), trunkIds: opts.trunkIds, rule, opts };
      rules.push(r);
      return r;
    },
  };
  return { api, trunks, rules };
}
const room = (agentName: string, metadata: string) => ({ agentName, metadata });

test("the SIP trunk and dispatch rule are created once and found the second time", async () => {
  const f = fakeSip();
  const input = { numbers: ["+60312345678"], allowedAddresses: ["203.0.113.8/30"] };
  const first = await ensureSipConfig(f.api, input, room);
  assert.deepEqual(first, { trunkId: "ST_1", ruleId: "SDR_1", created: { trunk: true, rule: true } });
  assert.deepEqual(f.trunks[0].allowed, ["203.0.113.8/30"]);
  assert.deepEqual(f.rules[0].rule, { type: "callee", roomPrefix: "call-", randomize: true });
  assert.equal(f.rules[0].opts.hidePhoneNumber, false);
  assert.deepEqual(f.rules[0].opts.roomConfig, { agentName: "jomcall-voice", metadata: '{"channel":"phone"}' });
  const second = await ensureSipConfig(f.api, input, room);
  assert.deepEqual(second, { trunkId: "ST_1", ruleId: "SDR_1", created: { trunk: false, rule: false } });
  assert.equal(f.trunks.length, 1);
  assert.equal(f.rules.length, 1);
});

test("a missing dispatch rule is added to a trunk that is already there", async () => {
  const f = fakeSip();
  const input = { numbers: ["+60312345678"], allowedAddresses: ["203.0.113.8/30"] };
  await ensureSipConfig(f.api, input, room);
  f.rules.length = 0;
  const again = await ensureSipConfig(f.api, input, room);
  assert.deepEqual(again.created, { trunk: false, rule: true });
  assert.equal(f.trunks.length, 1);
});

test("a trunk of ours with other numbers is never changed, and an open trunk is refused", async () => {
  const f = fakeSip();
  await ensureSipConfig(f.api, { numbers: ["+60312345678"], allowedAddresses: ["203.0.113.8/30"] }, room);
  await assert.rejects(
    ensureSipConfig(f.api, { numbers: ["+60387654321"], allowedAddresses: ["203.0.113.8/30"] }, room),
    /TRUNK_NUMBERS_DIFFER/,
  );
  assert.equal(f.trunks.length, 1);
  await assert.rejects(
    ensureSipConfig(fakeSip().api, { numbers: ["+60312345678"], allowedAddresses: [] }, room),
    /TRUNK_NEEDS_ADDRESSES_OR_USERNAME/,
  );
});
