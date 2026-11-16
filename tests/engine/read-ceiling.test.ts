import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { Engine } from "../../engine/src/engine.ts";
import { FakeSender, type Mail } from "../../engine/src/mail.ts";
import {
  bytesCeilingMail,
  type BytesCeilingNotice,
  type ReadCeilingNotice,
} from "../../engine/src/read-ceiling.ts";
import { operatorEmail } from "../../packages/contracts/src/hosting.ts";

// The engine's hourly check of document reading's daily ceiling. The
// database side (once a day, counts) is in tests/db/setup-upload.test.ts.
process.env.NODE_ENV = "test";
const notice: ReadCeilingNotice = { day: "2026-11-16", started: 300, ceiling: 300, waiting: 7 };
// 123.98 MB of 150 MB.
const bytes: BytesCeilingNotice = { day: "2026-11-16", storedBytes: 130_000_000, maxBytes: 157_286_400 };

async function logged<T>(run: () => Promise<T>) {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { value: await run(), lines };
  } finally {
    console.error = original;
  }
}

test("operator email: optional, one plain address, never a list", () => {
  assert.equal(operatorEmail({}), null);
  assert.equal(operatorEmail({ JOMCALL_OPERATOR_EMAIL: "  " }), null);
  assert.equal(operatorEmail({ JOMCALL_OPERATOR_EMAIL: " ops@example.test " }), "ops@example.test");
  for (const bad of ["ops", "ops@example", "a@example.test,b@example.test", "Ops <ops@example.test>", "a b@example.test"])
    assert.throws(() => operatorEmail({ JOMCALL_OPERATOR_EMAIL: bad }), /^Error: INVALID_OPERATOR_EMAIL: JOMCALL_OPERATOR_EMAIL$/);
});

test("the ceiling notice is checked once an hour, mailed once to the operator and always logged with counts", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    let t = 1_000_000,
      checks = 0,
      answer: ReadCeilingNotice | null = notice;
    const minute = 60_000;
    const mail = new FakeSender();
    engine = await Engine.create(h.namespace, {
      mail,
      readCeiling: {
        firstAfterMs: minute,
        everyMs: 60 * minute,
        now: () => t,
        operatorEmail: "ops@example.test",
        notice: async () => {
          checks++;
          const a = answer;
          answer = null;
          return a;
        },
      },
    });
    await engine.tick();
    assert.equal(checks, 0, "not before the first delay");
    t += minute;
    const first = await logged(() => engine!.tick());
    assert.equal(checks, 1);
    assert.deepEqual(mail.sent, [
      {
        to: "ops@example.test",
        subject: "JomCall: document reading paused at the daily ceiling",
        text:
          "Document reading reached today's ceiling: 300 files started in the last 24 hours (ceiling 300). " +
          "7 files are waiting and will be read as earlier ones age out of the 24-hour window. " +
          "To raise the ceiling: update app.setup_read_limit set daily_reads = <n>. No file has failed.",
        operationId: "setup-read-ceiling-2026-11-16",
      },
    ] satisfies Mail[]);
    assert.ok(first.lines.includes("SETUP_READ_CEILING started=300 ceiling=300 waiting=7"), first.lines.join("\n"));
    // Within the hour: not asked again.
    t += 30 * minute;
    await engine.tick();
    assert.equal(checks, 1);
    // An hour later: asked; the database answers null for the rest of the day.
    t += 30 * minute;
    await engine.tick();
    assert.equal(checks, 2);
    assert.equal(mail.sent.length, 1);
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("without an operator address the notice is logged only", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const mail = new FakeSender();
    engine = await Engine.create(h.namespace, {
      mail,
      readCeiling: { firstAfterMs: 0, operatorEmail: null, notice: async () => notice },
    });
    const r = await logged(() => engine!.tick());
    assert.deepEqual(mail.sent, []);
    assert.ok(r.lines.includes("SETUP_READ_CEILING started=300 ceiling=300 waiting=7"));
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("a failed send or a failed check never stops the tick; a failed check is retried sooner", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const failing = new FakeSender();
    failing.send = async () => {
      throw Error("SMTP_DOWN");
    };
    engine = await Engine.create(h.namespace, {
      mail: failing,
      readCeiling: { firstAfterMs: 0, operatorEmail: "ops@example.test", notice: async () => notice },
    });
    const sent = await logged(() => engine!.tick());
    assert.ok(sent.lines.includes("SETUP_READ_CEILING started=300 ceiling=300 waiting=7"));
    assert.ok(sent.lines.includes("SETUP_READ_CEILING_MAIL_FAILED"));
    assert.ok(!sent.lines.some((l) => l.includes("SMTP_DOWN")), "no foreign message");
    await engine.close();

    let t = 0,
      checks = 0;
    engine = await Engine.create(h.namespace, {
      readCeiling: {
        firstAfterMs: 0,
        retryMs: 5 * 60_000,
        everyMs: 60 * 60_000,
        now: () => t,
        notice: async () => {
          checks++;
          throw Error("DATABASE_DOWN");
        },
      },
    });
    const failed = await logged(() => engine!.tick());
    assert.ok(failed.lines.includes("SETUP_READ_CEILING_CHECK_FAILED"));
    assert.ok(engine.lastTickAt > 0, "the tick ran to the end");
    t += 5 * 60_000;
    await logged(() => engine!.tick());
    assert.equal(checks, 2, "retried after five minutes");
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("the engine's own check runs through the worker role", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const mail = new FakeSender();
    engine = await Engine.create(h.namespace, { mail, readCeiling: { firstAfterMs: 0, operatorEmail: null } });
    const r = await logged(() => engine!.tick());
    assert.ok(!r.lines.includes("SETUP_READ_CEILING_CHECK_FAILED"), r.lines.join("\n"));
    assert.ok(!r.lines.includes("SETUP_BYTES_CEILING_CHECK_FAILED"), r.lines.join("\n"));
    assert.deepEqual(mail.sent, []);
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("stored-uploads mail: whole MB rounded down, the 7-day deletion and how to raise the ceiling", () => {
  assert.deepEqual(bytesCeilingMail(bytes), {
    subject: "JomCall: stored setup uploads are near the ceiling",
    text:
      "Stored setup uploads hold 123 MB of 150 MB. New files are refused when the ceiling is reached. " +
      "File bytes are deleted 7 days after upload. " +
      "To raise the ceiling: update app.setup_read_limit set stored_bytes_max = <bytes>.",
  });
  // Just under one more MB stays at the lower figure.
  assert.match(bytesCeilingMail({ ...bytes, storedBytes: 2 * 1_048_576 - 1 }).text, /hold 1 MB of 150 MB/);
});

test("the stored-uploads notice is checked once an hour, mailed once and logged with both numbers", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    let t = 1_000_000,
      checks = 0,
      answer: BytesCeilingNotice | null = bytes;
    const minute = 60_000;
    const mail = new FakeSender();
    engine = await Engine.create(h.namespace, {
      mail,
      readCeiling: {
        firstAfterMs: minute,
        everyMs: 60 * minute,
        now: () => t,
        operatorEmail: "ops@example.test",
        notice: async () => null,
        bytesNotice: async () => {
          checks++;
          const a = answer;
          answer = null;
          return a;
        },
      },
    });
    await engine.tick();
    assert.equal(checks, 0, "not before the first delay");
    t += minute;
    const first = await logged(() => engine!.tick());
    assert.equal(checks, 1);
    assert.deepEqual(mail.sent, [
      { to: "ops@example.test", ...bytesCeilingMail(bytes), operationId: "setup-bytes-ceiling-2026-11-16" },
    ] satisfies Mail[]);
    assert.ok(first.lines.includes("SETUP_BYTES_CEILING stored=130000000 max=157286400"), first.lines.join("\n"));
    t += 30 * minute;
    await engine.tick();
    assert.equal(checks, 1, "not again within the hour");
    t += 30 * minute;
    await engine.tick();
    assert.equal(checks, 2);
    assert.equal(mail.sent.length, 1);
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("both notices on one day are two emails; without an operator address they are logged only", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const mail = new FakeSender();
    engine = await Engine.create(h.namespace, {
      mail,
      readCeiling: { firstAfterMs: 0, operatorEmail: "ops@example.test", notice: async () => notice, bytesNotice: async () => bytes },
    });
    await logged(() => engine!.tick());
    assert.deepEqual(
      mail.sent.map((m) => m.operationId),
      ["setup-read-ceiling-2026-11-16", "setup-bytes-ceiling-2026-11-16"],
    );
    await engine.close();
    const quiet = new FakeSender();
    engine = await Engine.create(h.namespace, {
      mail: quiet,
      readCeiling: { firstAfterMs: 0, operatorEmail: null, notice: async () => null, bytesNotice: async () => bytes },
    });
    const r = await logged(() => engine!.tick());
    assert.deepEqual(quiet.sent, []);
    assert.ok(r.lines.includes("SETUP_BYTES_CEILING stored=130000000 max=157286400"));
  } finally {
    await engine?.close();
    await h.close();
  }
});

test("a failed stored-uploads check or send never stops the tick or the read-ceiling check; a failed check is retried sooner", async () => {
  const h = await createHarness();
  let engine: Engine | undefined;
  try {
    const failing = new FakeSender();
    failing.send = async () => {
      throw Error("SMTP_DOWN");
    };
    engine = await Engine.create(h.namespace, {
      mail: failing,
      readCeiling: { firstAfterMs: 0, operatorEmail: "ops@example.test", notice: async () => null, bytesNotice: async () => bytes },
    });
    const sent = await logged(() => engine!.tick());
    assert.ok(sent.lines.includes("SETUP_BYTES_CEILING_MAIL_FAILED"));
    assert.ok(!sent.lines.some((l) => l.includes("SMTP_DOWN")), "no foreign message");
    await engine.close();

    let t = 0,
      checks = 0,
      reads = 0;
    const mail = new FakeSender();
    engine = await Engine.create(h.namespace, {
      mail,
      readCeiling: {
        firstAfterMs: 0,
        retryMs: 5 * 60_000,
        everyMs: 60 * 60_000,
        now: () => t,
        operatorEmail: "ops@example.test",
        notice: async () => (reads++ ? null : notice),
        bytesNotice: async () => {
          checks++;
          throw Error("DATABASE_DOWN");
        },
      },
    });
    const failed = await logged(() => engine!.tick());
    assert.ok(failed.lines.includes("SETUP_BYTES_CEILING_CHECK_FAILED"));
    assert.ok(!failed.lines.some((l) => l.includes("DATABASE_DOWN")), "no foreign message");
    assert.equal(mail.sent.length, 1, "the read-ceiling email still went");
    assert.ok(engine.lastTickAt > 0, "the tick ran to the end");
    t += 5 * 60_000;
    await logged(() => engine!.tick());
    assert.equal(checks, 2, "retried after five minutes");
    assert.equal(reads, 1, "the read-ceiling check keeps its hourly turn");
  } finally {
    await engine?.close();
    await h.close();
  }
});
