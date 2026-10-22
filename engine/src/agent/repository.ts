import pg from "pg";
import type {
  ToolAccess,
  ToolEffect,
  ToolResult,
} from "../../../packages/domain/src/agent-test/tools.ts";
import type { ToolCall } from "../../../packages/contracts/src/agent-test.ts";
import { calculateAvailability } from "../../../packages/domain/src/booking/availability.ts";
export class AgentRepository {
  private pool: pg.Pool;
  constructor(readonly namespace: string) {
    const url = new URL(process.env.AGENT_DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "54622")
      throw Error("LOCAL_DATABASE_REQUIRED");
    this.pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    this.pool.on("error", () => console.error("AGENT_DATABASE_POOL_ERROR"));
  }
  async op(
    action: string,
    id: string | null = null,
    operation: string | null = null,
    lease: string | null = null,
    data: unknown = {},
  ) {
    return (
      await this.pool.query(
        "select app_private.agent_work($1,$2,$3,$4,$5,$6)as value",
        [action, this.namespace, id, operation, lease, JSON.stringify(data)],
      )
    ).rows[0].value;
  }
  access(envelope: any): ToolAccess {
    const { turn } = envelope;
    const op = (action: string, data?: unknown) =>
      this.op(action, turn.id, turn.operation_id, turn.lease_token, data);
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
      record: async (
        step: number,
        call: ToolCall,
        effect: ToolEffect,
      ): Promise<ToolResult> => {
        const value = await op("record", { step, call, effect });
        if (!value) throw Error("TURN_CANCELLED");
        return value;
      },
    };
  }
  close() {
    return this.pool.end();
  }
}
