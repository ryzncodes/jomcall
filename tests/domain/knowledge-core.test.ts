import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coreSections,
  coreVoicePrompt,
  factsSection,
  rulesSection,
  typedSystemPrompt,
  usesCore,
} from "../../packages/domain/src/knowledge/prompt.ts";
import {
  buildUnitIndex,
  coreAgentRules,
  coreVoiceRules,
  coreVoiceTools,
  gapRecord,
  isGap,
  searchUnits,
  type CoreSnapshotFull,
  type KnowledgeAccess,
} from "../../packages/domain/src/knowledge/tools.ts";
import { resolveRules, unitHash, factText } from "../../packages/domain/src/knowledge/snapshot.ts";
import { lookupKeys, maskContact, questionKey, formatSen } from "../../packages/domain/src/knowledge/text.ts";
import { agentRules, businessConfiguration } from "../../packages/domain/src/agent-test/prompt.ts";
import { voiceRules, voiceSystem, voiceTools } from "../../packages/domain/src/agent-test/voice-prompt.ts";
import { toolCallSchema } from "../../packages/contracts/src/agent-test.ts";
import { coreDecisionSchema, coreToolCallSchema } from "../../packages/contracts/src/knowledge.ts";
import { inputBudget, packModelInput } from "../../packages/inference/src/budget.ts";
import { embeddingProvider, createEmbedder, FakeEmbedder } from "../../packages/inference/src/embedding.ts";

const snapshot: CoreSnapshotFull = {
  settings: { name: "Kedai Contoh", greeting: "Hai" },
  knowledge: [{ kind: "faq", name: "Parking", content: "Parking percuma di belakang kedai Contoh." }],
  packs: ["stock-price"],
  facts: [
    { id: "f1", packId: "stock-price", fieldKey: "delivery_options", title: "Delivery", value: "Rider dalam 10 km, caj RM 8.", language: "ms" },
    { id: "f2", packId: null, fieldKey: null, title: "Warranty card", value: ["Keep the receipt", "12 months"], language: "en" },
  ],
  rules: resolveRules(["stock-price"], [
    { kind: "never", text: "x", pack_id: "stock-price", pack_rule_id: "no-diagnosis", enabled: false },
    { kind: "never", text: "Never mention competitor prices.", pack_id: null, pack_rule_id: null, enabled: true },
  ]),
  catalogue: null,
  context: {
    business: { name: "Kedai Contoh", type: "auto parts" },
    location: { name: "Cawangan Contoh" },
    schedule: {
      timezone: "Asia/Kuala_Lumpur",
      weekdays: [[{ start: "09:00", end: "18:00" }], [], [], [], [], [{ start: "09:00", end: "13:00" }], []],
      closures: [{ date: "2026-12-25", reason: "Krismas" }],
    },
  },
};

test("rules resolve pack defaults minus switched-off ones, plus owner rules", () => {
  const ids = snapshot.rules!.map((r) => r.ruleId);
  assert.ok(ids.includes("never-claim-genuine"));
  assert.ok(ids.includes("ask-for-name") || ids.length > 10, "every-business rules included");
  assert.ok(!ids.includes("no-diagnosis"));
  assert.ok(snapshot.rules!.some((r) => r.text === "Never mention competitor prices." && r.packId === null));
});

test("rules section states that rules outrank everything and carries the not-found path", () => {
  const text = rulesSection(snapshot);
  assert.match(text, /^RULES \(.*outrank everything else/);
  assert.match(text, /Never: Never mention competitor prices\./);
  assert.match(text, /take_message with unanswered set to true/);
});

test("facts section shows business, hours from the schedule, closures and facts", () => {
  const text = factsSection(snapshot, 16000);
  assert.match(text, /^BUSINESS FACTS/);
  assert.match(text, /Business: Kedai Contoh \(auto parts\)/);
  assert.match(text, /Opening hours \(Asia\/Kuala_Lumpur\): Mon 09:00-18:00; Tue closed;.*Sat 09:00-13:00; Sun closed/);
  assert.match(text, /Closed on: 2026-12-25 \(Krismas\)/);
  assert.match(text, /Delivery, courier, rider or self-collect.*: Rider dalam 10 km/);
  assert.match(text, /Warranty card: Keep the receipt; 12 months/);
  // Capped for the small model: facts beyond the cap stay searchable.
  assert.ok(Buffer.byteLength(factsSection(snapshot, 300)) <= 300 || !factsSection(snapshot, 300).includes("Warranty"));
});

test("typed prompt: rules and facts in labelled sections; old snapshots unchanged", () => {
  const now = new Date("2026-11-14T02:00:00Z");
  const config = businessConfiguration(snapshot.settings);
  const typed = typedSystemPrompt({ shared: agentRules, core: coreAgentRules }, snapshot, config, now, 48000);
  assert.ok(typed.startsWith(coreAgentRules));
  assert.ok(typed.indexOf("RULES (") < typed.indexOf("BUSINESS FACTS"));
  assert.match(typed, /lookup_catalogue/);
  const old = { settings: snapshot.settings, knowledge: snapshot.knowledge };
  assert.equal(usesCore(old), false);
  assert.equal(
    typedSystemPrompt({ shared: agentRules, core: coreAgentRules }, old, config, now, 6000),
    agentRules + "\nBusiness configuration: " + config + "\nCurrent date/time: " + now.toISOString() + "; timezone Asia/Kuala_Lumpur.",
  );
});

test("spoken prompt: rules and facts in the stable prefix, which evidence does not change", () => {
  const rules = { shared: voiceRules, core: coreVoiceRules };
  const a = coreVoicePrompt(voiceSystem(snapshot.settings, [], [], new Date("2026-11-14T01:00:00Z")), rules, snapshot);
  const b = coreVoicePrompt(
    voiceSystem(snapshot.settings, [], [{ sourceId: "x", title: "Parking", excerpt: "Parking percuma" }], new Date("2026-11-14T03:00:00Z")),
    rules,
    snapshot,
  );
  assert.equal(a.stable, b.stable);
  assert.notEqual(a.volatile, b.volatile);
  assert.ok(a.stable.startsWith(coreVoiceRules));
  assert.match(a.stable, /RULES \(/);
  assert.match(a.stable, /Opening hours/);
  assert.doesNotMatch(a.stable, /Evidence: \[/);
  const old = voiceSystem({ name: "x" }, [], [], new Date());
  assert.deepEqual(coreVoicePrompt(old, rules, { knowledge: [] } as never), old);
});

test("shared tool exports are unchanged; core tools add lookup_catalogue", () => {
  assert.deepEqual(voiceTools.map((t) => t.name), toolCallSchema.options.map((o) => o.shape.name.value));
  assert.ok(!voiceTools.some((t) => t.name === "lookup_catalogue"));
  assert.ok(coreVoiceTools.some((t) => t.name === "lookup_catalogue"));
  assert.throws(() => toolCallSchema.parse({ name: "lookup_catalogue", args: { item: "x", code: "", fits: "" } }));
  assert.ok(coreToolCallSchema.parse({ name: "lookup_catalogue", args: { item: "bateri", code: "", fits: "" } }));
  assert.throws(() => coreToolCallSchema.parse({ name: "lookup_catalogue", args: { item: " ", code: "", fits: "" } }));
  assert.ok(coreDecisionSchema.parse({ kind: "tool", call: { name: "take_message", args: { text: "Call back", unanswered: true } } }));
});

test("lookup keys, money and contact masking", () => {
  assert.deepEqual(lookupKeys("Bateri NS60", ["ns-60 l", "46B24L"]).sort(), ["46B24L", "BATERINS60", "NS60", "NS60L"].sort());
  assert.equal(formatSen(23000), "RM 230.00");
  assert.equal(formatSen(null), null);
  const masked = maskContact("Saya Ali, call 012-555 0188 or ali@contoh.my");
  assert.doesNotMatch(masked, /555|contoh\.my/);
  assert.equal(questionKey("Berapa harga bateri?"), questionKey("berapa  harga BATERI"));
});

test("a gap needs a message, flagged unanswered or after an empty lookup", () => {
  const msg = (unanswered: boolean) => ({ call: { name: "take_message" as const, args: { text: "t", unanswered } } });
  assert.equal(isGap([msg(true)]), true);
  assert.equal(isGap([msg(false)]), false);
  assert.equal(
    isGap([{ call: { name: "lookup_catalogue", args: { item: "x", code: "", fits: "" } }, result: { kind: "catalogue", found: false, items: [] } }, msg(false)]),
    true,
  );
  assert.equal(isGap([{ call: { name: "search_knowledge", args: { query: "x" } }, result: { kind: "knowledge", items: [] } }]), false);
  const g = gapRecord("Timing belt? 012-555 0188", "en", "voice", "I will ask staff.");
  assert.match(g.question, /\[number\]/);
  assert.match(g.key, /^[0-9a-f]{64}$/);
});

test("unit search: free text keeps old ids, facts are units, embeddings only when switched on", async () => {
  const index = buildUnitIndex(snapshot);
  assert.ok(index.some((h) => h.title === "Parking" && /:0:0$/.test(h.sourceId)));
  assert.ok(index.some((h) => h.sourceId.startsWith("fact:") && h.title === "Warranty card"));
  const keyword = await searchUnits(snapshot, undefined, "parking percuma");
  assert.equal(keyword[0].title, "Parking");
  // Fake embedder, fake database: never the network.
  const embedder = new FakeEmbedder();
  const hash = unitHash("Warranty card", factText(snapshot.facts![1].value));
  let asked: string[] = [];
  const access: KnowledgeAccess = {
    catalogue: async () => [],
    units: async (args) => {
      asked = args.hashes;
      return [{ hash, source: "fact", title: "Warranty card", text: "x", score: 0.91 }];
    },
    gap: async () => ({}),
  };
  const semantic = await searchUnits(snapshot, access, "guarantee period", { embedder });
  assert.equal(embedder.calls, 1);
  assert.ok(asked.includes(hash));
  assert.equal(semantic[0].title, "Warranty card");
  assert.equal(semantic[0].score, 0.91);
  // A failing database falls back to keyword.
  const broken = { ...access, units: async () => { throw Error("down"); } };
  assert.equal((await searchUnits(snapshot, broken, "parking", { embedder }))[0].title, "Parking");
});

test("embedding switch is off by default and refuses unknown values", () => {
  assert.equal(embeddingProvider({}), "disabled");
  assert.equal(embeddingProvider({ JOMCALL_EMBEDDING_PROVIDER: "" }), "disabled");
  assert.equal(createEmbedder({}), null);
  assert.throws(() => embeddingProvider({ JOMCALL_EMBEDDING_PROVIDER: "openai" }), /EMBEDDING_PROVIDER_INVALID/);
  assert.throws(() => createEmbedder({ JOMCALL_EMBEDDING_PROVIDER: "google" }), /EMBEDDING_KEY_MISSING/);
});

test("input budget depends on the pinned model; local guard unchanged", () => {
  assert.equal(inputBudget("openrouter:anthropic/claude-haiku-5.5"), 48000);
  assert.equal(inputBudget("ollama:qwen3:4b"), 6000);
  assert.equal(inputBudget(null), 6000);
  const long = [{ role: "system" as const, content: "x".repeat(10000) }];
  assert.throws(() => packModelInput(long), /INPUT_BUDGET_EXCEEDED/);
  assert.equal(packModelInput(long, [], 48000).messages.length, 1);
  assert.ok(coreSections(snapshot, 6000)[1].length <= 1500);
});

test("the small local model keeps owner rules first and the not-found rule within its cap", () => {
  const text = rulesSection(snapshot, 1400);
  assert.ok(Buffer.byteLength(text) <= 1400);
  assert.match(text, /Never mention competitor prices/);
  assert.match(text, /take_message with unanswered set to true\.$/);
  assert.ok(rulesSection(snapshot).length > text.length);
});

test("snapshots are put in jsonb key order before hashing", async () => {
  const { jsonbOrder } = await import("../../packages/domain/src/knowledge/snapshot.ts");
  const ordered = jsonbOrder({ settings: { b: 1, aa: 2 }, knowledge: [], packs: [], context: { z: 1 } });
  assert.deepEqual(Object.keys(ordered), ["packs", "context", "settings", "knowledge"]);
  assert.deepEqual(Object.keys(ordered.settings), ["b", "aa"]);
});
