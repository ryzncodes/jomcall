"use client";
// Knowledge core editor (local app only): packs, pack fact fields, free facts,
// rules, catalogue rows and the gap log. Mock preview does not use it.
import { useState } from "react";
import type {
  KnowledgeCore,
  KnowledgeFact,
  KnowledgeGap,
} from "../../../packages/contracts/src/knowledge";
import { Field } from "./field";
import { useCore, useWords, useResource, useAction, Notice } from "./state";

type Kind = "never" | "unknown" | "message" | "handoff" | "after_hours" | "always";
const kinds: Kind[] = ["never", "unknown", "message", "handoff", "after_hours", "always"];
const kindWords: Record<Kind, [string, string]> = {
  never: ["Never say", "Jangan sekali-kali"],
  unknown: ["When unsure", "Bila tidak pasti"],
  message: ["When taking a message", "Semasa ambil pesanan"],
  handoff: ["Escalation", "Serah kepada staf"],
  after_hours: ["After hours", "Selepas waktu operasi"],
  always: ["Always", "Sentiasa"],
};
const valueText = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.map(valueText).join("; ")
      : v && typeof v === "object"
        ? Object.values(v).map(valueText).join(", ")
        : String(v ?? "");
// "RM 230", "230.50" or "" (no price) to integer sen.
export function parseSen(text: string): number | null | "invalid" {
  const t = text.replace(/rm/i, "").replace(/,/g, "").trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "invalid";
  return Math.round(Number(t) * 100);
}
// One row per line: item | price | stock note | other names, comma separated.
export function parseRows(text: string) {
  const rows = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [item = "", price = "", stock = "", aliases = ""] = line.split("|").map((x) => x.trim());
    const priceSen = parseSen(price);
    if (!item || priceSen === "invalid") return { error: line };
    rows.push({
      item: item.slice(0, 200),
      priceSen,
      stockNote: stock.slice(0, 200),
      aliases: aliases.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20),
    });
  }
  return { rows };
}

export function KnowledgeCoreEditor({
  agentId,
  revision,
  onRevision,
  disabled,
}: {
  agentId: string;
  revision: number;
  onRevision: (n: number) => void;
  disabled: boolean;
}) {
  const { client } = useCore(),
    w = useWords(),
    a = useAction();
  const packs = useResource(() => client.execute("packs", {}), "packs");
  const core = useResource(() => client.execute("knowledgeCore", { id: agentId }), agentId + "|core");
  const gaps = useResource(() => client.execute("knowledgeGaps", { id: agentId }), agentId + "|gaps");
  const [picked, setPicked] = useState<string[]>();
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [fact, setFact] = useState({ title: "", value: "" });
  const [rule, setRule] = useState<{ kind: Kind; text: string }>({ kind: "never", text: "" });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const done = async (r: KnowledgeCore | undefined) => {
    if (!r) return;
    onRevision(r.revision);
    setEdits({});
    await core.reload();
  };
  const exec = (fn: () => Promise<KnowledgeCore>) => a.run(fn).then(done);
  const data = core.data;
  const active = ["every-business", ...(picked ?? data?.packs ?? [])];
  const factFor = (packId: string, key: string): KnowledgeFact | undefined =>
    data?.facts.find((f) => f.pack_id === packId && f.field_key === key);
  const busy = a.busy || disabled;

  if (core.error) return <Notice error={core.error} />;
  if (!data || !packs.data) return <p role="status">{w("Loading knowledge…", "Memuatkan pengetahuan…")}</p>;
  return (
    <div className="builder-fields knowledge-core">
      <Notice {...a} />
      {disabled && (
        <p>{w("Save personality changes before editing knowledge.", "Simpan perubahan personaliti sebelum menyunting pengetahuan.")}</p>
      )}

      <section aria-labelledby="kc-packs">
        <h3 id="kc-packs">{w("What are your calls for?", "Panggilan anda untuk apa?")}</h3>
        <p className="core-hint">
          {w("Pick every pattern that fits. Shared basics are always on.", "Pilih semua corak yang sesuai. Asas umum sentiasa aktif.")}
        </p>
        {packs.data
          .filter((p) => p.id !== "every-business")
          .map((p) => (
            <label key={p.id} className="core-check">
              <input
                type="checkbox"
                disabled={busy}
                checked={active.includes(p.id)}
                onChange={(e) =>
                  setPicked(
                    e.target.checked
                      ? [...active.filter((x) => x !== "every-business"), p.id]
                      : active.filter((x) => x !== p.id && x !== "every-business"),
                  )
                }
              />
              <span>
                <strong>{w(p.name.en, p.name.ms)}</strong>
                <small>{w(p.callPurpose.en, p.callPurpose.ms)}</small>
              </span>
            </label>
          ))}
        <button
          className="button button-dark"
          disabled={busy || !picked}
          onClick={() =>
            exec(() => client.execute("savePacks", { agentId, expectedAgentRevision: revision, packs: picked ?? [] }))
          }
        >
          {w("Save patterns", "Simpan corak")}
        </button>
      </section>

      <section aria-labelledby="kc-facts">
        <h3 id="kc-facts">{w("Business facts (always known)", "Fakta perniagaan (sentiasa diketahui)")}</h3>
        {packs.data
          .filter((p) => (data.packs.includes(p.id) || p.id === "every-business") && p.facts.length)
          .map((p) => (
            <details key={p.id} className="core-record" open={p.id !== "every-business"}>
              <summary>{w(p.name.en, p.name.ms)}</summary>
              {p.facts.map((f) => {
                const saved = factFor(p.id, f.key);
                const id = `${p.id}.${f.key}`;
                const value = edits[id] ?? (saved ? valueText(saved.value) : "");
                return (
                  <form
                    key={f.key}
                    className="core-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      exec(() =>
                        client.execute("saveFact", {
                          agentId,
                          expectedAgentRevision: revision,
                          packId: p.id,
                          fieldKey: f.key,
                          title: f.label.en.slice(0, 200),
                          value,
                          language: "mixed",
                        }),
                      );
                    }}
                  >
                    <Field label={w(f.label.en, f.label.ms) + (f.required ? " *" : "")}>
                      <textarea
                        rows={2}
                        maxLength={3800}
                        value={value}
                        disabled={busy}
                        onChange={(e) => setEdits({ ...edits, [id]: e.target.value })}
                      />
                    </Field>
                    <button className="button" disabled={busy || !value.trim() || edits[id] === undefined}>
                      {w("Save", "Simpan")}
                    </button>
                  </form>
                );
              })}
            </details>
          ))}
        {data.facts
          .filter((f) => !f.pack_id)
          .map((f) => (
            <article key={f.id} className="core-record">
              <h4>
                {f.title} {f.status === "draft" && <span className="remaining-chip">{w("Draft", "Draf")}</span>}
              </h4>
              <p className="core-clamp">{valueText(f.value)}</p>
              <button
                disabled={busy}
                onClick={() => exec(() => client.execute("deleteFact", { agentId, id: f.id, expectedAgentRevision: revision }))}
              >
                {w("Remove", "Buang")}
              </button>
            </article>
          ))}
        <form
          className="core-form"
          onSubmit={(e) => {
            e.preventDefault();
            exec(() =>
              client.execute("saveFact", {
                agentId,
                expectedAgentRevision: revision,
                title: fact.title,
                value: fact.value,
                language: "mixed",
              }),
            ).then(() => setFact({ title: "", value: "" }));
          }}
        >
          <Field label={w("Other fact: title", "Fakta lain: tajuk")}>
            <input maxLength={200} value={fact.title} disabled={busy} onChange={(e) => setFact({ ...fact, title: e.target.value })} />
          </Field>
          <Field label={w("Fact", "Fakta")}>
            <textarea rows={2} maxLength={3800} value={fact.value} disabled={busy} onChange={(e) => setFact({ ...fact, value: e.target.value })} />
          </Field>
          <button className="button" disabled={busy || !fact.title.trim() || !fact.value.trim()}>
            {w("Add fact", "Tambah fakta")}
          </button>
        </form>
      </section>

      <section aria-labelledby="kc-rules">
        <h3 id="kc-rules">{w("Rules (they outrank everything)", "Peraturan (mengatasi semua)")}</h3>
        {packs.data
          .filter((p) => data.packs.includes(p.id) || p.id === "every-business")
          .flatMap((p) =>
            p.rules.map((r) => {
              const o = data.rules.find((x) => x.pack_id === p.id && x.pack_rule_id === r.id);
              const id = `${p.id}.${r.id}`;
              const on = o ? o.enabled : true;
              const text = edits[id] ?? (o ? o.text : r.text.en);
              const save = (enabled: boolean, t: string) =>
                exec(() =>
                  client.execute("saveRule", {
                    agentId,
                    expectedAgentRevision: revision,
                    kind: r.kind,
                    text: t,
                    packId: p.id,
                    packRuleId: r.id,
                    enabled,
                  }),
                );
              return (
                <article key={id} className="core-record">
                  <label className="core-check">
                    <input type="checkbox" checked={on} disabled={busy} onChange={(e) => save(e.target.checked, text)} />
                    <span>
                      <strong>{w(...kindWords[r.kind as Kind])}</strong>
                      <small>{o ? o.text : w(r.text.en, r.text.ms)}</small>
                    </span>
                  </label>
                  <details>
                    <summary>{w("Edit wording", "Ubah ayat")}</summary>
                    <textarea rows={3} maxLength={1000} value={text} disabled={busy} onChange={(e) => setEdits({ ...edits, [id]: e.target.value })} />
                    <button className="button" disabled={busy || !text.trim()} onClick={() => save(on, text)}>
                      {w("Save rule", "Simpan peraturan")}
                    </button>
                  </details>
                </article>
              );
            }),
          )}
        {data.rules
          .filter((r) => !r.pack_id)
          .map((r) => (
            <article key={r.id} className="core-record">
              <h4>{w(...kindWords[r.kind as Kind])}</h4>
              <p>{r.text}</p>
              <button disabled={busy} onClick={() => exec(() => client.execute("deleteRule", { agentId, id: r.id, expectedAgentRevision: revision }))}>
                {w("Remove", "Buang")}
              </button>
            </article>
          ))}
        <form
          className="core-form"
          onSubmit={(e) => {
            e.preventDefault();
            exec(() =>
              client.execute("saveRule", { agentId, expectedAgentRevision: revision, kind: rule.kind, text: rule.text, enabled: true }),
            ).then(() => setRule({ ...rule, text: "" }));
          }}
        >
          <Field label={w("Your rule: when", "Peraturan anda: bila")}>
            <select value={rule.kind} disabled={busy} onChange={(e) => setRule({ ...rule, kind: e.target.value as Kind })}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {w(...kindWords[k])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={w("Rule", "Peraturan")}>
            <textarea rows={2} maxLength={1000} value={rule.text} disabled={busy} onChange={(e) => setRule({ ...rule, text: e.target.value })} />
          </Field>
          <button className="button" disabled={busy || !rule.text.trim()}>
            {w("Add rule", "Tambah peraturan")}
          </button>
        </form>
      </section>

      <section aria-labelledby="kc-catalogue">
        <h3 id="kc-catalogue">{w("Catalogue and price list", "Katalog dan senarai harga")}</h3>
        <p className="core-hint">
          {w(
            `${data.catalogue.total} rows, ${data.catalogue.drafts} waiting for your check. Drafts never reach the agent.`,
            `${data.catalogue.total} baris, ${data.catalogue.drafts} menunggu semakan anda. Draf tidak sampai kepada ejen.`,
          )}
        </p>
        <Field
          label={w("Paste rows", "Tampal baris")}
          hint={w(
            "One item per line: item | price RM | stock note | other names, separated by commas",
            "Satu barang setiap baris: barang | harga RM | nota stok | nama lain, dipisah koma",
          )}
        >
          <textarea
            rows={4}
            value={paste}
            disabled={busy}
            placeholder="Bateri kereta NS60 | 230 | ada stok | NS60L, 46B24L"
            onChange={(e) => {
              setPaste(e.target.value);
              setPasteError("");
            }}
          />
        </Field>
        {pasteError && (
          <p role="alert">
            {w("Check this line:", "Semak baris ini:")} {pasteError}
          </p>
        )}
        <div className="core-actions">
          <button
            className="button"
            disabled={busy || !paste.trim()}
            onClick={() => {
              const parsed = parseRows(paste);
              if ("error" in parsed) return setPasteError(parsed.error ?? "");
              if (parsed.rows.length > 500) return setPasteError(w("At most 500 rows at a time.", "Paling banyak 500 baris sekali."));
              exec(() =>
                client.execute("saveCatalogue", {
                  agentId,
                  expectedAgentRevision: revision,
                  status: "draft",
                  ...(data.packs[0] ? { packId: data.packs[0] } : {}),
                  rows: parsed.rows.map((r) => ({ ...r, attributes: {}, language: "mixed" as const })),
                }),
              ).then(() => setPaste(""));
            }}
          >
            {w("Add as drafts", "Tambah sebagai draf")}
          </button>
          <button
            className="button button-dark"
            disabled={busy || !data.catalogue.drafts}
            onClick={() => exec(() => client.execute("confirmKnowledge", { agentId, expectedAgentRevision: revision }))}
          >
            {w("I checked the drafts: confirm", "Saya sudah semak draf: sahkan")}
          </button>
        </div>
        <ul className="core-list">
          {data.catalogue.rows.slice(0, 100).map((r) => (
            <li key={r.id}>
              <span>
                {r.item}
                {r.price_sen !== null && ` · RM ${(r.price_sen / 100).toFixed(2)}`}
                {r.stock_note && ` · ${r.stock_note}`}
                {r.status === "draft" && <span className="remaining-chip"> {w("Draft", "Draf")}</span>}
              </span>
              <button
                disabled={busy}
                aria-label={w("Remove " + r.item, "Buang " + r.item)}
                onClick={() => exec(() => client.execute("deleteCatalogueRow", { agentId, id: r.id, expectedAgentRevision: revision }))}
              >
                {w("Remove", "Buang")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="kc-gaps">
        <h3 id="kc-gaps">{w("Questions the agent could not answer", "Soalan yang ejen tidak dapat jawab")}</h3>
        <p className="core-hint">
          {w("Only the question is kept, never who asked.", "Hanya soalan disimpan, bukan siapa yang bertanya.")}
        </p>
        {gaps.error ? (
          <Notice error={gaps.error} />
        ) : !gaps.data?.length ? (
          <p>{w("Nothing yet.", "Belum ada.")}</p>
        ) : (
          gaps.data.map((g: KnowledgeGap) => (
            <article key={g.id} className="core-record">
              <h4>
                “{g.question}” <small>×{g.ask_count}</small>
              </h4>
              <p className="core-clamp">
                {w("Agent said:", "Ejen jawab:")} {g.answer}
              </p>
              {g.status === "open" ? (
                <>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    aria-label={w("The right answer", "Jawapan yang betul")}
                    placeholder={w("The right answer, or what to do", "Jawapan yang betul, atau apa perlu dibuat")}
                    value={answers[g.id] ?? ""}
                    disabled={busy}
                    onChange={(e) => setAnswers({ ...answers, [g.id]: e.target.value })}
                  />
                  <div className="core-actions">
                    {(["fact", "rule"] as const).map((as) => (
                      <button
                        key={as}
                        className="button"
                        disabled={busy || !(answers[g.id] ?? "").trim()}
                        onClick={async () => {
                          const text = answers[g.id]!.trim();
                          const r = await a.run(() =>
                            client.execute(
                              "resolveGap",
                              as === "fact"
                                ? { agentId, id: g.id, as, expectedRevision: g.revision, expectedAgentRevision: revision, title: g.question.slice(0, 200), value: text }
                                : { agentId, id: g.id, as, expectedRevision: g.revision, expectedAgentRevision: revision, kind: "always", text },
                            ),
                          );
                          if (r) {
                            onRevision(revision + 1);
                            await Promise.all([gaps.reload(), core.reload()]);
                          }
                        }}
                      >
                        {as === "fact" ? w("Save as fact", "Simpan sebagai fakta") : w("Save as rule", "Simpan sebagai peraturan")}
                      </button>
                    ))}
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (await a.run(() => client.execute("ignoreGap", { agentId, id: g.id, expectedRevision: g.revision })))
                          await gaps.reload();
                      }}
                    >
                      {w("Ignore", "Abaikan")}
                    </button>
                  </div>
                </>
              ) : (
                <span className="remaining-chip">
                  {g.status === "resolved" ? w("Resolved", "Selesai") : w("Ignored", "Diabaikan")}
                </span>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
