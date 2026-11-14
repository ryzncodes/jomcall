import pg from "pg";
import type {
  ToolAccess,
  ToolEffect,
  ToolResult,
} from "../../../packages/domain/src/agent-test/tools.ts";
import type { ToolCall } from "../../../packages/contracts/src/agent-test.ts";
import { calculateAvailability } from "../../../packages/domain/src/booking/availability.ts";
import { isAffirmative } from "../../../packages/domain/src/phone/readback.ts";

// Real phone calls, through app_private.agent_call. The method names match
// AgentRepository's spoken-turn methods so runVoiceTurn can use either one;
// "session" here is the call ID and the token is the per-call token's hash.
export type CallStart = {
  dialled: string;
  caller: string | null;
  sipCallId: string;
  room: string;
  identity: string;
  tokenHash: string;
  maxConcurrent: number;
  capSeconds: number;
  at?: string;
};

export class CallRepository {
  private pool: pg.Pool;
  constructor(readonly namespace: string) {
    const url = new URL(process.env.AGENT_DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "54622")
      throw Error("LOCAL_DATABASE_REQUIRED");
    this.pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    this.pool.on("error", () => console.error("CALL_DATABASE_POOL_ERROR"));
  }
  private async run(
    action: string,
    call: string | null,
    tokenHash: string | null,
    turn: string | null = null,
    lease: string | null = null,
    data: unknown = {},
  ) {
    return (
      await this.pool.query(
        "select app_private.agent_call($1,$2,$3,$4,$5,$6,$7)as value",
        [action, this.namespace, call, tokenHash, turn, lease, JSON.stringify(data)],
      )
    ).rows[0].value;
  }
  start(data: CallStart) {
    return this.run("call_start", null, null, null, null, data);
  }
  maintain() {
    return this.run("maintain", null, null);
  }
  answered(call: string, tokenHash: string) {
    return this.run("call_answered", call, tokenHash);
  }
  end(call: string, tokenHash: string, data: { reason: string; language?: string }) {
    return this.run("call_end", call, tokenHash, null, null, data);
  }
  async voiceBegin(
    call: string,
    tokenHash: string,
    data: { input: string; clientTurnId: string },
  ) {
    const envelope = await this.run("turn_begin", call, tokenHash, null, null, data);
    // Kept on the envelope (in memory only) so tool access can authenticate.
    Object.defineProperty(envelope, "auth", {
      value: { call, tokenHash },
      enumerable: false,
    });
    return envelope;
  }
  voiceComplete(
    call: string,
    tokenHash: string,
    turn: string,
    lease: string,
    data: { answer: string; timings: unknown; evidence: unknown; usage: unknown },
  ) {
    return this.run("turn_complete", call, tokenHash, turn, lease, data);
  }
  voiceFail(call: string, tokenHash: string, turn: string, lease: string, code: string) {
    return this.run("turn_fail", call, tokenHash, turn, lease, { code });
  }
  voiceCancel(call: string, tokenHash: string, turn: string, lease: string) {
    return this.run("turn_cancel", call, tokenHash, turn, lease);
  }
  // The answer cache is never used on a phone call.
  async voiceCacheGet(): Promise<null> {
    return null;
  }
  async voiceCachePut() {
    return {};
  }
  access(envelope: any): ToolAccess {
    const { call, tokenHash } = envelope.auth as { call: string; tokenHash: string };
    const { turn } = envelope;
    const op = (action: string, data?: unknown) =>
      this.run(action, call, tokenHash, turn.id, turn.lease_token, data);
    return {
      read: async () => {
        const value = await op("context");
        if (!value) throw Error("TURN_CANCELLED");
        return {
          snapshot: value.session.snapshot,
          locationId: value.session.location_id,
          resources: value.resources,
        };
      },
      availability: async (args) => {
        const value = await op("availability", args);
        if (!value) throw Error("TURN_CANCELLED");
        return calculateAvailability(
          envelope.session.org_id,
          value.resource,
          value.schedule,
          value.occupied,
          args,
        ).items;
      },
      record: async (step: number, toolCall: ToolCall, effect: ToolEffect) => {
        // The caller's half of the read-back check: their words in THIS turn.
        const value = await op("record", {
          step,
          call: toolCall,
          effect,
          confirmed: isAffirmative(String(turn.input ?? "")),
        });
        if (!value) throw Error("TURN_CANCELLED");
        return value as ToolResult;
      },
    };
  }
  // Records the outcome of a transfer as the tool step of handoff_to_human.
  async recordTransfer(
    envelope: any,
    step: number,
    args: unknown,
    outcome: { ok: boolean; reason: string | null },
  ) {
    const { call, tokenHash } = envelope.auth as { call: string; tokenHash: string };
    const value = await this.run("record", call, tokenHash, envelope.turn.id, envelope.turn.lease_token, {
      step,
      call: { name: "handoff_to_human", args },
      effect: { kind: "transfer", ok: outcome.ok, reason: outcome.reason },
    });
    if (!value) throw Error("TURN_CANCELLED");
    return value;
  }
  close() {
    return this.pool.end();
  }
}
