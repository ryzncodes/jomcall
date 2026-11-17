"use client";
import { useEffect, useState } from "react";
import { useCore, useWords, Heading } from "../state";
import { Greeting } from "./greeting";
import { Hours } from "./hours";
import { Knowledge } from "./knowledge";
import { More } from "./more";
import { PublishedAgent } from "./published";
import { Publish } from "./publish";
import { AgentPageProvider, useAgentPage } from "./store";
import { viewOf, type View } from "./rules";
import { Home } from "./home";
import { Questions } from "./questions";
import { SaveLine } from "./save-line";

export { PublishedAgent };

// The agent page. Staff see the published summary and nothing else; they
// never load the draft, the change list or the gap list.
export function LocalAgent(_props: { setup?: boolean }) {
  const w = useWords(),
    { workspace } = useCore();
  if (workspace.role === "staff")
    return (
      <>
        <Heading
          title={w("Agent configuration", "Konfigurasi ejen")}
          description={w(
            "Your owner or admin manages drafts and publishing.",
            "Pemilik atau pentadbir mengurus draf dan penerbitan.",
          )}
        />
        {workspace.agent.published_version_id && (
          <PublishedAgent id={workspace.agent.published_version_id} />
        )}
        {/* Staff could read the hours before; they still can, read only. */}
        <Hours editable={false} />
      </>
    );
  return (
    <AgentPageProvider>
      <Shell />
    </AgentPageProvider>
  );
}

function useHashView(): View {
  const [view, setView] = useState<View>("home");
  useEffect(() => {
    const read = () => setView(viewOf(location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return view;
}

function Shell() {
  const w = useWords(),
    page = useAgentPage(),
    view = useHashView();
  return (
    <div className="agent-page">
      <header className="agent-head">
        <h1>{w("Your agent", "Ejen anda")}</h1>
        <SaveLine />
        {page.reloadFailed && (
          <p role="alert" className="agent-notice">
            {w(
              "The restored version is saved, but this page could not read it back. Nothing is sent until it does.",
              "Versi yang dipulihkan sudah disimpan, tetapi halaman ini tidak dapat membacanya semula. Tiada apa dihantar sehingga ia berjaya.",
            )}{" "}
            <button
              type="button"
              className="button button-small"
              onClick={() => void page.reloadSettings().catch(() => {})}
            >
              {w("Try again", "Cuba lagi")}
            </button>
          </p>
        )}
        <div role="status">
          {page.notice && <p className="agent-notice">{page.notice}</p>}
        </div>
      </header>
      {view === "home" ? (
        <Home />
      ) : (
        <>
          <button
            type="button"
            className="agent-back"
            onClick={() => void page.go("home")}
          >
            {w("Back to your agent", "Kembali ke ejen anda")}
          </button>
          <Sub view={view} />
        </>
      )}
    </div>
  );
}

function Sub({ view }: { view: Exclude<View, "home"> }) {
  const page = useAgentPage();
  switch (view) {
    case "greeting":
      return <Greeting />;
    case "knowledge":
      return <Knowledge />;
    case "more":
      return <More />;
    case "hours":
      return (
        <Hours
          editable
          refreshChanges={page.refreshChanges}
          store={page.hours}
        />
      );
    case "questions":
      return <Questions />;
    case "publish":
      return <Publish />;
  }
}
