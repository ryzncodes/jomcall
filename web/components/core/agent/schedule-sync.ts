// Framework-free controller for one branch's opening hours: what the server
// last accepted, what the owner typed, and the saves in between. Saves run
// one at a time (the save queue), each with the revision the one before it
// returned; a lost answer is sent again with the same key and the same body
// before anything newer. hours.tsx wires it to React; node:test drives it
// with fake send and read functions.
import {
  createSaveQueue,
  type QueueStatus,
} from "../../../lib/core/save-queue.ts";
import {
  mergeWeek,
  sameClosures,
  sameWeek,
  weekToSend,
  type Closure,
  type Interval,
} from "./rules.ts";

export type ScheduleData = {
  timezone: string;
  weekdays: Interval[][];
  closures: Closure[];
  revision: number;
};
export type ScheduleBody = Omit<ScheduleData, "revision">;

const copyWeek = (w: Interval[][]) =>
  w.map((d) => d.map((b) => ({ start: b.start, end: b.end })));
// The server's week as { start, end }: its jsonb answers with the keys in
// another order, and one shape keeps every comparison and send alike.
const clean = (d: ScheduleData): ScheduleData => ({
  ...d,
  weekdays: copyWeek(d.weekdays),
});
const copyClosures = (c: Closure[]) => c.map((x) => ({ ...x }));
const sameBody = (a: ScheduleBody, b: ScheduleBody) =>
  a.timezone === b.timezone &&
  sameWeek(a.weekdays, b.weekdays) &&
  sameClosures(a.closures, b.closures);

export function createScheduleSync(o: {
  initial: ScheduleData;
  newKey: () => string;
  isConflict: (e: unknown) => boolean;
  isLost: (e: unknown) => boolean;
  wait?: (ms: number) => Promise<void>;
  // Sends the whole schedule with the revision to check; returns the saved one.
  send: (
    body: ScheduleBody,
    revision: number,
    key: string,
  ) => Promise<ScheduleData>;
  read: () => Promise<ScheduleData>;
  onChange: () => void;
  // After each save the server accepted.
  onSaved?: () => void;
  // After a 409 that left a different schedule on the server.
  onConflict?: () => void;
}) {
  let server = clean(o.initial);
  let weekdays = copyWeek(o.initial.weekdays);
  let closures = copyClosures(o.initial.closures);
  let saving = false;
  let error: unknown;
  let conflicted = false;
  // The owner changed something (not just opened or tidied a row). On a
  // branch that never had hours (revision 0) the default equals "closed every
  // day", so only this tells a real choice from an opened page.
  let touched = false;
  let lastSent: ScheduleBody | undefined;
  let settleWaiters: (() => void)[] = [];
  const notify = () => o.onChange();

  const build = (): ScheduleBody => ({
    timezone: server.timezone,
    weekdays: weekToSend(weekdays, server.weekdays).send,
    closures: copyClosures(closures),
  });

  const queue = createSaveQueue({
    revision: o.initial.revision,
    newKey: o.newKey,
    isConflict: o.isConflict,
    isLost: o.isLost,
    wait: o.wait,
    reread: async () => {
      const fresh = clean(await o.read());
      if (lastSent && sameBody(fresh, lastSent)) {
        server = fresh;
        notify();
        return { revision: fresh.revision, same: true };
      }
      // Someone else saved: untouched days take their version, typed days
      // keep the owner's text.
      weekdays = mergeWeek(server.weekdays, weekdays, fresh.weekdays);
      if (sameClosures(closures, server.closures))
        closures = copyClosures(fresh.closures);
      server = fresh;
      return { revision: fresh.revision, same: false };
    },
    onStatus: (status: QueueStatus, err?: unknown) => {
      if (status === "saving") {
        saving = true;
        error = undefined;
      } else {
        saving = false;
        if (status === "error") error = err;
        if (status === "conflict") {
          conflicted = true;
          o.onConflict?.();
        }
        // A stopped queue (error, conflict) is settled: nothing more runs
        // until the owner saves again.
        const waiters = settleWaiters;
        settleWaiters = [];
        for (const f of waiters) f();
      }
      notify();
    },
  });

  function save() {
    let body: ScheduleBody | undefined;
    void queue
      .push({
        // A newer save replaces one that has not started; both callers wait
        // for the newer.
        slot: "week",
        run: async (revision, key) => {
          // Built once, on the first try: a retry after a lost answer sends
          // the same body under the same key.
          body ??= build();
          if (sameBody(body, server) && !(server.revision === 0 && touched))
            return server.revision;
          lastSent = body;
          const saved = clean(await o.send(body, revision, key));
          server = saved;
          notify();
          o.onSaved?.();
          return saved.revision;
        },
      })
      // The outcome reaches the page through onStatus.
      .catch(() => {});
  }

  return {
    state: () => ({
      server,
      weekdays,
      closures,
      saving,
      error,
      conflicted,
      invalid: weekToSend(weekdays, server.weekdays).invalid,
      // Typed text that the server does not hold yet.
      unsaved:
        !sameWeek(weekdays, server.weekdays) ||
        !sameClosures(closures, server.closures),
    }),
    setWeek(next: Interval[][]) {
      if (!sameWeek(next, weekdays)) touched = true;
      weekdays = copyWeek(next);
      error = undefined;
      conflicted = false;
      notify();
    },
    setClosures(next: Closure[]) {
      if (!sameClosures(next, closures)) touched = true;
      closures = copyClosures(next);
      error = undefined;
      conflicted = false;
      notify();
    },
    save,
    // Reads the schedule again in place: untouched days take the server's
    // version, typed days stay. Waits for saves in flight first.
    async reload() {
      await queue.idle();
      const before = queue.revision();
      const fresh = clean(await o.read());
      // A save started while the read was in flight: this snapshot is older
      // than what the server holds now. Taking it would roll the revision back.
      if (queue.pending() || queue.revision() !== before || fresh.revision < queue.revision())
        return;
      weekdays = mergeWeek(server.weekdays, weekdays, fresh.weekdays);
      if (sameClosures(closures, server.closures))
        closures = copyClosures(fresh.closures);
      server = fresh;
      queue.setRevision(fresh.revision);
      notify();
    },
    pending: () => queue.pending(),
    // Resolves when no save is running: after the saves in flight land, or
    // at once after one stopped with an error. Never waits on a stopped sync.
    settled(): Promise<void> {
      if (!saving) return Promise.resolve();
      return new Promise<void>((r) => settleWaiters.push(r));
    },
    idle: () => queue.idle(),
    revision: () => queue.revision(),
  };
}

type Sync = ReturnType<typeof createScheduleSync>;

// The syncs of one agent page, keyed by branch. It lives as long as the page
// (not the hours view), so typed, refused and unsaved rows and saves in
// flight are still there when the owner comes back to the hours.
export function createHoursStore() {
  const syncs = new Map<string, Sync>();
  const listeners = new Set<() => void>();
  const all = () => [...syncs.values()];
  return {
    get: (branch: string) => syncs.get(branch),
    set(branch: string, sync: Sync) {
      syncs.set(branch, sync);
    },
    notify() {
      for (const f of [...listeners]) f();
    },
    subscribe(f: () => void) {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    // Branches holding text the server does not have.
    unsavedBranches: () =>
      [...syncs].filter(([, s]) => s.state().unsaved).map(([id]) => id),
    unsaved: () => all().some((s) => s.state().unsaved || s.pending()),
    settled: () => Promise.all(all().map((s) => s.settled())).then(() => {}),
  };
}
