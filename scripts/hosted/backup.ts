// Nightly encrypted database backup to Cloudflare R2. Owner's host only; no
// service holds these settings.
//
//   npm run hosted:backup -- --target staging --env-file /secure/backup-staging.env
//   npm run hosted:backup -- --decrypt <file.enc> <out.dump> --target staging --env-file ...
//
// Refuses to run without --target, when --target differs from HOSTED_TARGET,
// unless BACKUP_ENABLED=1, when any backup setting is missing or wrong, against
// a loopback or unlisted host, or without TLS. The dump (pg_dump custom format)
// is encrypted on this machine with AES-256-GCM before it leaves; R2 only ever
// stores ciphertext. Prints names, codes, sizes and the object key only.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import {
  databaseConnection,
  type Env,
} from "../../packages/contracts/src/hosting.ts";
import { readiness } from "../../packages/contracts/src/hosted-env.ts";
import { putObject, type Fetch, type S3Target } from "./s3.ts";

export const TARGETS = ["staging", "prod"] as const;
// Single-PUT ceiling with headroom (R2 allows 5 GiB less 5 MiB per request).
export const MAX_DUMP_BYTES = 4 * 1024 ** 3;

// File layout: MAGIC (8) | IV (12) | ciphertext | GCM tag (16).
// The additional data binds the file to its environment, so a staging dump
// cannot be passed off as production when restoring.
const MAGIC = Buffer.from("JCBACK01");
const aad = (target: string) =>
  Buffer.concat([MAGIC, Buffer.from(`|${target}`)]);

export function encryptBackup(
  plain: Uint8Array,
  keyHex: string,
  target: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  cipher.setAAD(aad(target));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decryptBackup(
  file: Uint8Array,
  keyHex: string,
  target: string,
) {
  const data = Buffer.from(file);
  if (data.length < 36 || !data.subarray(0, 8).equals(MAGIC))
    throw Error("NOT_A_BACKUP");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    data.subarray(8, 20),
  );
  decipher.setAAD(aad(target));
  decipher.setAuthTag(data.subarray(data.length - 16));
  try {
    return Buffer.concat([
      decipher.update(data.subarray(20, data.length - 16)),
      decipher.final(),
    ]);
  } catch {
    throw Error("BACKUP_KEY_OR_TARGET_WRONG");
  }
}

export type BackupPlan = {
  target: (typeof TARGETS)[number];
  host: string;
  key: string;
  objectKey: string;
  s3: S3Target;
  connection: ReturnType<typeof databaseConnection>;
};

export function objectKeyFor(target: string, now: Date) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return `${target}/jomcall-${target}-${stamp}.dump.enc`;
}

export function planBackup(
  args: string[],
  env: Env,
  now = new Date(),
): BackupPlan {
  const i = args.indexOf("--target");
  const target = i >= 0 ? args[i + 1] : undefined;
  if (!target || !(TARGETS as readonly string[]).includes(target))
    throw Error("TARGET_REQUIRED: --target staging|prod");
  if (env.HOSTED_TARGET !== target)
    throw Error("TARGET_MISMATCH: HOSTED_TARGET");
  const findings = readiness("backup", env);
  if (findings.length)
    throw Error(
      "BACKUP_NOT_READY: " +
        findings.map((f) => `${f.name}=${f.code}`).join(", "),
    );
  const connection = databaseConnection(
    env.BACKUP_DATABASE_URL,
    "BACKUP_DATABASE_URL",
    { ...env, JOMCALL_MODE: "hosted" },
  );
  return {
    target: target as BackupPlan["target"],
    host: new URL(connection.connectionString).hostname,
    key: env.BACKUP_ENCRYPTION_KEY!,
    objectKey: objectKeyFor(target, now),
    s3: {
      endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: env.R2_BUCKET!,
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      region: "auto",
    },
    connection,
  };
}

// libpq settings for pg_dump, passed through the environment so the password
// never appears in the process list. TLS is verify-full, as for the services.
export function pgDumpEnv(plan: BackupPlan, caFile?: string): Env {
  const url = new URL(plan.connection.connectionString);
  return {
    PATH: process.env.PATH,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)) || "postgres",
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: caFile ?? "system",
    PGCONNECT_TIMEOUT: "15",
  };
}

type Dump = (env: Env) => Promise<Buffer>;

export const pgDump: Dump = (env) =>
  new Promise((resolve, reject) =>
    execFile(
      "pg_dump",
      ["--format=custom", "--compress=6", "--no-owner", "--no-privileges"],
      {
        env: env as NodeJS.ProcessEnv,
        encoding: "buffer",
        maxBuffer: MAX_DUMP_BYTES,
      },
      (error, stdout) => {
        if (!error) return resolve(stdout);
        reject(
          Error(
            (error as { code?: unknown }).code ===
              "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
              ? "BACKUP_TOO_LARGE"
              : (error as { code?: unknown }).code === "ENOENT"
                ? "PG_DUMP_MISSING"
                : "PG_DUMP_FAILED",
          ),
        );
      },
    ),
  );

export async function runBackup(
  plan: BackupPlan,
  deps: {
    dump?: Dump;
    fetcher?: Fetch;
    now?: Date;
  } = {},
) {
  let caDir: string | undefined;
  try {
    let caFile: string | undefined;
    const ca =
      "ssl" in plan.connection
        ? (plan.connection.ssl as { ca?: string }).ca
        : undefined;
    if (ca) {
      caDir = mkdtempSync(join(tmpdir(), "jomcall-backup-"));
      caFile = join(caDir, "ca.pem");
      writeFileSync(caFile, ca, { mode: 0o600 });
    }
    const plain = await (deps.dump ?? pgDump)(pgDumpEnv(plan, caFile));
    if (!plain.length) throw Error("PG_DUMP_EMPTY");
    if (plain.length > MAX_DUMP_BYTES) throw Error("BACKUP_TOO_LARGE");
    const sealed = encryptBackup(plain, plan.key, plan.target);
    plain.fill(0);
    const { etag } = await putObject(plan.s3, plan.objectKey, sealed, {
      fetcher: deps.fetcher,
      now: deps.now,
    });
    return { objectKey: plan.objectKey, bytes: sealed.length, etag };
  } finally {
    if (caDir) rmSync(caDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const f = args.indexOf("--env-file");
  const env: Env =
    f >= 0 ? parseEnv(readFileSync(args[f + 1], "utf8")) : process.env;
  const d = args.indexOf("--decrypt");
  if (d >= 0) {
    // Restore helper: needs only the target and the key, never R2 or the DB.
    const i = args.indexOf("--target");
    const target = i >= 0 ? args[i + 1] : "";
    if (!(TARGETS as readonly string[]).includes(target))
      throw Error("TARGET_REQUIRED: --target staging|prod");
    if (!/^[a-f0-9]{64}$/.test(env.BACKUP_ENCRYPTION_KEY ?? ""))
      throw Error("INVALID_SECRET: BACKUP_ENCRYPTION_KEY");
    const [input, output] = [args[d + 1], args[d + 2]];
    if (!input || !output) throw Error("DECRYPT_USAGE: --decrypt <in> <out>");
    writeFileSync(
      output,
      decryptBackup(readFileSync(input), env.BACKUP_ENCRYPTION_KEY!, target),
      { mode: 0o600 },
    );
    console.log(
      `Decrypted to ${output}; restore with pg_restore (RUNBOOK.md).`,
    );
    return;
  }
  const plan = planBackup(args, env);
  console.log(`Backing up the ${plan.target} database at ${plan.host}.`);
  const result = await runBackup(plan);
  console.log(
    `Uploaded ${result.objectKey} (${result.bytes} bytes encrypted) to bucket ${plan.s3.bucket}.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    const message = e instanceof Error ? e.message : "";
    console.error(/^[A-Z0-9_]+(:|$)/.test(message) ? message : "BACKUP_FAILED");
    process.exitCode = 1;
  });
