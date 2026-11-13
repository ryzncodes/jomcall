import { createHash, randomUUID } from "node:crypto";
import { bookingFixture } from "./booking.ts";
import { AgentRepository } from "../../engine/src/agent/repository.ts";
import {
  runVoiceTurn,
  type VoiceTurnEvent,
} from "../../engine/src/agent/voice-turn.ts";
import type { VoiceModelEvent } from "../../packages/inference/src/anthropic-voice.ts";

export const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };
export const sentence = (text: string): VoiceModelEvent => ({
  type: "sentence",
  text,
});
export const end = (text = ""): VoiceModelEvent => ({
  type: "end",
  text,
  content: [{ type: "text", text }],
  usage,
});
export const toolEvent = (name: string, input: unknown): VoiceModelEvent => ({
  type: "tool",
  id: "toolu_" + randomUUID().slice(0, 8),
  name,
  input,
});

export async function fixture() {
  const f = await bookingFixture();
  const repository = new AgentRepository(f.h.namespace);
  const knowledge = [
    {
      kind: "text",
      name: "Contoh Hours",
      content: "Contoh Room opens weekdays from nine to six.",
    },
  ];
  const makeSession = async (seconds = 300) => {
    const session = (
      await f.req("POST", "/agent-tests", {
        agentId: f.h.orgA.agentId,
        locationId: f.h.orgA.locationId,
        source: { kind: "draft", expectedRevision: 1 },
      })
    ).body.data;
    const token = randomUUID();
    await f.h.cleanup.query(
      "update app.test_session set channel='voice',voice_token_hash=$2,voice_expires_at=now()+$3*interval '1 second',snapshot=jsonb_set(snapshot,'{knowledge}',$4::jsonb) where id=$1",
      [session.id, sha(token), seconds, JSON.stringify(knowledge)],
    );
    return { id: session.id as string, hash: sha(token), token };
  };
  // A scripted model: one list of events per call, and a record of the calls.
  const scripted = (...calls: VoiceModelEvent[][]) => {
    const seen: { messages: unknown[]; stable: string; volatile: string }[] =
      [];
    const model = async function* (input: any, signal: AbortSignal) {
      seen.push({
        messages: structuredClone(input.messages),
        stable: input.stable,
        volatile: input.volatile,
      });
      const events = calls[seen.length - 1];
      if (!events) throw Error("MODEL_UNAVAILABLE");
      for (const e of events) {
        if (signal.aborted) return;
        yield e;
      }
    };
    return { model: model as any, seen };
  };
  let clock = 1_000;
  const run = async (
    session: { id: string; hash: string },
    transcript: string,
    model: any,
    controller = new AbortController(),
    onEvent: (e: VoiceTurnEvent) => void = () => {},
    repo: AgentRepository = repository,
  ) => {
    const events: VoiceTurnEvent[] = [];
    await runVoiceTurn(
      { repository: repo, model, now: () => (clock += 50) },
      {
        sessionId: session.id,
        tokenHash: session.hash,
        transcript,
        clientTurnId: randomUUID(),
        heardAtMs: 1_000,
      },
      (e) => {
        events.push(e);
        onEvent(e);
      },
      controller.signal,
    );
    return events;
  };
  // The real repository with some methods wrapped, to inject faults.
  const wrapped = (over: Record<string, (...a: any[]) => any>) =>
    new Proxy(repository, {
      get: (target, prop: string) =>
        over[prop]
          ? (...a: any[]) => over[prop](target, ...a)
          : (target as any)[prop].bind(target),
    });
  const turns = async (session: string) =>
    (
      await f.h.cleanup.query(
        "select * from app.test_turn where session_id=$1 order by created_at",
        [session],
      )
    ).rows;
  return {
    ...f,
    makeSession,
    scripted,
    run,
    turns,
    wrapped,
    async close() {
      await repository.close();
      await f.close();
    },
  };
}
