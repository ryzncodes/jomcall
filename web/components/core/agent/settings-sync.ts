// Framework-free controller for the agent page's autosave of settings: owns
// the local settings, what the server last accepted, what this page last
// sent, and the queue jobs. store.tsx wires it to React; tests drive it
// with fake send and read functions under node:test.
import {
  createSaveQueue,
  type QueueStatus,
} from "../../../lib/core/save-queue.ts";
import type { AgentSettings } from "../../../../packages/contracts/src/core.ts";
import {
  afterConflict,
  sameSettings,
  validSettings,
  withVoice,
} from "./rules.ts";

const DEBOUNCE_MS = 800;

export function createSettingsSync(o: {
  initial: AgentSettings;
  revision: number;
  newKey: () => string;
  isConflict: (e: unknown) => boolean;
  isLost: (e: unknown) => boolean;
  wait?: (ms: number) => Promise<void>;
  // Sends the whole settings object; returns the agent revision after it.
  send: (
    settings: AgentSettings,
    revision: number,
    key: string,
    keepalive: boolean,
  ) => Promise<number>;
  read: () => Promise<{ revision: number; settings: AgentSettings }>;
  onChange: () => void;
  onStatus?: (status: QueueStatus, error?: unknown) => void;
  onConflict: () => void;
}) {
  let local = o.initial,
    lastValid = o.initial,
    lastSent = o.initial,
    server = o.initial,
    focused: keyof AgentSettings | null = null,
    // Fields left while their send was not settled, each with the token of
    // its blur; kept through a conflict like the focused field.
    blurred = new Map<keyof AgentSettings, number>(),
    blurSeq = 0,
    // True while a restore is in flight, and after it until the settings
    // were read again: nothing is typed or sent meanwhile.
    held = false,
    reloadFailed = false,
    dirty = false,
    invalid: (keyof AgentSettings)[] = [],
    status: QueueStatus = "idle",
    error: unknown,
    settingsRunning = false,
    keepalive = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    stopWaiters: (() => void)[] = [];

  const queue = createSaveQueue({
    revision: o.revision,
    newKey: o.newKey,
    isConflict: o.isConflict,
    isLost: o.isLost,
    wait: o.wait,
    reread: async () => {
      const a = await o.read();
      server = a.settings;
      // Same only when the conflicting job is a settings write and the
      // server already holds what this page last sent (the running edit too).
      const same = settingsRunning && sameSettings(server, lastSent);
      if (same) lastValid = lastSent;
      return { revision: a.revision, same };
    },
    onStatus: (s, e) => {
      // "saving" fires before every job: the flag is true only while a
      // settings job is the one that ran last, including when it fails.
      if (s === "saving") settingsRunning = false;
      status = s;
      if (s === "error") error = e;
      if (s === "saved") error = undefined;
      if (s === "conflict") {
        error = undefined;
        clearTimeout(timer);
        // Only a field the owner changed is kept; one merely tabbed
        // through shows the server's value.
        local = afterConflict(
          server,
          local,
          [...(focused ? [focused] : []), ...blurred.keys()].filter(
            (f) => JSON.stringify(local[f]) !== JSON.stringify(lastValid[f]),
          ),
        );
        lastValid = server;
        lastSent = server;
        invalid = validSettings(local, server).invalid;
        dirty = !sameSettings(local, server);
      }
      if (s === "error" || s === "conflict")
        for (const r of stopWaiters.splice(0)) r();
      o.onChange();
      o.onStatus?.(s, e);
      if (s === "conflict") o.onConflict();
    },
  });

  // Not on the server yet: typed and waiting, or sent and failed, or not
  // sendable (an invalid field).
  const unsaved = () => dirty || !sameSettings(local, lastValid);

  function push() {
    clearTimeout(timer);
    if (held) return;
    const { send, invalid: bad } = validSettings(local, lastValid);
    invalid = bad;
    dirty = false;
    o.onChange();
    if (sameSettings(send, lastValid) && !queue.pending()) return;
    queue
      .push({
        slot: "settings",
        run: async (revision, key) => {
          lastSent = send;
          settingsRunning = true;
          const next = await o.send(send, revision, key, keepalive);
          lastValid = send;
          return next;
        },
      })
      .catch(() => {
        // The outcome is shown through the status.
      });
  }

  return {
    queue,
    settings: () => local,
    invalid: () => invalid,
    dirty: () => dirty,
    status: () => status,
    error: () => error,
    unsaved,
    setFocused(f: keyof AgentSettings | null) {
      focused = f;
      // Focused again: kept as the focused field, so a stale blur must not
      // release it.
      if (f) blurred.delete(f);
    },
    change(partial: Partial<AgentSettings>) {
      if (held) return;
      local = { ...local, ...partial };
      invalid = validSettings(local, lastValid).invalid;
      dirty = true;
      o.onChange();
      clearTimeout(timer);
      timer = setTimeout(push, DEBOUNCE_MS);
    },
    push,
    // Blur and navigation: sends a waiting edit, and an edit whose save
    // failed. Not a second copy of one that is still being sent.
    flush() {
      const failed =
        (status === "error" || status === "conflict") &&
        !sameSettings(local, lastValid);
      if (dirty || failed) push();
    },
    // A text field lost focus: send its edit now. It stays kept through a
    // conflict until its send settles (the queue goes idle), unless the
    // owner focused it again meanwhile.
    blur(field: keyof AgentSettings) {
      if (focused === field) focused = null;
      const token = ++blurSeq;
      blurred.set(field, token);
      this.flush();
      void queue.idle().then(() => {
        if (blurred.get(field) === token) blurred.delete(field);
      });
    },
    // A restore starts: settings edits are refused and nothing is sent
    // until reload() succeeds (or release() after a failed restore).
    hold() {
      clearTimeout(timer);
      held = true;
      reloadFailed = false;
      o.onChange();
    },
    release() {
      held = false;
      reloadFailed = false;
      o.onChange();
    },
    // A restore: the waiting edit lands first (no restore when it did not
    // land, so the page is never left locked behind a stopped queue), then
    // edits are held while `run` writes, and the draft is read back.
    // "unsaved": nothing was done. "reloadFailed": restored, but the hold
    // stays until reload() succeeds. A failed `run` releases the hold and
    // rejects.
    async restore(
      run: () => Promise<unknown>,
    ): Promise<"unsaved" | "restored" | "reloadFailed"> {
      this.flush();
      await this.settled();
      if (
        status === "error" ||
        status === "conflict" ||
        queue.pending() ||
        unsaved()
      )
        return "unsaved";
      this.hold();
      try {
        await run();
      } catch (e) {
        this.release();
        throw e;
      }
      try {
        await this.reload();
      } catch {
        return "reloadFailed";
      }
      return "restored";
    },
    held: () => held,
    reloadFailed: () => reloadFailed,
    // Reads the draft again and takes it as both local and saved (after a
    // restore). On failure the hold stays and reloadFailed is set.
    async reload() {
      let a;
      try {
        a = await o.read();
      } catch (e) {
        reloadFailed = true;
        o.onChange();
        throw e;
      }
      clearTimeout(timer);
      local = lastValid = lastSent = server = withVoice(a.settings);
      dirty = false;
      invalid = [];
      held = false;
      reloadFailed = false;
      o.onChange();
    },
    // Waits for the queue, but never after an error (the queue may keep
    // jobs) and never past one that happens meanwhile.
    async settled() {
      if (status === "error") return;
      let stop!: () => void;
      const stopped = new Promise<void>((r) => {
        stop = r;
        stopWaiters.push(r);
      });
      await Promise.race([queue.idle(), stopped]);
      stopWaiters = stopWaiters.filter((r) => r !== stop);
    },
    // The tab is closing: send what waits with a keepalive request.
    pagehide() {
      keepalive = true;
      try {
        if (dirty) push();
        else if (queue.pending())
          queue
            .last()
            ?.run(queue.revision(), o.newKey())
            .catch(() => {});
      } finally {
        keepalive = false;
      }
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
