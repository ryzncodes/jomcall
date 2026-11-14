import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { phoneFixture, fakeNumber, klAt } from "../helpers/phone.ts";
import { end, sentence, toolEvent } from "../helpers/voice-turn.ts";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

test("a dialled number resolves to its business, location and PUBLISHED agent version", async () => {
  const f = await phoneFixture();
  try {
    const version = await f.publish();
    // A later draft change must not reach callers until it is published.
    const draft = (await f.req("GET", `/agents/${f.h.orgA.agentId}/draft`)).body.data;
    await f.req("PUT", `/agents/${f.h.orgA.agentId}/draft`, {
      expectedRevision: draft.revision,
      settings: { ...draft.draft, greeting: "Unpublished greeting." },
    });
    const dialled = await f.addNumber();
    const caller = fakeNumber();
    const { result } = await f.ring(dialled, caller);
    assert.equal(result.refusal, null);
    if (result.refusal !== null) return;
    assert.equal(result.greeting, "Hello, Contoh Room.");
    assert.equal(result.disclosure, "Anda bercakap dengan pembantu AI.");
    assert.equal(result.voice, "Leda");
    assert.equal(result.capSeconds, 600);
    assert.match(result.token, /^[0-9a-f]{64}$/);
    const call = await f.row(result.callId);
    assert.equal(call.org_id, f.h.orgA.id);
    assert.equal(call.location_id, f.h.orgA.locationId);
    assert.equal(call.agent_version_id, version.id);
    assert.equal(call.state, "active");
    assert.equal(call.caller_e164, caller);
    assert.equal(call.dialled_e164, dialled);
    assert.equal(call.token_hash, sha(result.token));
    assert.equal(call.after_hours, false);
    // The caller becomes a contact so PDPA deletion reaches the call.
    const contact = (
      await f.h.cleanup.query("select * from app.contact where id=$1", [call.contact_id])
    ).rows[0];
    assert.equal(contact.phone_e164, caller);
  } finally {
    await f.close();
  }
});

test("each refusal is clear, and a known number keeps a refused call row", async () => {
  const f = await phoneFixture();
  try {
    // Unknown number: no business to speak for, no row.
    const unknown = await f.ring(fakeNumber());
    assert.deepEqual(unknown.result, { callId: null, refusal: "UNKNOWN_NUMBER", busyLine: false });

    const dialled = await f.addNumber();
    const unpublished = await f.ring(dialled);
    assert.equal(unpublished.result.refusal, "AGENT_UNPUBLISHED");
    const row = await f.row(unpublished.result.callId!);
    assert.equal(row.state, "refused");
    assert.equal(row.outcome, "refused");
    assert.equal(row.token_hash, null);

    // Publishing already refuses a missing notice; the call start checks again
    // in case a published version lacks one (older data, manual edits).
    const version = await f.publish();
    const blank = (path: string, value: unknown) =>
      f.h.cleanup.query(
        "update app.agent_version set snapshot=jsonb_set(snapshot,$2::text[],$3::jsonb) where id=$1",
        [version.id, path, JSON.stringify(value)],
      );
    await blank("{settings,aiDisclosure}", "   ");
    assert.equal((await f.ring(dialled)).result.refusal, "DISCLOSURE_REQUIRED");
    await blank("{settings,aiDisclosure}", "Anda bercakap dengan pembantu AI.");
    await blank("{settings,recordingEnabled}", true);
    await blank("{settings,recordingDisclosure}", "");
    assert.equal((await f.ring(dialled)).result.refusal, "DISCLOSURE_REQUIRED");

    await f.publish({ recordingEnabled: true, recordingDisclosure: "Panggilan ini dirakam." });
    const recorded = (await f.ring(dialled)).result;
    assert.equal(recorded.refusal, null);
    if (recorded.refusal === null)
      assert.equal(recorded.recordingDisclosure, "Panggilan ini dirakam.");

    await f.h.cleanup.query("update app.organization set calls_suspended_at=now() where id=$1", [f.h.orgA.id]);
    assert.equal((await f.ring(dialled)).result.refusal, "CALLS_SUSPENDED");
    await f.h.cleanup.query("update app.organization set calls_suspended_at=null where id=$1", [f.h.orgA.id]);

    // Not a SIP participant, or no participant at all.
    await assert.rejects(f.ring(dialled, fakeNumber(), { kind: "other" }), { code: "NOT_SIP" });
    await assert.rejects(
      (await import("../../engine/src/agent/phone-call.ts")).startPhoneCall(f.deps, {
        room: "call-nobody",
        identity: "sip_nobody",
      }),
      { code: "NOT_SIP" },
    );
    // The same SIP call cannot start twice.
    await f.ring(dialled, fakeNumber(), { callId: "SCL_same" });
    await assert.rejects(f.ring(dialled, fakeNumber(), { callId: "SCL_same" }), {
      code: "DUPLICATE_CALL",
    });
  } finally {
    await f.close();
  }
});

test("the concurrency guard refuses a second live call with the busy line, never two winners", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    f.deps.maxConcurrent = 1;
    const [a, b] = await Promise.all([f.ring(dialled), f.ring(dialled)]);
    const refusals = [a.result.refusal, b.result.refusal].sort();
    assert.deepEqual(refusals, ["LINES_BUSY", null].sort());
    const busy = a.result.refusal ? a.result : b.result;
    assert.equal((busy as { busyLine: boolean }).busyLine, true);
    // Ending the live call frees the line.
    const live = (a.result.refusal ? b.result : a.result) as { callId: string; token: string };
    await f.calls.end(live.callId, sha(live.token), { reason: "hangup" });
    assert.equal((await f.ring(dialled)).result.refusal, null);
    // A browser voice test uses the same speech quota and counts too.
    const done = (await f.ring(dialled)).result;
    assert.equal(done.refusal, "LINES_BUSY");
  } finally {
    await f.close();
  }
});

test("a browser voice test in progress takes the only line", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    f.deps.maxConcurrent = 1;
    const session = (
      await f.req("POST", "/agent-tests", {
        agentId: f.h.orgA.agentId,
        locationId: f.h.orgA.locationId,
        source: {
          kind: "draft",
          expectedRevision: (await f.req("GET", `/agents/${f.h.orgA.agentId}/draft`)).body.data.revision,
        },
      })
    ).body.data;
    await f.h.cleanup.query(
      "update app.test_session set channel='voice',voice_token_hash=$2,voice_expires_at=now()+interval '5 minutes' where id=$1",
      [session.id, sha("x")],
    );
    assert.equal((await f.ring(dialled)).result.refusal, "LINES_BUSY");
  } finally {
    await f.close();
  }
});

test("a token works only for the call it was minted for", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const a = (await f.ring(dialled)).result as { callId: string; token: string };
    const b = (await f.ring(dialled)).result as { callId: string; token: string };
    await assert.rejects(f.calls.answered(b.callId, sha(a.token)), /VOICE_UNAUTHORIZED/);
    await assert.rejects(
      f.calls.voiceBegin(b.callId, sha(a.token), {
        input: "Hello",
        clientTurnId: crypto.randomUUID(),
      }),
      /VOICE_UNAUTHORIZED/,
    );
    await f.calls.answered(a.callId, sha(a.token));
    assert.ok((await f.row(a.callId)).disclosure_played_at);
    // An ended call's token is dead.
    await f.calls.end(a.callId, sha(a.token), { reason: "hangup" });
    await assert.rejects(f.calls.answered(a.callId, sha(a.token)), /VOICE_UNAUTHORIZED/);
  } finally {
    await f.close();
  }
});

test("a booking is recorded only after a read-back and the caller's yes", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const call = (await f.ring(dialled)).result as { callId: string; token: string };
    const args = { resourceId: f.resource.id, startAt: f.slotStart, title: "Contoh appointment" };
    const book = () =>
      f.scripted([toolEvent("book_slot", args), end("")], [sentence("Noted."), end("Noted.")]);

    // Turn 1: the model goes straight to book_slot. Nothing is recorded.
    const first = book();
    await f.turn(call, "Book Contoh Room tomorrow at nine", first.model);
    assert.equal((await f.proposals(call.callId)).length, 0);
    const steps = (
      await f.h.cleanup.query("select result from app.call_tool_step where call_id=$1", [call.callId])
    ).rows;
    assert.equal(steps[0].result.kind, "readback_required");
    assert.match(first.seen[0].stable, /readback_required/);

    // Turn 2: the caller says no. Still nothing.
    await f.turn(call, "Tak, bukan pukul sembilan", book().model);
    assert.equal((await f.proposals(call.callId)).length, 0);

    // Turn 3: different details than the read-back. Still nothing.
    const other = f.scripted(
      [toolEvent("book_slot", { ...args, title: "Something else" }), end("")],
      [sentence("Okay."), end("Okay.")],
    );
    await f.turn(call, "Ya betul", other.model);
    assert.equal((await f.proposals(call.callId)).length, 0);

    // Turn 4: the caller says yes to what turn 3 read back, same details.
    const yes = f.scripted(
      [toolEvent("book_slot", { ...args, title: "Something else" }), end("")],
      [sentence("Waiting for staff to confirm."), end("Waiting for staff to confirm.")],
    );
    await f.turn(call, "Ya, betul", yes.model);
    const recorded = await f.proposals(call.callId);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].kind, "booking");
    assert.equal(recorded[0].state, "pending");
    await f.calls.end(call.callId, sha(call.token), { reason: "hangup", language: "ms" });
    const row = await f.row(call.callId);
    assert.equal(row.outcome, "booking_proposed");
    assert.equal(row.language, "ms");
  } finally {
    await f.close();
  }
});

test("a do-not-contact caller is answered, flagged, and offered no follow-up", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const caller = fakeNumber();
    await f.h.cleanup.query(
      "insert into app.contact(org_id,name,phone_e164,do_not_contact)values($1,'Contoh Guest',$2,true)",
      [f.h.orgA.id, caller],
    );
    const call = (await f.ring(dialled, caller)).result as { callId: string; token: string };
    assert.equal((await f.row(call.callId)).do_not_contact, true);
    const model = f.scripted([sentence("Hello."), end("Hello.")]);
    await f.turn(call, "Hello", model.model);
    assert.match(model.seen[0].volatile, /asked not to be contacted/);
  } finally {
    await f.close();
  }
});

test("after hours: no transfer, a handoff is recorded for staff", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber({ transfer: fakeNumber() });
    f.setClock(klAt(f.day, "03:00"));
    const call = (await f.ring(dialled)).result as { callId: string; token: string; afterHours: boolean };
    assert.equal(call.afterHours, true);
    assert.equal((await f.row(call.callId)).after_hours, true);
    const model = f.scripted(
      [toolEvent("handoff_to_human", { reason: "wants a person" }), end("")],
      [sentence("Noted for staff."), end("Noted for staff.")],
    );
    await f.turn(call, "Saya nak cakap dengan orang", model.model);
    assert.match(model.seen[0].volatile, /closed right now/);
    assert.equal(f.telephony.transfers.length, 0);
    assert.equal((await f.proposals(call.callId))[0].kind, "handoff");
  } finally {
    await f.close();
  }
});

test("open hours: handoff transfers to the staff number; a failed transfer keeps the caller", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const staff = fakeNumber();
    const dialled = await f.addNumber({ transfer: staff });
    const handoff = () =>
      f.scripted(
        [toolEvent("handoff_to_human", { reason: "wants a person" }), end("")],
        [sentence("Sorry, nobody answered."), end("Sorry, nobody answered.")],
      );
    const failed = (await f.ring(dialled)).result as { callId: string; token: string };
    f.telephony.outcomes.push({ ok: false, reason: "STR_RINGING_TIMEOUT" });
    await f.turn(failed, "Can I talk to someone", handoff().model);
    assert.equal(f.telephony.transfers.length, 1);
    assert.equal(f.telephony.transfers[0].to, staff);
    await f.calls.end(failed.callId, sha(failed.token), { reason: "hangup" });
    assert.equal((await f.row(failed.callId)).outcome, "transfer_failed");

    const ok = (await f.ring(dialled)).result as { callId: string; token: string };
    f.telephony.outcomes.push({ ok: true, reason: null });
    await f.turn(ok, "Can I talk to someone", handoff().model);
    await f.calls.end(ok.callId, sha(ok.token), { reason: "transferred" });
    assert.equal((await f.row(ok.callId)).outcome, "transferred");
  } finally {
    await f.close();
  }
});

test("calls are tenant-isolated; staff see the call list but not what was said", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const call = (await f.ring(dialled)).result as { callId: string; token: string };
    await f.turn(call, "Hello", f.scripted([sentence("Hello."), end("Hello.")]).model);
    const count = (identity: any, org: string, table: string) =>
      f.h.sqlAsApp(identity, org, async (tx: any) =>
        Number((await tx.query(`select count(*) from app.${table} where org_id=$1`, [f.h.orgA.id])).rows[0].count),
      );
    assert.equal(await count(f.h.alice, f.h.orgA.id, "call"), 1);
    assert.equal(await count(f.h.alice, f.h.orgA.id, "call_turn"), 1);
    assert.equal(await count(f.h.bob, f.h.orgB.id, "call"), 0);
    assert.equal(await count(f.h.bob, f.h.orgB.id, "phone_number"), 0);
    assert.equal(await count(f.h.staff, f.h.orgA.id, "call"), 1);
    assert.equal(await count(f.h.staff, f.h.orgA.id, "call_turn"), 0);
  } finally {
    await f.close();
  }
});

test("one caller is limited to six calls an hour per business", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const caller = fakeNumber();
    for (let i = 0; i < 6; i++) {
      const r = (await f.ring(dialled, caller)).result as { callId: string; token: string };
      await f.calls.end(r.callId, sha(r.token), { reason: "hangup" });
    }
    const limited = (await f.ring(dialled, caller)).result;
    assert.equal(limited.refusal, "CALLER_LIMIT");
    assert.equal((limited as { busyLine: boolean }).busyLine, true);
  } finally {
    await f.close();
  }
});

test("deleting the caller's contact deletes their calls (PDPA)", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const call = (await f.ring(dialled)).result as { callId: string; token: string };
    const { contact_id } = await f.row(call.callId);
    await f.h.cleanup.query("delete from app.contact where id=$1", [contact_id]);
    assert.equal(await f.row(call.callId), undefined);
  } finally {
    await f.close();
  }
});

test("a withheld caller ID still gets answered, with no contact", async () => {
  const f = await phoneFixture();
  try {
    await f.publish();
    const dialled = await f.addNumber();
    const call = (await f.ring(dialled, null)).result as { callId: string };
    const row = await f.row(call.callId);
    assert.equal(row.caller_e164, null);
    assert.equal(row.contact_id, null);
  } finally {
    await f.close();
  }
});
