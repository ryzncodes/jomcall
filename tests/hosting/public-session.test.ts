// The public pages' session check: it never waits for ever, and while it
// runs (and in the static HTML) the call to action is a real sign-up link.
// react-dom/server is refused under the react-server condition the runner
// uses, and "@/" paths need the web tsconfig, so this runs in a child process.
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

function run(script: string): Record<string, unknown> {
  const stdout = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      TSX_TSCONFIG_PATH: "web/tsconfig.json",
      NEXT_PUBLIC_JOMCALL_MODE: "hosted",
    },
  });
  return JSON.parse(stdout);
}

test("pending session check renders a real sign-up link, with room for the workspace label", () => {
  const out = run(`
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { Cta } from "./web/components/public/cta.tsx";
    const html = renderToStaticMarkup(createElement(Cta, {
      locale: "en", getStarted: "Get started", openWorkspace: "Open your workspace",
    }));
    const ms = renderToStaticMarkup(createElement(Cta, {
      locale: "ms", getStarted: "Mula", openWorkspace: "Buka ruang kerja", block: true,
    }));
    process.stdout.write(JSON.stringify({ html, ms }));
  `) as { html: string; ms: string };
  assert.match(out.html, /<a href="[^"]*\/signup[^"]*"/);
  assert.match(out.html, />Get started</);
  assert.match(out.html, /class="cta-reserve" aria-hidden="true">Open your workspace</);
  assert.doesNotMatch(out.html, /btn-wait|aria-hidden="true">\s*<span/);
  assert.match(out.ms, /<a href="[^"]*\/ms\/signup|<a href="[^"]*signup[^"]*"/);
});

test("session check times out as signed out, with or without a fetch that listens to abort", () => {
  const out = run(`
    import { checkSession } from "./web/components/signed-in.ts";
    const never = () => new Promise(() => {});
    const listens = (_u, init) => new Promise((_r, reject) =>
      init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const t0 = Date.now();
    const a = await checkSession(never, 60);
    const b = await checkSession(listens, 60);
    const ok = await checkSession(async () => ({ ok: true, json: async () => ({ ok: true, data: { email: "a@example.test" } }) }), 60);
    process.stdout.write(JSON.stringify({ a, b, ok, fast: Date.now() - t0 < 1500 }));
  `);
  assert.deepEqual(out, { a: null, b: null, ok: "a@example.test", fast: true });
});

test("the estimator slider reads its value with the unit", () => {
  const out = run(`
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { Estimator } from "./web/components/public/estimator.tsx";
    process.stdout.write(JSON.stringify({
      en: renderToStaticMarkup(createElement(Estimator, { locale: "en" })),
      ms: renderToStaticMarkup(createElement(Estimator, { locale: "ms" })),
    }));
  `) as { en: string; ms: string };
  assert.match(out.en, /aria-valuetext="300 minutes"/);
  assert.match(out.ms, /aria-valuetext="300 minit"/);
});
