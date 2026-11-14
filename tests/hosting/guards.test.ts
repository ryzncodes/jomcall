import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appOrigin,
  cookieNames,
  databaseConnection,
  isLoopbackHost,
  isPrivateAddress,
  liveKitUrlProblem,
  mailSettings,
  parseMode,
  queueNamespace,
  supabaseUrl,
  validNamespace,
  voiceListen,
  workerMode,
} from "../../packages/contracts/src/hosting.ts";
import { parseMode as coreParseMode } from "../../packages/contracts/src/core.ts";

const LOCAL = { JOMCALL_MODE: "local" };
const HOSTED = {
  JOMCALL_MODE: "hosted",
  JOMCALL_DATABASE_HOSTS: "db.example.test, pooler.example.test",
};
const SECRET = "s".repeat(32);

test("three modes parse, unset means mock, anything else is refused", () => {
  for (const parse of [parseMode, coreParseMode]) {
    assert.equal(parse(undefined), "mock");
    assert.equal(parse("mock"), "mock");
    assert.equal(parse("local"), "local");
    assert.equal(parse("hosted"), "hosted");
    for (const bad of ["", "production", "Hosted", "live"])
      assert.throws(() => parse(bad), /INVALID_MODE/);
  }
});

test("workers run only as local or hosted", () => {
  assert.equal(workerMode(LOCAL), "local");
  assert.equal(workerMode(HOSTED), "hosted");
  for (const mode of [undefined, "mock", "prod"])
    assert.throws(() => workerMode({ JOMCALL_MODE: mode }), /LOCAL_ONLY/);
});

test("loopback and private address detection", () => {
  for (const host of [
    "127.0.0.1",
    "127.8.9.1",
    "localhost",
    "app.localhost",
    "[::1]",
    "0.0.0.0",
    "[::]",
  ])
    assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["10.0.0.1", "example.test", "128.0.0.1", "1.2.3.4"])
    assert.equal(isLoopbackHost(host), false, host);
  for (const host of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.9.9",
    "192.168.1.1",
  ])
    assert.equal(isPrivateAddress(host), true, host);
  for (const host of [
    "0.0.0.0",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "8.8.8.8",
    "agent",
    "::1",
    "10.0.0.256",
  ])
    assert.equal(isPrivateAddress(host), false, host);
});

test("local origin stays http on 127.0.0.1 and ignores APP_ORIGIN", () => {
  assert.equal(
    appOrigin({ ...LOCAL, LOCAL_ORIGIN: "http://127.0.0.1:4182" }),
    "http://127.0.0.1:4182",
  );
  for (const origin of [
    undefined,
    "https://127.0.0.1:4182",
    "http://localhost:4182",
    "http://192.168.1.5:4182",
    "https://app.example.test",
  ])
    assert.throws(
      () =>
        appOrigin({
          ...LOCAL,
          LOCAL_ORIGIN: origin,
          APP_ORIGIN: "https://app.example.test",
        }),
      /LOCAL_ORIGIN_REQUIRED/,
    );
  // An unset mode is as strict as local.
  assert.throws(
    () => appOrigin({ APP_ORIGIN: "https://app.example.test" }),
    /LOCAL_ORIGIN_REQUIRED/,
  );
});

test("hosted origin must be https, not loopback, and only an origin", () => {
  assert.equal(
    appOrigin({ ...HOSTED, APP_ORIGIN: "https://app.example.test" }),
    "https://app.example.test",
  );
  assert.equal(
    appOrigin({ ...HOSTED, APP_ORIGIN: "https://app.example.test/" }),
    "https://app.example.test",
  );
  // LOCAL_ORIGIN is never a fallback.
  assert.throws(
    () => appOrigin({ ...HOSTED, LOCAL_ORIGIN: "http://127.0.0.1:4182" }),
    /APP_ORIGIN_REQUIRED: APP_ORIGIN/,
  );
  assert.throws(
    () => appOrigin({ ...HOSTED, APP_ORIGIN: "http://app.example.test" }),
    /HTTPS_REQUIRED: APP_ORIGIN/,
  );
  for (const origin of [
    "https://127.0.0.1",
    "https://localhost:4182",
    "https://[::1]",
  ])
    assert.throws(
      () => appOrigin({ ...HOSTED, APP_ORIGIN: origin }),
      /HOSTED_LOOPBACK_REFUSED: APP_ORIGIN/,
    );
  for (const origin of [
    "https://app.example.test/path",
    "https://app.example.test/?x=1",
    "https://user:pw@app.example.test",
    "not a url",
  ])
    assert.throws(
      () => appOrigin({ ...HOSTED, APP_ORIGIN: origin }),
      /INVALID_URL: APP_ORIGIN/,
    );
});

test("Supabase URL: local http loopback, hosted https non-loopback", () => {
  assert.equal(
    supabaseUrl({ ...LOCAL, SUPABASE_URL: "http://127.0.0.1:54621" }),
    "http://127.0.0.1:54621",
  );
  assert.throws(
    () => supabaseUrl({ ...LOCAL, SUPABASE_URL: "https://ref.example.test" }),
    /LOCAL_ORIGIN_REQUIRED/,
  );
  assert.equal(
    supabaseUrl({ ...HOSTED, SUPABASE_URL: "https://ref.example.test" }),
    "https://ref.example.test",
  );
  assert.throws(() => supabaseUrl(HOSTED), /SUPABASE_URL_REQUIRED/);
  assert.throws(
    () => supabaseUrl({ ...HOSTED, SUPABASE_URL: "http://ref.example.test" }),
    /HTTPS_REQUIRED: SUPABASE_URL/,
  );
  assert.throws(
    () => supabaseUrl({ ...HOSTED, SUPABASE_URL: "https://127.0.0.1:54621" }),
    /HOSTED_LOOPBACK_REFUSED: SUPABASE_URL/,
  );
});

test("local database guard still demands 127.0.0.1:54622", () => {
  const ok = "postgresql://jomcall_app:pw@127.0.0.1:54622/postgres";
  assert.deepEqual(databaseConnection(ok, "APP_DATABASE_URL", LOCAL), {
    connectionString: ok,
  });
  assert.deepEqual(databaseConnection(ok, "APP_DATABASE_URL", {}), {
    connectionString: ok,
  });
  for (const url of [
    undefined,
    "",
    "postgresql://u:p@127.0.0.1:5432/postgres",
    "postgresql://u:p@localhost:54622/postgres",
    "postgresql://u:p@db.example.test:54622/postgres",
    "postgresql://u:p@db.example.test:5432/postgres?sslmode=require",
  ])
    assert.throws(
      // The hosted allow-list never loosens local mode.
      () =>
        databaseConnection(url, "APP_DATABASE_URL", {
          ...LOCAL,
          JOMCALL_DATABASE_HOSTS: "db.example.test",
        }),
      /^Error: LOCAL_DATABASE_REQUIRED$/,
    );
  assert.throws(
    () => databaseConnection("x", "WORKER_DATABASE_URL", LOCAL, "LOCAL_ONLY"),
    /^Error: LOCAL_ONLY$/,
  );
});

test("hosted database guard requires TLS and an expected host", () => {
  const url = "postgresql://jomcall_app:pw@db.example.test:5432/postgres";
  assert.deepEqual(databaseConnection(url, "APP_DATABASE_URL", HOSTED), {
    connectionString: url,
    ssl: { rejectUnauthorized: true },
  });
  // TLS parameters are removed from the URL so they cannot override the setting.
  assert.deepEqual(
    databaseConnection(
      "postgresql://u:pw@pooler.example.test:6543/postgres?sslmode=require&application_name=web",
      "APP_DATABASE_URL",
      HOSTED,
    ),
    {
      connectionString:
        "postgresql://u:pw@pooler.example.test:6543/postgres?application_name=web",
      ssl: { rejectUnauthorized: true },
    },
  );
  assert.throws(
    () => databaseConnection(undefined, "APP_DATABASE_URL", HOSTED),
    /HOSTED_DATABASE_URL_REQUIRED: APP_DATABASE_URL/,
  );
  assert.throws(
    () =>
      databaseConnection(url, "APP_DATABASE_URL", { JOMCALL_MODE: "hosted" }),
    /HOSTED_DATABASE_HOSTS_REQUIRED: JOMCALL_DATABASE_HOSTS/,
  );
  assert.throws(
    () =>
      databaseConnection(
        "postgresql://u:pw@other.example.test:5432/postgres",
        "AGENT_DATABASE_URL",
        HOSTED,
      ),
    /HOSTED_DATABASE_HOST_MISMATCH: AGENT_DATABASE_URL/,
  );
  for (const host of [
    "127.0.0.1:54622",
    "localhost:5432",
    "[::1]:5432",
    "10.0.0.5:5432",
  ])
    assert.throws(
      () =>
        databaseConnection(
          `postgresql://u:pw@${host}/postgres`,
          "APP_DATABASE_URL",
          {
            ...HOSTED,
            JOMCALL_DATABASE_HOSTS: "127.0.0.1,localhost,[::1],10.0.0.5",
          },
        ),
      /HOSTED_LOOPBACK_REFUSED: APP_DATABASE_URL/,
    );
  for (const query of [
    "sslmode=disable",
    "sslmode=prefer",
    "sslmode=allow",
    "sslmode=no-verify",
    "ssl=false",
    "ssl=0",
  ])
    assert.throws(
      () => databaseConnection(`${url}?${query}`, "APP_DATABASE_URL", HOSTED),
      /HOSTED_DATABASE_TLS_REQUIRED: APP_DATABASE_URL/,
    );
  assert.throws(
    () =>
      databaseConnection(
        "https://db.example.test/postgres",
        "APP_DATABASE_URL",
        HOSTED,
      ),
    /INVALID_URL: APP_DATABASE_URL/,
  );
});

test("hosted database errors never contain the URL or its password", () => {
  for (const url of [
    "postgresql://u:hunter2secret@other.example.test:5432/postgres",
    "postgresql://u:hunter2secret@db.example.test:5432/postgres?sslmode=disable",
    "postgresql://u:hunter2secret@127.0.0.1:5432/postgres",
  ])
    try {
      databaseConnection(url, "APP_DATABASE_URL", HOSTED);
      assert.fail("accepted");
    } catch (error) {
      assert.doesNotMatch(
        String(error),
        /hunter2secret|example\.test|127\.0\.0\.1/,
      );
    }
});

test("a database certificate authority is passed through and checked", () => {
  const pem = "-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----";
  const result = databaseConnection(
    "postgresql://u:pw@db.example.test:5432/postgres",
    "APP_DATABASE_URL",
    { ...HOSTED, JOMCALL_DATABASE_CA: pem },
  );
  assert.equal(result.ssl?.rejectUnauthorized, true);
  assert.equal(
    result.ssl?.ca,
    "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
  );
  assert.throws(
    () =>
      databaseConnection(
        "postgresql://u:pw@db.example.test:5432/postgres",
        "APP_DATABASE_URL",
        {
          ...HOSTED,
          JOMCALL_DATABASE_CA: "not a certificate",
        },
      ),
    /HOSTED_DATABASE_CA_INVALID: JOMCALL_DATABASE_CA/,
  );
});

test("namespace: local by default, staging or prod only in hosted mode", () => {
  const uuid = "test_00000000-0000-4000-8000-000000000000";
  assert.equal(queueNamespace({}), "local");
  assert.equal(queueNamespace(LOCAL), "local");
  assert.equal(
    queueNamespace({ ...LOCAL, JOMCALL_QUEUE_NAMESPACE: "local" }),
    "local",
  );
  assert.equal(
    queueNamespace({ NODE_ENV: "test", JOMCALL_QUEUE_NAMESPACE: uuid }),
    uuid,
  );
  for (const value of ["staging", "prod", uuid, "Local", "production"])
    assert.throws(
      () => queueNamespace({ ...LOCAL, JOMCALL_QUEUE_NAMESPACE: value }),
      /INVALID_QUEUE_NAMESPACE/,
    );
  assert.equal(
    queueNamespace({ ...HOSTED, JOMCALL_QUEUE_NAMESPACE: "staging" }),
    "staging",
  );
  assert.equal(
    queueNamespace({ ...HOSTED, JOMCALL_QUEUE_NAMESPACE: "prod" }),
    "prod",
  );
  assert.throws(
    () => queueNamespace(HOSTED),
    /QUEUE_NAMESPACE_REQUIRED: JOMCALL_QUEUE_NAMESPACE/,
  );
  for (const value of ["local", "production", uuid])
    assert.throws(
      () =>
        queueNamespace({
          ...HOSTED,
          NODE_ENV: "test",
          JOMCALL_QUEUE_NAMESPACE: value,
        }),
      /INVALID_QUEUE_NAMESPACE/,
    );
  assert.throws(() => validNamespace("prod", {}), /INVALID_QUEUE_NAMESPACE/);
  assert.equal(validNamespace("prod", HOSTED), "prod");
});

test("cookies: local names unchanged, hosted names are __Host- and Secure", () => {
  assert.deepEqual(cookieNames(LOCAL), {
    access: "ca_local_access",
    refresh: "ca_local_refresh",
    csrf: "ca_local_csrf",
    secure: false,
  });
  const hosted = cookieNames(HOSTED);
  assert.equal(hosted.secure, true);
  for (const name of [hosted.access, hosted.refresh, hosted.csrf])
    assert.match(name, /^__Host-jomcall_/);
});

test("mail: local Mailpit only; hosted needs a real provider with TLS and a login", () => {
  const local = mailSettings({
    ...LOCAL,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "54625",
  });
  assert.deepEqual(local.transport, {
    host: "127.0.0.1",
    port: 54625,
    secure: false,
    ignoreTLS: true,
  });
  assert.equal(local.inviteBase, "http://127.0.0.1:4182");
  assert.throws(
    () =>
      mailSettings({
        ...LOCAL,
        SMTP_HOST: "smtp.example.test",
        SMTP_PORT: "587",
      }),
    /LOCAL_SMTP_REQUIRED/,
  );
  const env = {
    ...HOSTED,
    APP_ORIGIN: "https://app.example.test",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "user",
    SMTP_PASSWORD: "pw",
    SMTP_FROM: "JomCall <hello@example.test>",
  };
  const hosted = mailSettings(env);
  assert.deepEqual(hosted.transport, {
    host: "smtp.example.test",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: "user", pass: "pw" },
  });
  assert.equal(hosted.inviteBase, "https://app.example.test");
  assert.equal(hosted.messageIdDomain, "app.example.test");
  assert.equal(
    mailSettings({ ...env, SMTP_PORT: "465" }).transport.secure,
    true,
  );
  for (const name of [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "APP_ORIGIN",
  ])
    assert.throws(
      () => mailSettings({ ...env, [name]: undefined }),
      new RegExp(`${name}_REQUIRED: ${name}`),
    );
  assert.throws(
    () => mailSettings({ ...env, SMTP_HOST: "127.0.0.1", SMTP_PORT: "54625" }),
    /HOSTED_LOOPBACK_REFUSED: SMTP_HOST/,
  );
  assert.throws(
    () => mailSettings({ ...env, SMTP_FROM: "nobody" }),
    /INVALID_SENDER/,
  );
});

test("voice endpoint: loopback only in local mode", () => {
  assert.deepEqual(voiceListen(LOCAL), {
    mode: "local",
    host: "127.0.0.1",
    port: 54633,
  });
  assert.deepEqual(voiceListen({ ...LOCAL, JOMCALL_VOICE_BIND: "127.0.0.1" }), {
    mode: "local",
    host: "127.0.0.1",
    port: 54633,
  });
  for (const bind of ["0.0.0.0", "172.30.0.10", "10.0.0.1", "::1", "localhost"])
    assert.throws(
      () =>
        voiceListen({
          ...LOCAL,
          JOMCALL_VOICE_BIND: bind,
          JOMCALL_VOICE_SERVICE_SECRET: SECRET,
        }),
      /LOOPBACK_REQUIRED/,
    );
});

test("voice endpoint: hosted needs a private bind address and a service secret", () => {
  assert.deepEqual(
    voiceListen({
      ...HOSTED,
      JOMCALL_VOICE_BIND: "172.30.0.10",
      JOMCALL_VOICE_SERVICE_SECRET: SECRET,
    }),
    { mode: "hosted", host: "172.30.0.10", port: 54633, serviceSecret: SECRET },
  );
  assert.throws(
    () => voiceListen({ ...HOSTED, JOMCALL_VOICE_SERVICE_SECRET: SECRET }),
    /VOICE_BIND_REQUIRED: JOMCALL_VOICE_BIND/,
  );
  for (const bind of ["0.0.0.0", "8.8.8.8", "agent", "[::]", "203.0.113.9"])
    assert.throws(
      () =>
        voiceListen({
          ...HOSTED,
          JOMCALL_VOICE_BIND: bind,
          JOMCALL_VOICE_SERVICE_SECRET: SECRET,
        }),
      /PRIVATE_BIND_REQUIRED: JOMCALL_VOICE_BIND/,
    );
  for (const secret of [
    undefined,
    "",
    "short",
    "s".repeat(31),
    "has space ".repeat(5),
  ])
    try {
      voiceListen({
        ...HOSTED,
        JOMCALL_VOICE_BIND: "172.30.0.10",
        JOMCALL_VOICE_SERVICE_SECRET: secret,
      });
      assert.fail("accepted");
    } catch (error) {
      assert.match(
        String(error),
        /VOICE_SERVICE_SECRET_REQUIRED: JOMCALL_VOICE_SERVICE_SECRET/,
      );
      if (secret) assert.equal(String(error).includes(secret), false);
    }
});

test("hosted LiveKit address must be wss and not loopback", () => {
  assert.equal(
    liveKitUrlProblem({ ...LOCAL, LIVEKIT_URL: "ws://127.0.0.1:54630" }),
    null,
  );
  assert.equal(
    liveKitUrlProblem({ ...HOSTED, LIVEKIT_URL: "wss://livekit.example.test" }),
    null,
  );
  assert.match(
    liveKitUrlProblem({ ...HOSTED, LIVEKIT_URL: "ws://livekit.example.test" })!,
    /WSS_REQUIRED/,
  );
  assert.match(
    liveKitUrlProblem({ ...HOSTED, LIVEKIT_URL: "wss://127.0.0.1:54630" })!,
    /HOSTED_LOOPBACK_REFUSED/,
  );
  assert.match(liveKitUrlProblem(HOSTED)!, /INVALID_URL/);
});
