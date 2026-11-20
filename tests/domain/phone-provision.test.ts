import test from "node:test";
import assert from "node:assert/strict";
import {
  TwilioError,
  twilioNumbers,
  twilioSettings,
  type OwnedNumber,
  type TwilioNumbers,
} from "../../packages/domain/src/phone/twilio.ts";
import { provisionNumber, type SipTrunkApi } from "../../packages/domain/src/phone/provision.ts";

const hex = (c: string) => c.repeat(32);
const ENV = {
  TWILIO_ACCOUNT_SID: "AC" + hex("a"),
  TWILIO_API_KEY_SID: "SK" + hex("b"),
  TWILIO_API_KEY_SECRET: "s3cret-value-that-is-long",
  TWILIO_BUNDLE_SID: "BU" + hex("c"),
  TWILIO_ADDRESS_SID: "AD" + hex("d"),
  TWILIO_TRUNK_SID: "TK" + hex("e"),
};
const NUMBER = "+60312345678";

test("Twilio settings name what is wrong by variable, never by value", () => {
  const s = twilioSettings(ENV);
  assert.equal(s.maxNumbers, 5);
  assert.throws(
    () => twilioSettings({ ...ENV, TWILIO_API_KEY_SECRET: "short", TWILIO_TRUNK_SID: "nope-nope" }),
    (e: Error) =>
      /TWILIO_SETTINGS_INVALID: TWILIO_API_KEY_SECRET, TWILIO_TRUNK_SID/.test(e.message) &&
      !e.message.includes("short") &&
      !e.message.includes("nope-nope"),
  );
  assert.throws(() => twilioSettings({ ...ENV, TWILIO_MAX_NUMBERS: "0" }), /TWILIO_MAX_NUMBERS/);
  assert.throws(() => twilioSettings({}), /TWILIO_ACCOUNT_SID/);
});

test("buying sends the bundle, address and trunk with the API key, and an error carries codes only", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let answer: () => Response = () =>
    Response.json({ sid: "PN" + hex("1"), phone_number: NUMBER, trunk_sid: ENV.TWILIO_TRUNK_SID }, { status: 201 });
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  const twilio = twilioNumbers(twilioSettings(ENV), fake);

  const bought = await twilio.buy(NUMBER, "Kedai Contoh");
  assert.deepEqual(bought, { sid: "PN" + hex("1"), e164: NUMBER, trunkSid: ENV.TWILIO_TRUNK_SID });
  assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${ENV.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`);
  assert.equal(calls[0].init.method, "POST");
  const form = new URLSearchParams(String(calls[0].init.body));
  assert.equal(form.get("PhoneNumber"), NUMBER);
  assert.equal(form.get("BundleSid"), ENV.TWILIO_BUNDLE_SID);
  assert.equal(form.get("AddressSid"), ENV.TWILIO_ADDRESS_SID);
  assert.equal(form.get("TrunkSid"), ENV.TWILIO_TRUNK_SID);
  assert.equal(form.get("VoiceUrl"), null);
  const auth = (calls[0].init.headers as Record<string, string>).authorization;
  assert.equal(auth, "Basic " + Buffer.from(`${ENV.TWILIO_API_KEY_SID}:${ENV.TWILIO_API_KEY_SECRET}`).toString("base64"));

  answer = () => Response.json({ code: 21649, message: "Bundle mismatch for " + ENV.TWILIO_API_KEY_SECRET }, { status: 400 });
  await assert.rejects(twilio.buy(NUMBER, "x"), (e: unknown) => {
    assert.ok(e instanceof TwilioError);
    assert.equal(e.message, "TWILIO_BUY_FAILED status=400 code=21649");
    assert.ok(!e.message.includes(ENV.TWILIO_API_KEY_SECRET));
    return true;
  });
  await assert.rejects(twilio.buy("0312345678", "x"), /INVALID_PHONE_NUMBER/);
  await assert.rejects(twilio.release("not-a-sid"), /INVALID_NUMBER_SID/);

  answer = () => Response.json({ available_phone_numbers: [{ phone_number: NUMBER, locality: "Kuala Lumpur" }, { phone_number: "bad" }] });
  assert.deepEqual(await twilio.available({ contains: "+603" }), [{ e164: NUMBER, locality: "Kuala Lumpur" }]);
  const search = new URL(calls.at(-1)!.url);
  assert.ok(search.pathname.endsWith("/AvailablePhoneNumbers/MY/Local.json"));
  assert.equal(search.searchParams.get("VoiceEnabled"), "true");
  assert.equal(search.searchParams.get("Contains"), "+603");
});

function fakes(held: OwnedNumber[] = [], trunkNumbers: string[] | null = ["+6042253068"]) {
  const bought: string[] = [];
  const twilio: TwilioNumbers = {
    available: async () => [],
    owned: async () => held,
    buy: async (e164) => {
      bought.push(e164);
      return { sid: "PN" + hex("2"), e164, trunkSid: ENV.TWILIO_TRUNK_SID };
    },
    release: async () => {},
  };
  const trunks = trunkNumbers ? [{ sipTrunkId: "ST_1", name: "jomcall-inbound", numbers: [...trunkNumbers] }] : [];
  const rules: { sipDispatchRuleId: string; trunkIds: string[] }[] = trunkNumbers ? [{ sipDispatchRuleId: "SDR_1", trunkIds: ["ST_1"] }] : [];
  const updates: unknown[] = [];
  const sip: SipTrunkApi = {
    listSipInboundTrunk: async () => trunks,
    createSipInboundTrunk: async (name, numbers) => {
      trunks.push({ sipTrunkId: "ST_new", name, numbers });
      return { sipTrunkId: "ST_new" };
    },
    listSipDispatchRule: async () => rules,
    createSipDispatchRule: async (_rule, opts) => {
      rules.push({ sipDispatchRuleId: "SDR_new", trunkIds: opts.trunkIds });
      return { sipDispatchRuleId: "SDR_new" };
    },
    updateSipInboundTrunkFields: async (id, fields) => {
      updates.push([id, fields]);
    },
  };
  const deps = {
    twilio,
    sip,
    trunkSid: ENV.TWILIO_TRUNK_SID,
    maxNumbers: 2,
    allowedAddresses: ["203.0.113.8/30"],
    roomConfig: (agentName: string, metadata: string) => ({ agentName, metadata }),
  };
  return { deps, bought, updates, trunks, rules };
}

test("a new number is bought once and added to the existing LiveKit trunk", async () => {
  const f = fakes([{ sid: "PN" + hex("0"), e164: "+6042253068", trunkSid: ENV.TWILIO_TRUNK_SID }]);
  const r = await provisionNumber(f.deps, { e164: NUMBER, label: "Kedai Contoh" });
  assert.deepEqual(r, { e164: NUMBER, numberSid: "PN" + hex("2"), bought: true, trunkId: "ST_1", addedToTrunk: true });
  assert.deepEqual(f.bought, [NUMBER]);
  assert.deepEqual(f.updates, [["ST_1", { numbers: { add: [NUMBER] } }]]);
});

test("running it again for a number already held and wired buys and changes nothing", async () => {
  const f = fakes([{ sid: "PN" + hex("2"), e164: NUMBER, trunkSid: ENV.TWILIO_TRUNK_SID }], ["+6042253068", NUMBER]);
  const r = await provisionNumber(f.deps, { e164: NUMBER, label: "x" });
  assert.equal(r.bought, false);
  assert.equal(r.addedToTrunk, false);
  assert.deepEqual(f.bought, []);
  assert.deepEqual(f.updates, []);
});

test("nothing is bought past the limit, with an open trunk, or for a bad number", async () => {
  const full = fakes([
    { sid: "PN" + hex("0"), e164: "+6042253068", trunkSid: ENV.TWILIO_TRUNK_SID },
    { sid: "PN" + hex("3"), e164: "+60387654321", trunkSid: ENV.TWILIO_TRUNK_SID },
  ]);
  await assert.rejects(provisionNumber(full.deps, { e164: NUMBER, label: "x" }), /NUMBER_LIMIT_REACHED/);
  assert.deepEqual(full.bought, []);
  const open = fakes();
  await assert.rejects(provisionNumber({ ...open.deps, allowedAddresses: [] }, { e164: NUMBER, label: "x" }), /TRUNK_NEEDS_ADDRESSES_OR_USERNAME/);
  await assert.rejects(provisionNumber(open.deps, { e164: "0312345678", label: "x" }), /INVALID_PHONE_NUMBER/);
  assert.deepEqual(open.bought, []);
});

test("a number held on another trunk is left alone, and a lost trunk is created again", async () => {
  const other = fakes([{ sid: "PN" + hex("4"), e164: NUMBER, trunkSid: "TK" + hex("f") }]);
  await assert.rejects(provisionNumber(other.deps, { e164: NUMBER, label: "x" }), /NUMBER_ON_ANOTHER_TRUNK/);
  assert.deepEqual(other.updates, []);
  const lost = fakes([], null);
  const r = await provisionNumber(lost.deps, { e164: NUMBER, label: "x" });
  assert.equal(r.trunkId, "ST_new");
  assert.deepEqual(lost.trunks[0].numbers, [NUMBER]);
  assert.deepEqual(lost.rules, [{ sipDispatchRuleId: "SDR_new", trunkIds: ["ST_new"] }]);
});
