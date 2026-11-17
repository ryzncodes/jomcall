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
import type { QueueStatus } from "@/lib/core/save-queue";
import type {
  Agent,
  AgentChanges,
  AgentSettings,
} from "../../../../packages/contracts/src/core";
import { useCore, useWords, Loading } from "../state";
import { type GapDrafts, type View, withVoice } from "./rules";
import { createSettingsSync } from "./settings-sync";
import { createHoursStore } from "./schedule-sync";

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
const merged = (a: Agent): AgentSettings =>
  withVoice({ ...defaults, ...a.draft });
const CHANGES_DELAY_MS = 2000;

export type Queue = ReturnType<typeof createSettingsSync>["queue"];
export type AgentPage = {
  agentId: string;
  settings: AgentSettings;
  // Updates the page at once; the save follows 800 ms after the last call.
  change: (partial: Partial<AgentSettings>) => void;
  // Sends a pending edit now (fields call this on blur).
  flush: () => void;
  // Fields report which one the owner is typing in (kept after a conflict).
  setFocused: (field: keyof AgentSettings | null) => void;
  // A field lost focus: sends its edit, then forgets the focus once settled.
  blur: (field: keyof AgentSettings) => void;
  // Reads the draft settings again (after a restore).
  reloadSettings: () => Promise<void>;
  // A restore is in flight, or its reload has not succeeded: settings
  // edits are refused and nothing is sent.
  locked: boolean;
  reloadFailed: boolean;
  // Sends the waiting edit, then runs the restore with settings edits held.
  restore: (
    run: () => Promise<unknown>,
  ) => Promise<"unsaved" | "restored" | "reloadFailed">;
  invalid: (keyof AgentSettings)[];
  // True while an edit is not on the server: waiting, being sent, or failed.
  dirty: boolean;
  // True from an edit until its save is handed to the queue.
  waiting: boolean;
  status: QueueStatus;
  // The error behind status "error", for the save line.
  error: unknown;
  queue: Queue;
  // Per-branch opening hours state; lives as long as the page, so unsaved
  // hours are still here when the owner comes back to #hours.
  hours: ReturnType<typeof createHoursStore>;
  // Typed answers on the questions view; they outlive a change of view.
  gapDrafts: GapDrafts;
  updateGapDrafts: (update: (drafts: GapDrafts) => GapDrafts) => void;
  changes: AgentChanges | undefined;
  refreshChanges: () => void;
  go: (view: View) => Promise<void>;
  // Set after a conflict: the sentence to show.
  notice: string | null;
  // Shows a sentence in the header until the next move to another view.
  announce: (text: string) => void;
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
  const [, tick] = useState(0);
  const [changes, setChanges] = useState<AgentChanges>();
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const announced = useRef(false);
  const gapDraftsRef = useRef<GapDrafts>({});
  const changesTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    changesSeq = useRef(0),
    wordsRef = useRef(w);
  wordsRef.current = w;

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

  const syncRef = useRef<ReturnType<typeof createSettingsSync>>(undefined);
  if (!syncRef.current)
    syncRef.current = createSettingsSync({
      initial: merged(initial),
      revision: initial.revision,
      newKey: () => crypto.randomUUID(),
      isConflict,
      isLost,
      send: async (settings, revision, key, keepalive) =>
        (
          await client.execute(
            "saveDraft",
            { id: agentId, expectedRevision: revision, settings },
            key,
            undefined,
            keepalive ? { keepalive: true } : undefined,
          )
        ).revision,
      read: async () => {
        const a = await client.execute("draft", { id: agentId });
        return { revision: a.revision, settings: merged(a) };
      },
      onChange: () => tick((n) => n + 1),
      onStatus: (s) => {
        if (s === "saving") clearTimeout(changesTimer.current);
        if (s === "saved" || s === "error" || s === "conflict") {
          clearTimeout(changesTimer.current);
          changesTimer.current = setTimeout(refreshChanges, CHANGES_DELAY_MS);
        }
      },
      onConflict: () => {
        setNotice(
          wordsRef.current(
            "Someone else changed the agent. This shows the latest.",
            "Orang lain telah mengubah ejen. Ini yang terkini.",
          ),
        );
        setReloadKey((k) => k + 1);
      },
    });
  const sync = syncRef.current;
  const hoursRef = useRef<ReturnType<typeof createHoursStore>>(undefined);
  if (!hoursRef.current) hoursRef.current = createHoursStore();
  const hours = hoursRef.current;

  async function go(view: View) {
    if (announced.current) {
      announced.current = false;
      setNotice(null);
    }
    sync.flush();
    // Schedule saves in flight land first; a sync stopped by an error is
    // not waited on.
    await Promise.all([sync.settled(), hours.settled()]);
    location.hash = view === "home" ? "" : view;
  }

  useEffect(() => {
    refreshChanges();
    // Home shows a hint while hours are unsaved, so it follows the store.
    const unsubscribe = hours.subscribe(() => tick((n) => n + 1));
    const pagehide = () => sync.pagehide();
    const beforeunload = (e: BeforeUnloadEvent) => {
      const typed = Object.values(gapDraftsRef.current).some(
        (d) => d.answer.trim() || d.topic.trim(),
      );
      if (sync.queue.pending() || sync.unsaved() || hours.unsaved() || typed) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("beforeunload", beforeunload);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("beforeunload", beforeunload);
      // Leaving the page inside the app: an edit still waiting is sent.
      sync.flush();
      sync.dispose();
      clearTimeout(changesTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider
      value={{
        agentId,
        settings: sync.settings(),
        change: (partial) => {
          setNotice(null);
          sync.change(partial);
        },
        flush: sync.flush,
        setFocused: sync.setFocused,
        blur: (field) => sync.blur(field),
        reloadSettings: () => sync.reload(),
        locked: sync.held(),
        reloadFailed: sync.reloadFailed(),
        restore: (run) => sync.restore(run),
        invalid: sync.invalid(),
        dirty: sync.unsaved(),
        waiting: sync.dirty(),
        status: sync.status(),
        error: sync.error(),
        queue: sync.queue,
        hours,
        gapDrafts: gapDraftsRef.current,
        updateGapDrafts: (update) => {
          gapDraftsRef.current = update(gapDraftsRef.current);
          tick((n) => n + 1);
        },
        changes,
        refreshChanges,
        go,
        notice,
        announce: (text) => {
          announced.current = true;
          setNotice(text);
        },
        reloadKey,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
