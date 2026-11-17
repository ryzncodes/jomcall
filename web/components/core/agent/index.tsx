"use client";
import { useEffect, useState } from "react";
import { useCore, useWords, useResource, Heading, Loading, Notice } from "../state";
import { AgentEditor } from "../agent";
import { LocalHours } from "../settings";
import { PublishedAgent } from "./published";
import { AgentPageProvider, useAgentPage } from "./store";
import { viewOf, type View } from "./rules";
import { Home } from "./home";
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
        {page.notice && (
          <p role="status" className="agent-notice">
            {page.notice}
          </p>
        )}
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
          <Placeholder view={view} />
        </>
      )}
    </div>
  );
}

// Until the other views are built, each shows the matching part of the old
// editor. It saves by itself with its own button, as before.
const legacyTab = {
  questions: "core",
  knowledge: "core",
  greeting: "voice",
  more: "history",
  publish: "voice",
} as const;
function Placeholder({ view }: { view: Exclude<View, "home"> }) {
  const { client } = useCore(),
    { agentId, reloadKey } = useAgentPage(),
    r = useResource(
      () => client.execute("draft", { id: agentId }),
      agentId + "|" + reloadKey + "|" + view,
    );
  if (view === "hours") return <LocalHours />;
  if (!r.data) return <Loading error={r.error} />;
  return (
    <>
      <Notice error={r.error} />
      <AgentEditor
        key={agentId + reloadKey + view}
        initial={r.data}
        initialTab={legacyTab[view]}
      />
    </>
  );
}
