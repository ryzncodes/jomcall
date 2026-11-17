"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CoreError, ProxyError } from "@/lib/core/client";
import {
  createSaveQueue,
  type QueueStatus,
} from "@/lib/core/save-queue";
import type {
  Agent,
  AgentChanges,
  AgentSettings,
} from "../../../../packages/contracts/src/core";
import { useCore, useWords, Loading } from "../state";
import {
  afterConflict,
  sameSettings,
  validSettings,
  type View,
} from "./rules";

const defaults: AgentSettings = {
  name: "",
  languages: ["ms", "en"],
  manglish: true,
  greeting: "",
  instructions: "",
  aiDisclosure: "",
  recordingEnabled: false,
  recordingDisclosure: "",
  voicePreference: "",
};
const merged = (a: Agent): AgentSettings => ({ ...defaults, ...a.draft });
const DEBOUNCE_MS = 800;
const CHANGES_DELAY_MS = 2000;

export type Queue = ReturnType<typeof createSaveQueue>;
export type AgentPage = {
  agentId: string;
  settings: AgentSettings;
  // Updates the page at once; the save follows 800 ms after the last call.
  change: (partial: Partial<AgentSettings>) => void;
  // Sends a pending edit now (fields call this on blur).
  flush: () => void;
  // Fields report which one the owner is typing in (kept after a conflict).
  setFocused: (field: keyof AgentSettings | null) => void;
  invalid: (keyof AgentSettings)[];
  // True from an edit until its save has been handed to the queue.
  dirty: boolean;
  status: QueueStatus;
  // The error behind status "error", for the save line.
  error: unknown;
  queue: Queue;
  changes: AgentChanges | undefined;
  refreshChanges: () => void;
  go: (view: View) => Promise<void>;
  // Set after a conflict: the sentence to show.
  notice: string | null;
  // Changes after a conflict; views key their data on it to load again.
  reloadKey: number;
};
const Ctx = createContext<AgentPage>(null as never);
export const useAgentPage = () => useContext(Ctx);

// No answer arrived: a network error, or a proxy's 502/503/504 page.
const isLost = (e: unknown) =>
  e instanceof TypeError ||
  (e instanceof ProxyError && [502, 503, 504].includes(e.status));
const isConflict = (e: unknown) =>
  e instanceof CoreError && e.status === 409 && e.code === "CONFLICT";

export function AgentPageProvider({ children }: { children: React.ReactNode }) {
  const { client, workspace } = useCore();
  const [initial, setInitial] = useState<Agent>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let alive = true;
    setInitial(undefined);
    setError(undefined);
    client
      .execute("draft", { id: workspace.agent.id })
      .then((a) => alive && setInitial(a))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [client, workspace.agent.id]);
  if (!initial) return <Loading error={error} />;
  return (
    <Store key={workspace.agent.id} initial={initial}>
      {children}
    </Store>
  );
}

function Store({
  initial,
  children,
}: {
  initial: Agent;
  children: React.ReactNode;
}) {
  const { client } = useCore(),
    w = useWords(),
    agentId = initial.id;
  const [settings, setSettingsState] = useState(() => merged(initial));
  const [invalid, setInvalid] = useState<(keyof AgentSettings)[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatusState] = useState<QueueStatus>("idle");
  const [saveError, setSaveError] = useState<unknown>();
  const [changes, setChanges] = useState<AgentChanges>();
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const settingsRef = useRef(settings),
    lastValid = useRef(settings),
    lastSent = useRef(settings),
    server = useRef(settings),
    focused = useRef<keyof AgentSettings | null>(null),
    debounce = useRef<ReturnType<typeof setTimeout>>(undefined),
    changesTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    changesSeq = useRef(0),
    statusRef = useRef<QueueStatus>("idle"),
    settingsRunning = useRef(false),
    keepalive = useRef(false),
    stopWaiters = useRef<(() => void)[]>([]),
    wordsRef = useRef(w);
  wordsRef.current = w;

  const setSettings = (next: AgentSettings) => {
    settingsRef.current = next;
    setSettingsState(next);
  };

  const refreshChanges = useCallback(() => {
    const seq = ++changesSeq.current;
    client
      .execute("agentChanges", { id: agentId })
      .then((c) => {
        if (seq === changesSeq.current) setChanges(c);
      })
      .catch(() => {
        // The last known list stays; the next refresh tries again.
      });
  }, [client, agentId]);

  // The queue is made once. Its callbacks read refs, never stale state.
  const queueRef = useRef<Queue>(undefined);
  if (!queueRef.current)
    queueRef.current = createSaveQueue({
      revision: initial.revision,
      newKey: () => crypto.randomUUID(),
      isConflict,
      isLost,
      reread: async () => {
        const a = await client.execute("draft", { id: agentId });
        server.current = merged(a);
        // Same only when this was a settings write and the server already
        // holds what this page last sent (which includes the running edit).
        return {
          revision: a.revision,
          same:
            settingsRunning.current &&
            sameSettings(server.current, lastSent.current),
        };
      },
      onStatus: (s, e) => {
        statusRef.current = s;
        setStatusState(s);
        if (s === "saving") clearTimeout(changesTimer.current);
        if (s === "error" || s === "conflict") {
          setSaveError(s === "error" ? e : undefined);
          for (const r of stopWaiters.current.splice(0)) r();
        }
        if (s === "saved") setSaveError(undefined);
        if (s === "conflict") {
          // The queue holds the server's revision now. Take the server's
          // settings, except the field being typed in, before any push.
          clearTimeout(debounce.current);
          const next = afterConflict(
            server.current,
            settingsRef.current,
            focused.current,
          );
          lastValid.current = server.current;
          lastSent.current = server.current;
          setSettings(next);
          setInvalid(validSettings(next, server.current).invalid);
          setDirty(!sameSettings(next, server.current));
          setNotice(
            wordsRef.current(
              "Someone else changed the agent. This shows the latest.",
              "Orang lain telah mengubah ejen. Ini yang terkini.",
            ),
          );
          setReloadKey((k) => k + 1);
        }
        if (s === "saved" || s === "error" || s === "conflict") {
          clearTimeout(changesTimer.current);
          changesTimer.current = setTimeout(refreshChanges, CHANGES_DELAY_MS);
        }
      },
    });
  const queue = queueRef.current;

  function pushSettings() {
    clearTimeout(debounce.current);
    const { send, invalid: bad } = validSettings(
      settingsRef.current,
      lastValid.current,
    );
    setInvalid(bad);
    setDirty(false);
    if (sameSettings(send, lastValid.current) && !queue.pending()) return;
    queue
      .push({
        slot: "settings",
        run: async (revision, key) => {
          lastSent.current = send;
          settingsRunning.current = true;
          try {
            const a = await client.execute(
              "saveDraft",
              { id: agentId, expectedRevision: revision, settings: send },
              key,
              undefined,
              keepalive.current ? { keepalive: true } : undefined,
            );
            lastValid.current = send;
            return a.revision;
          } finally {
            settingsRunning.current = false;
          }
        },
      })
      .catch(() => {
        // The outcome is shown through the queue's status.
      });
  }

  const change = (partial: Partial<AgentSettings>) => {
    setSettings({ ...settingsRef.current, ...partial });
    setInvalid(
      validSettings(settingsRef.current, lastValid.current).invalid,
    );
    setDirty(true);
    setNotice(null);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(pushSettings, DEBOUNCE_MS);
  };
  const flush = () => {
    if (dirtyRef.current) pushSettings();
  };
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  async function go(view: View) {
    clearTimeout(debounce.current);
    if (dirtyRef.current) pushSettings();
    // After an error the queue may still hold jobs; do not wait for them.
    if (statusRef.current !== "error") {
      let stop!: () => void;
      const stopped = new Promise<void>((r) => {
        stop = r;
        stopWaiters.current.push(r);
      });
      await Promise.race([queue.idle(), stopped]);
      stopWaiters.current = stopWaiters.current.filter((r) => r !== stop);
    }
    location.hash = view === "home" ? "" : view;
  }

  useEffect(() => {
    refreshChanges();
    const pagehide = () => {
      keepalive.current = true;
      try {
        if (dirtyRef.current) {
          pushSettings();
        } else if (queue.pending()) {
          // Best effort: sends the newest job once more with a keepalive
          // request; a stale revision or a large body is refused silently.
          queue
            .last()
            ?.run(queue.revision(), crypto.randomUUID())
            .catch(() => {});
        }
      } finally {
        keepalive.current = false;
      }
    };
    const beforeunload = (e: BeforeUnloadEvent) => {
      if (queue.pending() || dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("beforeunload", beforeunload);
    return () => {
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("beforeunload", beforeunload);
      // Leaving the page inside the app: an edit still waiting is sent.
      if (dirtyRef.current) pushSettings();
      clearTimeout(debounce.current);
      clearTimeout(changesTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider
      value={{
        agentId,
        settings,
        change,
        flush,
        setFocused: (f) => {
          focused.current = f;
        },
        invalid,
        dirty,
        status,
        error: saveError,
        queue,
        changes,
        refreshChanges,
        go,
        notice,
        reloadKey,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
