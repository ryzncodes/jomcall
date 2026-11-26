// Paid check for AI call summaries: npm run check:call-summary.
//
// Runs the 16 made-up calls in summary-cases.json through writeSummary, the
// way the summary worker does. Without a flag it refuses; --dry builds every
// request locally and sends nothing (no network). With --paid it calls the
// Anthropic API (api.anthropic.com) once per case, which costs money, and
// writes every output to output/call-summary/<timestamp>.json (git ignores
// output/). The console shows ids, counts and error codes only, never turn
// text or summary text.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  summaryRequest,
  writeSummary,
  type SummaryInput,
} from "../../packages/inference/src/call-summary.ts";
import { sharedAnthropicClient } from "../../packages/inference/src/anthropic-voice.ts";
import type { AnthropicLike } from "../../packages/inference/src/setup-reader.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT_DIR = join(ROOT, "output", "call-summary");
const CASE_TIMEOUT_MS = 20_000;

export type SummaryCase = {
  id: string;
  language: "ms" | "en" | "manglish" | "zh";
  input: SummaryInput;
  reasonKeywords: { en: string[]; ms: string[] };
};
type Result = Awaited<ReturnType<typeof writeSummary>>;
type Options = { paid: boolean; dry: boolean; only?: string[]; out?: string };

const USAGE =
  "Usage: npm run check:call-summary -- --dry | --paid [--only c01,c05] [--out name.json]";
const REFUSE_UNPAID = `This check calls the Anthropic API once per case and costs money. Nothing was sent.\nRun with --dry to build the requests without sending, or --paid to spend.\n${USAGE}`;
const REFUSE_NO_KEY = "ANTHROPIC_API_KEY is not set. Nothing was sent.";

export function loadCases(file = join(HERE, "summary-cases.json")): SummaryCase[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { cases: SummaryCase[] };
  const ids = new Set<string>();
  for (const c of parsed.cases) {
    if (ids.has(c.id)) throw Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return parsed.cases;
}

export function parseArgs(argv: string[]): Options | { error: string } {
  const o: Options = { paid: false, dry: false };
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
      const list = v?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      if (!list.length) return { error: "--only needs a list such as c01,c05" };
      o.only = list;
    } else if (a === "--out") {
      const v = value();
      if (!v) return { error: "--out needs a file name" };
      o.out = basename(v);
    } else return { error: `unknown option ${a}` };
  }
  if (!o.paid && !o.dry)
    return { error: `This check costs money when run with --paid. Pass --dry or --paid.\n${USAGE}` };
  return o;
}

export function scoreCase(c: SummaryCase, result: Result): { pass: boolean; why: string[] } {
  if ("error" in result) return { pass: false, why: [result.error] };
  const has = (text: string, kws: string[]) => {
    const t = text.toLowerCase();
    return kws.some((k) => t.includes(k.toLowerCase()));
  };
  const hit =
    has(result.fields.reason_en, c.reasonKeywords.en) ||
    has(result.fields.reason_ms, c.reasonKeywords.ms);
  return hit ? { pass: true, why: [] } : { pass: false, why: ["REASON_KEYWORD_MISSING"] };
}

type Deps = {
  env: Record<string, string | undefined>;
  print: (line: string) => void;
  makeClient: () => AnthropicLike;
  cases?: SummaryCase[];
};

export async function run(argv: string[], deps: Deps): Promise<number> {
  const opts = parseArgs(argv);
  if ("error" in opts) {
    deps.print(opts.error);
    return 2;
  }
  let cases = deps.cases ?? loadCases();
  if (opts.only) {
    const unknown = opts.only.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length) {
      deps.print(`Unknown case id(s): ${unknown.join(", ")}\n${USAGE}`);
      return 2;
    }
    cases = cases.filter((c) => opts.only!.includes(c.id));
  }
  if (opts.dry) {
    // --dry wins over --paid: nothing is sent.
    for (const c of cases) {
      const req = summaryRequest(c.input);
      deps.print(`${c.id} ${c.language} turns=${c.input.turns.length} request_chars=${JSON.stringify(req).length}`);
    }
    deps.print(`dry run: ${cases.length} requests built, none sent`);
    return 0;
  }
  if (!deps.env.ANTHROPIC_API_KEY?.trim()) {
    deps.print(REFUSE_NO_KEY);
    return 2;
  }
  const client = deps.makeClient();
  const rows: unknown[] = [];
  let passed = 0;
  for (const c of cases) {
    const signal = AbortSignal.timeout(CASE_TIMEOUT_MS);
    const result = await writeSummary(client, c.input, { signal });
    const score = scoreCase(c, result);
    if (score.pass) passed++;
    deps.print(`${c.id} ${c.language} ${score.pass ? "pass" : `FAIL ${score.why.join(",")}`}`);
    rows.push({ id: c.id, language: c.language, result, pass: score.pass, why: score.why });
  }
  const file = join(OUT_DIR, opts.out ?? `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify({ model: "claude-haiku-5-5", passed, total: cases.length, rows }, null, 2));
  deps.print(`${passed} of ${cases.length} passed; outputs in ${file}`);
  return passed === cases.length ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2), {
    env: process.env,
    print: (line) => console.log(line),
    makeClient: sharedAnthropicClient,
  });
}
