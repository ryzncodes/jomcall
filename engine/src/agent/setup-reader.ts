// Guided setup document import, read side, in the agent process. Claims one
// queued upload per tick, assembles its bytes, reads it with
// readDocumentChecked (a photo or PDF twice, compared) and writes draft price rows and facts through app_private.setup_read, which
// re-checks the lease and the session under row locks. Only the upload id,
// the attempt and a code are ever logged: never a file name, row text, fact
// text or key.
import pg from "pg";
import {
  databaseConnection,
  setupReader,
  validNamespace,
  type Env,
} from "../../../packages/contracts/src/hosting.ts";
import {
  setupCataloguePayload,
  setupFactPayload,
} from "../../../packages/contracts/src/setup.ts";
import { factInput } from "../../../packages/contracts/src/knowledge.ts";
import {
  basePack,
  packById,
  type Pack,
} from "../../../packages/domain/src/packs/index.ts";
import {
  readDocument,
  readDocumentChecked,
  readerFallbackModel,
  type AnthropicLike,
  type ReaderField,
  type ReaderInput,
  type ReadResult,
} from "../../../packages/inference/src/setup-reader.ts";
import { sharedAnthropicClient } from "../../../packages/inference/src/anthropic-voice.ts";

// readDocumentChecked has this same shape.
export type ReadFn = typeof readDocument;
export type SetupReadDeps = {
  // Tests pass a fake read, or a fake client with the default read;
  // otherwise readDocumentChecked on the shared client (photos and PDFs are
  // read twice and compared, delimited and pasted text once).
  read?: ReadFn;
  client?: AnthropicLike;
  // Defaults to JOMCALL_SETUP_READER === "anthropic". Off: maintenance still
  // runs, and any queued upload found is failed with READER_OFF.
  enabled?: boolean;
  env?: Env;
  // Per read; tests shorten it.
  timeoutMs?: number;
  // How often maintain runs; tests pass 0 so every tick runs it.
  maintainEveryMs?: number;
};

type Claim = {
  upload: string;
  lease: string;
  attempt: number;
  kind: "image" | "pdf" | "sheet" | "text";
  mime: string;
  name: string;
  chunks: number;
  mainPack: string;
  extraPacks: string[];
  questionIds: string[];
};

// A heavily flagged long delimited or pasted list is read once more with the
// stronger model. Photos and PDFs are not: they are already read twice and
// compared, and a disagreement flag is the answer, not a reason to read
// again. Exported for the reading check (scripts/setup/check-reader.ts).
export const FALLBACK_SHARE = 0.5;
export const FALLBACK_MIN_ROWS = 10;
export const FALLBACK_KINDS: readonly ReaderInput["kind"][] = ["sheet", "text"];
export function wantsFallback(
  input: ReaderInput,
  result: ReadResult,
): result is Ok {
  return (
    FALLBACK_KINDS.includes(input.kind) &&
    result.ok &&
    result.flaggedShare > FALLBACK_SHARE &&
    result.rows.length >= FALLBACK_MIN_ROWS
  );
}
// A 300-row answer can take well over a minute. One timeout covers a read:
// both concurrent requests of a photo or PDF share it. The lease (eight
// minutes, set in setup_read) covers two reads plus the chunk fetch and the
// result.
export const READ_TIMEOUT_MS = 120_000;
const MAINTAIN_EVERY_MS = 30_000;
// Loop pauses: after a handled upload, and after a tick that found nothing
// (or failed).
const BUSY_PAUSE_MS = 1_000;
const IDLE_PAUSE_MS = 5_000;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

// Never used: an injected read gets this in place of a real client, so a test
// can never build one by accident.
const noClient: AnthropicLike = {
  messages: {
    create: () => Promise.reject(Error("SETUP_READ_NO_CLIENT")),
  },
};

// The fact fields the reader may fill: every fact of the session's active
// packs, one per key. A key that several packs share goes to the pack the
// interview would file it under: its frozen question's pack, else the first
// of base, main, extras.
export function readerFields(claim: {
  mainPack: string;
  extraPacks: string[];
  questionIds: string[];
}): ReaderField[] {
  const order: Pack[] = [];
  for (const id of [basePack, claim.mainPack, ...claim.extraPacks]) {
    const pack = packById(id);
    if (pack && !order.some((p) => p.id === pack.id)) order.push(pack);
  }
  const prefer = new Map<string, string>();
  for (const qid of claim.questionIds) {
    const m = qid.match(/^([a-z][a-z0-9-]{1,40}):(\d{1,3})$/);
    const pack = m ? order.find((p) => p.id === m[1]) : undefined;
    const q = pack?.interview.find((x) => x.order === Number(m![2]));
    const fact = q?.fills.find((f) => f.startsWith("facts."));
    const key = fact?.slice("facts.".length);
    if (pack && key && pack.facts.some((f) => f.key === key))
      prefer.set(key, pack.id);
  }
  const owner = new Map<string, Pack>();
  for (const pack of order)
    for (const f of pack.facts)
      if (!owner.has(f.key) || prefer.get(f.key) === pack.id)
        owner.set(f.key, pack);
  const out: ReaderField[] = [];
  for (const pack of order)
    for (const f of pack.facts)
      if (owner.get(f.key) === pack)
        out.push({ packId: pack.id, fieldKey: f.key, title: f.label.en });
  return out;
}

const log = (upload: string, attempt: number, code: string) =>
  console.log(`SETUP_READ upload=${upload} attempt=${attempt} code=${code}`);

// What jsonb and the staging store accept: no NUL and no lone surrogate
// half (both are refused by Postgres), cut by code points, never inside a
// character.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function clean(s: string, maxPoints?: number): string {
  const out = s.replace(/\u0000/g, "").replace(LONE_SURROGATE, "");
  if (maxPoints === undefined) return out;
  const points = [...out];
  return points.length <= maxPoints ? out : points.slice(0, maxPoints).join("");
}

type Ok = Extract<ReadResult, { ok: true }>;
// The fallback read replaces the first only when it kept at least as many
// rows and is not more heavily flagged; an empty or shorter answer never
// wins. Facts are merged, the first read's fact winning per field.
export function better(first: Ok, second: ReadResult): Ok {
  if (
    !second.ok ||
    second.rows.length < first.rows.length ||
    second.flaggedShare > first.flaggedShare
  )
    return first;
  const have = new Set(first.facts.map((f) => f.fieldKey));
  return {
    ...second,
    facts: [...first.facts, ...second.facts.filter((f) => !have.has(f.fieldKey))],
  };
}

export class SetupReadWorker {
  private pool: pg.Pool;
  private stop = new AbortController();
  private running: Promise<unknown> = Promise.resolve();
  private loop: Promise<void> | undefined;
  private closed = false;
  private lastMaintain = -Infinity;
  private constructor(
    readonly namespace: string,
    private readonly read: ReadFn,
    private readonly client: () => AnthropicLike,
    readonly enabled: boolean,
    private readonly timeoutMs: number,
    private readonly maintainEveryMs: number,
    env: Env,
  ) {
    // Local: 127.0.0.1:54622 only. Hosted: TLS and an allow-listed host.
    this.pool = new pg.Pool({
      ...databaseConnection(env.AGENT_DATABASE_URL, "AGENT_DATABASE_URL", env),
      max: 2,
    });
    this.pool.on("error", () => console.error("SETUP_READ_DATABASE_POOL_ERROR"));
  }

  static async create(namespace: string, deps: SetupReadDeps = {}) {
    const env = deps.env ?? process.env;
    validNamespace(namespace, env);
    const enabled = deps.enabled ?? setupReader(env) === "anthropic";
    const client = deps.read
      ? () => deps.client ?? noClient
      : () => deps.client ?? sharedAnthropicClient();
    return new SetupReadWorker(
      namespace,
      deps.read ?? readDocumentChecked,
      client,
      enabled,
      deps.timeoutMs ?? READ_TIMEOUT_MS,
      deps.maintainEveryMs ?? MAINTAIN_EVERY_MS,
      env,
    );
  }

  async op(
    action: string,
    upload: string | null = null,
    lease: string | null = null,
    data: unknown = {},
  ): Promise<any> {
    return (
      await this.pool.query(
        "select app_private.setup_read($1,$2,$3,$4,$5)as value",
        [action, this.namespace, upload, lease, JSON.stringify(data)],
      )
    ).rows[0].value;
  }

  // Maintenance (at most every maintainEveryMs), then at most one upload.
  // True when an upload was handled.
  tick(): Promise<boolean> {
    const run = this.once();
    this.running = run.catch(() => undefined);
    return run;
  }

  // The worker's own loop: one second after a handled upload, five after a
  // tick that found nothing or failed. close() ends it promptly.
  run(): Promise<void> {
    this.loop ??= (async () => {
      while (!this.stop.signal.aborted) {
        let handled = false;
        try {
          handled = await this.tick();
        } catch {
          console.error("SETUP_READ_TICK_FAILED");
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
    if (this.stop.signal.aborted) return false;
    const claim = (await this.op("claim")) as Claim | null;
    if (!claim) return false;
    await this.handle(claim);
    return true;
  }

  private async handle(claim: Claim) {
    const { upload, lease, attempt } = claim;
    const fail = async (code: string) => {
      await this.op("fail", upload, lease, { code });
      log(upload, attempt, code);
    };
    if (!this.enabled) return fail("READER_OFF");

    const input = await this.input(claim);
    if (input === null) return log(upload, attempt, "LEASE_LOST");
    if (input === "UNREADABLE") return fail("UNREADABLE");

    // Stopping (a deploy): the lease goes back with the attempt returned.
    const stopped = async () => {
      await this.op("release", upload, lease, { stopped: true });
      log(upload, attempt, "STOPPED");
    };
    if (this.stop.signal.aborted) return stopped();
    const fields = readerFields(claim);
    let result = await this.readOnce(input, fields);
    // Inside the same lease; not a second attempt. A failed, shorter or
    // more heavily flagged fallback keeps the first result. Delimited and
    // pasted text only.
    if (wantsFallback(input, result) && !this.stop.signal.aborted)
      result = better(
        result,
        await this.readOnce(input, fields, readerFallbackModel),
      );

    if (!result.ok) {
      if (result.code === "FAILED" && this.stop.signal.aborted)
        return stopped();
      if (result.code === "FAILED") {
        // Retryable: a later tick tries again, unless this was the second try.
        const r = await this.op("release", upload, lease);
        log(upload, attempt, r?.state === "failed" ? "READ_FAILED" : "FAILED");
        return;
      }
      return fail(result.code === "REJECTED" ? "READ_FAILED" : result.code);
    }

    const payload = this.payload(upload, result, fields);
    let r;
    try {
      r = await this.op("result", upload, lease, payload);
    } catch (e) {
      if ((e as Error | null)?.message === "INVALID_SETUP_READ_RESULT") {
        // Refused by setup_read: the upload must not wait in "reading" to be
        // sent to the model again and refused the same way.
        await this.op("fail", upload, lease, { code: "READ_FAILED" }).catch(
          () => undefined,
        );
        return log(upload, attempt, "RESULT_REFUSED");
      }
      // Any other error (a lost connection, a database restart) is not the
      // reader's fault: the lease goes back with the attempt returned. If
      // the release fails too, maintain re-queues the upload when its lease
      // runs out.
      await this.op("release", upload, lease, { stopped: true }).catch(
        () => undefined,
      );
      return log(upload, attempt, "RESULT_NOT_STORED");
    }
    log(
      upload,
      attempt,
      r === null
        ? "LEASE_LOST"
        : r.removed
          ? "REMOVED"
          : r.state === "failed"
            ? r.code
            : "OK",
    );
  }

  private async readOnce(
    input: ReaderInput,
    fields: ReaderField[],
    model?: typeof readerFallbackModel,
  ): Promise<ReadResult> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.timeoutMs),
      this.stop.signal,
    ]);
    try {
      return await this.read(input, fields, {
        client: this.client(),
        signal,
        ...(model ? { model } : {}),
      });
    } catch {
      // A read that throws is treated as a retryable failure.
      return { ok: false, code: "FAILED" };
    }
  }

  // The document as the reader takes it. Null: the lease was lost.
  private async input(
    claim: Claim,
  ): Promise<ReaderInput | "UNREADABLE" | null> {
    if (claim.chunks < 1) return "UNREADABLE";
    const parts: Buffer[] = [];
    for (let seq = 0; seq < claim.chunks; seq++) {
      const c = await this.op("chunk", claim.upload, claim.lease, { seq });
      if (c === null) return null;
      if (c.missing || typeof c.data !== "string") return "UNREADABLE";
      parts.push(Buffer.from(c.data, "base64"));
    }
    const data = Buffer.concat(parts);
    // The joined copy is all that is kept.
    parts.length = 0;
    if (claim.kind === "image") {
      const mime = IMAGE_MIMES.find((m) => m === claim.mime);
      return mime ? { kind: "image", mime, data } : "UNREADABLE";
    }
    if (claim.kind === "pdf") return { kind: "pdf", data };
    if (claim.kind === "sheet")
      return { kind: "sheet", data, name: claim.name };
    return { kind: "text", text: data.toString("utf8") };
  }

  // Rows and facts in the shapes the staging store keeps, checked with the
  // same rules setup_read enforces. A row or fact that fails them is counted
  // as dropped (rows) or left out (facts), not sent.
  private payload(upload: string, result: Ok, fields: ReaderField[]) {
    let dropped = result.dropped;
    const rows = [];
    for (const r of result.rows) {
      const parsed = setupCataloguePayload.safeParse({
        uploadId: upload,
        item: clean(r.item),
        variant: clean(r.variant),
        priceSen: r.priceSen,
        unit: clean(r.unit),
        notes: clean(r.notes),
      });
      if (!parsed.success) {
        dropped += 1;
        continue;
      }
      const { item, variant, priceSen, unit, notes } = parsed.data;
      rows.push({
        item,
        variant,
        priceSen,
        unit,
        notes,
        needsCheck: r.needsCheck,
        checkReason: r.needsCheck ? clean(r.checkReason, 500) : "",
      });
    }
    // The worker is the gate for "this field belongs to this pack": only the
    // fields offered to the reader (readerFields) are accepted.
    const titles = new Map(
      fields.map((f) => [`${f.packId}\u0000${f.fieldKey}`, f.title]),
    );
    const facts = [];
    for (const f of result.facts) {
      const title = titles.get(`${f.packId}\u0000${f.fieldKey}`);
      if (!title) continue;
      // The interview's own value rule (2,000 code points, 4,000 bytes,
      // trimmed), then the parse applySetup runs.
      const parsed = setupFactPayload.safeParse({
        value: clean(f.value),
        title,
        language: "mixed",
        uploadId: upload,
      });
      if (!parsed.success || !parsed.data.value) continue;
      const value = parsed.data.value;
      const applies = factInput.safeParse({
        expectedAgentRevision: 1,
        packId: f.packId,
        fieldKey: f.fieldKey,
        title,
        value,
        language: "mixed",
      }).success;
      if (!applies) continue;
      facts.push({
        packId: f.packId,
        fieldKey: f.fieldKey,
        title,
        value,
        needsCheck: f.needsCheck,
        checkReason: f.needsCheck ? clean(f.checkReason, 500) : "",
      });
    }
    return { rows, facts, dropped: Math.min(dropped, 9999) };
  }

  // Stops a read in progress (its lease goes back with the attempt
  // returned), ends the loop, waits for the current tick, then closes the
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
