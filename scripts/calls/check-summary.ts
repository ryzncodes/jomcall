// Paid check for AI call summaries: npm run check:call-summary.
//
// Runs the 16 made-up calls in summary-cases.json through writeSummary, the
// way the summary worker does. Without a flag it refuses; --dry builds every
// request locally and sends nothing (no network). With --paid it calls the
// Anthropic API (api.anthropic.com) once per case, which costs money, and
// writes every output to output/call-summary/<timestamp>.json (git ignores
// output/). A case fails on a guard or model error, on a reason with none of
// its keywords, or when any of the six fields repeats one of its forbidden
// details (named in the output file as FORBIDDEN:<detail>). The console shows
// ids, counts and error codes only, never turn text, summary text or a
// forbidden detail.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  summaryModel,
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
  // Details the caller gave (name parts, street and estate names, email
  // local parts and the like) that no summary field may repeat.
  forbidden: string[];
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

const FIELD_KEYS = ["reason_en", "reason_ms", "outcome_en", "outcome_ms", "next_step_en", "next_step_ms"] as const;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Case-insensitive; a Latin entry must not sit inside a longer word ("Chen"
// is not a hit in "kitchen").
const LATIN = "[\\p{Script=Latin}\\p{N}]";
const forbiddenHit = (text: string, f: string) =>
  new RegExp(`(?<!${LATIN})${escape(f)}(?!${LATIN})`, "iu").test(text);

export function scoreCase(c: SummaryCase, result: Result): { pass: boolean; why: string[] } {
  if ("error" in result) return { pass: false, why: [result.error] };
  const why: string[] = [];
  const texts = FIELD_KEYS.map((k) => result.fields[k]).filter((v): v is string => typeof v === "string");
  for (const f of c.forbidden) if (texts.some((t) => forbiddenHit(t, f))) why.push(`FORBIDDEN:${f}`);
  const has = (text: string, kws: string[]) => {
    const t = text.toLowerCase();
    return kws.some((k) => t.includes(k.toLowerCase()));
  };
  const hit =
    has(result.fields.reason_en, c.reasonKeywords.en) ||
    has(result.fields.reason_ms, c.reasonKeywords.ms);
  if (!hit) why.push("REASON_KEYWORD_MISSING");
  return { pass: why.length === 0, why };
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
  const models = new Set<string>();
  let passed = 0;
  for (const c of cases) {
    const signal = AbortSignal.timeout(CASE_TIMEOUT_MS);
    const result = await writeSummary(client, c.input, { signal });
    if ("model" in result) models.add(result.model);
    const score = scoreCase(c, result);
    if (score.pass) passed++;
    // The console gets codes only; the named detail goes to the output file.
    const codes = [...new Set(score.why.map((w) => w.split(":")[0]))];
    deps.print(`${c.id} ${c.language} ${score.pass ? "pass" : `FAIL ${codes.join(",")}`}`);
    rows.push({ id: c.id, language: c.language, result, pass: score.pass, why: score.why });
  }
  const file = join(OUT_DIR, opts.out ?? `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify({ model: [...models].join(",") || summaryModel, passed, total: cases.length, rows }, null, 2));
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
