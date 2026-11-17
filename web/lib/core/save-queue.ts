// One queue for every write that checks the agent's revision. Edits land in
// order, a lost answer is retried with the same idempotency key, and a
// conflict (another tab saved) is settled by re-reading the draft. No React
// or DOM here, so it runs under node:test.
export type QueueStatus = "idle" | "saving" | "saved" | "error" | "conflict";
export type Job = {
  // A queued (not started) job with the same slot is replaced by a newer one.
  slot?: string;
  // Sends one command. Gets the revision to send and this job's fixed
  // idempotency key. Returns the agent revision after the write.
  run: (revision: number, key: string) => Promise<number>;
};
type Waiter = { resolve: () => void; reject: (error: unknown) => void };
type Entry = { job: Job; key: string; waiters: Waiter[] };

const RETRY_DELAYS = [500, 2000, 5000];

export function createSaveQueue(options: {
  revision: number;
  newKey: () => string;
  isConflict: (error: unknown) => boolean;
  // No answer arrived (network error, ProxyError 502/504).
  isLost: (error: unknown) => boolean;
  // Re-reads the draft. same: the server already holds what this page last sent.
  reread: () => Promise<{ revision: number; same: boolean }>;
  onStatus: (status: QueueStatus, error?: unknown) => void;
  wait?: (ms: number) => Promise<void>;
}) {
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let revision = options.revision;
  let queued: Entry[] = [];
  let running: Entry | undefined;
  let pumping = false;
  let idleWaiters: (() => void)[] = [];

  // A throwing callback must not stop the pump or leave idle() waiting.
  function report(status: QueueStatus, error?: unknown) {
    try {
      options.onStatus(status, error);
    } catch {
      // The page's status handler broke; the queue carries on.
    }
  }

  function settleIdle() {
    if (running || queued.length) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  }

  type Outcome = { status?: QueueStatus; error?: unknown; stop: boolean };

  // Runs one entry: retries a lost answer with the same key. Rejects its
  // waiters (and, on a conflict, the queue) and returns the status to report;
  // the caller reports it only after the pump is no longer running, so a push
  // made from the status callback starts a fresh pump.
  async function runEntry(entry: Entry): Promise<Outcome> {
    for (let attempt = 0; ; attempt++) {
      try {
        revision = await entry.job.run(revision, entry.key);
        for (const w of entry.waiters) w.resolve();
        return { stop: false };
      } catch (error) {
        if (options.isConflict(error)) {
          let again: { revision: number; same: boolean };
          try {
            again = await options.reread();
          } catch (rereadError) {
            for (const w of entry.waiters) w.reject(rereadError);
            return { status: "error", error: rereadError, stop: true };
          }
          revision = again.revision;
          if (again.same) {
            for (const w of entry.waiters) w.resolve();
            return { stop: false };
          }
          const rest = queued;
          queued = [];
          for (const w of entry.waiters) w.reject(error);
          for (const e of rest) for (const w of e.waiters) w.reject(error);
          return { status: "conflict", error, stop: true };
        }
        if (options.isLost(error) && attempt < RETRY_DELAYS.length) {
          await wait(RETRY_DELAYS[attempt]!);
          continue;
        }
        for (const w of entry.waiters) w.reject(error);
        return { status: "error", error, stop: true };
      }
    }
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    let final: Outcome | undefined;
    try {
      let succeeded = false;
      while (queued.length) {
        const entry = queued.shift()!;
        running = entry;
        report("saving");
        const outcome = await runEntry(entry);
        running = undefined;
        if (outcome.stop) {
          final = outcome;
          return;
        }
        succeeded = true;
      }
      if (succeeded) final = { status: "saved", stop: false };
    } finally {
      running = undefined;
      pumping = false;
      if (final?.status) report(final.status, final.error);
      settleIdle();
    }
  }

  return {
    push(job: Job): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const waiter = { resolve, reject };
        const at = job.slot
          ? queued.findIndex((e) => e.job.slot === job.slot)
          : -1;
        if (at >= 0) {
          // The replaced job's callers wait for the job that superseded it.
          const old = queued[at]!;
          queued[at] = {
            job,
            key: options.newKey(),
            waiters: [...old.waiters, waiter],
          };
        } else {
          queued.push({ job, key: options.newKey(), waiters: [waiter] });
        }
        void pump();
      });
    },
    revision: () => revision,
    setRevision(next: number) {
      revision = next;
    },
    pending: () => pumping || queued.length > 0,
    idle(): Promise<void> {
      if (!running && !queued.length) return Promise.resolve();
      return new Promise<void>((r) => idleWaiters.push(r));
    },
    last(): Job | undefined {
      return queued.at(-1)?.job ?? running?.job;
    },
  };
}
