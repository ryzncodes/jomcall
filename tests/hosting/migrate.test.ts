import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { planRelease, confirmed } from "../../scripts/hosted/migrate.ts";

const hex = "cd".repeat(32);
const env = {
  HOSTED_TARGET: "staging",
  JOMCALL_DATABASE_HOSTS: "db.staging.example.test",
  HOSTED_ADMIN_DATABASE_URL:
    "postgresql://postgres:ADMINSECRET@db.staging.example.test:5432/postgres",
  HOSTED_APP_PASSWORD: hex,
  HOSTED_WORKER_PASSWORD: hex,
  HOSTED_QUEUE_PASSWORD: hex,
  HOSTED_AGENT_PASSWORD: hex,
};

test("the runner needs an explicit target that matches the env file", () => {
  assert.throws(() => planRelease([], env), /TARGET_REQUIRED/);
  assert.throws(() => planRelease(["--target"], env), /TARGET_REQUIRED/);
  assert.throws(
    () => planRelease(["--target", "production"], env),
    /TARGET_REQUIRED/,
  );
  assert.throws(
    () => planRelease(["--target", "prod"], env),
    /TARGET_MISMATCH: HOSTED_TARGET/,
  );
  const plan = planRelease(["--target", "staging"], env);
  assert.equal(plan.phrase, "staging db.staging.example.test");
  assert.deepEqual(plan.connection.ssl, { rejectUnauthorized: true });
});

test("the runner refuses loopback, unlisted hosts, plain connections and bad passwords", () => {
  const go = (extra: Record<string, string>) =>
    planRelease(["--target", "staging"], { ...env, ...extra });
  assert.throws(
    () =>
      go({
        HOSTED_ADMIN_DATABASE_URL:
          "postgresql://postgres:x@127.0.0.1:54622/postgres",
        JOMCALL_DATABASE_HOSTS: "127.0.0.1",
      }),
    /RELEASE_NOT_READY: HOSTED_ADMIN_DATABASE_URL=HOSTED_LOOPBACK_REFUSED/,
  );
  assert.throws(
    () =>
      go({
        HOSTED_ADMIN_DATABASE_URL:
          "postgresql://postgres:x@db.prod.example.test:5432/postgres",
      }),
    /HOSTED_DATABASE_HOST_MISMATCH/,
  );
  assert.throws(
    () =>
      go({
        HOSTED_ADMIN_DATABASE_URL:
          env.HOSTED_ADMIN_DATABASE_URL + "?sslmode=disable",
      }),
    /HOSTED_DATABASE_TLS_REQUIRED/,
  );
  assert.throws(
    () => go({ HOSTED_APP_PASSWORD: "short" }),
    /HOSTED_APP_PASSWORD=INVALID_SECRET/,
  );
  try {
    go({
      HOSTED_ADMIN_DATABASE_URL:
        "postgresql://postgres:ADMINSECRET@other.example.test/postgres",
    });
  } catch (error) {
    assert.doesNotMatch(String(error), /ADMINSECRET/);
  }
});

test("the confirmation must be typed exactly", () => {
  const plan = planRelease(["--target", "staging"], env);
  assert.equal(confirmed("staging db.staging.example.test\n", plan), true);
  for (const typed of [
    "",
    "yes",
    "staging",
    "prod db.staging.example.test",
    "staging db.prod.example.test",
  ])
    assert.equal(confirmed(typed, plan), false, typed);
});

test("without a terminal the runner stops before touching anything", () => {
  let stderr = "";
  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/hosted/migrate.ts", "--target", "staging"],
      {
        env: { PATH: process.env.PATH, ...env },
        stdio: ["pipe", "pipe", "pipe"],
        input: "staging db.staging.example.test\n",
        encoding: "utf8",
      },
    );
    assert.fail("ran without a terminal");
  } catch (error) {
    stderr = (error as { stderr: string }).stderr;
  }
  assert.match(stderr, /CONFIRMATION_NEEDS_TERMINAL/);
  assert.doesNotMatch(stderr, /ADMINSECRET/);
});
