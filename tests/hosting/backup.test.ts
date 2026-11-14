import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import {
  decryptBackup,
  encryptBackup,
  objectKeyFor,
  pgDumpEnv,
  planBackup,
  runBackup,
} from "../../scripts/hosted/backup.ts";
import { signV4 } from "../../scripts/hosted/s3.ts";

const SECRET = "SUPERSECRETVALUE";
const KEY = "ab".repeat(32);
const env = {
  HOSTED_TARGET: "staging",
  BACKUP_ENABLED: "1",
  JOMCALL_DATABASE_HOSTS: "db.example.test",
  BACKUP_DATABASE_URL: `postgresql://postgres:${SECRET}@db.example.test:5432/postgres?sslmode=require`,
  BACKUP_ENCRYPTION_KEY: KEY,
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_BUCKET: "jomcall-backups-staging",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: SECRET + "R2",
};
const args = ["--target", "staging"];

test("SigV4 matches AWS's published GET Object example", () => {
  // From the AWS S3 Signature Version 4 documentation ("Example: GET Object").
  const emptyHash = createHash("sha256").update("").digest("hex");
  const authorization = signV4({
    method: "GET",
    path: "/test.txt",
    headers: {
      host: "examplebucket.s3.amazonaws.com",
      range: "bytes=0-9",
      "x-amz-content-sha256": emptyHash,
      "x-amz-date": "20130524T000000Z",
    },
    payloadHash: emptyHash,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "s3",
    date: "20130524T000000Z",
  });
  assert.equal(
    authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("the backup refuses without an explicit, matching target and complete settings", () => {
  const refuses = (
    a: string[],
    e: Record<string, string | undefined>,
    re: RegExp,
  ) =>
    assert.throws(
      () => planBackup(a, e),
      (err: Error) => re.test(err.message) && !err.message.includes(SECRET),
    );
  refuses([], env, /^TARGET_REQUIRED/);
  refuses(["--target", "dev"], env, /^TARGET_REQUIRED/);
  refuses(["--target", "prod"], env, /^TARGET_MISMATCH: HOSTED_TARGET$/);
  refuses(
    args,
    { ...env, BACKUP_ENABLED: "0" },
    /BACKUP_ENABLED=BACKUP_DISABLED/,
  );
  refuses(
    args,
    { ...env, R2_SECRET_ACCESS_KEY: undefined },
    /R2_SECRET_ACCESS_KEY=MISSING/,
  );
  refuses(args, { ...env, R2_ACCESS_KEY_ID: "" }, /R2_ACCESS_KEY_ID=MISSING/);
  refuses(
    args,
    { ...env, BACKUP_ENCRYPTION_KEY: "short" },
    /BACKUP_ENCRYPTION_KEY=INVALID_SECRET/,
  );
  refuses(
    args,
    { ...env, R2_BUCKET: "Bad_Bucket" },
    /R2_BUCKET=INVALID_BUCKET/,
  );
  refuses(
    args,
    { ...env, CLOUDFLARE_ACCOUNT_ID: "x" },
    /CLOUDFLARE_ACCOUNT_ID=INVALID_ACCOUNT_ID/,
  );
  refuses(
    args,
    {
      ...env,
      BACKUP_DATABASE_URL: `postgresql://postgres:${SECRET}@db.example.test:5432/postgres?sslmode=disable`,
    },
    /BACKUP_DATABASE_URL=HOSTED_DATABASE_TLS_REQUIRED/,
  );
  refuses(
    args,
    {
      ...env,
      BACKUP_DATABASE_URL: `postgresql://postgres:${SECRET}@127.0.0.1:5432/postgres?sslmode=require`,
    },
    /BACKUP_DATABASE_URL=/,
  );
  refuses(
    args,
    {
      ...env,
      BACKUP_DATABASE_URL: `postgresql://postgres:${SECRET}@other.example.test:5432/postgres?sslmode=require`,
    },
    /BACKUP_DATABASE_URL=/,
  );
  const plan = planBackup(args, env, new Date("2026-11-14T18:30:05.123Z"));
  assert.equal(
    plan.objectKey,
    "staging/jomcall-staging-20261114T183005Z.dump.enc",
  );
  assert.equal(
    plan.s3.endpoint,
    "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  );
  assert.equal(plan.s3.region, "auto");
});

test("pg_dump gets the password through the environment, with verify-full TLS", () => {
  const e = pgDumpEnv(planBackup(args, env));
  assert.equal(e.PGPASSWORD, SECRET);
  assert.equal(e.PGHOST, "db.example.test");
  assert.equal(e.PGSSLMODE, "verify-full");
  assert.equal(e.PGSSLROOTCERT, "system");
  assert.equal(
    pgDumpEnv(planBackup(args, env), "/tmp/ca.pem").PGSSLROOTCERT,
    "/tmp/ca.pem",
  );
});

test("encryption round-trips and rejects a wrong key, target or any changed byte", () => {
  const plain = Buffer.from("PGDMP fake dump bytes");
  const sealed = encryptBackup(plain, KEY, "staging");
  assert.ok(!sealed.includes(plain));
  assert.deepEqual(decryptBackup(sealed, KEY, "staging"), plain);
  assert.throws(
    () => decryptBackup(sealed, "cd".repeat(32), "staging"),
    /BACKUP_KEY_OR_TARGET_WRONG/,
  );
  assert.throws(
    () => decryptBackup(sealed, KEY, "prod"),
    /BACKUP_KEY_OR_TARGET_WRONG/,
  );
  const tampered = Buffer.from(sealed);
  tampered[25] ^= 1;
  assert.throws(
    () => decryptBackup(tampered, KEY, "staging"),
    /BACKUP_KEY_OR_TARGET_WRONG/,
  );
  assert.throws(
    () => decryptBackup(Buffer.from("nope"), KEY, "staging"),
    /NOT_A_BACKUP/,
  );
});

// A local stand-in for R2's S3 endpoint: it re-derives the signature from the
// request as received, keeps objects in memory and honours If-None-Match: *.
async function fakeR2() {
  const objects = new Map<string, Buffer>();
  const requests: IncomingMessage[] = [];
  const server = createServer(async (req, res) => {
    requests.push(req);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const auth = req.headers.authorization ?? "";
    const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(";") ?? [];
    const headers = Object.fromEntries(
      signed.map((n) => [n, String(req.headers[n])]),
    );
    const hash = createHash("sha256").update(body).digest("hex");
    const expected = signV4({
      method: req.method!,
      path: req.url!,
      headers,
      payloadHash: hash,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      region: "auto",
      service: "s3",
      date: String(req.headers["x-amz-date"]),
    });
    if (
      auth !== expected ||
      req.headers["x-amz-content-sha256"] !== hash ||
      !signed.includes("host")
    ) {
      res
        .writeHead(403)
        .end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
      return;
    }
    if (req.headers["if-none-match"] === "*" && objects.has(req.url!)) {
      res.writeHead(412).end("<Error><Code>PreconditionFailed</Code></Error>");
      return;
    }
    objects.set(req.url!, body);
    res
      .writeHead(200, {
        etag: '"' + createHash("md5").update(body).digest("hex") + '"',
      })
      .end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { objects, requests, server, endpoint: `http://127.0.0.1:${port}` };
}

test("a backup run uploads only ciphertext to the bucket, create-only", async () => {
  const r2 = await fakeR2();
  try {
    const now = new Date("2026-11-14T18:30:05Z");
    const plan = planBackup(args, env, now);
    plan.s3 = { ...plan.s3, endpoint: r2.endpoint };
    const dump = Buffer.from("PGDMP" + "x".repeat(1000));
    let dumpEnv: Record<string, string | undefined> = {};
    const result = await runBackup(plan, {
      now,
      dump: async (e) => {
        dumpEnv = e;
        return Buffer.from(dump);
      },
    });
    assert.equal(dumpEnv.PGSSLMODE, "verify-full");
    assert.equal(result.objectKey, objectKeyFor("staging", now));
    const stored = r2.objects.get(`/${env.R2_BUCKET}/${result.objectKey}`)!;
    assert.ok(stored);
    assert.ok(!stored.includes(Buffer.from("PGDMP")));
    assert.deepEqual(decryptBackup(stored, KEY, "staging"), dump);
    assert.equal(r2.requests[0].headers["if-none-match"], "*");
    // The same key again is refused by the bucket, never overwritten.
    await assert.rejects(
      runBackup(plan, { now, dump: async () => Buffer.from(dump) }),
      /^Error: UPLOAD_FAILED_412_PreconditionFailed$/,
    );
    // A wrong secret is refused and reported by code only.
    plan.s3 = { ...plan.s3, secretAccessKey: "wrong" };
    plan.objectKey = objectKeyFor("staging", new Date("2026-11-15T00:00:00Z"));
    await assert.rejects(
      runBackup(plan, { now, dump: async () => Buffer.from(dump) }),
      /^Error: UPLOAD_FAILED_403_SignatureDoesNotMatch$/,
    );
  } finally {
    r2.server.close();
  }
});

test("an empty dump or a failed dump uploads nothing", async () => {
  const r2 = await fakeR2();
  try {
    const plan = planBackup(args, env);
    plan.s3 = { ...plan.s3, endpoint: r2.endpoint };
    await assert.rejects(
      runBackup(plan, { dump: async () => Buffer.alloc(0) }),
      /PG_DUMP_EMPTY/,
    );
    await assert.rejects(
      runBackup(plan, {
        dump: async () => Promise.reject(Error("PG_DUMP_FAILED")),
      }),
      /PG_DUMP_FAILED/,
    );
    assert.equal(r2.requests.length, 0);
  } finally {
    r2.server.close();
  }
});
