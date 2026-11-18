import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { COMPOSE_ENVIRONMENT } from "../../packages/contracts/src/hosted-env.ts";
import { join } from "node:path";

// Validates infra/hosted/docker-compose.yml offline with empty env files. It
// starts nothing and contacts no registry. Skipped where Docker is missing.
function composeConfig(): any | null {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
  } catch {
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), "jomcall-compose-"));
  // A harmless marker shows which file reached which container.
  for (const name of ["agent", "engine", "voice", "livekit", "caddy", "sip"])
    writeFileSync(join(dir, `${name}.env`), `JOMCALL_ENV_MARKER=${name}\n`);
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "infra/hosted/docker-compose.yml",
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8", env: { ...process.env, JOMCALL_ENV_DIR: dir } },
    ),
  );
}
const config = composeConfig();

test(
  "only the ports the design allows are published",
  { skip: !config },
  () => {
    const published = Object.entries(config.services).flatMap(
      ([name, s]: [string, any]) =>
        (s.ports ?? []).map(
          (p: any) => `${name}:${p.published}/${p.protocol}:${p.host_ip ?? ""}`,
        ),
    );
    assert.deepEqual(published.sort(), [
      "caddy:443/tcp:",
      "caddy:80/tcp:",
      // Loopback only, for the SIP service on the host's network.
      "livekit:7880/tcp:127.0.0.1",
      "livekit:7881/tcp:",
      "livekit:7882/udp:",
      "redis:6379/tcp:127.0.0.1",
    ]);
  },
);

test(
  "the SIP service uses the host network, gets only its own env file and holds no key in its config",
  { skip: !config },
  () => {
    const sip = config.services.sip;
    assert.equal(sip.network_mode, "host");
    assert.equal(sip.environment.JOMCALL_ENV_MARKER, "sip");
    assert.deepEqual(sip.cap_drop, ["ALL"]);
    assert.ok(sip.security_opt.includes("no-new-privileges:true"));
    assert.equal(sip.restart, "unless-stopped");
    const body: string = sip.environment.SIP_CONFIG_BODY;
    assert.match(body, /ws_url: ws:\/\/127\.0\.0\.1:7880/);
    assert.match(body, /address: 127\.0\.0\.1:6379/);
    assert.match(body, /rtp_port: 10000-10200/);
    assert.doesNotMatch(body, /api_key|api_secret/);
    // The bus is reachable from LiveKit and the host's loopback only.
    assert.deepEqual(Object.keys(config.services.redis.networks), ["sip"]);
    assert.ok("sip" in config.services.livekit.networks);
    for (const name of ["agent", "engine", "voice", "caddy"])
      assert.ok(!("sip" in config.services[name].networks), name);
    assert.match(config.services.sip.image, /@sha256:[a-f0-9]{64}$/);
    assert.match(config.services.redis.image, /@sha256:[a-f0-9]{64}$/);
  },
);

test(
  "workers are hardened, restart, health-checked and get only their own env file",
  { skip: !config },
  () => {
    for (const name of ["agent", "engine", "voice"]) {
      const s = config.services[name];
      assert.equal(s.restart, "unless-stopped", name);
      assert.ok(s.healthcheck?.test, name);
      assert.deepEqual(s.cap_drop, ["ALL"], name);
      assert.ok(s.security_opt.includes("no-new-privileges:true"), name);
      assert.equal(s.environment.JOMCALL_MODE, "hosted", name);
      assert.equal(s.environment.JOMCALL_ENV_MARKER, name, name);
    }
    const agent = config.services.agent;
    assert.equal(
      agent.environment.JOMCALL_VOICE_BIND,
      agent.networks.private.ipv4_address,
    );
    assert.equal(
      config.services.voice.environment.JOMCALL_VOICE_TURN_URL,
      `http://${agent.networks.private.ipv4_address}:54633`,
    );
    // A call may last 300 s; the voice worker must get longer to drain.
    const [, m, sec] = /^(?:(\d+)m)?(?:(\d+)s)?$/.exec(
      config.services.voice.stop_grace_period,
    )!;
    assert.ok(Number(m ?? 0) * 60 + Number(sec ?? 0) >= 330);
    assert.equal(
      config.services.livekit.environment.JOMCALL_ENV_MARKER,
      "livekit",
    );
    // Caddy never receives the LiveKit keys file.
    assert.equal(config.services.caddy.environment.JOMCALL_ENV_MARKER, "caddy");
  },
);

test(
  "LiveKit uses the digest pinned for local development",
  { skip: !config },
  () => {
    const lock = JSON.parse(
      readFileSync("infra/local/livekit-lock.json", "utf8"),
    );
    assert.equal(config.services.livekit.image, `${lock.image}@${lock.digest}`);
  },
);

test("no secret value is written in the compose file or the LiveKit config", () => {
  for (const file of [
    "infra/hosted/docker-compose.yml",
    "infra/hosted/livekit/livekit.yaml",
  ]) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /^\s*keys:\s*$/m, file);
    assert.doesNotMatch(
      text,
      /(API_SECRET|PASSWORD|_KEY)\s*[:=]\s*\S{8,}/,
      file,
    );
  }
});

test(
  "readiness --compose adds exactly what Compose sets",
  { skip: !config },
  () => {
    for (const name of ["agent", "engine", "voice"] as const) {
      const { JOMCALL_ENV_MARKER, ...set } = config.services[name].environment;
      assert.equal(JOMCALL_ENV_MARKER, name);
      assert.deepEqual(set, COMPOSE_ENVIRONMENT[name], name);
    }
  },
);
