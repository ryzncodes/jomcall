// The setup read worker against the local database, with a fake `read`. No
// network call and no model call: readDocument is never run here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPhase2Harness } from "../helpers/phase2.ts";
import {
  SetupReadWorker,
  readerFields,
  type ReadFn,
} from "../../engine/src/agent/setup-reader.ts";
import {
  readerFallbackModel,
  readerModel,
  READER_DISAGREE_PREFIX,
  type AnthropicLike,
  type ReadResult,
  type ReadRow,
  type ReadFact,
  type ReaderInput,
  type ReaderField,
} from "../../packages/inference/src/setup-reader.ts";
import { basePack, packById } from "../../packages/domain/src/packs/index.ts";

// The web process accepts uploads only while the switch is on.
process.env.JOMCALL_SETUP_READER = "anthropic";

type ReadOpts = Parameters<ReadFn>[2];
type Step = ReadResult | Error | ((opts: ReadOpts) => Promise<ReadResult> | ReadResult);
// Answers with the steps in order; the last one repeats.
function fake(...steps: Step[]) {
  const calls: { input: ReaderInput; fields: ReaderField[]; model?: string }[] = [];
  const read: ReadFn = async (input, fields, opts) => {
    calls.push({ input, fields, model: opts.model });
    const step = steps.length > 1 ? steps.shift()! : steps[0]!;
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(opts) : step;
  };
  return { read, calls };
}
const row = (item: string, extra: Partial<ReadRow> = {}): ReadRow => ({
  item,
  variant: "",
  priceSen: 500,
  unit: "",
  notes: "",
  needsCheck: false,
  checkReason: "",
  ...extra,
});
const fact = (packId: string, fieldKey: string, value: string, extra: Partial<ReadFact> = {}): ReadFact => ({
  packId,
  fieldKey,
  value,
  needsCheck: false,
  checkReason: "",
  ...extra,
});
const ok = (rows: ReadRow[], facts: ReadFact[] = [], extra: Partial<ReadResult> = {}): ReadResult =>
  ({
    ok: true,
    rows,
    facts,
    model: "fake",
    flaggedShare: rows.length ? rows.filter((r) => r.needsCheck).length / rows.length : 0,
    dropped: 0,
    ...extra,
  }) as ReadResult;
const failed = (code: "TOO_LONG" | "UNREADABLE" | "REFUSED" | "FAILED" | "REJECTED"): ReadResult => ({ ok: false, code });

async function fixture() {
  const f = await createPhase2Harness();
  const agentId = f.h.orgA.agentId;
  const base = `/agents/${agentId}/setup`;
  const up = `${base}/uploads`;
  const started = await f.req("POST", base, { mainPack: "appointment", extraPacks: [] });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const sessionId = started.body.data.session.id as string;
  const q = (sql: string, args: unknown[] = []) => f.h.cleanup.query(sql, args);
  const workers: SetupReadWorker[] = [];
  const worker = async (
    read: ReadFn | undefined,
    opts: { enabled?: boolean; ns?: string; timeoutMs?: number; client?: AnthropicLike } = {},
  ) => {
    const w = await SetupReadWorker.create(opts.ns ?? f.h.namespace, {
      ...(read ? { read } : {}),
      ...(opts.client ? { client: opts.client } : {}),
      enabled: opts.enabled ?? true,
      // Every tick runs maintain here; the process default is every 30 s.
      maintainEveryMs: 0,
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
    workers.push(w);
    return w;
  };
  const paste = async (text = "Nasi lemak RM5\nTeh tarik RM2") => {
    const r = await f.req("POST", `${up}/text`, { text });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.data.id as string;
  };
  // A PDF upload sent in one chunk and finished.
  const pdfUpload = async (data: Buffer, name = "senarai.pdf") => {
    const c = await f.req("POST", up, { kind: "pdf", name, mime: "application/pdf", bytes: data.length });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const id = c.body.data.id as string;
    const r = await f.api.raw(f.h.alice, f.h.orgA.id, "PUT", `/api/v1${up}/${id}/chunks/0`, data);
    assert.equal(r.status, 200);
    assert.equal((await f.req("POST", `${up}/${id}/finish`, {})).status, 200);
    return id;
  };
  const view = async () => (await f.req("GET", base)).body.data;
  const upload = async (id: string) =>
    (await q("select * from app.setup_upload where id=$1", [id])).rows[0];
  const chunks = async (id: string) =>
    Number((await q("select count(*) from app.setup_upload_chunk where upload_id=$1", [id])).rows[0].count);
  const outboxDone = async (id: string) =>
    (await q("select delivered_at from app.outbox where kind='setup.read' and resource_id=$1", [id])).rows[0]
      .delivered_at !== null;
  // Items of the session, price rows in document order.
  const items = async (kind?: string) =>
    (
      await q(
        "select kind,key,payload,source,needs_check,check_reason,state from app.setup_item where session_id=$1 and ($2::text is null or kind=$2)",
        [sessionId, kind ?? null],
      )
    ).rows.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind.localeCompare(b.kind)
        : a.key.split(":")[0] !== b.key.split(":")[0]
          ? 0
          : Number(a.key.split(":")[1] ?? 0) - Number(b.key.split(":")[1] ?? 0),
    );
  const close = async () => {
    for (const w of workers) await w.close();
    await f.close();
  };
  return { f, agentId, base, up, sessionId, q, worker, paste, pdfUpload, view, upload, chunks, outboxDone, items, close };
}
type Fx = Awaited<ReturnType<typeof fixture>>;
async function withFixture(run: (x: Fx) => Promise<void>) {
  const x = await fixture();
  try {
    await run(x);
  } finally {
    await x.close();
  }
}

test("readerFields lists every active pack's facts once per key, under the interview's pack", () => {
  // lead_time is in both quote-visit and order. With no frozen question for
  // it, the first pack in order (base, main, extras) keeps it.
  const fields = readerFields({ mainPack: "quote-visit", extraPacks: ["order"], questionIds: ["order:3"] });
  const keys = fields.map((f) => f.fieldKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(fields.find((f) => f.fieldKey === "lead_time")!.packId, "quote-visit");
  assert.equal(fields.find((f) => f.fieldKey === "business_name")!.packId, "every-business");
  const leadQuestion = packById("order")!.interview.find((q) => q.fills.includes("facts.lead_time"))!;
  // Its frozen question is order's: the interview files it there.
  const withQuestion = readerFields({
    mainPack: "quote-visit",
    extraPacks: ["order"],
    questionIds: [`order:${leadQuestion.order}`],
  });
  assert.equal(withQuestion.find((f) => f.fieldKey === "lead_time")!.packId, "order");
});

test("a queued upload is read once and its rows appear as pending import items", () =>
  withFixture(async (x) => {
    const id = await x.paste("Nasi lemak RM5\nTeh tarik RM2");
    const before = await x.view();
    assert.ok(before.missing.some((m: { key: string }) => m.key === "business_name"));
    const { read, calls } = fake(
      ok(
        [
          row("Nasi lemak", { variant: "Besar", priceSen: 650, unit: "per pinggan", notes: "sebelum 11 pagi" }),
          row("Teh tarik", { priceSen: null, needsCheck: true, checkReason: "No price was found for this item." }),
          row("   "), // refused by the payload contract: counted as dropped
        ],
        [fact("every-business", "business_name", "Kedai Contoh"), fact("appointment", "nope_not_a_field", "x")],
        { dropped: 1 },
      ),
    );
    const w = await x.worker(read);
    assert.equal(await w.tick(), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.input, { kind: "text", text: "Nasi lemak RM5\nTeh tarik RM2" });
    assert.equal(calls[0]!.model, undefined);
    assert.ok(calls[0]!.fields.some((f) => f.packId === "appointment" && f.fieldKey === "services_summary"));

    const rows = await x.items("catalogue_row");
    assert.deepEqual(rows, [
      {
        kind: "catalogue_row",
        key: `${id}:1`,
        payload: { uploadId: id, item: "Nasi lemak", variant: "Besar", priceSen: 650, unit: "per pinggan", notes: "sebelum 11 pagi" },
        source: "import",
        needs_check: false,
        check_reason: null,
        state: "pending",
      },
      {
        kind: "catalogue_row",
        key: `${id}:2`,
        payload: { uploadId: id, item: "Teh tarik", variant: "", priceSen: null, unit: "", notes: "" },
        source: "import",
        needs_check: true,
        check_reason: "No price was found for this item.",
        state: "pending",
      },
    ]);
    // Exactly what the interview writes for that pack field, plus uploadId.
    const facts = await x.items("fact");
    assert.deepEqual(facts, [
      {
        kind: "fact",
        key: "business_name",
        payload: {
          packId: "every-business",
          fieldKey: "business_name",
          title: packById("every-business")!.facts.find((f) => f.key === "business_name")!.label.en,
          value: "Kedai Contoh",
          language: "mixed",
          uploadId: id,
        },
        source: "import",
        needs_check: false,
        check_reason: null,
        state: "pending",
      },
    ]);
    const u = await x.upload(id);
    assert.equal(u.state, "done");
    assert.equal(u.row_count, 2);
    assert.equal(u.fact_count, 1);
    assert.equal(u.dropped_count, 2);
    assert.equal(u.attempts, 1);
    assert.equal(u.lease_token, null);
    assert.ok(u.read_at);
    assert.equal(await x.outboxDone(id), true);
    // The view treats the import fact like an answer, and the page reloads.
    const after = await x.view();
    assert.ok(!after.missing.some((m: { key: string }) => m.key === "business_name"));
    assert.ok(after.session.revision > before.session.revision);
    assert.equal(after.uploads[0].state, "done");
    // Read once: a second tick finds nothing.
    assert.equal(await w.tick(), false);
    assert.equal(calls.length, 1);

    // A file in two chunks reaches the reader joined, in order.
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40, 0x41)]);
    const c = await x.f.req("POST", x.up, { kind: "pdf", name: "senarai.pdf", mime: "application/pdf", bytes: pdf.length });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const pid = c.body.data.id as string;
    const owner = (m: string, p: string, b: Uint8Array) => x.f.api.raw(x.f.h.alice, x.f.h.orgA.id, m, "/api/v1" + p, b);
    assert.equal((await owner("PUT", `${x.up}/${pid}/chunks/1`, pdf.subarray(20))).status, 200);
    assert.equal((await owner("PUT", `${x.up}/${pid}/chunks/0`, pdf.subarray(0, 20))).status, 200);
    assert.equal((await x.f.req("POST", `${x.up}/${pid}/finish`, {})).status, 200);
    assert.equal(await w.tick(), true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.input.kind, "pdf");
    assert.ok((calls[1]!.input as { data: Buffer }).data.equals(pdf));
  }));

test("two workers ticking together read it once", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return ok([row("Nasi lemak")]);
    });
    const [a, b] = [await x.worker(read), await x.worker(read)];
    const handled = await Promise.all([a.tick(), b.tick()]);
    assert.deepEqual(handled.sort(), [false, true]);
    assert.equal(calls.length, 1);
    assert.equal((await x.upload(id)).state, "done");
    assert.equal((await x.items("catalogue_row")).length, 1);
  }));

test("TOO_LONG stores no item and marks the upload failed with that code", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(failed("TOO_LONG"));
    const w = await x.worker(read);
    await w.tick();
    await w.tick();
    assert.equal(calls.length, 1);
    const u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "TOO_LONG");
    assert.equal(u.lease_token, null);
    assert.deepEqual(await x.items(), []);
    assert.equal(await x.outboxDone(id), true);
  }));

test("retryable vs final codes: FAILED is retried, the others are final at once", () =>
  withFixture(async (x) => {
    for (const [code, stored] of [
      ["UNREADABLE", "UNREADABLE"],
      ["REFUSED", "REFUSED"],
      ["REJECTED", "READ_FAILED"],
    ] as const) {
      const id = await x.paste(`list for ${code}`);
      const { read, calls } = fake(failed(code));
      const w = await x.worker(read);
      await w.tick();
      await w.tick();
      assert.equal(calls.length, 1, code);
      const u = await x.upload(id);
      assert.equal(u.state, "failed", code);
      assert.equal(u.fail_code, stored, code);
      assert.equal(u.attempts, 1, code);
    }
    // FAILED releases the lease; the next tick reads again and succeeds.
    const id = await x.paste("retry me");
    const { read, calls } = fake(failed("FAILED"), ok([row("Kopi")]));
    const w = await x.worker(read);
    await w.tick();
    let u = await x.upload(id);
    assert.equal(u.state, "queued");
    assert.equal(u.attempts, 1);
    assert.equal(u.lease_token, null);
    assert.equal(await x.outboxDone(id), false);
    await w.tick();
    u = await x.upload(id);
    assert.equal(calls.length, 2);
    assert.equal(u.state, "done");
    assert.equal(u.attempts, 2);
    assert.deepEqual((await x.items("catalogue_row")).map((r) => r.payload.item), ["Kopi"]);
  }));

test("a thrown error is retried once, then READ_FAILED", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(new Error("socket hang up"));
    const w = await x.worker(read);
    await w.tick();
    assert.equal((await x.upload(id)).state, "queued");
    await w.tick();
    await w.tick();
    assert.equal(calls.length, 2);
    const u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "READ_FAILED");
    assert.equal(u.attempts, 2);
    assert.equal(await x.outboxDone(id), true);
    assert.deepEqual(await x.items(), []);
  }));

test("an expired lease is picked up again by maintain", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(ok([row("Roti canai")]));
    const w = await x.worker(read);
    // A worker that claimed and then died.
    const claim = await w.op("claim");
    assert.equal(claim.upload, id);
    assert.equal((await x.upload(id)).state, "reading");
    // Not expired yet: nothing to claim.
    assert.equal(await w.tick(), false);
    await x.q("update app.setup_upload set lease_until=now()-interval '1 second' where id=$1", [id]);
    assert.equal(await w.tick(), true);
    assert.equal(calls.length, 1);
    const u = await x.upload(id);
    assert.equal(u.state, "done");
    assert.equal(u.attempts, 2);
    // The dead worker's lease writes nothing.
    assert.equal(await w.op("result", id, claim.lease, { rows: [], facts: [], dropped: 0 }), null);
    assert.equal(await w.op("chunk", id, claim.lease, { seq: 0 }), null);
    // An expired lease on the second attempt fails the upload at claim.
    const id2 = await x.paste("second");
    await w.op("claim");
    await x.q("update app.setup_upload set attempts=2,lease_until=now()-interval '1 second' where id=$1", [id2]);
    await w.tick();
    assert.equal(calls.length, 1);
    assert.equal((await x.upload(id2)).fail_code, "READ_FAILED");
  }));

test("an interview answer for the same fact is kept; the import fact is skipped", () =>
  withFixture(async (x) => {
    const v = await x.view();
    const questions = v.questions.filter((q: { kind: string }) => q.kind === "fact");
    const [answered, skipped] = questions as { id: string; fills: string[] }[];
    const keyOf = (q: { fills: string[] }) => q.fills.find((f) => f.startsWith("facts."))!.slice(6);
    let r = await x.f.req("PUT", `${x.base}/answers/${encodeURIComponent(answered!.id)}`, {
      expectedRevision: v.session.revision,
      answer: { kind: "fact", text: "Jawapan pemilik" },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await x.f.req("PUT", `${x.base}/answers/${encodeURIComponent(skipped!.id)}`, {
      expectedRevision: r.body.data.session.revision,
      answer: { kind: "skip" },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const id = await x.paste();
    const pack = (q: { id: string }) => q.id.split(":")[0]!;
    const { read } = fake(
      ok([], [fact(pack(answered!), keyOf(answered!), "Dari dokumen"), fact(pack(skipped!), keyOf(skipped!), "Juga dari dokumen")]),
    );
    const w = await x.worker(read);
    await w.tick();
    const facts = await x.items("fact");
    const kept = facts.find((i) => i.key === keyOf(answered!))!;
    assert.equal(kept.source, "interview");
    assert.equal(kept.payload.value, "Jawapan pemilik");
    assert.equal(kept.payload.uploadId, undefined);
    // A skipped (removed) row is replaced by the import.
    const filled = facts.find((i) => i.key === keyOf(skipped!))!;
    assert.equal(filled.source, "import");
    assert.equal(filled.state, "pending");
    assert.equal(filled.payload.value, "Juga dari dokumen");
    assert.equal(filled.payload.uploadId, id);
    assert.equal((await x.upload(id)).fact_count, 1);
  }));

test('the same item in two uploads is flagged "listed twice"', () =>
  withFixture(async (x) => {
    const first = await x.paste("first");
    const w1 = await x.worker(
      fake(ok([row("Nasi Lemak"), row("  nasi   LEMAK "), row("Nasi", { variant: "Lemak" })])).read,
    );
    await w1.tick();
    const second = await x.paste("second");
    const w2 = await x.worker(
      fake(ok([row("Nasi lemak", { needsCheck: true, checkReason: "The price is blurred." }), row("Teh ais")])).read,
    );
    await w2.tick();
    const rows = await x.items("catalogue_row");
    const by = (key: string) => rows.find((r) => r.key === key)!;
    assert.equal(by(`${first}:1`).needs_check, false);
    assert.equal(by(`${first}:2`).needs_check, true);
    assert.equal(by(`${first}:2`).check_reason, "listed twice");
    // Item and variant are compared as a pair.
    assert.equal(by(`${first}:3`).needs_check, false);
    assert.equal(by(`${second}:1`).needs_check, true);
    assert.equal(by(`${second}:1`).check_reason, "The price is blurred.; listed twice");
    assert.equal(by(`${second}:2`).needs_check, false);
    // A long reader reason is cut so the note still fits.
    const third = await x.paste("third");
    const w3 = await x.worker(fake(ok([row("Teh ais", { needsCheck: true, checkReason: "x".repeat(500) })])).read);
    await w3.tick();
    const long = (await x.items("catalogue_row")).find((r) => r.key === `${third}:1`)!;
    assert.equal(long.check_reason.length, 500);
    assert.ok(long.check_reason.endsWith("; listed twice"));
  }));

const flaggedRows = (n: number, flagged: number) =>
  Array.from({ length: n }, (_, i) =>
    row(`Item ${i + 1}`, i < flagged ? { needsCheck: true, checkReason: "Blurred." } : {}),
  );

test("flaggedShare above 0.5 with 10 rows triggers one fallback read; its result replaces the first", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(ok(flaggedRows(10, 6)), ok(flaggedRows(10, 1)));
    const w = await x.worker(read);
    await w.tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.model, readerFallbackModel);
    const rows = await x.items("catalogue_row");
    assert.equal(rows.length, 10);
    assert.equal(rows.filter((r) => r.needs_check).length, 1);
    const u = await x.upload(id);
    assert.equal(u.attempts, 1);
    assert.equal(u.state, "done");
  }));

test("a fallback with fewer rows never replaces the first read; facts are merged when it wins", () =>
  withFixture(async (x) => {
    const firstFacts = [fact("every-business", "business_name", "Dari bacaan pertama")];
    // Empty fallback: share 0, but no rows.
    const empty = await x.paste("empty fallback");
    const a = fake(ok(flaggedRows(10, 6), firstFacts), ok([]));
    await (await x.worker(a.read)).tick();
    assert.equal(a.calls.length, 2);
    let rows = (await x.items("catalogue_row")).filter((r) => r.key.startsWith(empty));
    assert.equal(rows.length, 10);
    assert.equal(rows.filter((r) => r.needs_check).length, 6);
    assert.equal((await x.upload(empty)).fact_count, 1);
    // Two clean rows: still fewer rows.
    const two = await x.paste("two rows");
    const b = fake(ok(flaggedRows(10, 6).map((r) => ({ ...r, item: "B " + r.item }))), ok([row("Satu"), row("Dua")]));
    await (await x.worker(b.read)).tick();
    rows = (await x.items("catalogue_row")).filter((r) => r.key.startsWith(two));
    assert.equal(rows.length, 10);
    assert.ok(rows.every((r) => r.payload.item.startsWith("B ")));
    // Ten rows, two flagged: kept, with the first read's fact merged in and
    // winning for its field.
    const good = await x.paste("good fallback");
    const c = fake(
      ok(flaggedRows(10, 6).map((r) => ({ ...r, item: "C " + r.item })), [fact("appointment", "walk_in_policy", "Pertama")]),
      ok(flaggedRows(10, 2).map((r) => ({ ...r, item: "D " + r.item })), [
        fact("appointment", "walk_in_policy", "Kedua"),
        fact("appointment", "booking_window", "Dua minggu"),
      ]),
    );
    await (await x.worker(c.read)).tick();
    rows = (await x.items("catalogue_row")).filter((r) => r.key.startsWith(good));
    assert.equal(rows.length, 10);
    assert.ok(rows.every((r) => r.payload.item.startsWith("D ")));
    assert.equal(rows.filter((r) => r.needs_check).length, 2);
    const facts = await x.items("fact");
    assert.equal(facts.find((f) => f.key === "walk_in_policy")!.payload.value, "Pertama");
    assert.equal(facts.find((f) => f.key === "booking_window")!.payload.value, "Dua minggu");
  }));

test("fallback keeps the better result: a worse or failed fallback keeps the first", () =>
  withFixture(async (x) => {
    const worse = await x.paste("worse");
    const a = fake(ok(flaggedRows(10, 6)), ok(flaggedRows(10, 9)));
    await (await x.worker(a.read)).tick();
    assert.equal(a.calls.length, 2);
    assert.equal(
      (await x.items("catalogue_row")).filter((r) => r.key.startsWith(worse) && r.needs_check).length,
      6,
    );
    const broken = await x.paste("broken");
    const b = fake(ok(flaggedRows(10, 7)), failed("FAILED"));
    await (await x.worker(b.read)).tick();
    assert.equal(b.calls.length, 2);
    const u = await x.upload(broken);
    assert.equal(u.state, "done");
    assert.equal(u.attempts, 1);
    // Nine rows: no fallback, however flagged.
    await x.paste("short");
    const c = fake(ok(flaggedRows(9, 9)));
    await (await x.worker(c.read)).tick();
    assert.equal(c.calls.length, 1);
  }));

test("a session applied while reading gets no items and fails SESSION_CLOSED", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read } = fake(async () => {
      const v = await x.view();
      const applied = await x.f.req("POST", `${x.base}/apply`, { expectedRevision: v.session.revision, replace: [] });
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      return ok([row("Nasi lemak")], [fact("every-business", "business_name", "Kedai Contoh")]);
    });
    await (await x.worker(read)).tick();
    assert.deepEqual(await x.items(), []);
    const u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "SESSION_CLOSED");
    assert.equal(await x.outboxDone(id), true);
  }));

test("an upload still queued when the session is applied is failed SESSION_CLOSED at claim, never read", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const v = await x.view();
    const applied = await x.f.req("POST", `${x.base}/apply`, { expectedRevision: v.session.revision, replace: [] });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    const { read, calls } = fake(ok([row("Nasi lemak")]));
    assert.equal(await (await x.worker(read)).tick(), false);
    assert.equal(calls.length, 0);
    const u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "SESSION_CLOSED");
    assert.equal(await x.outboxDone(id), true);
  }));

test("result after remove writes nothing", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(async () => {
      const gone = await x.f.req("DELETE", `${x.up}/${id}`, {});
      assert.equal(gone.status, 200, JSON.stringify(gone.body));
      return ok([row("Nasi lemak")]);
    });
    const w = await x.worker(read);
    await w.tick();
    assert.deepEqual(await x.items(), []);
    const u = await x.upload(id);
    assert.equal(u.state, "removed");
    assert.equal(u.fail_code, null);
    // The next claim delivers the outbox row without reading.
    await w.tick();
    assert.equal(calls.length, 1);
    assert.equal(await x.outboxDone(id), true);
  }));

test("claim skips a removed upload", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    assert.equal((await x.f.req("DELETE", `${x.up}/${id}`, {})).status, 200);
    const { read, calls } = fake(ok([row("Nasi lemak")]));
    const w = await x.worker(read);
    assert.equal(await w.tick(), false);
    assert.equal(calls.length, 0);
    assert.equal(await x.outboxDone(id), true);
    assert.equal((await x.upload(id)).state, "removed");
  }));

test("with the switch off a queued upload is failed READER_OFF", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(ok([row("Nasi lemak")]));
    await (await x.worker(read, { enabled: false })).tick();
    assert.equal(calls.length, 0);
    const u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "READER_OFF");
    assert.deepEqual(await x.items(), []);
  }));

test("abandoned uploading uploads are cleared by maintain", () =>
  withFixture(async (x) => {
    const make = async () => {
      const c = await x.f.req("POST", x.up, { kind: "pdf", name: "a.pdf", mime: "application/pdf", bytes: 30 });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      const id = c.body.data.id as string;
      const put = await x.f.api.raw(x.f.h.alice, x.f.h.orgA.id, "PUT", `/api/v1${x.up}/${id}/chunks/0`, Buffer.alloc(10, 1));
      assert.equal(put.status, 200);
      return id;
    };
    const old = await make();
    const fresh = await make();
    await x.q("update app.setup_upload set created_at=now()-interval '25 hours' where id=$1", [old]);
    await (await x.worker(fake(ok([])).read)).tick();
    const u = await x.upload(old);
    assert.equal(u.state, "removed");
    assert.equal(u.fail_code, "ABANDONED");
    assert.equal(await x.chunks(old), 0);
    assert.equal((await x.upload(fresh)).state, "uploading");
    assert.equal(await x.chunks(fresh), 1);
  }));

test("delete_after is set for uploads of sessions that never get applied; chunks go after it, items stay", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const w = await x.worker(fake(ok([row("Nasi lemak")])).read);
    await w.tick();
    const u = await x.upload(id);
    assert.equal(u.state, "done");
    assert.equal(
      new Date(u.delete_after).getTime() - new Date(u.created_at).getTime(),
      30 * 86400000,
    );
    // The session is still open: the bytes stay until delete_after.
    assert.equal(await x.chunks(id), 1);
    await x.q(
      "update app.setup_upload set created_at=now()-interval '31 days',delete_after=null where id=$1",
      [id],
    );
    // A local agent process running beside the tests sweeps every upload in
    // the database too (retention is not per namespace). It would only do
    // what this worker does, so each assertion below holds whoever swept.
    // Still open: not swept yet.
    assert.equal((await x.upload(id)).bytes_deleted_at, null);
    await w.tick();
    assert.equal(await x.chunks(id), 0);
    // Swept once: the sweep's index no longer holds it.
    assert.ok((await x.upload(id)).bytes_deleted_at);
    assert.equal((await x.items("catalogue_row")).length, 1);
  }));

test("the agent role cannot read app.setup_upload, app.setup_upload_chunk or app.setup_item directly", async () => {
  const pool = new pg.Pool({ connectionString: process.env.AGENT_DATABASE_URL, max: 1 });
  try {
    for (const table of ["app.setup_upload", "app.setup_upload_chunk", "app.setup_item", "app.setup_session"])
      await assert.rejects(pool.query(`select 1 from ${table} limit 1`), /permission denied/, table);
  } finally {
    await pool.end();
  }
});

test("setup_read refuses an unknown action, a bad result and another namespace", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const w = await x.worker(fake(ok([])).read);
    await assert.rejects(w.op("bogus"), /INVALID_SETUP_READ_OPERATION/);
    const pool = new pg.Pool({ connectionString: process.env.AGENT_DATABASE_URL, max: 1 });
    try {
      await assert.rejects(
        pool.query("select app_private.setup_read('claim','evil',null,null,'{}')"),
        /INVALID_NAMESPACE/,
      );
    } finally {
      await pool.end();
    }
    // Another valid namespace sees no work and cannot reach this upload.
    const other = await x.worker(fake(ok([])).read, { ns: `test_${randomUUID()}` });
    assert.equal(await other.op("claim"), null);
    const claim = await w.op("claim");
    assert.equal(claim.upload, id);
    assert.equal(await other.op("chunk", id, claim.lease, { seq: 0 }), null);
    assert.equal(await other.op("result", id, claim.lease, { rows: [], facts: [], dropped: 0 }), null);
    // A fail code outside the fixed list and a malformed result are refused.
    await assert.rejects(w.op("fail", id, claim.lease, { code: "SOMETHING" }), /INVALID_SETUP_READ_OPERATION/);
    await assert.rejects(
      w.op("result", id, claim.lease, { rows: [{ item: "" }], facts: [], dropped: 0 }),
      /INVALID_SETUP_READ_RESULT/,
    );
    await assert.rejects(
      w.op("result", id, claim.lease, {
        rows: [{ item: "A", variant: "", priceSen: 1.5, unit: "", notes: "", needsCheck: false, checkReason: "" }],
        facts: [],
        dropped: 0,
      }),
      /INVALID_SETUP_READ_RESULT/,
    );
    assert.deepEqual(await x.items(), []);
    assert.equal((await x.upload(id)).state, "reading");
  }));

test("a second worker cannot read chunks of an upload leased by the first", () =>
  withFixture(async (x) => {
    const id = await x.paste("Rahsia RM9");
    const first = await x.worker(fake(ok([])).read);
    const second = await x.worker(fake(ok([])).read);
    const claim = await first.op("claim");
    assert.equal(await second.op("claim"), null);
    assert.equal(await second.op("chunk", id, randomUUID(), { seq: 0 }), null);
    assert.equal(await second.op("result", id, randomUUID(), { rows: [], facts: [], dropped: 0 }), null);
    assert.equal(await second.op("fail", id, randomUUID(), { code: "TOO_LONG" }), null);
    const mine = await first.op("chunk", id, claim.lease, { seq: 0 });
    assert.equal(Buffer.from(mine.data, "base64").toString("utf8"), "Rahsia RM9");
    assert.equal((await x.upload(id)).state, "reading");
  }));

test("strings are cut by code points and cleaned before the result is sent", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    // 499 units, then an emoji whose two halves straddle unit 500.
    const reason = "x".repeat(499) + "\u{1F600}" + "tail";
    const { read } = fake(
      ok([
        row("Nasi\u0000 lemak", { needsCheck: true, checkReason: reason }),
        row("Teh \uD800tarik"),
      ]),
    );
    await (await x.worker(read)).tick();
    assert.equal((await x.upload(id)).state, "done");
    const rows = await x.items("catalogue_row");
    assert.equal(rows[0].payload.item, "Nasi lemak");
    assert.equal(rows[0].check_reason, "x".repeat(499) + "\u{1F600}");
    assert.equal(rows[1].payload.item, "Teh tarik");
  }));

test("a result the SQL refuses ends the upload failed, not reading, after one read", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    // More rows than setup_read accepts.
    const { read, calls } = fake(ok(Array.from({ length: 301 }, (_, i) => row(`Item ${i}`))));
    const w = await x.worker(read);
    await w.tick();
    let u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "READ_FAILED");
    assert.equal(u.lease_token, null);
    await w.tick();
    assert.equal(calls.length, 1);
    u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.deepEqual(await x.items(), []);
  }));

test("a database error on result that is not a refusal releases the lease and the attempt counts", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(ok([row("Nasi lemak")]), ok([row("Nasi lemak")]));
    const w = await x.worker(read);
    const op = w.op.bind(w);
    let broken = true;
    const releases: unknown[] = [];
    w.op = async (action: string, upload?: string | null, lease?: string | null, data?: unknown) => {
      if (action === "release") releases.push(data);
      if (action === "result" && broken) throw Error("Connection terminated unexpectedly");
      return op(action, upload, lease, data);
    };
    const logged: string[] = [];
    const log = console.log;
    console.log = (m: string) => logged.push(String(m));
    try {
      await w.tick();
    } finally {
      console.log = log;
    }
    let u = await x.upload(id);
    assert.equal(u.state, "queued");
    assert.equal(u.attempts, 1);
    assert.equal(u.lease_token, null);
    assert.equal(u.fail_code, null);
    assert.deepEqual(releases, [{}]);
    assert.deepEqual(logged, [`SETUP_READ upload=${id} attempt=1 code=RESULT_NOT_STORED`]);
    // The next tick reads it again and stores the rows.
    broken = false;
    await w.tick();
    assert.equal(calls.length, 2);
    u = await x.upload(id);
    assert.equal(u.state, "done");
    assert.equal((await x.items("catalogue_row")).length, 1);
  }));

test("a result that keeps failing to store is read twice, then READ_FAILED, never a third time", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read, calls } = fake(ok([row("Nasi lemak")]), ok([row("Nasi lemak")]), ok([row("Nasi lemak")]));
    const w = await x.worker(read);
    const op = w.op.bind(w);
    w.op = async (action: string, upload?: string | null, lease?: string | null, data?: unknown) => {
      if (action === "result") throw Error("Connection terminated unexpectedly");
      return op(action, upload, lease, data);
    };
    const log = console.log;
    console.log = () => undefined;
    try {
      await w.tick();
      await w.tick();
      await w.tick();
    } finally {
      console.log = log;
    }
    assert.equal(calls.length, 2);
    const u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "READ_FAILED");
    assert.equal(u.attempts, 2);
    assert.deepEqual(await x.items(), []);
  }));

test("a refusal by setup_read on result fails the upload READ_FAILED", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read } = fake(ok([row("Nasi lemak")]));
    const w = await x.worker(read);
    const op = w.op.bind(w);
    // The function's own refusal, as pg reports it.
    w.op = async (action: string, upload?: string | null, lease?: string | null, data?: unknown) => {
      if (action === "result") throw Error("INVALID_SETUP_READ_RESULT");
      return op(action, upload, lease, data);
    };
    await w.tick();
    const u = await x.upload(id);
    assert.equal(u.state, "failed");
    assert.equal(u.fail_code, "READ_FAILED");
    assert.equal(u.lease_token, null);
  }));

test("facts: a dropped pack mid-read, a field not in its pack, and first wins per key", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const { read } = fake(async () => {
      // The owner switches the main pack while the document is read.
      const switched = await x.f.req("POST", x.base, { mainPack: "order", extraPacks: [] });
      assert.equal(switched.status, 200, JSON.stringify(switched.body));
      return ok([], [
        fact("appointment", "walk_in_policy", "Boleh walk-in"),
        // business_name is every-business's field, not appointment's.
        fact("appointment", "business_name", "Salah pek"),
        fact("every-business", "address", "Jalan Contoh 1"),
      ]);
    });
    const w = await x.worker(read);
    await w.tick();
    const facts = await x.items("fact");
    assert.deepEqual(facts.map((f) => f.key), ["address"]);
    assert.equal((await x.upload(id)).fact_count, 1);
    // setup_read keeps the first of two facts for one key.
    const second = await x.paste("second");
    const claim = await w.op("claim");
    assert.equal(claim.upload, second);
    const f = (value: string) => ({
      packId: "every-business",
      fieldKey: "parking",
      title: "Parking",
      value,
      needsCheck: false,
      checkReason: "",
    });
    await w.op("result", second, claim.lease, { rows: [], facts: [f("Pertama"), f("Kedua")], dropped: 0 });
    const parking = (await x.items("fact")).filter((i) => i.key === "parking");
    assert.equal(parking.length, 1);
    assert.equal(parking[0].payload.value, "Pertama");
  }));

test("a null or missing lease opens nothing", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const w = await x.worker(fake(ok([])).read);
    const claim = await w.op("claim");
    for (const action of ["chunk", "result", "fail", "release"])
      assert.equal(await w.op(action, id, null, { seq: 0, code: "TOO_LONG", rows: [], facts: [], dropped: 0 }), null, action);
    // A lease row whose lease_until was cleared is not held.
    await x.q("update app.setup_upload set lease_until=null where id=$1", [id]);
    assert.equal(await w.op("chunk", id, claim.lease, { seq: 0 }), null);
    await x.q("update app.setup_upload set lease_until=now()+interval '1 minute' where id=$1", [id]);
    // A missing seq is refused, not read as seq 0.
    await assert.rejects(w.op("chunk", id, claim.lease, {}), /INVALID_SETUP_READ_OPERATION/);
    assert.equal((await x.upload(id)).state, "reading");
  }));

test("another namespace's maintain does not re-queue this namespace's expired lease", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    const mine = await x.worker(fake(ok([])).read);
    await mine.op("claim");
    await x.q("update app.setup_upload set lease_until=now()-interval '1 second' where id=$1", [id]);
    const other = await x.worker(fake(ok([])).read, { ns: `test_${randomUUID()}` });
    await other.tick();
    assert.equal((await x.upload(id)).state, "reading");
    await mine.op("maintain");
    assert.equal((await x.upload(id)).state, "queued");
  }));

test("the timeout's abort reaches the reader and counts as a retryable failure", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    let reason: unknown;
    const { read } = fake(
      (opts) =>
        new Promise<ReadResult>((resolve) =>
          opts.signal!.addEventListener("abort", () => {
            reason = opts.signal!.reason;
            resolve(failed("FAILED"));
          }),
        ),
    );
    await (await x.worker(read, { timeoutMs: 50 })).tick();
    assert.equal((reason as Error).name, "TimeoutError");
    const u = await x.upload(id);
    assert.equal(u.state, "queued");
    assert.equal(u.attempts, 1);
  }));

test("close() during a read ends the loop and gives the attempt back", () =>
  withFixture(async (x) => {
    const id = await x.paste();
    let started!: () => void;
    const reading = new Promise<void>((r) => (started = r));
    const { read, calls } = fake(
      (opts) =>
        new Promise<ReadResult>((resolve) => {
          started();
          opts.signal!.addEventListener("abort", () => resolve(failed("FAILED")));
        }),
    );
    const w = await x.worker(read);
    const loop = w.run();
    await reading;
    assert.equal((await x.upload(id)).state, "reading");
    const t0 = Date.now();
    await w.close();
    await loop;
    assert.ok(Date.now() - t0 < 3000);
    assert.equal(calls.length, 1);
    const u = await x.upload(id);
    assert.equal(u.state, "queued");
    assert.equal(u.attempts, 0);
    assert.equal(await x.outboxDone(id), false);
  }));

test("the worker loop waits when idle and close() ends it promptly", () =>
  withFixture(async (x) => {
    const w = await x.worker(fake(ok([])).read);
    const loop = w.run();
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    await w.close();
    await loop;
    assert.ok(Date.now() - t0 < 2000);
  }));

test("the SQL's base pack id is the TypeScript basePack", async () => {
  const pool = new pg.Pool({ connectionString: process.env.LOCAL_ADMIN_DATABASE_URL, max: 1 });
  try {
    const def = (
      await pool.query(
        "select pg_get_functiondef('app_private.setup_read(text,text,uuid,uuid,jsonb)'::regprocedure) as d",
      )
    ).rows[0].d as string;
    assert.ok(def.includes(`array['${basePack}', s.main_pack]`), "base pack id differs");
  } finally {
    await pool.end();
  }
});

// ---- Double read: photos and PDFs ----

test("a PDF goes to the reader once (the checked read inside it) and never to the fallback", () =>
  withFixture(async (x) => {
    const pdf = Buffer.from("%PDF-1.4\nsenarai harga\n");
    const id = await x.pdfUpload(pdf);
    // Heavily flagged and long: a text upload would get the fallback.
    const { read, calls } = fake(ok(flaggedRows(10, 8)));
    await (await x.worker(read)).tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.input.kind, "pdf");
    assert.equal(calls[0]!.model, undefined);
    assert.equal((await x.upload(id)).state, "done");
    assert.equal((await x.items("catalogue_row")).length, 10);
  }));

test("by default a PDF is read twice through the client and the reconciled rows are stored", () =>
  withFixture(async (x) => {
    const pdf = Buffer.from("%PDF-1.4\nsenarai harga\n");
    const id = await x.pdfUpload(pdf);
    // Ten rows; the second read disagrees on six prices: 60% flagged after
    // the comparison, which would trigger a fallback on a text upload.
    const answer = (shift: number) => ({
      rows: Array.from({ length: 10 }, (_, i) => ({
        item: `Servis ${i + 1}`,
        variant: "",
        priceSen: 1000 * (i + 1) + (i < 6 ? shift : 0),
        unit: "",
        notes: "",
        needsCheck: false,
        checkReason: "",
      })),
      facts: [],
    });
    const bodies: Record<string, any>[] = [];
    const client = {
      messages: {
        async create(body: Record<string, any>) {
          bodies.push(body);
          return {
            id: `msg_${bodies.length}`,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [{ type: "text", text: JSON.stringify(answer(bodies.length === 1 ? 0 : 50)) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    } as unknown as AnthropicLike;
    await (await x.worker(undefined, { client })).tick();
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every((b) => b.model === readerModel));
    assert.ok(bodies.every((b) => b.messages[0].content[0].type === "document"));
    assert.equal((await x.upload(id)).state, "done");
    const rows = await x.items("catalogue_row");
    assert.equal(rows.length, 10);
    const flagged = rows.filter((r) => r.needs_check);
    assert.equal(flagged.length, 6);
    assert.ok(flagged.every((r) => r.check_reason.startsWith(READER_DISAGREE_PREFIX)));
    // The first read's price is kept on a disputed row.
    assert.equal(rows.find((r) => r.payload.item === "Servis 1")!.payload.priceSen, 1000);
  }));
