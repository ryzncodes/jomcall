import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettingsSync } from "../../web/components/core/agent/settings-sync.ts";
import type { AgentSettings } from "../../packages/contracts/src/core.ts";

class Conflict extends Error {}
const base: AgentSettings = {
  name: "Aina",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "Hai",
  instructions: "",
  aiDisclosure: "AI",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "",
};

function setup(opts: {
  send?: (s: AgentSettings, rev: number) => Promise<number>;
  server?: () => AgentSettings;
}) {
  const sent: AgentSettings[] = [];
  const events = { conflicts: 0 };
  const sync = createSettingsSync({
    initial: base,
    revision: 1,
    newKey: () => "k",
    isConflict: (e) => e instanceof Conflict,
    isLost: () => false,
    wait: async () => {},
    send: async (s, rev) => {
      sent.push(s);
      return opts.send ? opts.send(s, rev) : rev + 1;
    },
    read: async () => ({ revision: 7, settings: opts.server?.() ?? base }),
    onChange: () => {},
    onConflict: () => {
      events.conflicts++;
    },
  });
  return { sync, sent, events };
}

test("a 409 whose server draft equals what was sent is no conflict", async () => {
  const edited = { ...base, greeting: "Selamat" };
  const t = setup({
    send: async () => {
      throw new Conflict();
    },
    server: () => edited,
  });
  t.sync.change({ greeting: "Selamat" });
  t.sync.flush();
  await t.sync.queue.idle();
  assert.equal(t.events.conflicts, 0);
  assert.equal(t.sync.status(), "saved");
  assert.equal(t.sync.unsaved(), false);
  assert.equal(t.sync.queue.revision(), 7);
});

test("a 409 with a different server draft reports a conflict", async () => {
  const t = setup({
    send: async () => {
      throw new Conflict();
    },
    server: () => ({ ...base, name: "Other" }),
  });
  t.sync.change({ greeting: "Selamat" });
  t.sync.flush();
  await t.sync.queue.idle();
  assert.equal(t.events.conflicts, 1);
  assert.equal(t.sync.status(), "conflict");
  assert.equal(t.sync.settings().name, "Other");
  assert.equal(t.sync.settings().greeting, "Hai");
});

test("after an error the edit is still unsaved and a flush sends it again", async () => {
  let fail = true;
  const t = setup({
    send: async (_s, rev) => {
      if (fail) throw new Error("boom");
      return rev + 1;
    },
  });
  t.sync.change({ greeting: "Selamat" });
  t.sync.flush();
  await t.sync.queue.idle();
  assert.equal(t.sync.status(), "error");
  assert.equal(t.sync.unsaved(), true);
  fail = false;
  t.sync.flush();
  await t.sync.queue.idle();
  assert.equal(t.sent.length, 2);
  assert.equal(t.sync.status(), "saved");
  assert.equal(t.sync.unsaved(), false);
});

test("after a successful save nothing is unsaved", async () => {
  const t = setup({});
  t.sync.change({ greeting: "Selamat" });
  assert.equal(t.sync.unsaved(), true);
  t.sync.flush();
  await t.sync.queue.idle();
  assert.equal(t.sync.unsaved(), false);
  assert.equal(t.sync.status(), "saved");
});

test("waiting for the queue does not hang after an error", async () => {
  const t = setup({
    send: async () => {
      throw new Error("boom");
    },
  });
  t.sync.change({ greeting: "x" });
  t.sync.flush();
  await t.sync.queue.idle();
  await t.sync.settled();
});

test("an empty name is not sent and stays unsaved", async () => {
  const t = setup({});
  t.sync.change({ name: "" });
  t.sync.flush();
  await t.sync.queue.idle();
  assert.equal(t.sent.length, 0);
  assert.deepEqual(t.sync.invalid(), ["name"]);
  assert.equal(t.sync.unsaved(), true);
});

test("while a save is in flight it is unsaved but nothing is waiting", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const t = setup({
    send: async (_s, rev) => {
      await gate;
      return rev + 1;
    },
  });
  t.sync.change({ greeting: "Selamat" });
  t.sync.flush();
  assert.equal(t.sync.status(), "saving");
  assert.equal(t.sync.dirty(), false);
  assert.equal(t.sync.unsaved(), true);
  release();
  await t.sync.queue.idle();
  assert.equal(t.sync.unsaved(), false);
});

test("a blurred field keeps its text through a conflict on its own send", async () => {
  const server = { ...base, greeting: "Orang lain" };
  const t = setup({
    send: async () => {
      throw new Conflict();
    },
    server: () => server,
  });
  t.sync.setFocused("name");
  t.sync.change({ name: "Aina Baru" });
  t.sync.blur("name");
  await t.sync.queue.idle();
  assert.equal(t.events.conflicts, 1);
  assert.equal(t.sync.settings().name, "Aina Baru");
  assert.equal(t.sync.settings().greeting, "Orang lain");
  assert.equal(t.sync.unsaved(), true);
});

test("blur forgets the focus after the send, unless another field took it", async () => {
  const server = { ...base, name: "Lain", greeting: "Lain" };
  const t = setup({
    send: async () => {
      throw new Conflict();
    },
    server: () => server,
  });
  t.sync.setFocused("name");
  t.sync.change({ name: "X" });
  t.sync.blur("name");
  t.sync.setFocused("greeting");
  t.sync.change({ greeting: "Y" });
  await t.sync.queue.idle();
  // greeting is still focused: its text stays, name takes the server's.
  assert.equal(t.sync.settings().greeting, "Y");
  assert.equal(t.sync.settings().name, "Lain");
});

test("reload takes the server draft as local and saved", async () => {
  const server = { ...base, instructions: "Dipulihkan" };
  const t = setup({ server: () => server });
  t.sync.change({ greeting: "Tidak dihantar" });
  await t.sync.reload();
  assert.equal(t.sync.settings().instructions, "Dipulihkan");
  assert.equal(t.sync.settings().greeting, base.greeting);
  assert.equal(t.sync.unsaved(), false);
  assert.equal(t.sync.dirty(), false);
});
