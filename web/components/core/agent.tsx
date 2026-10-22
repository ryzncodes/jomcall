"use client";
import { useState } from "react";
import { readKnowledgeText } from "@/lib/core/text-file";
import type {
  Agent,
  AgentSettings,
  Knowledge,
  Version,
} from "../../../packages/contracts/src/core";
import { useExperience } from "../experience";
import { Field } from "./field";
import { GreetingField } from "./agent-fields";
import {
  useCore,
  useWords,
  useResource,
  useAction,
  Heading,
  Notice,
  Loading,
} from "./state";
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
export function LocalAgent({ setup }: { setup: boolean }) {
  const w = useWords(),
    { workspace, client } = useCore(),
    { href } = useExperience();
  const resource = useResource(
    () =>
      workspace.role === "staff"
        ? Promise.resolve(null)
        : client.execute("draft", { id: workspace.agent.id }),
    workspace.agent.id + "|" + workspace.role,
  );
  const [reload, setReload] = useState(0);
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
    <>
      <Heading
        eyebrow={
          setup
            ? w(
                "Guided setup · local workspace",
                "Persediaan berpandu · ruang kerja setempat",
              )
            : w("Agent builder", "Pembina ejen")
        }
        title={
          setup
            ? w(
                "Teach your front desk.",
                "Lengkapkan pengetahuan kaunter anda.",
              )
            : w(
                "Your business. In your own words.",
                "Perniagaan anda. Dengan kata-kata anda.",
              )
        }
        description={w(
          "Save a draft, add trusted knowledge and publish an immutable configuration. Publishing does not connect calls or WhatsApp.",
          "Simpan draf, tambah pengetahuan dipercayai dan terbitkan konfigurasi tetap. Penerbitan tidak menyambungkan panggilan atau WhatsApp.",
        )}
      />
      {
        <div className="core-steps">
          <a href={href("/app/test")}>
            {w("Test agent answers", "Uji jawapan ejen")}
          </a>
          <a href={href("/app/bookings")}>
            {w("Set up local bookings", "Sediakan tempahan setempat")}
          </a>
          <a href={href("/app/settings")}>
            01 · {w("Business details", "Butiran perniagaan")}
          </a>
          <a href={href("/app/hours")}>
            02 · {w("Branches & hours", "Cawangan & waktu")}
          </a>
          <span>03 · {w("Agent & knowledge", "Ejen & pengetahuan")}</span>
        </div>
      }
      <Notice error={resource.error} />
      {!resource.data ? (
        <Loading error={resource.error} />
      ) : (
        <>
          <div className="builder-status">
            <span>
              {w("Draft revision", "Semakan draf")} {resource.data.revision}
            </span>
            <button
              onClick={async () => {
                if (await resource.reload()) setReload((v) => v + 1);
              }}
            >
              {w("Reload latest values", "Muat semula nilai terkini")}
            </button>
          </div>
          <AgentEditor
            key={workspace.agent.id + reload}
            initial={resource.data}
          />
        </>
      )}
    </>
  );
}
function PublishedAgent({ id }: { id: string }) {
  const { workspace, client } = useCore(),
    r = useResource(
      () => client.execute("version", { agentId: workspace.agent.id, id }),
      id,
    ),
    w = useWords();
  return r.data ? (
    <section className="core-panel">
      <h2>{r.data.snapshot.settings.name}</h2>
      <p>{r.data.snapshot.settings.greeting}</p>
      <p>
        {w("Published configuration", "Konfigurasi diterbitkan")} #
        {r.data.sequence}
      </p>
    </section>
  ) : (
    <Loading error={r.error} />
  );
}
function AgentEditor({ initial }: { initial: Agent }) {
  const { client } = useCore(),
    w = useWords(),
    a = useAction();
  const [settings, setSettings] = useState<AgentSettings>({
      ...defaults,
      ...initial.draft,
    }),
    [revision, setRevision] = useState(initial.revision),
    [tab, setTab] = useState<"voice" | "knowledge" | "history">("voice"),
    [dirty, setDirty] = useState(false),
    [published, setPublished] = useState(false);
  const change = (v: Partial<AgentSettings>) => {
    setSettings((s) => ({ ...s, ...v }));
    setDirty(true);
    setPublished(false);
  };
  const accept = (v: Agent) => {
    setRevision(v.revision);
    setSettings({ ...defaults, ...v.draft });
    setDirty(false);
  };
  return (
    <>
      <div
        className="builder-tabs"
        role="group"
        aria-label={w("Agent sections", "Bahagian ejen")}
      >
        {(["voice", "knowledge", "history"] as const).map((t, i) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {
              [
                w("Personality & disclosure", "Personaliti & pendedahan"),
                w("Business knowledge", "Pengetahuan perniagaan"),
                w("Published versions", "Versi diterbitkan"),
              ][i]
            }
          </button>
        ))}
      </div>
      <Notice {...a} />
      {published && (
        <p role="status" className="core-success">
          {w(
            "Configuration published. Channels remain disconnected.",
            "Konfigurasi diterbitkan. Saluran kekal tidak disambungkan.",
          )}
        </p>
      )}
      <div className="builder-grid">
        <section className="builder-editor">
          <header className="editor-heading">
            <span className="editor-index">
              0{tab === "voice" ? 1 : tab === "knowledge" ? 2 : 3}
            </span>
            <div>
              <h2>
                {tab === "voice"
                  ? w("How your agent responds", "Cara ejen anda menjawab")
                  : tab === "knowledge"
                    ? w(
                        "Grounded in your business",
                        "Berpandukan perniagaan anda",
                      )
                    : w("A record of every release", "Rekod setiap penerbitan")}
              </h2>
              <p>
                {tab === "voice"
                  ? w(
                      "Set language, greeting and the disclosures your customers hear.",
                      "Tetapkan bahasa, salam dan pendedahan untuk pelanggan.",
                    )
                  : w(
                      "Changes stay in draft until you publish.",
                      "Perubahan kekal dalam draf sehingga diterbitkan.",
                    )}
              </p>
            </div>
          </header>
          {tab === "voice" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await a.run(() =>
                  client.execute("saveDraft", {
                    id: initial.id,
                    expectedRevision: revision,
                    settings,
                  }),
                );
                if (r) accept(r);
              }}
            >
              <fieldset className="builder-fields" disabled={a.busy}>
                <Field label={w("Agent name", "Nama ejen")}>
                  <input
                    required
                    maxLength={120}
                    value={settings.name}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </Field>
                <GreetingField
                  value={settings.greeting}
                  onChange={(greeting) => change({ greeting })}
                />
                <Field
                  label={w("Instructions", "Arahan")}
                  hint={w(
                    "Tone, boundaries and how to handle unanswered questions.",
                    "Nada, batasan dan cara mengendalikan soalan yang belum dijawab.",
                  )}
                >
                  <textarea
                    rows={6}
                    maxLength={20000}
                    value={settings.instructions}
                    onChange={(e) => change({ instructions: e.target.value })}
                  />
                </Field>
                <fieldset className="builder-languages">
                  <legend>{w("Languages", "Bahasa")}</legend>
                  {(["ms", "en", "zh"] as const).map((lang, i) => (
                    <label key={lang} className="product-check">
                      <input
                        type="checkbox"
                        checked={settings.languages.includes(lang)}
                        onChange={(e) =>
                          change({
                            languages: e.target.checked
                              ? [...settings.languages, lang]
                              : settings.languages.filter((l) => l !== lang),
                          })
                        }
                      />
                      {["Bahasa Melayu", "English", "中文"][i]}
                    </label>
                  ))}
                  <label className="product-check">
                    <input
                      type="checkbox"
                      checked={settings.manglish}
                      onChange={(e) => change({ manglish: e.target.checked })}
                    />
                    Manglish
                  </label>
                </fieldset>
                <Field
                  label={w("AI introduction", "Pengenalan AI")}
                  hint={w(
                    "Required before publishing. Clearly identify this as an AI assistant.",
                    "Wajib sebelum diterbitkan. Nyatakan dengan jelas bahawa ini pembantu AI.",
                  )}
                >
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={settings.aiDisclosure}
                    onChange={(e) => change({ aiDisclosure: e.target.value })}
                  />
                </Field>
                <label className="product-check">
                  <input
                    type="checkbox"
                    checked={settings.recordingEnabled}
                    onChange={(e) =>
                      change({ recordingEnabled: e.target.checked })
                    }
                  />
                  {w(
                    "Record calls when calling is available",
                    "Rakam panggilan apabila panggilan tersedia",
                  )}
                </label>
                {settings.recordingEnabled && (
                  <Field
                    label={w("Recording disclosure", "Pendedahan rakaman")}
                  >
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={settings.recordingDisclosure}
                      onChange={(e) =>
                        change({ recordingDisclosure: e.target.value })
                      }
                    />
                  </Field>
                )}
                <Field
                  label={w("Voice preference", "Pilihan suara")}
                  hint={w(
                    "Preference only. No speech provider is connected.",
                    "Pilihan sahaja. Tiada penyedia suara disambungkan.",
                  )}
                >
                  <input
                    maxLength={120}
                    value={settings.voicePreference}
                    onChange={(e) =>
                      change({ voicePreference: e.target.value })
                    }
                  />
                </Field>
                <button className="button button-dark">
                  {w("Save draft", "Simpan draf")}
                </button>
              </fieldset>
            </form>
          ) : tab === "knowledge" ? (
            <KnowledgeEditor
              agentId={initial.id}
              revision={revision}
              onSaved={accept}
              disabled={dirty}
            />
          ) : (
            <History
              agentId={initial.id}
              revision={revision}
              settings={settings}
              onRestore={accept}
              disabled={dirty}
            />
          )}
        </section>
        <aside className="core-panel core-agent-aside">
          <span className="remaining-chip">
            {dirty
              ? w("Unsaved changes", "Perubahan belum disimpan")
              : w("Draft saved", "Draf disimpan")}
          </span>
          <h3>{w("Publish with confidence.", "Terbitkan dengan yakin.")}</h3>
          <p>
            {w(
              "Publishing freezes a version of your settings and knowledge. You can compare versions and restore one to a draft.",
              "Penerbitan menyimpan versi tetap tetapan dan pengetahuan. Anda boleh membandingkan versi dan memulihkan ke draf.",
            )}
          </p>
          <p>
            {w(
              "No voice or WhatsApp connection yet.",
              "Belum ada sambungan suara atau WhatsApp.",
            )}
          </p>
          <button
            className="button button-dark"
            disabled={a.busy || dirty}
            onClick={async () => {
              const r = await a.run(() =>
                client.execute("publish", {
                  id: initial.id,
                  expectedRevision: revision,
                }),
              );
              if (r) {
                const current = await a.run(() =>
                  client.execute("draft", { id: initial.id }),
                );
                if (current) accept(current);
                setPublished(true);
              }
            }}
          >
            {w("Publish configuration", "Terbitkan konfigurasi")}
          </button>
          {dirty && (
            <small>{w("Save your draft first.", "Simpan draf dahulu.")}</small>
          )}
        </aside>
      </div>
    </>
  );
}
function KnowledgeEditor({
  agentId,
  revision,
  onSaved,
  disabled,
}: {
  agentId: string;
  revision: number;
  onSaved: (a: Agent) => void;
  disabled: boolean;
}) {
  const { client } = useCore(),
    w = useWords(),
    a = useAction(),
    r = useResource(
      () => client.execute("knowledge", { id: agentId }),
      agentId,
    );
  const [item, setItem] = useState<Partial<Knowledge>>({
      kind: "faq",
      name: "",
      content: "",
    }),
    [filename, setFilename] = useState<string>(),
    [fileError, setFileError] = useState(""),
    [readingFile, setReadingFile] = useState(false);
  return (
    <div className="builder-fields">
      <Notice {...a} />
      {disabled && (
        <p>
          {w(
            "Save personality changes before editing knowledge.",
            "Simpan perubahan personaliti sebelum menyunting pengetahuan.",
          )}
        </p>
      )}
      {r.error ? (
        <Notice error={r.error} />
      ) : (
        r.data?.map((k) => (
          <article key={k.id} className="core-record">
            <h3>{k.name}</h3>
            <p className="core-clamp">{k.content}</p>
            <div className="core-actions">
              <button
                disabled={disabled}
                onClick={() => {
                  setItem(k);
                  setFilename(
                    k.kind === "text-document" ? k.name + ".txt" : undefined,
                  );
                }}
              >
                {w("Edit", "Sunting")}
              </button>
              <button
                disabled={a.busy || disabled}
                onClick={async () => {
                  const v = await a.run(() =>
                    client.execute("deleteKnowledge", {
                      agentId,
                      id: k.id,
                      expectedAgentRevision: revision,
                    }),
                  );
                  if (v) onSaved(v);
                }}
              >
                {w("Remove", "Buang")}
              </button>
            </div>
          </article>
        ))
      )}
      <form
        className="core-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (readingFile) return;
          const v = await a.run(() =>
            client.execute("saveKnowledge", {
              agentId,
              id: item.id,
              expectedAgentRevision: revision,
              kind: item.kind ?? "faq",
              name: item.name ?? "",
              content: item.content ?? "",
              ...(item.kind === "text-document" ? { filename } : {}),
            }),
          );
          if (v) {
            onSaved(v);
            setItem({ kind: "faq", name: "", content: "" });
            setFilename(undefined);
          }
        }}
      >
        <fieldset disabled={a.busy || disabled || readingFile}>
          <h3>
            {item.id
              ? w("Edit knowledge", "Sunting pengetahuan")
              : w("Add knowledge", "Tambah pengetahuan")}
          </h3>
          <Field label={w("Type", "Jenis")}>
            <select
              value={item.kind}
              onChange={(e) =>
                setItem((v) => ({
                  ...v,
                  kind: e.target.value as Knowledge["kind"],
                }))
              }
            >
              <option value="faq">FAQ</option>
              <option value="services">{w("Services", "Perkhidmatan")}</option>
              <option value="text-document">
                {w("Text document", "Dokumen teks")}
              </option>
            </select>
          </Field>
          {item.kind === "text-document" && (
            <Field
              label={w(
                "Text file (.txt or .md, up to 100 KB)",
                "Fail teks (.txt atau .md, sehingga 100 KB)",
              )}
            >
              <input
                type="file"
                accept=".txt,.md"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 100000 || !/\.(txt|md)$/i.test(file.name)) {
                    setFileError(
                      w(
                        "Choose a text file under 100 KB.",
                        "Pilih fail teks di bawah 100 KB.",
                      ),
                    );
                    return;
                  }
                  setReadingFile(true);
                  setFileError("");
                  try {
                    const content = await readKnowledgeText(file);
                    setFilename(file.name);
                    setItem((v) => ({ ...v, name: file.name, content }));
                  } catch {
                    setFileError(
                      w(
                        "Could not read this UTF-8 text file. Existing content is unchanged.",
                        "Fail teks UTF-8 ini tidak dapat dibaca. Kandungan asal dikekalkan.",
                      ),
                    );
                  } finally {
                    setReadingFile(false);
                  }
                }}
              />
            </Field>
          )}
          {fileError && <p role="alert">{fileError}</p>}
          <Field label={w("Title", "Tajuk")}>
            <input
              required
              maxLength={120}
              value={item.name}
              onChange={(e) => setItem((v) => ({ ...v, name: e.target.value }))}
            />
          </Field>
          <Field label={w("Content", "Kandungan")}>
            <textarea
              required
              maxLength={100000}
              rows={7}
              value={item.content}
              onChange={(e) =>
                setItem((v) => ({ ...v, content: e.target.value }))
              }
            />
          </Field>
          <div className="core-actions">
            <button className="button button-dark">
              {w("Save knowledge", "Simpan pengetahuan")}
            </button>
            {item.id && (
              <button
                type="button"
                onClick={() => setItem({ kind: "faq", name: "", content: "" })}
              >
                {w("Cancel edit", "Batal suntingan")}
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </div>
  );
}
function History({
  agentId,
  revision,
  settings,
  onRestore,
  disabled,
}: {
  agentId: string;
  revision: number;
  settings: AgentSettings;
  onRestore: (a: Agent) => void;
  disabled: boolean;
}) {
  const { client } = useCore(),
    w = useWords(),
    a = useAction();
  const [cursor, setCursor] = useState<string>(),
    [compare, setCompare] = useState<Version>();
  const r = useResource(
    () => client.execute("versions", { id: agentId, cursor }),
    agentId + "|" + cursor,
  );
  return (
    <div className="builder-fields">
      <Notice {...a} />
      {r.error || !r.data ? (
        <Loading error={r.error} />
      ) : !r.data.items.length ? (
        <p>{w("No published versions yet.", "Belum ada versi diterbitkan.")}</p>
      ) : (
        r.data.items.map((v) => (
          <article key={v.id} className="core-record">
            <strong>
              {w("Version", "Versi")} {v.sequence}
            </strong>
            <p>
              {new Date(v.created_at).toLocaleString("en-MY", {
                timeZone: "Asia/Kuala_Lumpur",
              })}
            </p>
            <div className="core-actions">
              <button onClick={() => setCompare(v)}>
                {w("Compare with draft", "Bandingkan dengan draf")}
              </button>
              <button
                disabled={a.busy || disabled}
                onClick={async () => {
                  const restored = await a.run(() =>
                    client.execute("restore", {
                      id: agentId,
                      versionId: v.id,
                      expectedRevision: revision,
                    }),
                  );
                  if (restored) onRestore(restored);
                }}
              >
                {w("Restore to draft", "Pulihkan ke draf")}
              </button>
            </div>
          </article>
        ))
      )}
      {r.data?.nextCursor && (
        <button onClick={() => setCursor(r.data!.nextCursor!)}>
          {w("Older versions", "Versi terdahulu")}
        </button>
      )}
      {compare && (
        <section className="core-compare">
          <h3>
            {w("Version", "Versi")} {compare.sequence} ↔ {w("Draft", "Draf")}
          </h3>
          {(
            [
              "name",
              "greeting",
              "instructions",
              "aiDisclosure",
              "recordingDisclosure",
              "voicePreference",
            ] as const
          ).map((k) => (
            <div className="core-record" key={k}>
              <strong>{k}</strong>
              <p>{compare.snapshot.settings[k] || "—"}</p>
              <p>{settings[k] || "—"}</p>
            </div>
          ))}
          <p>
            {w("Published knowledge items", "Item pengetahuan diterbitkan")}:{" "}
            {compare.snapshot.knowledge.length}
          </p>
          {compare.snapshot.knowledge.map((k, i) => (
            <p key={i}>
              {k.name}: {k.content}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
