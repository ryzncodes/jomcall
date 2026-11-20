"use client";
import { Picker } from "@/components/picker";
import { useState } from "react";
import { readKnowledgeText } from "@/lib/core/text-file";
import type {
  Agent,
  Knowledge,
} from "../../../../packages/contracts/src/core";
import { Field } from "../field";
import { KnowledgeCoreEditor } from "../knowledge-core";
import { useCore, useWords, useResource, useAction, Notice } from "../state";
import { useAgentPage } from "./store";

// What it knows: the knowledge items, then facts, rules and the price list.
// Each row form keeps its own Save button; every write goes through the
// page's queue, so none waits for the settings.
export function Knowledge() {
  const w = useWords(),
    { agentId, queue, reloadKey } = useAgentPage();
  return (
    <section className="agent-view" aria-labelledby="agent-knowledge-h">
      <h2 id="agent-knowledge-h">{w("What it knows", "Apa yang ejen tahu")}</h2>
      <KnowledgeList />
      <KnowledgeCoreEditor
        agentId={agentId}
        queue={queue}
        reloadKey={reloadKey}
        sections={["facts", "rules", "catalogue"]}
      />
    </section>
  );
}

function KnowledgeList() {
  const { client } = useCore(),
    w = useWords(),
    a = useAction(),
    { agentId, queue, reloadKey } = useAgentPage(),
    r = useResource(
      () => client.execute("knowledge", { id: agentId }),
      agentId + "|" + reloadKey,
    );
  // One write through the page's queue: it gives the agent revision and the
  // idempotency key. A rejection shows in the notice; the form keeps its text.
  const write = (run: (revision: number, key: string) => Promise<Agent>) =>
    a.run(async () => {
      let done = false;
      await queue.push({
        run: async (revision, key) => {
          const v = await run(revision, key);
          done = true;
          return v.revision;
        },
      });
      return done;
    });
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
      {r.error ? (
        <Notice error={r.error} />
      ) : (
        r.data?.map((k) => (
          <article key={k.id} className="core-record">
            <h3>{k.name}</h3>
            <p className="core-clamp">{k.content}</p>
            <div className="core-actions">
              <button
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
                disabled={a.busy}
                onClick={async () => {
                  const v = await write((expectedAgentRevision, key) =>
                    client.execute(
                      "deleteKnowledge",
                      { agentId, id: k.id, expectedAgentRevision },
                      key,
                    ),
                  );
                  if (v) await r.reload();
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
          const v = await write((expectedAgentRevision, key) =>
            client.execute(
              "saveKnowledge",
              {
                agentId,
                id: item.id,
                expectedAgentRevision,
                kind: item.kind ?? "faq",
                name: item.name ?? "",
                content: item.content ?? "",
                ...(item.kind === "text-document" ? { filename } : {}),
              },
              key,
            ),
          );
          if (v) {
            await r.reload();
            setItem({ kind: "faq", name: "", content: "" });
            setFilename(undefined);
          }
        }}
      >
        <fieldset disabled={a.busy || readingFile}>
          <h3>
            {item.id
              ? w("Edit knowledge", "Sunting pengetahuan")
              : w("Add knowledge", "Tambah pengetahuan")}
          </h3>
          <Field label={w("Type", "Jenis")}>
            <Picker<NonNullable<Knowledge["kind"]>>
              value={item.kind ?? "faq"}
              onChange={(kind) => setItem((v) => ({ ...v, kind }))}
              options={[
                { value: "faq", label: "FAQ" },
                { value: "services", label: w("Services", "Perkhidmatan") },
                { value: "text-document", label: w("Text document", "Dokumen teks") },
              ]}
            />
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
