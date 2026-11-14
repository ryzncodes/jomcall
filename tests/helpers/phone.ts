import { randomUUID, randomInt } from "node:crypto";
import { bookingFixture } from "./booking.ts";
import { CallRepository } from "../../engine/src/agent/call-repository.ts";
import {
  phonePolicy,
  startPhoneCall,
  type PhoneDeps,
} from "../../engine/src/agent/phone-call.ts";
import {
  runVoiceTurn,
  type VoiceTurnEvent,
} from "../../engine/src/agent/voice-turn.ts";
import { FakeTelephony } from "../../packages/domain/src/phone/telephony.ts";
import type { VoiceModelEvent } from "../../packages/inference/src/anthropic-voice.ts";

export const phoneSettings = (over: Record<string, unknown> = {}) => ({
  name: "Contoh Agent",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "Hello, Contoh Room.",
  instructions: "Answer politely.",
  aiDisclosure: "Anda bercakap dengan pembantu AI.",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "Leda",
  ...over,
});

// Fake Malaysian mobile numbers, random so parallel runs never share one.
export const fakeNumber = () => "+6011" + String(randomInt(10_000_000, 99_999_999));
// Noon and 3 am tomorrow in Kuala Lumpur; the fixture schedule is 09:00-18:00 daily.
export const klAt = (day: string, hhmm: string) =>
  Date.parse(`${day}T${hhmm}:00+08:00`);

export async function phoneFixture() {
  const f = await bookingFixture();
  const calls = new CallRepository(f.h.namespace);
  const telephony = new FakeTelephony();
  let clock = klAt(f.day, "12:00");
  const deps: PhoneDeps = {
    calls,
    telephony,
    maxConcurrent: 20,
    capSeconds: 600,
    now: () => clock,
  };
  const publish = async (over: Record<string, unknown> = {}) => {
    const draft = (await f.req("GET", `/agents/${f.h.orgA.agentId}/draft`)).body.data;
    const put = await f.req("PUT", `/agents/${f.h.orgA.agentId}/draft`, {
      expectedRevision: draft.revision,
      settings: phoneSettings(over),
    });
    if (put.status !== 200) throw Error("draft failed " + put.status);
    const pub = await f.req("POST", `/agents/${f.h.orgA.agentId}/publish`, {
      expectedRevision: put.body.data.revision,
    });
    if (pub.status !== 200) throw Error("publish failed " + pub.status);
    return pub.body.data;
  };
  const addNumber = async (over: { transfer?: string | null; org?: "A" | "B" } = {}) => {
    const org = over.org === "B" ? f.h.orgB : f.h.orgA;
    const e164 = fakeNumber();
    await f.h.cleanup.query(
      "insert into app.phone_number(org_id,location_id,agent_id,e164,transfer_e164)values($1,$2,$3,$4,$5)",
      [org.id, org.locationId, org.agentId, e164, over.transfer ?? null],
    );
    return e164;
  };
  // A SIP caller as LiveKit would show it, then the server-side start.
  const ring = async (
    dialled: string,
    caller: string | null = fakeNumber(),
    opts: { kind?: "sip" | "other"; callId?: string } = {},
  ) => {
    const room = "call-" + dialled + "_" + randomUUID().slice(0, 8);
    const identity = "sip_" + (caller ?? "anonymous");
    telephony.addCaller(
      room,
      identity,
      {
        "sip.trunkPhoneNumber": dialled,
        "sip.callID": opts.callId ?? "SCL_" + randomUUID(),
        ...(caller ? { "sip.phoneNumber": caller } : {}),
      },
      opts.kind ?? "sip",
    );
    return { room, identity, result: await startPhoneCall(deps, { room, identity }) };
  };
  const scripted = (...lists: VoiceModelEvent[][]) => {
    const seen: { stable: string; volatile: string }[] = [];
    const model = async function* (input: any, signal: AbortSignal) {
      seen.push({ stable: input.stable, volatile: input.volatile });
      const events = lists[seen.length - 1];
      if (!events) throw Error("MODEL_UNAVAILABLE");
      for (const e of events) {
        if (signal.aborted) return;
        yield e;
      }
    };
    return { model: model as any, seen };
  };
  const turn = async (
    call: { callId: string; token: string },
    transcript: string,
    model: any,
  ) => {
    const events: VoiceTurnEvent[] = [];
    const { createHash } = await import("node:crypto");
    await runVoiceTurn(
      { repository: calls, model, now: () => (clock += 50), policy: phonePolicy(deps) },
      {
        sessionId: call.callId,
        tokenHash: createHash("sha256").update(call.token).digest("hex"),
        transcript,
        clientTurnId: randomUUID(),
        heardAtMs: clock,
      },
      (e) => events.push(e),
      new AbortController().signal,
    );
    return events;
  };
  const row = async (id: string) =>
    (await f.h.cleanup.query("select * from app.call where id=$1", [id])).rows[0];
  const proposals = async (id: string) =>
    (
      await f.h.cleanup.query(
        "select * from app.call_proposal where call_id=$1 order by created_at,step",
        [id],
      )
    ).rows;
  return {
    ...f,
    calls,
    telephony,
    deps,
    publish,
    addNumber,
    ring,
    scripted,
    turn,
    row,
    proposals,
    setClock: (ms: number) => (clock = ms),
    async close() {
      await calls.close();
      await f.close();
    },
  };
}
