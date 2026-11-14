"use client";
// Stage 4: try a call on the draft with the existing test panel, then
// publish once with the existing `publish` command and its rules.
import { useEffect, useRef, useState } from "react";
import { CoreError } from "@/lib/core/client";
import type { SessionDetail } from "../../../../packages/contracts/src/agent-test";
import { useCore, useWords, Notice } from "../state";
import { useExperience } from "../../experience";
import { LocalAgentTest } from "../agent-test";
import { useLanding } from "./flow";
import { pollDelay, unlocksPublish } from "./rules";

// True once a draft test session created after this stage opened has a
// completed answer. Sessions listed at mount form the baseline; the panel
// keeps its open test in the URL (?testSession=), which is cleared on entry
// so an older test never reopens here. Without a baseline nothing unlocks.
function useTestedHere() {
  const { client } = useCore();
  const [tested, setTested] = useState(false);
  const [baselineError, setBaselineError] = useState<unknown>();
  const baseline = useRef<Set<string> | null>(null);
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("testSession")) {
      url.searchParams.delete("testSession");
      history.replaceState(null, "", url);
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const opened = Date.now();
    let running = false;
    let unlocked = false;
    const check = async () => {
      if (!baseline.current)
        try {
          const list = await client.execute("agentTests", {});
          baseline.current = new Set(list.map((t) => t.id));
          if (alive) setBaselineError(undefined);
        } catch (e) {
          if (alive) setBaselineError(e);
        }
      const id = new URL(location.href).searchParams.get("testSession");
      if (baseline.current && id && !baseline.current.has(id))
        try {
          const d: SessionDetail = await client.execute("agentTest", { id });
          if (unlocksPublish(baseline.current, d)) unlocked = true;
        } catch {
          // The panel shows its own errors.
        }
    };
    const poll = async () => {
      clearTimeout(timer);
      timer = undefined;
      // The baseline loads at once; checking for a new test runs only while
      // the page is visible, and visibilitychange restarts it.
      if (!alive || running || unlocked) return;
      if (document.visibilityState !== "visible" && baseline.current) return;
      running = true;
      await check();
      running = false;
      if (!alive) return;
      if (unlocked) setTested(true);
      else
        timer = setTimeout(() => void poll(), pollDelay(Date.now() - opened));
    };
    const visible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client]);
  return { tested, baselineError };
}

export function FinishStage({
  onPublished,
  onRestart,
}: {
  onPublished: () => void;
  onRestart: () => void;
}) {
  const { client, workspace, refresh } = useCore(),
    w = useWords(),
    { href } = useExperience();
  const { tested, baselineError } = useTestedHere();
  const heading = useLanding<HTMLHeadingElement>("finish");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const publish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const draft = await client.execute("draft", { id: workspace.agent.id });
      await client.execute("publish", {
        id: workspace.agent.id,
        expectedRevision: draft.revision,
      });
      refresh();
      onPublished();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setup-finish">
      <h1 className="setup-title-small" ref={heading} tabIndex={-1}>
        {w(
          "Your answers are in the draft. Try a call before you publish.",
          "Jawapan anda sudah ada dalam draf. Cuba satu panggilan sebelum menerbitkan.",
        )}
      </h1>
      <LocalAgentTest heading={false} startOn="draft" resume={false} />
      <section
        className="core-panel setup-publish"
        aria-labelledby="setup-publish"
      >
        <h2 id="setup-publish">
          {w("Publish when it sounds right", "Terbitkan apabila sudah sesuai")}
        </h2>
        <p>
          {tested
            ? w(
                "Your draft answered a test question. Publishing freezes this version; channels stay disconnected.",
                "Draf anda telah menjawab soalan ujian. Menerbitkan akan membekukan versi ini; saluran kekal tidak disambungkan.",
              )
            : w(
                "Start a test on the current draft and ask one question. Publish opens after the agent answers.",
                "Mulakan ujian pada draf semasa dan tanya satu soalan. Butang Terbitkan boleh ditekan selepas ejen menjawab.",
              )}
        </p>
        <Notice error={error ?? baselineError} />
        {error instanceof CoreError && error.code === "DISCLOSURE_REQUIRED" && (
          <p>
            <a href={href("/app/agent")}>
              {w("Open the Agent page", "Buka halaman Ejen")}
            </a>
          </p>
        )}
        <div className="setup-nav">
          <button
            type="button"
            className="button button-dark"
            disabled={!tested || busy}
            onClick={() => void publish()}
          >
            {busy
              ? w("Publishing…", "Menerbitkan…")
              : w("Publish", "Terbitkan")}
          </button>
        </div>
        <button type="button" className="setup-link" onClick={onRestart}>
          {w(
            "Answer the setup questions again",
            "Jawab soalan persediaan semula",
          )}
        </button>
      </section>
    </div>
  );
}

export function LiveStage({ onRestart }: { onRestart: () => void }) {
  const w = useWords(),
    { href } = useExperience();
  const heading = useLanding<HTMLHeadingElement>("live");
  return (
    <div className="setup-flow">
      <header className="setup-head">
        <h1 className="setup-title" ref={heading} tabIndex={-1}>
          {w(
            "Your agent is live for testing.",
            "Ejen anda sudah aktif untuk ujian.",
          )}
        </h1>
        <p className="setup-lead">
          {w(
            "Your published version answers test calls and chats. Phone and WhatsApp connect later.",
            "Versi yang diterbitkan menjawab panggilan dan sembang ujian. Telefon dan WhatsApp disambungkan kemudian.",
          )}
        </p>
      </header>
      <div className="setup-body">
        <div className="setup-nav">
          <a className="button button-dark" href={href("/app/agent")}>
            {w("Go to the Agent page", "Ke halaman Ejen")}
          </a>
          <a className="button secondary-button" href={href("/app/test")}>
            {w("Try a call", "Cuba buat panggilan")}
          </a>
        </div>
        <button type="button" className="setup-link" onClick={onRestart}>
          {w(
            "Answer the setup questions again",
            "Jawab soalan persediaan semula",
          )}
        </button>
      </div>
    </div>
  );
}
