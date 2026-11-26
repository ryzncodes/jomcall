// AI call summaries, in the agent process. Claims one pending summary per tick
// through app_private.call_summary (lease based), has writeSummary turn the
// completed turns of the call into six short sentences, and writes them back
// under the lease. Only the row id and a code are ever logged: never turn
// text, the caller number or summary text.
import pg from "pg";
import {
  callSummary,
  databaseConnection,
  validNamespace,
  type Env,
} from "../../../packages/contracts/src/hosting.ts";
import {
  summaryModel,
  writeSummary,
  type SummaryInput,
} from "../../../packages/inference/src/call-summary.ts";
import type { AnthropicLike } from "../../../packages/inference/src/setup-reader.ts";
import { sharedAnthropicClient } from "../../../packages/inference/src/anthropic-voice.ts";

export type CallSummaryDeps = {
  env?: Env;
  // Defaults to JOMCALL_CALL_SUMMARY === "anthropic". Off: maintenance still
  // runs, and nothing is claimed.
  enabled?: boolean;
  write?: typeof writeSummary;
  client?: AnthropicLike;
  // How often maintain runs; tests pass 0 so every tick runs it.
  maintainEveryMs?: number;
};

type Claim = {
  id: string;
  lease: string;
  attempt: number;
  call: {
    outcome: string | null;
    transfer_result: string | null;
    after_hours: boolean | null;
    caller_e164: string | null;
  };
  turns: { input: string; answer: string | null }[];
  proposals: string[];
};

// The plan's model request timeout.
const MODEL_TIMEOUT_MS = 20_000;
const MAINTAIN_EVERY_MS = 30_000;
const BUSY_PAUSE_MS = 1_000;
const IDLE_PAUSE_MS = 5_000;

// Never used: an injected write gets this in place of a real client, so a
// test can never build one by accident.
const noClient: AnthropicLike = {
  messages: { create: () => Promise.reject(Error("CALL_SUMMARY_NO_CLIENT")) },
};

const log = (id: string, code: string) =>
  console.log(`CALL_SUMMARY_FAILED ${code} ${id}`);

export class CallSummaryWorker {
  private pool: pg.Pool;
  private stop = new AbortController();
  private running: Promise<unknown> = Promise.resolve();
  private loop: Promise<void> | undefined;
  private closed = false;
  private lastMaintain = -Infinity;
  private constructor(
    readonly namespace: string,
    private readonly write: typeof writeSummary,
    private readonly client: () => AnthropicLike,
    readonly enabled: boolean,
    private readonly maintainEveryMs: number,
    env: Env,
  ) {
    this.pool = new pg.Pool({
      ...databaseConnection(env.AGENT_DATABASE_URL, "AGENT_DATABASE_URL", env),
      max: 2,
    });
    this.pool.on("error", () => console.error("CALL_SUMMARY_DATABASE_POOL_ERROR"));
  }

  static async create(namespace: string, deps: CallSummaryDeps = {}) {
    const env = deps.env ?? process.env;
    validNamespace(namespace, env);
    const enabled = deps.enabled ?? callSummary(env) === "anthropic";
    const client = deps.write
      ? () => deps.client ?? noClient
      : () => deps.client ?? sharedAnthropicClient();
    return new CallSummaryWorker(
      namespace,
      deps.write ?? writeSummary,
      client,
      enabled,
      deps.maintainEveryMs ?? MAINTAIN_EVERY_MS,
      env,
    );
  }

  private async op(
    action: string,
    id: string | null = null,
    lease: string | null = null,
    data: unknown = {},
  ): Promise<any> {
    return (
      await this.pool.query(
        "select app_private.call_summary($1,$2,$3,$4,$5)as value",
        [action, this.namespace, id, lease, JSON.stringify(data)],
      )
    ).rows[0].value;
  }

  // Maintenance (at most every maintainEveryMs), then at most one claim.
  // True when a row was handled.
  tick(): Promise<boolean> {
    const run = this.once();
    this.running = run.catch(() => undefined);
    return run;
  }

  // Own loop: one second after a handled row, five otherwise. close() ends it
  // promptly.
  run(): Promise<void> {
    this.loop ??= (async () => {
      while (!this.stop.signal.aborted) {
        let handled = false;
        try {
          handled = await this.tick();
        } catch {
          console.error("CALL_SUMMARY_TICK_FAILED");
        }
        await this.pause(handled ? BUSY_PAUSE_MS : IDLE_PAUSE_MS);
      }
    })();
    return this.loop;
  }

  private pause(ms: number) {
    const signal = this.stop.signal;
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  private async once(): Promise<boolean> {
    if (Date.now() - this.lastMaintain >= this.maintainEveryMs) {
      await this.op("maintain");
      this.lastMaintain = Date.now();
    }
    if (!this.enabled || this.stop.signal.aborted) return false;
    const claim = (await this.op("claim")) as Claim | null;
    if (!claim) return false;
    await this.handle(claim);
    return true;
  }

  private async handle(claim: Claim) {
    const { id, lease } = claim;
    const fail = async (code: string) => {
      await this.op("fail", id, lease, { code });
      log(id, code);
    };
    const input: SummaryInput = {
      outcome: claim.call.outcome,
      transferResult: claim.call.transfer_result,
      afterHours: claim.call.after_hours === true,
      callerE164: claim.call.caller_e164,
      turns: claim.turns,
      proposals: claim.proposals,
    };
    let result: Awaited<ReturnType<typeof writeSummary>>;
    try {
      result = await this.write(this.client(), input, {
        signal: AbortSignal.any([
          AbortSignal.timeout(MODEL_TIMEOUT_MS),
          this.stop.signal,
        ]),
      });
    } catch {
      return fail("MODEL_FAILED");
    }
    // Stopping (a deploy) and no summary: leave the lease to expire; maintain
    // re-queues it. A summary that did arrive is still written: close() keeps
    // the pool open until this tick ends.
    if ("error" in result) {
      if (this.stop.signal.aborted) return;
      return fail(result.error);
    }
    let r: { ok: boolean } | null;
    try {
      r = await this.op("write", id, lease, {
        ...result.fields,
        model: result.model || summaryModel,
      });
    } catch (e) {
      // A payload the database refuses (raised even on a stale lease): a
      // failed attempt, so it cannot loop on the same answer for ever.
      const code = /SUMMARY_INVALID/.test((e as Error | null)?.message ?? "")
        ? "SUMMARY_INVALID"
        : "WRITE_FAILED";
      await fail(code).catch(() => undefined);
      return;
    }
    if (!r?.ok) log(id, "LEASE_LOST");
  }

  // Aborts a model call in progress (its lease expires and maintain returns
  // it to the queue), ends the loop, waits for the current tick, closes the
  // pool. Safe to call twice.
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.stop.abort();
    await this.loop;
    await this.running;
    await this.pool.end();
  }
}
