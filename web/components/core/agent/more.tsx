"use client";
import { useState } from "react";
import type { Version } from "../../../../packages/contracts/src/core";
import { Field } from "../field";
import { KnowledgeCoreEditor } from "../knowledge-core";
import {
  useCore,
  useWords,
  useResource,
  useAction,
  Notice,
  Loading,
} from "../state";
import { queuedWrite } from "@/lib/core/queued-write";
import { useFieldEvents } from "./greeting";
import { useAgentPage } from "./store";

// Call types, written instructions and past versions.
export function More() {
  const w = useWords(),
    p = useAgentPage(),
    instructions = useFieldEvents("instructions");
  // Counts restores, so the call types are read again after one.
  const [restored, setRestored] = useState(0);
  return (
    <section className="agent-view" aria-labelledby="agent-more-h">
      <h2 id="agent-more-h">{w("More", "Lagi")}</h2>
      <KnowledgeCoreEditor
        agentId={p.agentId}
        queue={p.queue}
        reloadKey={p.reloadKey + restored}
        sections={["packs"]}
      />
      <fieldset className="builder-fields agent-lock" disabled={p.locked}>
        <Field
          label={w("Written instructions", "Arahan bertulis")}
          hint={w(
            "Tone, boundaries and how to handle unanswered questions.",
            "Nada, batasan dan cara mengendalikan soalan yang belum dijawab.",
          )}
        >
          <textarea
            rows={6}
            maxLength={20000}
            value={p.settings.instructions}
            onChange={(e) => p.change({ instructions: e.target.value })}
            {...instructions}
          />
        </Field>
      </fieldset>
      <History onRestored={() => setRestored((n) => n + 1)} />
    </section>
  );
}

function History({ onRestored }: { onRestored: () => void }) {
  const { client } = useCore(),
    w = useWords(),
    a = useAction(),
    p = useAgentPage(),
    { agentId, queue, settings } = p;
  const [cursor, setCursor] = useState<string>(),
    [compare, setCompare] = useState<Version>(),
    [confirm, setConfirm] = useState<string>(),
    [unsaved, setUnsaved] = useState(false);
  const r = useResource(
    () => client.execute("versions", { id: agentId, cursor }),
    agentId + "|" + cursor + "|" + p.reloadKey,
  );
  async function restore(v: Version) {
    setUnsaved(false);
    const outcome = await a.run(() =>
      p.restore(() =>
        queuedWrite(queue, (expectedRevision, key) =>
          client.execute(
            "restore",
            { id: agentId, versionId: v.id, expectedRevision },
            key,
          ),
        ),
      ),
    );
    if (!outcome) return; // failed: the notice shows it, nothing is locked
    if (outcome === "unsaved") {
      setUnsaved(true);
      return;
    }
    setConfirm(undefined);
    // "reloadFailed": the page shows an error with Retry, and sends no
    // settings until the restored settings were read.
    onRestored();
  }
  return (
    <div className="builder-fields">
      <h3>{w("Past versions", "Versi lalu")}</h3>
      <Notice {...a} saved={a.saved && !unsaved} />
      {unsaved && (
        <p role="alert">
          {w(
            "Your last edit is not saved yet. Save it first, then restore.",
            "Suntingan terakhir anda belum disimpan. Simpan dahulu, kemudian pulihkan.",
          )}
        </p>
      )}
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
            {confirm === v.id ? (
              <div role="group" aria-label={w("Restore this version", "Pulihkan versi ini")}>
                <p>
                  {w(
                    `Replace your draft with version ${v.sequence}? Your current draft settings and knowledge are replaced. Opening hours are not restored.`,
                    `Gantikan draf anda dengan versi ${v.sequence}? Tetapan dan pengetahuan draf semasa akan diganti. Waktu operasi tidak dipulihkan.`,
                  )}
                </p>
                <div className="core-actions">
                  <button
                    className="button button-dark"
                    disabled={a.busy}
                    onClick={() => void restore(v)}
                  >
                    {w("Yes, restore", "Ya, pulihkan")}
                  </button>
                  <button disabled={a.busy} onClick={() => setConfirm(undefined)}>
                    {w("Cancel", "Batal")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="core-actions">
                <button onClick={() => setCompare(v)}>
                  {w("Compare with draft", "Bandingkan dengan draf")}
                </button>
                <button disabled={a.busy} onClick={() => setConfirm(v.id)}>
                  {w("Restore to draft", "Pulihkan ke draf")}
                </button>
              </div>
            )}
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
              <p>{compare.snapshot.settings[k] || "-"}</p>
              <p>{settings[k] || "-"}</p>
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
