"use client";
// Guided setup: pick a business type, bring a document if there is one,
// answer up to 8 questions, check one review page, try a call, publish once.
// The stage comes from server state read when the page opens; answers are
// kept as the owner moves on.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CoreError } from "@/lib/core/client";
import type {
  Setup,
  SetupItem,
  SetupQuestionView,
} from "../../../../packages/contracts/src/setup";
import { useCore, useWords, Notice, errorText } from "../state";
import { useExperience } from "../../experience";
import { BusinessTypeStage } from "./business-type";
import { Interview } from "./interview";
import { Review } from "./review";
import { FinishStage, LiveStage } from "./finish";
import { BringStage } from "./bring";
import { useUploadManager, type UploadManager } from "./upload";
import {
  bringFirst,
  firstSeenQueued,
  mergeUploads,
  pollDelay,
  quietRetry,
  readingNow,
  sendsOnUnmount,
  sendsWhenHidden,
  type KnownUpload,
} from "./rules";
import type { SetupUpload } from "../../../../packages/contracts/src/setup-upload";

// The pack every agent has; kept here so the client never loads pack data.
export const BASE_PACK = "every-business";
export const MAX_QUESTIONS = 8;

// The parts of the `packs` command's answer this flow reads.
export type PackInfo = {
  id: string;
  name: { en: string; ms: string };
  callPurpose: { en: string; ms: string };
  pairsWith: string[];
  facts: {
    key: string;
    label: { en: string; ms: string };
    required: boolean;
  }[];
};

export const packOf = (i: SetupItem) =>
  (i.payload as { packId?: unknown } | null)?.packId as string | undefined;

// The staged item that answers a question: same slot and, for a fact, the
// same pack. A "missing:<pack>:<key>" question names its pack in the id.
export function itemFor(
  items: SetupItem[],
  q: SetupQuestionView,
): SetupItem | undefined {
  if (q.kind === "hours") return items.find((i) => i.kind === "schedule");
  if (q.kind === "first_words") return items.find((i) => i.kind === "settings");
  const key = q.fills.find((f) => f.startsWith("facts."))?.slice(6);
  const pack = q.id.startsWith("missing:")
    ? q.id.split(":")[1]
    : q.id.split(":")[0];
  return items.find(
    (i) => i.kind === "fact" && i.key === key && packOf(i) === pack,
  );
}

// The view lists only unanswered questions, so the frozen total is counted
// as items that answer a question of an active pack plus those still open.
export function frozenTotal(view: Setup): number {
  const s = view.session;
  if (!s) return 0;
  const active = [BASE_PACK, s.mainPack, ...s.extraPacks];
  const answered = view.items.filter(
    (i) =>
      i.kind === "schedule" ||
      i.kind === "settings" ||
      (i.kind === "fact" && active.includes(packOf(i) ?? "")),
  ).length;
  return Math.min(MAX_QUESTIONS, answered + view.questions.length);
}

type Store = {
  agentId: string;
  view: Setup;
  // `at` is the request counter taken when the view was asked for; left
  // out, the view counts as the newest.
  setView: (v: Setup, at?: number) => void;
  // The latest view, also after an await inside a handler.
  latest: () => Setup;
  reload: () => Promise<Setup | undefined>;
  // One write at a time, each with the latest session revision.
  write: (fn: (expectedRevision: number) => Promise<Setup>) => Promise<boolean>;
  // Sends every pending field, then waits for the writes in flight.
  flushAll: () => Promise<boolean>;
  revision: () => number;
  flushers: Set<() => Promise<boolean>>;
  landed: { current: string | null };
  saving: boolean;
  saved: boolean;
  error: unknown;
  // Files being sent; lives here so sending goes on behind other stages.
  uploads: UploadManager;
  // The clock the upload labels read (moved on by each poll).
  now: number;
  // When this browser first saw each upload queued, on its own clock.
  queuedSince: ReadonlyMap<string, number>;
};
const StoreContext = createContext<Store>({} as never);
export const useSetup = () => useContext(StoreContext);

// A field's value is sent 600 ms after the last change, or at once when the
// field is left or the owner moves on. With `debounce: false` a change is
// only held until flush (the field is left, Enter, the flush before apply or
// another stage): a price edit confirms its row, so neither a pause in
// typing, switching apps (sendsWhenHidden) nor unmounting (sendsOnUnmount,
// the value is dropped) sends it. flush waits for a save of this field
// already in flight and reports its failure, so a Confirm right after the
// field is left never confirms the old value.
export function useAutosave<T>(
  save: (value: T) => Promise<boolean>,
  { debounce = true }: { debounce?: boolean } = {},
) {
  const store = useSetup();
  const saveRef = useRef(save);
  saveRef.current = save;
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<Promise<boolean> | null>(null);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const running = inflight.current;
    if (running && !(await running)) return false;
    const p = pending.current;
    if (!p) return true;
    pending.current = null;
    const job: Promise<boolean> = saveRef.current(p.value).then((ok) => {
      // Cleared before anyone awaiting it resumes: a later flush retries a
      // failed value instead of reporting this failure again.
      if (inflight.current === job) inflight.current = null;
      if (!ok && !pending.current) pending.current = p;
      return ok;
    });
    inflight.current = job;
    return job;
  }, []);
  const { flushers } = store;
  const onHide = sendsWhenHidden({ debounce });
  const onUnmount = sendsOnUnmount({ debounce });
  useEffect(() => {
    flushers.add(flush);
    // Text typed inside the debounce window is sent when the tab is hidden
    // (switching apps, closing the tab), while the page can still send.
    const hide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const leave = () => void flush();
    if (onHide) {
      document.addEventListener("visibilitychange", hide);
      window.addEventListener("pagehide", leave);
    }
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      flushers.delete(flush);
      if (onUnmount) void flush();
      else {
        clearTimeout(timer.current);
        pending.current = null;
      }
    };
  }, [flushers, flush, onHide, onUnmount]);
  return {
    change: (value: T) => {
      pending.current = { value };
      clearTimeout(timer.current);
      if (debounce) timer.current = setTimeout(() => void flush(), 600);
    },
    flush,
    cancel: () => {
      clearTimeout(timer.current);
      pending.current = null;
    },
    dirty: () => pending.current !== null,
  };
}

// After a stage or question change, bring the flow to the top and move
// focus to the new heading. The first screen of a visit stays as it loads.
// `screen` names the screen, so running the effect twice for the same
// screen (React's development double run) does not move anything.
export function useLanding<T extends HTMLElement>(screen: string) {
  const { landed } = useSetup();
  const ref = useRef<T>(null);
  useEffect(() => {
    const first = landed.current === null;
    if (landed.current === screen) return;
    landed.current = screen;
    if (first) return;
    const el = ref.current;
    el?.closest(".setup-flow, .setup-finish")?.scrollIntoView({
      block: "start",
    });
    el?.focus({ preventScroll: true });
  }, [landed, screen]);
  return ref;
}

export function SaveMark() {
  const { saving, saved } = useSetup(),
    w = useWords();
  return (
    <p className="setup-saved" role="status">
      {saving
        ? w("Saving…", "Menyimpan…")
        : saved
          ? w("Saved", "Disimpan")
          : ""}
    </p>
  );
}

// Save errors. A stale revision has already reloaded the view by now.
export function SetupNotice({ error }: { error: unknown }) {
  const w = useWords();
  if (error instanceof CoreError && error.code === "CONFLICT")
    return (
      <div className="storage-warning" role="alert">
        {w(
          "Setup changed in another window. The latest answers are loaded; check this one and continue.",
          "Persediaan telah berubah di tetingkap lain. Jawapan terkini sudah dimuatkan; semak jawapan ini dan teruskan.",
        )}
      </div>
    );
  return <Notice error={error} />;
}

export function SetupFlow() {
  const { workspace } = useCore(),
    w = useWords();
  if (workspace.role === "staff")
    return (
      <div className="setup-flow">
        <h1 className="setup-title">
          {w(
            "Setup is for owners and admins. Ask one of them to finish it.",
            "Persediaan untuk pemilik dan pentadbir. Minta mereka melengkapkannya.",
          )}
        </h1>
      </div>
    );
  return <SetupLoader />;
}

type Loaded = { view: Setup; packs: PackInfo[] };

function SetupLoader() {
  const { client, workspace } = useCore(),
    w = useWords(),
    { locale } = useExperience();
  const agentId = workspace.agent.id;
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  // Read once when the page opens. The stages poll only while a document is
  // being read, and that never moves the owner to another stage.
  useEffect(() => {
    let alive = true;
    Promise.all([
      client.execute("setup", { id: agentId }),
      client.execute("packs", {}),
    ])
      .then(([view, packs]) => {
        if (alive) {
          setData({ view, packs });
          setError(undefined);
        }
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [client, agentId, attempt]);
  if (!data)
    return (
      <div className="setup-flow">
        {error ? (
          <>
            <div className="storage-warning" role="alert">
              {errorText(error, locale === "ms")}
            </div>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => setAttempt((v) => v + 1)}
            >
              {w("Retry", "Cuba lagi")}
            </button>
          </>
        ) : (
          <p role="status">{w("Loading setup…", "Memuatkan persediaan…")}</p>
        )}
      </div>
    );
  return <SetupStages initial={data} agentId={agentId} />;
}

function SetupStages({
  initial,
  agentId,
}: {
  initial: Loaded;
  agentId: string;
}) {
  const { client, workspace } = useCore();
  const [view, setViewState] = useState(initial.view);
  const latestView = useRef(initial.view);
  const revision = useRef(initial.view.session?.revision ?? 0);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const [flushers] = useState(() => new Set<() => Promise<boolean>>());
  const landed = useRef<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  // Stage overrides held for this visit only: changing the business type
  // and the live page right after publishing (the view's `finish` is not
  // read again). A reload reads the stage from the server again.
  const [override, setOverride] = useState<"type" | "live" | null>(null);
  const [interviewing, setInterviewing] = useState(false);
  const [interviewKey, setInterviewKey] = useState(0);
  const [adding, setAdding] = useState<SetupQuestionView | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Keep-or-replace choices survive a trip to "Add now" and back.
  const [choices, setChoices] = useState<Record<string, "keep" | "new">>({});
  // Where Back on the business type goes when no session is open.
  const [returnTo, setReturnTo] = useState<"live" | null | undefined>();
  const [snapshot, setSnapshot] = useState<{
    queue: SetupQuestionView[];
    total: number;
  }>();
  // Whether the "bring a document" stage is showing. Decided once from the
  // view when the page opens or a session starts (an untouched session),
  // then only by the owner: "Add a document" opens it, Continue closes it.
  // An upload added on the stage does not move the owner on.
  const [bringing, setBringing] = useState(() => bringFirst(initial.view));
  // How the owner reached it: Back returns to the interview or review when
  // they came through "Add a document", else to the business type.
  const [bringVia, setBringVia] = useState<"start" | "link">("start");

  // Every view request takes a number from this counter, and so does every
  // upload change this browser makes, so mergeUploads can tell an older
  // answer from a newer one.
  const requests = useRef(0);
  // The latest view as the server sent it, before merging.
  const raw = useRef<{ view: Setup; at: number }>({ view: initial.view, at: 0 });
  // What is known about each upload of the open session (see mergeUploads).
  const known = useRef<{
    session: string | null;
    uploads: Map<string, KnownUpload>;
  }>({ session: null, uploads: new Map() });
  // When this browser first saw each upload queued (see stalled).
  const queuedSince = useRef<Map<string, number>>(new Map());
  const show = useCallback((next: Setup, at: number) => {
    let v = next;
    if (v.session) {
      if (known.current.session !== v.session.id)
        known.current = { session: v.session.id, uploads: new Map() };
      const merged = mergeUploads(v.uploads, at, known.current.uploads);
      known.current.uploads = merged.known;
      v = { ...v, uploads: merged.uploads };
      queuedSince.current = firstSeenQueued(
        queuedSince.current,
        v.uploads,
        Date.now(),
      );
    }
    latestView.current = v;
    setViewState(v);
    if (v.session) revision.current = v.session.revision;
  }, []);
  const setView = useCallback(
    (next: Setup, at = ++requests.current) => {
      raw.current = { view: next, at };
      show(next, at);
    },
    [show],
  );
  // An upload this browser just changed: merged again against the latest
  // server view (not the merged one), counted as newer than it.
  const holdUpload = useCallback(
    (id: string, upload: SetupUpload | "removed") => {
      const { view: v, at } = raw.current;
      if (!v.session) return;
      if (known.current.session !== v.session.id)
        known.current = { session: v.session.id, uploads: new Map() };
      known.current.uploads.set(id, { upload, at: ++requests.current });
      show(v, at);
    },
    [show],
  );
  const reload = useCallback(async () => {
    const at = ++requests.current;
    try {
      const v = await client.execute("setup", { id: agentId });
      setView(v, at);
      return v;
    } catch (e) {
      setError(e);
      return undefined;
    }
  }, [client, agentId, setView]);
  const write = useCallback(
    (fn: (expectedRevision: number) => Promise<Setup>) => {
      const next = chain.current.then(async () => {
        setInFlight((n) => n + 1);
        setError(undefined);
        // The view this try is built on and the revision it carries, taken
        // just before sending: a poll landing while it is in flight must
        // not become the baseline of the conflict check.
        let base = latestView.current,
          sent = revision.current;
        const attempt = async () => {
          const at = ++requests.current;
          base = latestView.current;
          sent = revision.current;
          setView(await fn(sent), at);
          setSaved(true);
          return true;
        };
        try {
          return await attempt();
        } catch (e) {
          setSaved(false);
          let failure = e;
          if (e instanceof CoreError && e.code === "CONFLICT") {
            // A document finishing its read raises the revision too. When
            // that is all that changed since this save's own baseline, the
            // save goes again once, quietly, with the fresh revision.
            const fresh = await reload();
            if (fresh && quietRetry(base, sent, latestView.current)) {
              try {
                return await attempt();
              } catch (again) {
                failure = again;
                if (again instanceof CoreError && again.code === "CONFLICT")
                  await reload();
              }
            }
          }
          setError(failure);
          return false;
        } finally {
          setInFlight((n) => n - 1);
        }
      });
      chain.current = next.catch(() => false);
      return next;
    },
    [reload, setView],
  );
  // A quiet read for polling and after an upload change: no error shown,
  // and a view older than the latest write is dropped, so the revision the
  // next write sends never goes back.
  const refresh = useCallback(async () => {
    const at = ++requests.current;
    try {
      const v = await client.execute("setup", { id: agentId });
      if ((v.session?.revision ?? -1) >= revision.current) setView(v, at);
    } catch {
      // The next poll or action reads again.
    }
  }, [client, agentId, setView]);
  const uploads = useUploadManager({
    client,
    agentId,
    uploads: view.uploads,
    hold: holdUpload,
    refresh,
  });
  // While a document waits for the reader or is being read, the view is
  // read again (every 3 s for a minute, then every 10 s), only while the
  // page is visible. A finished read adds items and raises the revision.
  // An upload queued for more than 10 minutes is no longer polled for.
  const [now, setNow] = useState(() => Date.now());
  const reading =
    !!view.session && readingNow(view.uploads, now, queuedSince.current);
  useEffect(() => {
    if (!reading) return;
    const started = Date.now();
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await refresh();
      if (!alive) return;
      setNow(Date.now());
      timer = setTimeout(tick, pollDelay(Date.now() - started));
    };
    timer = setTimeout(tick, pollDelay(0));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [reading, refresh]);
  // Coming back to the tab reads the view at once while any upload is
  // still waiting or being read (also one no longer polled for).
  const waiting =
    !!view.session &&
    view.uploads.some((u) => u.state === "queued" || u.state === "reading");
  useEffect(() => {
    if (!waiting) return;
    const back = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      void refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [waiting, refresh]);

  // Waits for writes in flight first: a failed field value goes back to its
  // field and is sent again by its flusher, so nothing typed is lost.
  const flushAll = useCallback(async () => {
    await chain.current;
    const results = await Promise.all([...flushers].map((f) => f()));
    await chain.current;
    return results.every(Boolean);
  }, [flushers]);

  const published = !!workspace.agent.published_version_id;
  const readerOn = view.reader === "ready";
  const stage:
    | "type"
    | "bring"
    | "interview"
    | "add"
    | "review"
    | "finish"
    | "live" =
    override === "type"
      ? "type"
      : view.session
        ? adding
          ? "add"
          : bringing && readerOn
            ? "bring"
            : interviewing || view.questions.length
            ? "interview"
            : "review"
        : override === "live"
          ? "live"
          : view.finish
            ? "finish"
            : published
              ? "live"
              : "type";

  // Entering the interview freezes this visit's queue, so an answer saved
  // while the owner types never moves the screen.
  useEffect(() => {
    if (stage === "interview" && !interviewing) {
      setSnapshot({ queue: view.questions, total: frozenTotal(view) });
      setInterviewing(true);
    }
  }, [stage, interviewing, view]);

  const store: Store = {
    agentId,
    view,
    setView,
    latest: () => latestView.current,
    reload,
    write,
    flushAll,
    revision: () => revision.current,
    flushers,
    landed,
    saving: inFlight > 0,
    saved,
    error,
    uploads,
    now,
    queuedSince: queuedSince.current,
  };
  // "Add a document" on the interview and review pages: answers typed so
  // far are sent first.
  const openBring = readerOn
    ? async () => {
        if (await flushAll()) {
          setBringVia("link");
          setBringing(true);
        }
      }
    : undefined;
  // Leaving the bring stage for the questions: a fresh interview queue,
  // because reads may have answered questions and the owner may have come
  // here in the middle of it.
  const leaveBring = () => {
    setBringing(false);
    setInterviewing(false);
    setInterviewKey((k) => k + 1);
  };

  return (
    <StoreContext.Provider value={store}>
      {stage === "type" ? (
        <BusinessTypeStage
          packs={initial.packs}
          session={view.session}
          onStarted={(v) => {
            setView(v);
            setOverride(null);
            setBringing(bringFirst(v));
            setBringVia("start");
            setInterviewing(false);
            setInterviewKey((k) => k + 1);
          }}
          onCancel={
            view.session
              ? () => setOverride(null)
              : returnTo !== undefined
                ? () => setOverride(returnTo)
                : undefined
          }
        />
      ) : stage === "bring" ? (
        <BringStage
          onBack={bringVia === "link" ? leaveBring : () => setOverride("type")}
          onContinue={leaveBring}
        />
      ) : stage === "interview" ? (
        snapshot && interviewing ? (
          <Interview
            key={interviewKey}
            queue={snapshot.queue}
            total={snapshot.total}
            onBring={openBring}
            onBack={() => setOverride("type")}
            onDone={() => {
              setInterviewing(false);
              setInterviewKey((k) => k + 1);
            }}
          />
        ) : null
      ) : stage === "add" && adding ? (
        <Interview
          key={adding.id}
          queue={[adding]}
          total={null}
          onBack={() => setAdding(null)}
          onDone={(skipped) => {
            if (skipped) setDismissed((d) => [...d, adding.id]);
            setAdding(null);
          }}
        />
      ) : stage === "review" ? (
        <Review
          packs={initial.packs}
          dismissed={dismissed}
          choices={choices}
          onChoice={(id, c) => setChoices((s) => ({ ...s, [id]: c }))}
          onAdd={(q) => setAdding(q)}
          onBring={openBring}
          onDismiss={(id) => setDismissed((d) => [...d, id])}
          onApplied={() => {
            setView({ ...view, session: null, questions: [], finish: true });
          }}
        />
      ) : stage === "finish" ? (
        <FinishStage
          onPublished={() => setOverride("live")}
          onRestart={() => {
            setReturnTo(null);
            setOverride("type");
          }}
        />
      ) : (
        <LiveStage
          onRestart={() => {
            setReturnTo("live");
            setOverride("type");
          }}
        />
      )}
    </StoreContext.Provider>
  );
}
