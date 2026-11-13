import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLock,
  imageRef,
  renderConfig,
  runArgs,
  assertLoopbackPublishes,
  verifyImage,
  prepareLivekit,
  startLivekit,
  stopLivekit,
  containerName,
  labelKey,
  labelValue,
} from "../../scripts/local/livekit-common.mjs";
import { buildEnvironment } from "../../scripts/local/env.mjs";

const template = await readFile(
  new URL("../../infra/local/livekit.yaml", import.meta.url),
  "utf8",
);
const lock = await readLock();
const ref = imageRef(lock);
const ID = "a".repeat(64);

// Fake Docker: records calls, keeps one container in memory.
function fakeDocker({ image = "ok", container } = {}) {
  const calls = [];
  const state = { container };
  const docker = (args) => {
    calls.push(args);
    const [cmd] = args;
    if (cmd === "info") return "29.0.0";
    if (cmd === "pull") return "";
    if (cmd === "image") {
      if (image === "missing") throw Error("no such image");
      return JSON.stringify([
        image === "ok"
          ? { Id: "sha256:" + "1".repeat(64), RepoDigests: [ref], Size: 42 }
          : {
              Id: "sha256:" + "2".repeat(64),
              RepoDigests: [lock.image + "@sha256:" + "3".repeat(64)],
              Size: 42,
            },
      ]);
    }
    if (cmd === "inspect") {
      if (
        !state.container ||
        ![state.container.Id, containerName].includes(args[1])
      )
        throw Error("no such object");
      return JSON.stringify([state.container]);
    }
    if (cmd === "run") {
      state.container = {
        Id: ID,
        Name: "/" + containerName,
        State: { Running: true },
        Config: { Labels: { [labelKey]: labelValue } },
      };
      return ID + "\n";
    }
    if (cmd === "rm") {
      state.container = undefined;
      return "";
    }
    throw Error("unexpected docker call " + args.join(" "));
  };
  return { docker, calls, state };
}
const tmp = () => mkdtemp(join(tmpdir(), "jomcall-livekit-"));
const env = {
  LIVEKIT_API_KEY: "APIkey123",
  LIVEKIT_API_SECRET: "secretvalue456",
};
const ready = async () => {};

test("lock pins a version tag and a sha256 image digest, referenced only by digest", () => {
  assert.match(lock.version, /^v\d+\.\d+\.\d+$/);
  assert.match(lock.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(ref, `${lock.image}@${lock.digest}`);
  assert.ok(!ref.includes(lock.version));
  const args = runArgs(lock, "/x/livekit.yaml");
  assert.ok(args.includes(ref));
  assert.ok(!args.some((a) => a.includes(":v1") || a.endsWith(":latest")));
});

test("generated config binds loopback on ports 54630-54632 and has no 0.0.0.0", () => {
  const out = renderConfig(template, "APIkey123", "secretvalue456");
  assert.doesNotMatch(out, /0\.0\.0\.0/);
  assert.match(out, /^port: 54630$/m);
  assert.match(out, /tcp_port: 54631/);
  assert.match(out, /udp_port: 54632/);
  assert.match(out, /node_ip: 127\.0\.0\.1/);
  assert.match(out, /use_external_ip: false/);
  assert.match(out, /APIkey123: secretvalue456/);
  assert.doesNotMatch(template, /0\.0\.0\.0/);
  assert.doesNotMatch(template, /[a-f0-9]{32}/);
});

test("container arguments publish loopback only with no host network or privilege", () => {
  const args = runArgs(lock, "/x/livekit.yaml");
  const published = args.filter((_, i) => args[i - 1] === "-p");
  assert.deepEqual(published, [
    "127.0.0.1:54630:54630/tcp",
    "127.0.0.1:54631:54631/tcp",
    "127.0.0.1:54632:54632/udp",
  ]);
  assert.ok(!args.join(" ").includes("0.0.0.0"));
  assert.ok(!args.includes("--network") && !args.includes("--privileged"));
  assert.equal(args.filter((a) => a === "-v").length, 1);
  assert.match(args[args.indexOf("-v") + 1], /:\/etc\/livekit\.yaml:ro$/);
  assert.throws(
    () => assertLoopbackPublishes(["run", "-p", "54630:54630"]),
    /NOT_LOOPBACK/,
  );
  assert.throws(
    () => assertLoopbackPublishes(["run", "-p", "0.0.0.0:1:1"]),
    /NOT_LOOPBACK/,
  );
  assert.throws(
    () => assertLoopbackPublishes(["run", "--network", "host"]),
    /UNSAFE/,
  );
  assert.throws(() => assertLoopbackPublishes(["run", "-P"]), /UNSAFE/);
});

test("start refuses an image whose digest does not match the lock, before any run", async () => {
  const dir = await tmp();
  try {
    const f = fakeDocker({ image: "mismatch" });
    await assert.rejects(
      startLivekit({ docker: f.docker, dir, env, ready }),
      /LIVEKIT_IMAGE_MISMATCH/,
    );
    assert.ok(!f.calls.some((c) => c[0] === "run"));
    const g = fakeDocker({ image: "missing" });
    await assert.rejects(
      startLivekit({ docker: g.docker, dir, env, ready }),
      /LIVEKIT_IMAGE_MISSING/,
    );
    assert.throws(() => verifyImage(f.docker, lock), /MISMATCH/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prepare pulls the pinned digest only with --download", async () => {
  const quiet = () => {};
  const a = fakeDocker({ image: "missing" });
  assert.equal(
    await prepareLivekit({ download: false, docker: a.docker, log: quiet }),
    false,
  );
  assert.ok(!a.calls.some((c) => c[0] === "pull"));
  const b = fakeDocker();
  assert.equal(
    await prepareLivekit({ download: true, docker: b.docker, log: quiet }),
    true,
  );
  assert.deepEqual(
    b.calls.find((c) => c[0] === "pull"),
    ["pull", ref],
  );
  const c = fakeDocker({ image: "mismatch" });
  await assert.rejects(
    prepareLivekit({ download: true, docker: c.docker, log: quiet }),
    /MISMATCH/,
  );
});

test("start writes the config privately, runs one container and records its id; stop removes it", async () => {
  const dir = (await tmp()) + "/";
  try {
    const f = fakeDocker();
    const id = await startLivekit({
      docker: f.docker,
      dir,
      env,
      template,
      ready,
    });
    assert.equal(id, ID);
    assert.equal(f.calls.filter((c) => c[0] === "run").length, 1);
    const cfg = await readFile(dir + "livekit.yaml", "utf8");
    assert.match(cfg, /APIkey123: secretvalue456/);
    assert.doesNotMatch(cfg, /0\.0\.0\.0/);
    assert.equal((await stat(dir + "livekit.yaml")).mode & 0o077, 0);
    assert.deepEqual(
      JSON.parse(await readFile(dir + "container.json", "utf8")),
      { id: ID },
    );
    assert.equal(
      await startLivekit({ docker: f.docker, dir, env, template, ready }),
      ID,
    );
    assert.equal(f.calls.filter((c) => c[0] === "run").length, 1);
    assert.equal(await stopLivekit({ docker: f.docker, dir }), true);
    assert.equal(f.state.container, undefined);
    await assert.rejects(readFile(dir + "container.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop and start refuse a container they did not start", async () => {
  const dir = (await tmp()) + "/";
  try {
    const foreign = {
      Id: "b".repeat(64),
      Name: "/" + containerName,
      Config: { Labels: {} },
      State: { Running: true },
    };
    // Same name, no saved id: refuse.
    const f = fakeDocker({ container: foreign });
    await assert.rejects(
      stopLivekit({ docker: f.docker, dir }),
      /FOREIGN_LIVEKIT_CONTAINER/,
    );
    await assert.rejects(
      startLivekit({ docker: f.docker, dir, env, template, ready }),
      /FOREIGN_LIVEKIT_CONTAINER/,
    );
    assert.ok(!f.calls.some((c) => c[0] === "rm" || c[0] === "run"));
    // Saved id matches but label is missing: refuse.
    await mkdir(dir, { recursive: true });
    await writeFile(dir + "container.json", JSON.stringify({ id: foreign.Id }));
    await assert.rejects(
      stopLivekit({ docker: f.docker, dir }),
      /FOREIGN_LIVEKIT_CONTAINER/,
    );
    // Right label, different id than recorded: refuse.
    const g = fakeDocker({
      container: {
        ...foreign,
        Id: "c".repeat(64),
        Config: { Labels: { [labelKey]: labelValue } },
      },
    });
    await writeFile(
      dir + "container.json",
      JSON.stringify({ id: containerName }),
    );
    await assert.rejects(
      stopLivekit({ docker: g.docker, dir }),
      /FOREIGN_LIVEKIT_CONTAINER/,
    );
    assert.ok(!g.calls.some((c) => c[0] === "rm"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed readiness check removes the container it just started", async () => {
  const dir = (await tmp()) + "/";
  try {
    const f = fakeDocker();
    await assert.rejects(
      startLivekit({
        docker: f.docker,
        dir,
        env,
        template,
        ready: async () => {
          throw Error("LIVEKIT_START_FAILED");
        },
      }),
      /LIVEKIT_START_FAILED/,
    );
    assert.equal(f.state.container, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LiveKit secret goes to root and web env, is generated once, preserved, and never public", () => {
  const status = {
    API_URL: "http://127.0.0.1:54621",
    ANON_KEY: "anon",
    DB_URL: "postgresql://x",
    SERVICE_ROLE_KEY: "svc",
  };
  const first = buildEnvironment(status, {});
  for (const side of [first.root, first.shared]) {
    assert.equal(side.LIVEKIT_URL, "ws://127.0.0.1:54630");
    assert.match(side.LIVEKIT_API_KEY, /^API[a-f0-9]{16}$/);
    assert.match(side.LIVEKIT_API_SECRET, /^[a-f0-9]{64}$/);
    assert.ok(!Object.keys(side).some((k) => k.startsWith("NEXT_PUBLIC_")));
  }
  assert.equal(first.root.LIVEKIT_API_SECRET, first.shared.LIVEKIT_API_SECRET);
  const again = buildEnvironment(status, first.root);
  assert.equal(again.root.LIVEKIT_API_SECRET, first.root.LIVEKIT_API_SECRET);
  assert.equal(again.root.LIVEKIT_API_KEY, first.root.LIVEKIT_API_KEY);
  assert.equal(again.shared.LIVEKIT_API_SECRET, first.root.LIVEKIT_API_SECRET);
});
