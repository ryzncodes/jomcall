import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  sentence,
  end,
  toolEvent,
  usage,
} from "../helpers/voice-turn.ts";

test("a plain spoken answer streams sentences and is stored as a voice turn", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model } = f.scripted([
      sentence("We open at nine."),
      sentence("We close at six."),
      end("We open at nine. We close at six."),
    ]);
    const events = await f.run(s, "What time are you open on weekdays?", model);
    assert.deepEqual(
      events.map((e) => e.type),
      ["started", "sentence", "sentence", "done"],
    );
    const [turn] = await f.turns(s.id);
    assert.equal(turn.channel, "voice");
    assert.equal(turn.state, "completed");
    assert.equal(turn.answer, "We open at nine. We close at six.");
    assert.ok(turn.evidence.length >= 1);
    assert.match(turn.evidence[0].sourceId, /^[0-9a-f]{24}:0:0$/);
    assert.equal(typeof turn.timings.firstSentenceMs, "number");
  } finally {
    await f.close();
  }
});

test("a take_message tool call records one proposal before the final sentences", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model, seen } = f.scripted(
      [
        toolEvent("take_message", { text: "Please call Contoh Guest back." }),
        end(),
      ],
      [
        sentence("I passed that on to staff."),
        end("I passed that on to staff."),
      ],
    );
    const events = await f.run(
      s,
      "Please leave a message for the owner",
      model,
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["started", "tool", "sentence", "done"],
    );
    const [turn] = await f.turns(s.id);
    const rows = (
      await f.h.cleanup.query(
        "select kind from app.test_proposal where turn_id=$1",
        [turn.id],
      )
    ).rows;
    assert.deepEqual(rows, [{ kind: "message" }]);
    assert.equal(seen.length, 2);
  } finally {
    await f.close();
  }
});

test("an empty transcript is rejected before any database write", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const count = async () =>
      (await f.h.cleanup.query("select count(*)::int n from app.test_turn"))
        .rows[0].n;
    const before = await count();
    const { model, seen } = f.scripted();
    const events = await f.run(s, "   ", model);
    assert.deepEqual(events, [{ type: "error", code: "NOTHING_HEARD" }]);
    assert.equal(await count(), before);
    assert.equal(seen.length, 0);
  } finally {
    await f.close();
  }
});

test("aborting during a tool call cancels the turn and leaves no proposal", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model } = f.scripted(
      [toolEvent("take_message", { text: "Hello from Contoh." }), end()],
      [sentence("Should never be spoken."), end()],
    );
    const controller = new AbortController();
    const events = await f.run(
      s,
      "Please leave a message",
      model,
      controller,
      (e) => {
        if (e.type === "tool") controller.abort();
      },
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["started", "tool"],
    );
    const [turn] = await f.turns(s.id);
    assert.equal(turn.state, "cancelled");
    const left = (
      await f.h.cleanup.query(
        "select (select count(*) from app.test_proposal where turn_id=$1)::int p,(select count(*) from app.test_tool_step where turn_id=$1)::int t",
        [turn.id],
      )
    ).rows[0];
    assert.deepEqual(left, { p: 0, t: 0 });
  } finally {
    await f.close();
  }
});

test("a sentence that claims success is never spoken and fails the turn", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model } = f.scripted([
      sentence("Your appointment is confirmed."),
      end("Your appointment is confirmed."),
    ]);
    const events = await f.run(s, "Can I book a visit for the weekend?", model);
    assert.ok(!events.some((e) => e.type === "sentence"));
    assert.deepEqual(events.at(-1), { type: "error", code: "UNSAFE_REPLY" });
    const [turn] = await f.turns(s.id);
    assert.equal(turn.state, "failed");
    assert.equal(turn.error_code, "UNSAFE_REPLY");
  } finally {
    await f.close();
  }
});

test("a model error after sentences ends the turn as failed with that code", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const model = async function* () {
      yield sentence("We open at nine.");
      throw Error("MODEL_OUTPUT_TRUNCATED");
    };
    const events = await f.run(
      s,
      "What time are you open on weekdays?",
      model as any,
    );
    assert.deepEqual(events.at(-1), {
      type: "error",
      code: "MODEL_OUTPUT_TRUNCATED",
    });
    assert.ok(!events.some((e) => e.type === "done"));
    const [turn] = await f.turns(s.id);
    assert.equal(turn.state, "failed");
    assert.equal(turn.answer, null);
  } finally {
    await f.close();
  }
});

test("an identical question in a new session on the same snapshot is served fast", async () => {
  const f = await fixture();
  try {
    const first = await f.makeSession();
    const second = await f.makeSession();
    const { model, seen } = f.scripted([
      sentence("We open at nine."),
      end("We open at nine."),
    ]);
    const question = "What time are you open on weekdays?";
    await f.run(first, question, model);
    const events = await f.run(second, question, model);
    assert.deepEqual(
      events.map((e) => e.type),
      ["started", "fast", "done"],
    );
    assert.deepEqual(events[1], { type: "fast", text: "We open at nine." });
    assert.equal(seen.length, 1);
    const [turn] = await f.turns(second.id);
    assert.equal(turn.state, "completed");
    assert.equal(turn.answer, "We open at nine.");
  } finally {
    await f.close();
  }
});

test("a question about tomorrow is never served fast", async () => {
  const f = await fixture();
  try {
    const first = await f.makeSession();
    const second = await f.makeSession();
    const answer = [sentence("We open at nine."), end("We open at nine.")];
    const { model, seen } = f.scripted(answer, answer);
    const question = "Are you open esok morning for a visit?";
    await f.run(first, question, model);
    const events = await f.run(second, question, model);
    assert.ok(!events.some((e) => e.type === "fast"));
    assert.equal(seen.length, 2);
  } finally {
    await f.close();
  }
});

test("an expired session reports VOICE_EXPIRED", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession(-5);
    const { model } = f.scripted();
    const events = await f.run(s, "What time are you open on weekdays?", model);
    assert.deepEqual(events, [{ type: "error", code: "VOICE_EXPIRED" }]);
  } finally {
    await f.close();
  }
});

test("aborting before a tool starts means the tool never runs", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model } = f.scripted([
      toolEvent("take_message", { text: "Hello from Contoh." }),
      end(),
    ]);
    const controller = new AbortController();
    // Every tool goes through access().read() first; count those calls.
    let toolReads = 0;
    const repo = f.wrapped({
      access: (target: any, envelope: any) => {
        const access = target.access(envelope);
        return {
          ...access,
          read: () => {
            toolReads++;
            return access.read();
          },
        };
      },
    });
    await f.run(
      s,
      "Please leave a message",
      model,
      controller,
      (e) => {
        if (e.type === "tool") controller.abort();
      },
      repo as any,
    );
    const [turn] = await f.turns(s.id);
    assert.equal(turn.state, "cancelled");
    assert.equal(toolReads, 0);
  } finally {
    await f.close();
  }
});

test("a failing cache read falls through to the model", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model, seen } = f.scripted([
      sentence("We open at nine."),
      end("We open at nine."),
    ]);
    const repo = f.wrapped({
      voiceCacheGet: () => Promise.reject(Error("CACHE_DOWN")),
    });
    const events = await f.run(
      s,
      "What time are you open on weekdays?",
      model,
      new AbortController(),
      () => {},
      repo as any,
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["started", "sentence", "done"],
    );
    assert.equal(seen.length, 1);
  } finally {
    await f.close();
  }
});

test("abort landing during the completion write emits no done", async () => {
  const f = await fixture();
  try {
    const question = "What time are you open on weekdays?";
    const answer = [sentence("We open at nine."), end("We open at nine.")];
    for (const fast of [false, true]) {
      const s = await f.makeSession();
      if (fast) {
        const warm = await f.makeSession();
        await f.run(warm, question, f.scripted(answer).model);
      }
      const controller = new AbortController();
      const repo = f.wrapped({
        voiceComplete: async (target: any, ...a: any[]) => {
          const result = await target.voiceComplete(...a);
          controller.abort();
          return result;
        },
      });
      const { model } = f.scripted(answer);
      const events = await f.run(
        s,
        question,
        model,
        controller,
        () => {},
        repo as any,
      );
      assert.ok(!events.some((e) => e.type === "done"), `fast=${fast}`);
      assert.ok(!events.some((e) => e.type === "error"), `fast=${fast}`);
      if (fast) assert.ok(events.some((e) => e.type === "fast"));
    }
  } finally {
    await f.close();
  }
});

const cached = async (f: any) =>
  (
    await f.h.cleanup.query(
      "select count(*)::int n from app.voice_answer_cache where org_id=$1",
      [f.h.orgA.id],
    )
  ).rows[0].n;
const question = "What time are you open on weekdays?";

test("an answer about the present moment is never cached", async () => {
  const f = await fixture();
  try {
    const first = await f.makeSession();
    const second = await f.makeSession();
    const live = [
      sentence("Yes, we are open now until 6 pm."),
      end("Yes, we are open now until 6 pm."),
    ];
    const { model, seen } = f.scripted(live, live);
    await f.run(first, question, model);
    assert.equal((await f.turns(first.id))[0].state, "completed");
    assert.equal(await cached(f), 0);
    const events = await f.run(second, question, model);
    assert.ok(!events.some((e) => e.type === "fast"));
    assert.equal(seen.length, 2);
  } finally {
    await f.close();
  }
});

test("a turn that used a tool is not cached", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model } = f.scripted(
      [toolEvent("take_message", { text: "Hello from Contoh." }), end()],
      [sentence("Staff will read that."), end("Staff will read that.")],
    );
    const events = await f.run(s, question, model);
    assert.equal(events.at(-1)?.type, "done");
    assert.equal(await cached(f), 0);
  } finally {
    await f.close();
  }
});

test("a turn with earlier turns in the session is not cached", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const answer = [sentence("We open at nine."), end("We open at nine.")];
    const { model } = f.scripted(answer, answer);
    await f.run(s, "Do you have a room for four people?", model);
    const before = await cached(f);
    await f.run(s, question, model);
    assert.equal((await f.turns(s.id)).length, 2);
    assert.equal(await cached(f), before);
  } finally {
    await f.close();
  }
});

test("an unsafe reply is not cached", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model } = f.scripted([
      sentence("Your appointment is confirmed."),
      end("Your appointment is confirmed."),
    ]);
    await f.run(s, question, model);
    assert.equal((await f.turns(s.id))[0].state, "failed");
    assert.equal(await cached(f), 0);
  } finally {
    await f.close();
  }
});

const weekdays = "What time are you open on weekdays?";
const unrelated = "Please tell me something else";

test("evidence from earlier turns joins the fresh hits and is deduped", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const answer = [sentence("We open at nine."), end("We open at nine.")];
    const { model, seen } = f.scripted(answer, answer, answer);
    await f.run(s, weekdays, model);
    // No search hit for this one, yet the earlier chunk is still supplied.
    await f.run(s, unrelated, model);
    assert.match(seen[1].volatile, /:0:0/);
    // A hit and the same chunk from history appear once.
    await f.run(s, weekdays, model);
    assert.equal(seen[2].volatile.split('"sourceId"').length - 1, 1);
  } finally {
    await f.close();
  }
});

test("what the call recorded is stated to the model only when something was", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model, seen } = f.scripted(
      [sentence("Hello there."), end("Hello there.")],
      [toolEvent("take_message", { text: "Please call Contoh Guest." }), end()],
      [sentence("Staff will read that."), end("Staff will read that.")],
      [sentence("Anything else?"), end("Anything else?")],
    );
    await f.run(s, unrelated, model);
    await f.run(s, "Please leave a message for staff", model);
    await f.run(s, "Thank you very much", model);
    assert.doesNotMatch(seen[0].volatile, /Recorded in this call/);
    assert.doesNotMatch(seen[1].volatile, /Recorded in this call/);
    assert.match(seen[3].volatile, /Recorded in this call/);
    assert.match(
      seen[3].volatile,
      /message for staff: Please call Contoh Guest/,
    );
  } finally {
    await f.close();
  }
});

test("the stable prompt is byte-identical across turns with different evidence", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const answer = [sentence("We open at nine."), end("We open at nine.")];
    const { model, seen } = f.scripted(answer, answer);
    await f.run(s, unrelated, model);
    await f.run(s, weekdays, model);
    assert.notEqual(seen[0].volatile, seen[1].volatile);
    assert.equal(seen[0].stable, seen[1].stable);
  } finally {
    await f.close();
  }
});

test("stored usage carries the cache write count", async () => {
  const f = await fixture();
  try {
    const s = await f.makeSession();
    const { model } = f.scripted([
      sentence("We open at nine."),
      {
        ...(end("We open at nine.") as any),
        usage: { ...usage, cacheWrite: 7 },
      },
    ]);
    await f.run(s, weekdays, model);
    const [turn] = await f.turns(s.id);
    assert.equal(turn.usage[0].cacheWrite, 7);
  } finally {
    await f.close();
  }
});
