"use client";
import { isResourceUnavailable } from "@/lib/core/client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChatCircle, ArrowUpRight } from "@phosphor-icons/react";
import type { SessionDetail } from "../../../packages/contracts/src/agent-test";
import {
  useCore,
  useWords,
  useResource,
  useAction,
  Heading,
  Notice,
  Loading,
} from "./state";
import { Field } from "./field";
import { TestTranscript } from "./test-transcript";
import { ProposalReview } from "./proposal-review";
import { useExperience } from "../experience";
export function LocalAgentTest() {
  const { workspace } = useCore(),
    w = useWords();
  if (workspace.role === "staff")
    return (
      <Heading
        title={w(
          "Agent testing is for workspace managers.",
          "Ujian ejen untuk pengurus ruang kerja.",
        )}
        description={w(
          "Your team can manage appointments from Bookings.",
          "Pasukan anda boleh mengurus janji temu melalui Tempahan.",
        )}
      />
    );
  return <AgentTestManager />;
}
function AgentTestManager() {
  const { client, workspace, epoch } = useCore(),
    w = useWords(),
    { href } = useExperience(),
    query = useSearchParams(),
    a = useAction();
  const [sessionId, setSession] = useState(query.get("testSession") ?? ""),
    [source, setSource] = useState<"draft" | "published">(
      workspace.agent.published_version_id ? "published" : "draft",
    ),
    [text, setText] = useState(""),
    [detail, setDetail] = useState<SessionDetail>(),
    [error, setError] = useState<unknown>(),
    [tick, setTick] = useState(0),
    [knowledgeQuery, setKnowledgeQuery] = useState(""),
    [inspect, setInspect] = useState("");
  const turnKey = useRef(crypto.randomUUID());
  const readiness = useResource(
    () => client.execute("testReadiness", {}),
    "test-readiness",
  );
  const draft = useResource(
    () => client.execute("draft", { id: workspace.agent.id }),
    "test-draft",
  );
  const sessions = useResource(
    () => client.execute("agentTests", {}),
    "test-sessions",
  );
  const knowledge = useResource(
    () =>
      sessionId && inspect
        ? client.execute("testKnowledge", { id: sessionId, query: inspect })
        : Promise.resolve([]),
    "test-knowledge|" + sessionId + "|" + inspect,
  );
  const select = (id: string) => {
    setSession(id);
    setDetail(undefined);
    setError(undefined);
    setText("");
    setInspect("");
    turnKey.current = crypto.randomUUID();
    const url = new URL(location.href);
    id
      ? url.searchParams.set("testSession", id)
      : url.searchParams.delete("testSession");
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let running = false;
      try {
        const value = await client.execute("agentTest", { id: sessionId });
        if (alive) {
          setDetail(value);
          setError(undefined);
          running = value.turns.some((t) =>
            ["queued", "running"].includes(t.state),
          );
        }
      } catch (e) {
        if (alive) {
          setError(e);
          if (isResourceUnavailable(e)) {
            setDetail(undefined);
            setInspect("");
          }
        }
      }
      if (alive)
        timer = setTimeout(
          () => void load(),
          running && document.visibilityState === "visible" ? 2000 : 15000,
        );
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, sessionId, epoch, tick]);
  useEffect(() => {
    const focus = () => setTick((v) => v + 1);
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  useEffect(() => {
    if (
      isResourceUnavailable(a.error) ||
      isResourceUnavailable(knowledge.error)
    ) {
      setError(isResourceUnavailable(a.error) ? a.error : knowledge.error);
      setDetail(undefined);
      setInspect("");
    }
  }, [a.error, knowledge.error]);
  const running = detail?.turns.some((t) =>
    ["queued", "running"].includes(t.state),
  );
  return (
    <>
      <Heading
        eyebrow={w("Agent studio · text test", "Studio ejen · ujian teks")}
        title={w(
          "A good conversation starts here.",
          "Perbualan yang baik bermula di sini.",
        )}
        description={w(
          "Ask a question. Follow the sources. Review what your agent would do before it reaches a customer.",
          "Tanya soalan. Semak sumber. Lihat tindakan ejen sebelum berhubung dengan pelanggan.",
        )}
      >
        <a className="button secondary-button" href={href("/app/agent")}>
          {w("Edit agent", "Sunting ejen")}
          <ArrowUpRight size={16} />
        </a>
      </Heading>
      <div className="core-test-mode">
        <span>
          <ChatCircle size={18} />
          {w("Text test", "Ujian teks")}
        </span>
        <small>
          {w(
            "Voice testing is not connected yet",
            "Ujian suara belum disambungkan",
          )}
        </small>
        <span className="core-model-state">
          {readiness.data?.available
            ? w(
                "Local model connected · experimental",
                "Model setempat disambung · eksperimen",
              )
            : w("Local model unavailable", "Model setempat tiada")}
        </span>
      </div>
      <Notice error={a.error ?? error ?? readiness.error ?? draft.error} />
      <div className="core-test-layout">
        <aside className="core-panel core-test-controls">
          <p className="eyebrow">
            {w("Test configuration", "Konfigurasi ujian")}
          </p>
          <h2>{draft.data?.draft.name ?? w("Your agent", "Ejen anda")}</h2>
          <Field label={w("Configuration source", "Sumber konfigurasi")}>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              <option value="draft">
                {w("Current draft snapshot", "Petikan draf semasa")}
              </option>
              {workspace.agent.published_version_id && (
                <option value="published">
                  {w("Published version", "Versi diterbitkan")}
                </option>
              )}
            </select>
          </Field>
          <button
            className="button button-dark"
            disabled={a.busy || !draft.data}
            onClick={async () => {
              const value = await a.run(() =>
                client.execute("startAgentTest", {
                  agentId: workspace.agent.id,
                  locationId: (
                    workspace.locations.find((l) => l.primary_location) ??
                    workspace.locations[0]
                  ).id,
                  source:
                    source === "published"
                      ? {
                          kind: "published",
                          versionId: workspace.agent.published_version_id!,
                        }
                      : {
                          kind: "draft",
                          expectedRevision: draft.data!.revision,
                        },
                }),
              );
              if (value) select(value.id);
            }}
          >
            {w("Start new test", "Mulakan ujian baharu")}
          </button>
          <Field label={w("Resume a saved test", "Sambung ujian tersimpan")}>
            <select value={sessionId} onChange={(e) => select(e.target.value)}>
              <option value="">{w("Choose a test", "Pilih ujian")}</option>
              {sessions.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.source === "draft"
                    ? w("Draft", "Draf")
                    : w("Published", "Diterbitkan")}{" "}
                  · {s.snapshot_hash.slice(0, 8)} · {s.id.slice(-4)}
                </option>
              ))}
            </select>
          </Field>
          <Notice error={sessions.error} />
          {detail && (
            <>
              <dl className="core-test-facts">
                <dt>{w("Pinned source", "Sumber tetap")}</dt>
                <dd>
                  {detail.source === "draft"
                    ? w("Draft snapshot", "Petikan draf")
                    : w("Published version", "Versi diterbitkan")}{" "}
                  · {detail.snapshot_hash.slice(0, 12)}
                </dd>
                <dt>{w("Model digest", "Digest model")}</dt>
                <dd>
                  {detail.model_digest?.slice(0, 12) ??
                    w(
                      "Pinned on first turn",
                      "Ditetapkan pada giliran pertama",
                    )}
                </dd>
                <dt>{w("Expiry", "Tamat tempoh")}</dt>
                <dd>
                  {new Intl.DateTimeFormat("en-MY", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kuala_Lumpur",
                  }).format(new Date(detail.expires_at))}
                </dd>
              </dl>
              <form
                className="core-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setInspect(knowledgeQuery);
                }}
              >
                <Field label={w("Inspect knowledge", "Semak pengetahuan")}>
                  <input
                    required
                    maxLength={200}
                    value={knowledgeQuery}
                    onChange={(e) => setKnowledgeQuery(e.target.value)}
                  />
                </Field>
                <button className="button secondary-button">
                  {w("Find sources", "Cari sumber")}
                </button>
              </form>
              <Notice error={knowledge.error} />
              {inspect && (
                <div>
                  {knowledge.data?.length ? (
                    knowledge.data.map((h) => (
                      <details key={h.sourceId} className="core-tool-trace">
                        <summary>{h.title}</summary>
                        <p>{h.excerpt}</p>
                        <small>{h.sourceId}</small>
                      </details>
                    ))
                  ) : (
                    <p>
                      {w(
                        "No matching source. Add business knowledge or ask your team.",
                        "Tiada sumber sepadan. Tambah pengetahuan atau tanya pasukan anda.",
                      )}
                    </p>
                  )}
                </div>
              )}
              <button
                className="core-back"
                disabled={a.busy}
                onClick={async () => {
                  if (
                    !confirm(
                      w(
                        "Delete this saved test and its transcript? Applied appointments remain in your calendar.",
                        "Padam ujian tersimpan dan transkrip ini? Janji temu yang telah dibuat kekal dalam kalendar.",
                      ),
                    )
                  )
                    return;
                  const result = await a.run(() =>
                    client.execute("deleteAgentTest", {
                      id: detail.id,
                      expectedRevision: detail.revision,
                    }),
                  );
                  if (result) select("");
                }}
              >
                {w("Delete saved test", "Padam ujian tersimpan")}
              </button>
            </>
          )}
          <p>
            {w(
              "Saved for 24 hours. No microphone, external messages or live calls.",
              "Disimpan selama 24 jam. Tiada mikrofon, mesej luar atau panggilan langsung.",
            )}
          </p>
        </aside>
        <section className="core-panel core-test-conversation">
          {!sessionId ? (
            <div className="core-empty core-test-welcome">
              <ChatCircle size={48} weight="light" />
              <h2>
                {w("Meet your front desk.", "Kenali kaunter hadapan anda.")}
              </h2>
              <p>
                {w(
                  "Start a test to explore your agent’s answers and decisions. Your business knowledge stays frozen for each session.",
                  "Mulakan ujian untuk meneroka jawapan dan keputusan ejen. Pengetahuan perniagaan kekal tetap bagi setiap sesi.",
                )}
              </p>
            </div>
          ) : !detail ? (
            <Loading error={error} />
          ) : (
            <>
              <TestTranscript
                session={detail}
                busy={a.busy}
                onCancel={(id, revision) =>
                  void a.run(() =>
                    client.execute("cancelTestTurn", {
                      sessionId,
                      id,
                      expectedRevision: revision,
                    }),
                  )
                }
                onRetry={(id, revision) =>
                  void a.run(() =>
                    client.execute("retryTestTurn", {
                      sessionId,
                      id,
                      expectedRevision: revision,
                    }),
                  )
                }
              />
              {detail.proposals.map((p) => (
                <ProposalReview
                  key={p.id}
                  proposal={p}
                  sessionId={sessionId}
                  locationId={detail.location_id}
                  contactId={detail.contact_id}
                  ready={detail.turns.some(
                    (t) =>
                      t.id === p.turn_id &&
                      t.attempt === p.attempt &&
                      t.state === "completed",
                  )}
                />
              ))}
              <form
                className="core-test-composer"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const result = await a.run(() =>
                    client.execute("submitTestTurn", {
                      id: sessionId,
                      text,
                      expectedSessionRevision: detail.revision,
                      clientTurnId: turnKey.current,
                    }),
                  );
                  if (result) {
                    setText("");
                    turnKey.current = crypto.randomUUID();
                    setTick((v) => v + 1);
                  }
                }}
              >
                <Field label={w("Customer question", "Soalan pelanggan")}>
                  <textarea
                    rows={3}
                    required
                    maxLength={4000}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      turnKey.current = crypto.randomUUID();
                    }}
                    disabled={running || a.busy}
                  />
                </Field>
                <div className="core-actions">
                  <small>
                    {readiness.data?.available
                      ? w("Runs on this computer", "Berjalan pada komputer ini")
                      : w(
                          "Start the local model to send a question. Knowledge inspection still works.",
                          "Mulakan model setempat untuk menghantar soalan. Semakan pengetahuan masih tersedia.",
                        )}
                  </small>
                  <button
                    className="button button-dark"
                    disabled={
                      running ||
                      a.busy ||
                      !readiness.data?.available ||
                      !text.trim() ||
                      detail.turns.length >= 20
                    }
                  >
                    {w("Send question", "Hantar soalan")}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </>
  );
}
