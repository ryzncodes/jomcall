import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readiness,
  SETTINGS,
  SERVICES,
} from "../../packages/contracts/src/hosted-env.ts";

const EXAMPLE = readFileSync("infra/hosted/.env.hosted.example", "utf8");
const exampleNames = EXAMPLE.split("\n")
  .filter((l) => /^[A-Z0-9_]+=/.test(l))
  .map((l) => l.split("=")[0]);

test("the example lists exactly the catalogued settings, once each", () => {
  assert.deepEqual(
    [...exampleNames].sort(),
    SETTINGS.map((s) => s.name).sort(),
  );
  assert.equal(new Set(exampleNames).size, exampleNames.length);
});

test("the example carries no values", () => {
  for (const line of EXAMPLE.split("\n"))
    if (!line.startsWith("#") && line.trim())
      assert.match(line, /^[A-Z0-9_]+=$/, line);
});

test("every service's settings are checked by readiness", () => {
  for (const service of SERVICES) {
    const findings = readiness(service, {}).map((f) => f.name);
    for (const s of SETTINGS)
      if (s.services.includes(service) && s.required === undefined)
        assert.ok(
          findings.includes(s.name),
          `${service} does not check ${s.name}`,
        );
  }
});

const SECRET = "SUPERSECRETVALUE";
const hex = "ab".repeat(32);
const good = {
  JOMCALL_MODE: "hosted",
  JOMCALL_QUEUE_NAMESPACE: "staging",
  JOMCALL_DATABASE_HOSTS: "db.example.test",
  APP_ORIGIN: "https://app.example.test",
  SUPABASE_URL: "https://ref.example.test",
  SUPABASE_ANON_KEY: SECRET,
  APP_DATABASE_URL: `postgresql://jomcall_app:${SECRET}@db.example.test:6543/postgres`,
  CSRF_SECRET: SECRET.repeat(3),
  INVITATION_KEY: hex,
  JOMCALL_MODEL_PROVIDER: "disabled",
  JOMCALL_VOICE_PROVIDER: "hosted",
  LIVEKIT_URL: "wss://livekit.example.test",
  LIVEKIT_API_KEY: "APIkey",
  LIVEKIT_API_SECRET: SECRET,
  JOMCALL_VOICE_SERVICE_SECRET: SECRET.repeat(3),
};

test("a complete web configuration is ready", () => {
  assert.deepEqual(readiness("web", good), []);
});

test("wrong values are named by variable and code, never echoed", () => {
  const bad = {
    ...good,
    JOMCALL_MODE: "local",
    APP_ORIGIN: `http://${SECRET}.example.test`,
    APP_DATABASE_URL: `postgresql://u:${SECRET}@127.0.0.1:54622/postgres`,
    LIVEKIT_URL: `ws://${SECRET}.example.test`,
    CSRF_SECRET: "short",
    INVITATION_KEY: SECRET,
    JOMCALL_QUEUE_NAMESPACE: "local",
  };
  const findings = readiness("web", bad);
  const text = JSON.stringify(findings);
  assert.doesNotMatch(text, new RegExp(SECRET));
  const byName = Object.fromEntries(findings.map((f) => [f.name, f.code]));
  assert.equal(byName.JOMCALL_MODE, "HOSTED_MODE_REQUIRED");
  assert.equal(byName.APP_ORIGIN, "HTTPS_REQUIRED");
  assert.equal(byName.APP_DATABASE_URL, "HOSTED_LOOPBACK_REFUSED");
  assert.equal(byName.LIVEKIT_URL, "WSS_REQUIRED");
  assert.equal(byName.CSRF_SECRET, "SECRET_TOO_SHORT");
  assert.equal(byName.INVITATION_KEY, "INVALID_SECRET");
  assert.equal(byName.JOMCALL_QUEUE_NAMESPACE, "INVALID_QUEUE_NAMESPACE");
});

test("conditional keys are required only when their feature is on", () => {
  const agent = {
    JOMCALL_MODE: "hosted",
    JOMCALL_QUEUE_NAMESPACE: "prod",
    JOMCALL_DATABASE_HOSTS: "db.example.test",
    AGENT_DATABASE_URL: "postgresql://a:b@db.example.test:5432/postgres",
    QUEUE_DATABASE_URL: "postgresql://a:b@db.example.test:5432/postgres",
    JOMCALL_MODEL_PROVIDER: "disabled",
    JOMCALL_VOICE_PROVIDER: "disabled",
  };
  // Voice off: no voice secret, bind address or model key needed.
  assert.deepEqual(readiness("agent", agent), []);
  const names = readiness("agent", {
    ...agent,
    JOMCALL_VOICE_PROVIDER: "hosted",
    JOMCALL_MODEL_PROVIDER: "openrouter",
  }).map((f) => f.name);
  for (const n of [
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "JOMCALL_VOICE_BIND",
    "JOMCALL_VOICE_SERVICE_SECRET",
  ])
    assert.ok(names.includes(n), n);
});

test("the readiness command prints names only and exits 1 when not ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "jomcall-ready-"));
  const file = join(dir, "web.env");
  writeFileSync(
    file,
    `APP_ORIGIN=http://${SECRET}.example.test\nSUPABASE_ANON_KEY=${SECRET}\n`,
  );
  let out = "";
  let code = 0;
  try {
    out = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/hosted/readiness.ts",
        "--service",
        "web",
        "--env-file",
        file,
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
  } catch (error) {
    code = (error as { status: number }).status;
    out = (error as { stdout: string }).stdout;
  }
  assert.equal(code, 1);
  assert.match(out, /web: not ready/);
  assert.match(out, /APP_ORIGIN: HTTPS_REQUIRED/);
  assert.match(out, /CSRF_SECRET: MISSING/);
  assert.doesNotMatch(out, new RegExp(SECRET));
});

test("the voice worker always needs its service secret", () => {
  const names = readiness("voice", { JOMCALL_MODE: "hosted" }).map(
    (f) => f.name,
  );
  assert.ok(names.includes("JOMCALL_VOICE_SERVICE_SECRET"));
});
