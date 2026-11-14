"use client";
// Guided setup: pick a business type, answer up to 8 questions, check one
// review page, try a call, publish once. The stage comes from server state
// read when the page opens; answers are kept as the owner moves on.
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

// The pack every agent has; kept here so the client never loads pack data.
export const BASE_PACK = "every-business";
export const MAX_QUESTIONS = 8;

// The parts of the `packs` command's answer this flow reads.
export type PackInfo = {
  id: string;
  name: { en: string; ms: string };
  callPurpose: { en: string; ms: string };
  pairsWith: string[];
  facts: { key: string; label: { en: string; ms: string }; required: boolean }[];
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
  setView: (v: Setup) => void;
  reload: () => Promise<Setup | undefined>;
  // One write at a time, each with the latest session revision.
  write: (fn: (expectedRevision: number) => Promise<Setup>) => Promise<boolean>;
  // Sends every pending field, then waits for the writes in flight.
  flushAll: () => Promise<boolean>;
  revision: () => number;
  flushers: Set<() => Promise<boolean>>;
  saving: boolean;
  saved: boolean;
  error: unknown;
};
const StoreContext = createContext<Store>({} as never);
export const useSetup = () => useContext(StoreContext);

// A field's value is sent 600 ms after the last change, or at once when the
// field is left or the owner moves on.
export function useAutosave<T>(save: (value: T) => Promise<boolean>) {
  const store = useSetup();
  const saveRef = useRef(save);
  saveRef.current = save;
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return true;
    pending.current = null;
    const ok = await saveRef.current(p.value);
    if (!ok && !pending.current) pending.current = p;
    return ok;
  }, []);
  const { flushers } = store;
  useEffect(() => {
    flushers.add(flush);
    return () => {
      flushers.delete(flush);
      void flush();
    };
  }, [flushers, flush]);
  return {
    change: (value: T) => {
      pending.current = { value };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 600);
    },
    flush,
    cancel: () => {
      clearTimeout(timer.current);
      pending.current = null;
    },
    dirty: () => pending.current !== null,
  };
}

export function SaveMark() {
  const { saving, saved } = useSetup(),
    w = useWords();
  return (
    <p className="setup-saved" role="status">
      {saving ? w("Saving…", "Menyimpan…") : saved ? w("Saved", "Disimpan") : ""}
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

type Loaded = { view: Setup; packs: PackInfo[]; agentPacks: string[] };

function SetupLoader() {
  const { client, workspace } = useCore(),
    w = useWords(),
    { locale } = useExperience();
  const agentId = workspace.agent.id;
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  // Read once when the page opens; no polling, so a background refresh never
  // moves the owner to another stage while they type.
  useEffect(() => {
    let alive = true;
    Promise.all([
      client.execute("setup", { id: agentId }),
      client.execute("packs", {}),
      client.execute("knowledgeCore", { id: agentId }),
    ])
      .then(([view, packs, core]) => {
        if (alive) {
          setData({ view, packs, agentPacks: core.packs });
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
  const revision = useRef(initial.view.session?.revision ?? 0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [flushers] = useState(() => new Set<() => Promise<boolean>>());
  const [inFlight, setInFlight] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  // Stage overrides held for this visit only: changing the business type,
  // the finish page right after apply (even when an older version is
  // published), the live page right after publishing, and a "missing" fact
  // being added. A reload reads the stage from the server again.
  const [override, setOverride] = useState<
    "type" | "finish" | "live" | null
  >(null);
  const [interviewing, setInterviewing] = useState(false);
  const [interviewKey, setInterviewKey] = useState(0);
  const [adding, setAdding] = useState<SetupQuestionView | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Keep-or-replace choices survive a trip to "Add now" and back.
  const [choices, setChoices] = useState<Record<string, "keep" | "new">>({});
  const [returnTo, setReturnTo] = useState<"finish" | "live" | null>(null);
  const [snapshot, setSnapshot] = useState<{
    queue: SetupQuestionView[];
    total: number;
  }>();

  const setView = useCallback((v: Setup) => {
    setViewState(v);
    if (v.session) revision.current = v.session.revision;
  }, []);
  const reload = useCallback(async () => {
    try {
      const v = await client.execute("setup", { id: agentId });
      setView(v);
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
        try {
          setView(await fn(revision.current));
          setSaved(true);
          return true;
        } catch (e) {
          setSaved(false);
          if (e instanceof CoreError && e.code === "CONFLICT") await reload();
          setError(e);
          return false;
        } finally {
          setInFlight((n) => n - 1);
        }
      });
      chain.current = next.catch(() => undefined);
      return next;
    },
    [reload, setView],
  );
  const flushAll = useCallback(async () => {
    const results = await Promise.all([...flushers].map((f) => f()));
    await chain.current;
    return results.every(Boolean);
  }, [flushers]);

  const published = !!workspace.agent.published_version_id;
  const stage: "type" | "interview" | "add" | "review" | "finish" | "live" =
    override === "type"
      ? "type"
      : view.session
        ? adding
          ? "add"
          : interviewing || view.questions.length
            ? "interview"
            : "review"
        : override === "finish" || override === "live"
          ? override
          : published
            ? "live"
            : initial.agentPacks.length
              ? "finish"
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
    reload,
    write,
    flushAll,
    revision: () => revision.current,
    flushers,
    saving: inFlight > 0,
    saved,
    error,
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
            setInterviewing(false);
            setInterviewKey((k) => k + 1);
          }}
          onCancel={
            view.session
              ? () => setOverride(null)
              : returnTo
                ? () => setOverride(returnTo)
                : undefined
          }
        />
      ) : stage === "interview" ? (
        snapshot && interviewing ? (
          <Interview
            key={interviewKey}
            queue={snapshot.queue}
            total={snapshot.total}
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
          onDismiss={(id) => setDismissed((d) => [...d, id])}
          onApplied={() => {
            setView({ ...view, session: null, questions: [] });
            setOverride("finish");
          }}
        />
      ) : stage === "finish" ? (
        <FinishStage
          onPublished={() => setOverride("live")}
          onRestart={() => {
            setReturnTo("finish");
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
