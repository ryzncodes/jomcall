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

const completed = (d: SessionDetail) =>
  d.turns.filter((t) => t.state === "completed").map((t) => t.id);

// True once the draft answers a test question after this page opened. The
// test panel keeps its open test in the URL (?testSession=); answers that
// existed before this page opened do not count.
function useTestedHere() {
  const { client } = useCore();
  const [tested, setTested] = useState(false);
  const before = useRef<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const start = async () => {
      const seen = new Set<string>();
      try {
        const list = await client.execute("agentTests", {});
        for (const s of list.filter((x) => x.source === "draft").slice(0, 20))
          try {
            completed(await client.execute("agentTest", { id: s.id })).forEach(
              (id) => seen.add(id),
            );
          } catch {
            // An expired or removed test has nothing to count.
          }
      } catch {
        // Unavailable list: count every answer from now on.
      }
      before.current = seen;
    };
    const poll = async () => {
      if (!before.current) await start();
      const id = new URL(location.href).searchParams.get("testSession");
      if (id)
        try {
          const d = await client.execute("agentTest", { id });
          if (
            alive &&
            d.source === "draft" &&
            completed(d).some((t) => !before.current!.has(t))
          ) {
            setTested(true);
            return;
          }
        } catch {
          // The panel shows its own errors.
        }
      if (alive) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client]);
  return tested;
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
  const tested = useTestedHere();
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
      <LocalAgentTest heading={false} />
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
                "Draf anda telah menjawab soalan ujian. Penerbitan menyimpan versi tetap ini; saluran kekal tidak disambungkan.",
              )
            : w(
                "Start a test on the current draft and ask one question. Publish opens after the agent answers.",
                "Mulakan ujian pada draf semasa dan tanya satu soalan. Butang Terbitkan boleh ditekan selepas ejen menjawab.",
              )}
        </p>
        <Notice error={error} />
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
            {w("Try a call", "Cuba panggilan")}
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
