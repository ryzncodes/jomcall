// Reading check for guided setup's document reader: npm run check:setup-reader.
//
// Reads the synthetic documents in tests/fixtures/setup-reader/ the way the
// worker does (readDocumentChecked, and the worker's fallback rule) and
// scores the rows against truth.json. Without --paid it refuses; --dry builds
// every request locally and sends nothing. With --paid it calls the Anthropic
// API (api.anthropic.com), which costs money: twice per photo or PDF (two
// reads, compared), once per delimited or pasted text, plus one fallback read
// of a text when the worker's fallback rule applies.
//
// The console shows counts only, never document text or model output; the
// rows read go to the JSON result file (default under output/setup-reader/,
// which git ignores).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  READER_DISAGREE_PREFIX,
  READER_LIMITS,
  READER_ONE_READ_ROW,
  isDoubleRead,
  readDocument,
  readDocumentChecked,
  readerFallbackModel,
  readerModel,
  type AnthropicLike,
  type ReaderField,
  type ReaderInput,
  type ReaderModel,
  type ReadResult,
} from "../../packages/inference/src/setup-reader.ts";
import { sharedAnthropicClient } from "../../packages/inference/src/anthropic-voice.ts";
import { packById } from "../../packages/domain/src/packs/index.ts";
// The worker module loads the pg library at import but builds no pool and
// opens no connection until SetupReadWorker.create, which is never called here.
import {
  FALLBACK_KINDS,
  FALLBACK_MIN_ROWS,
  FALLBACK_SHARE,
  READ_TIMEOUT_MS,
  better,
  readerFields,
  wantsFallback,
} from "../../engine/src/agent/setup-reader.ts";
import {
  failures,
  formatTable,
  injectionSignals,
  personalHits,
  scoreRows,
  totals,
  truthRow,
  type DocResult,
} from "./reader-score.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
export const FIXTURES = join(root, "tests", "fixtures", "setup-reader");

// The worker's fallback rule and timeout are imported from it: a delimited or
// pasted text whose read is flagged on more than FALLBACK_SHARE of at least
// FALLBACK_MIN_ROWS rows is read again with the fallback model, and better()
// picks the result (wantsFallback). Photos and PDFs get no fallback.
// What the browser's shrinking produces at most for a photo.
const BROWSER_IMAGE_BYTES = 3_600_000;

export const REFUSE_UNPAID =
  "Refused: this check sends the synthetic documents to the Anthropic API and costs money. Run it with --paid only after the owner approves the spend (or use --dry to send nothing).";
export const REFUSE_NO_KEY =
  "Refused: ANTHROPIC_API_KEY is not set. It is read from .env.hosted by npm run check:setup-reader.";
// Calls counted by this check are reads. The Anthropic SDK also retries a
// request on its own after a 429, a 5xx or a connection error (its default
// is two retries), so the HTTP requests sent, and the spend, can be higher.
export const RETRY_NOTE =
  "Calls counted here are model calls the reader makes (two per photo or PDF read); the Anthropic SDK retries a request itself after a 429, a 5xx or a connection error (default: two retries), so the requests sent can be more.";
export const USAGE =
  "Usage: npm run check:setup-reader -- (--dry | --paid) [--only d01,d05] [--model haiku|sonnet] [--out <file>]";

const document = z
  .object({
    id: z.string().regex(/^d\d{2}$/),
    file: z.string().regex(/^[a-z0-9-]+\.(jpg|pdf|csv|tsv|txt)$/),
    kind: z.enum(["image", "pdf", "sheet", "text"]),
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    mainPack: z.string().min(1),
    source: z.enum(["spike", "new"]),
    about: z.string().min(1),
    rows: z.array(truthRow).min(1),
    factLabels: z.array(z.string()),
    expectFit: z.boolean().default(true),
    injection: z
      .object({
        priceSen: z.number().int().nonnegative(),
        items: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    personal: z
      .object({
        names: z.array(z.string().min(1)).min(1),
        numbers: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    mustNotAppear: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((d) => (d.kind === "image") === (d.mime !== undefined), {
    message: "an image needs a mime, and only an image has one",
  });
export type FixtureDoc = z.infer<typeof document> & { data: Buffer };
const truthFile = z
  .object({ note: z.string(), documents: z.array(document).min(1) })
  .strict();

export function loadFixtures(dir = FIXTURES): FixtureDoc[] {
  const parsed = truthFile.parse(
    JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")),
  );
  const ids = new Set<string>();
  return parsed.documents.map((d) => {
    if (ids.has(d.id)) throw Error(`duplicate document id ${d.id}`);
    ids.add(d.id);
    return { ...d, data: readFileSync(join(dir, d.file)) };
  });
}

// The input exactly as the worker's input() builds it from the stored bytes.
export function buildInput(doc: FixtureDoc): ReaderInput {
  if (doc.kind === "image")
    return { kind: "image", mime: doc.mime!, data: doc.data };
  if (doc.kind === "pdf") return { kind: "pdf", data: doc.data };
  if (doc.kind === "sheet")
    return { kind: "sheet", data: doc.data, name: doc.file };
  return { kind: "text", text: doc.data.toString("utf8") };
}

// The worker's own field list for a session on the base pack plus this
// document's main pack, with no extra packs and no interview answers yet.
export function fieldsFor(doc: FixtureDoc): ReaderField[] {
  return readerFields({
    mainPack: doc.mainPack,
    extraPacks: [],
    questionIds: [],
  });
}

export type Options = {
  paid: boolean;
  dry: boolean;
  only: string[] | null;
  model: "haiku" | "sonnet" | null;
  out: string | null;
};

export function parseArgs(argv: string[]): Options | { error: string } {
  const o: Options = {
    paid: false,
    dry: false,
    only: null,
    model: null,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      return v === undefined || v.startsWith("--") ? null : v;
    };
    if (a === "--paid") o.paid = true;
    else if (a === "--dry") o.dry = true;
    else if (a === "--only") {
      const v = value();
      if (!v) return { error: "--only needs a list such as d01,d05" };
      o.only = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!o.only.length)
        return { error: "--only needs a list such as d01,d05" };
    } else if (a === "--model") {
      const v = value();
      if (v !== "haiku" && v !== "sonnet")
        return { error: "--model is haiku or sonnet" };
      o.model = v;
    } else if (a === "--out") {
      const v = value();
      if (!v) return { error: "--out needs a file name" };
      o.out = v;
    } else return { error: `unknown option ${a}` };
  }
  return o;
}

type Print = (line: string) => void;
export type Deps = {
  env: Record<string, string | undefined>;
  print: Print;
  // Called only on the paid path, after both refusals.
  makeClient: () => AnthropicLike;
  // Stands in for readDocumentChecked (same shape as readDocument).
  read?: typeof readDocument;
  fixtures?: string;
  now?: () => number;
};

// --dry: every input built and passed through readDocumentChecked with a
// local client that records each request and answers with no rows (a photo
// or PDF makes two). Nothing leaves this machine.
async function dryRun(docs: FixtureDoc[], print: Print): Promise<number> {
  let bad = 0;
  print("Dry run: nothing is sent. Per document, what --paid would send:");
  print(
    [
      "doc".padEnd(4),
      "kind".padEnd(6),
      "file".padEnd(32),
      "bytes".padStart(7),
      "sent-as".padStart(8),
      "request".padStart(8),
      "calls".padStart(5),
      "truth".padStart(6),
      "fields".padStart(7),
      "pack".padEnd(15),
      "check",
    ].join(" "),
  );
  for (const doc of docs) {
    const problems: string[] = [];
    if (!packById(doc.mainPack)) problems.push(`unknown pack ${doc.mainPack}`);
    const input = buildInput(doc);
    const fields = fieldsFor(doc);
    if (doc.kind === "image") {
      if (doc.data.length > BROWSER_IMAGE_BYTES)
        problems.push("larger than the browser's shrunk photo");
      if (
        Buffer.byteLength(doc.data.toString("base64")) >
        READER_LIMITS.imageBase64Bytes
      )
        problems.push("over the reader's image limit");
    }
    if (doc.kind === "pdf" && doc.data.toString("latin1", 0, 5) !== "%PDF-")
      problems.push("not a PDF");
    let requestBytes = 0;
    let sentAs = "";
    let calls = 0;
    const local: AnthropicLike = {
      messages: {
        async create(body) {
          calls += 1;
          requestBytes = Buffer.byteLength(JSON.stringify(body));
          const content = body.messages[0]?.content;
          sentAs = Array.isArray(content) ? (content[0]?.type ?? "") : "text";
          return {
            id: "msg_dry",
            type: "message",
            role: "assistant",
            model: body.model,
            content: [
              { type: "text", text: '{"rows":[],"facts":[]}', citations: null },
            ],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          } as unknown as Awaited<
            ReturnType<AnthropicLike["messages"]["create"]>
          >;
        },
      },
    };
    const result = await readDocumentChecked(input, fields, { client: local });
    if (!result.ok) problems.push(`reader refused it: ${result.code}`);
    if (problems.length) bad += 1;
    print(
      [
        doc.id.padEnd(4),
        doc.kind.padEnd(6),
        doc.file.padEnd(32),
        String(doc.data.length).padStart(7),
        sentAs.padStart(8),
        String(requestBytes).padStart(8),
        String(calls).padStart(5),
        String(doc.rows.length).padStart(6),
        String(fields.length).padStart(7),
        doc.mainPack.padEnd(15),
        problems.length ? `PROBLEM: ${problems.join("; ")}` : "ok",
      ].join(" "),
    );
  }
  const rows = docs.reduce((a, d) => a + d.rows.length, 0);
  const optional = docs.reduce(
    (a, d) => a + d.rows.filter((r) => r.optional).length,
    0,
  );
  print(
    `${docs.length} documents, ${rows} truth rows (${optional} optional). ${bad ? `${bad} with problems.` : "All inputs accepted by the reader."}`,
  );
  return bad ? 1 : 0;
}

type ReadRecord = {
  model: ReaderModel;
  // Model calls this read made (two for a photo or PDF).
  calls: number;
  seconds: number;
  code: string | null;
  rows: number;
  flaggedShare: number;
  dropped: number;
  facts: number;
};

async function paidRun(
  docs: FixtureDoc[],
  opts: Options,
  deps: Deps,
): Promise<number> {
  const read = deps.read ?? readDocumentChecked;
  const now = deps.now ?? (() => performance.now());
  const client = deps.makeClient();
  const first: ReaderModel =
    opts.model === "sonnet" ? readerFallbackModel : readerModel;
  const fallbackOn = opts.model === null;
  const startedAt = new Date().toISOString();
  const results: DocResult[] = [];
  const details: unknown[] = [];

  const once = async (
    input: ReaderInput,
    fields: ReaderField[],
    model: ReaderModel,
  ): Promise<{ result: ReadResult; record: ReadRecord }> => {
    const start = now();
    let result: ReadResult;
    try {
      result = await read(input, fields, {
        client,
        model,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch {
      result = { ok: false, code: "FAILED" };
    }
    const seconds = (now() - start) / 1000;
    return {
      result,
      record: {
        model,
        calls: isDoubleRead(input) ? 2 : 1,
        seconds,
        code: result.ok ? null : result.code,
        rows: result.ok ? result.rows.length : 0,
        flaggedShare: result.ok ? result.flaggedShare : 0,
        dropped: result.ok ? result.dropped : 0,
        facts: result.ok ? result.facts.length : 0,
      },
    };
  };

  for (const doc of docs) {
    const input = buildInput(doc);
    const fields = fieldsFor(doc);
    const reads: ReadRecord[] = [];
    const a = await once(input, fields, first);
    reads.push(a.record);
    let kept = a.result;
    let fallback: DocResult["fallback"] = "none";
    if (fallbackOn && wantsFallback(input, a.result)) {
      const b = await once(input, fields, readerFallbackModel);
      reads.push(b.record);
      kept = better(a.result, b.result);
      fallback = kept === a.result ? "kept-first" : "used-second";
    }
    const seconds = reads.reduce((s, r) => s + r.seconds, 0);
    const calls = reads.reduce((s, r) => s + r.calls, 0);
    const rows = kept.ok ? kept.rows : [];
    const facts = kept.ok ? kept.facts : [];
    const score = scoreRows(doc.rows, rows);
    const result: DocResult = {
      id: doc.id,
      kind: doc.kind,
      model: kept.ok ? kept.model : "",
      fallback,
      code: kept.ok ? null : kept.code,
      expectFit: doc.expectFit,
      fields: fields.length,
      truthRows: score.truthRows,
      rowsRead: score.rowsRead,
      matched: score.matched,
      matchedByTokens: score.matchedByTokens,
      missed: score.missed,
      duplicates: score.duplicates,
      duplicateSamePrice: score.duplicateSamePrice,
      extra: score.extra,
      extraUnflaggedPriced: score.extraUnflaggedPriced,
      wrongUnflagged: score.wrongUnflagged,
      wrongFlagged: score.wrongFlagged,
      correctFlagged: score.correctFlagged,
      nullPrice: score.nullPrice,
      unsureUnflagged: score.unsureUnflagged,
      dropped: kept.ok ? kept.dropped : 0,
      disagree: rows.filter(
        (r) => r.needsCheck && r.checkReason.startsWith(READER_DISAGREE_PREFIX),
      ).length,
      oneRead: rows.filter(
        (r) => r.needsCheck && r.checkReason === READER_ONE_READ_ROW,
      ).length,
      facts: facts.length,
      flaggedRows: score.flaggedRows,
      flaggedShare: kept.ok ? kept.flaggedShare : 0,
      calls,
      seconds,
      injection:
        doc.injection && kept.ok
          ? injectionSignals(doc.rows, rows, facts, score, doc.injection)
          : null,
      personal: doc.personal
        ? personalHits(rows, facts, doc.personal, doc.mustNotAppear)
        : null,
    };
    results.push(result);
    const repeated = new Set(score.repeats.map((p) => p.read));
    const matched = new Set(score.pairs.map((p) => p.read));
    const found = new Set(score.pairs.map((p) => p.truth));
    details.push({
      id: doc.id,
      file: doc.file,
      kind: doc.kind,
      mainPack: doc.mainPack,
      fields: fields.length,
      model: result.model,
      fallbackRan: fallback !== "none",
      fallback,
      reads,
      result,
      failures: failures(result),
      pairs: score.pairs.map((p) => ({
        ...p,
        truthRow: doc.rows[p.truth],
        readRow: rows[p.read],
      })),
      wrong: score.wrong.map((w) => ({
        flagged: w.flagged,
        duplicate: w.duplicate,
        truthRow: doc.rows[w.truth],
        readRow: rows[w.read],
      })),
      missed: doc.rows.filter((r, i) => !found.has(i) && !r.optional),
      duplicates: score.repeats.map((p) => ({
        truthRow: doc.rows[p.truth],
        readRow: rows[p.read],
      })),
      extra: rows.filter((_, i) => !matched.has(i) && !repeated.has(i)),
      facts,
    });
    deps.print(
      `${doc.id} read in ${seconds.toFixed(1)} s (${calls} model call${calls > 1 ? "s" : ""})`,
    );
  }

  deps.print("");
  deps.print(formatTable(results));
  const failing = results.filter((r) => failures(r).length > 0);
  deps.print("");
  for (const r of failing)
    deps.print(`FAIL ${r.id}: ${failures(r).join("; ")}`);
  const code = failing.length ? 1 : 0;
  const sum = totals(results);
  deps.print(
    failing.length
      ? `${failing.length} document(s) failed the check.`
      : "No unflagged wrong or unsure price, no instruction obeyed, no failed read, unmatched priced rows within the allowance.",
  );
  if (results.some((r) => r.personal !== null))
    deps.print(
      `Personal data carried over (reported, not failed on): ${sum.personal} row(s) or fact(s) in ${results
        .filter((r) => r.personal !== null)
        .map((r) => `${r.id} ${r.personal}`)
        .join(", ")}.`,
    );
  deps.print(
    `${sum.calls} model call(s) in all; ${sum.disagree} row(s) flagged because two reads gave different prices, ${sum.oneRead} found by only one read.`,
  );
  deps.print(
    `Fallback read ran on ${sum.fallbackRan} of ${results.length} document(s); field lists of ${[...new Set(results.map((r) => r.fields))].sort((x, y) => x - y).join(", ")} fields.`,
  );
  deps.print(RETRY_NOTE);

  const out = opts.out
    ? resolve(opts.out)
    : join(
        root,
        "output",
        "setup-reader",
        `check-${startedAt.replace(/[:.]/g, "-")}.json`,
      );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        firstModel: first,
        fallbackModel: fallbackOn ? readerFallbackModel : null,
        forcedModel: opts.model,
        fallbackRule: {
          share: FALLBACK_SHARE,
          minRows: FALLBACK_MIN_ROWS,
          kinds: FALLBACK_KINDS,
          timeoutMs: READ_TIMEOUT_MS,
        },
        retries: RETRY_NOTE,
        exitCode: code,
        personalCarriedOver: sum.personal,
        totals: sum,
        documents: details,
      },
      null,
      1,
    ) + "\n",
  );
  deps.print(`Details (rows read, matches, misses) written to ${out}`);
  return code;
}

export async function run(argv: string[], deps: Deps): Promise<number> {
  const opts = parseArgs(argv);
  if ("error" in opts) {
    deps.print(`${opts.error}\n${USAGE}`);
    return 2;
  }
  let docs: FixtureDoc[];
  try {
    docs = loadFixtures(deps.fixtures);
  } catch (error) {
    deps.print(
      `The fixtures in tests/fixtures/setup-reader/ could not be loaded: ${error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (error as Error).message}`,
    );
    return 1;
  }
  if (opts.only) {
    const unknown = opts.only.filter((id) => !docs.some((d) => d.id === id));
    if (unknown.length) {
      deps.print(`Unknown document id(s): ${unknown.join(", ")}\n${USAGE}`);
      return 2;
    }
    docs = docs.filter((d) => opts.only!.includes(d.id));
  }
  // --dry wins over --paid: nothing is sent.
  if (opts.dry) return dryRun(docs, deps.print);
  if (!opts.paid) {
    deps.print(REFUSE_UNPAID);
    return 2;
  }
  if (!deps.env.ANTHROPIC_API_KEY?.trim()) {
    deps.print(REFUSE_NO_KEY);
    return 2;
  }
  return paidRun(docs, opts, deps);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await run(process.argv.slice(2), {
    env: process.env,
    print: (line) => console.log(line),
    makeClient: sharedAnthropicClient,
  });
}
