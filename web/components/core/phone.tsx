"use client";
import { HOSTED } from "@/lib/hosted";
import { useState } from "react";
import { ArrowLeft, Phone } from "@phosphor-icons/react";
import type { PhoneNumber, CallSummary } from "../../../packages/contracts/src/phone";
import { useCore, useWords, useResource, useAction, Heading, Notice, Loading } from "./state";
import { Field } from "./field";
import { useExperience } from "../experience";

const KL = "Asia/Kuala_Lumpur";
const when = (iso: string, ms: boolean) =>
  new Intl.DateTimeFormat(ms ? "ms-MY" : "en-MY", {
    timeZone: KL,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
const seconds = (s: number | null) =>
  s === null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function useMs() {
  return useExperience().locale === "ms";
}

// Whether a telephony provider is set up on the agent side. Until it is, the
// numbers are only routing records: nothing rings.
function ProviderChip({ configured }: { configured: boolean }) {
  const w = useWords();
  return (
    <span className="remaining-chip" role="status">
      {configured
        ? w("Phone line connected", "Talian telefon disambungkan")
        : w("Not connected", "Belum disambungkan")}
    </span>
  );
}

export function LocalPhoneNumbers() {
  const w = useWords(),
    { client, workspace } = useCore();
  const manager = workspace.role !== "staff";
  const list = useResource(() => client.execute("phoneNumbers", {}), "numbers");
  const [editing, setEditing] = useState<PhoneNumber | "new">();
  return (
    <>
      <Heading
        title={w("Phone numbers", "Nombor telefon")}
        description={w(
          "Each number reaches one location and its published agent. Calls are answered only after a telephony provider is connected.",
          "Setiap nombor sampai ke satu lokasi dan ejen yang diterbitkan. Panggilan hanya dijawab selepas penyedia telefoni disambungkan.",
        )}
      >
        {manager && (
          <button className="button button-dark" onClick={() => setEditing("new")}>
            {w("Add number", "Tambah nombor")}
          </button>
        )}
      </Heading>
      {list.error ? (
        <Notice error={list.error} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <>
          <section className="core-panel">
            <ProviderChip configured={list.data.provider.configured} />
            {!list.data.provider.configured && (
              <p>
                {w(
                  HOSTED ? "No calls are placed or answered from this workspace yet. Phone lines are not available yet." : "No calls are placed or answered from this workspace yet. The owner steps in the phone-line guide connect a provider.",
                  HOSTED ? "Belum ada panggilan dibuat atau dijawab dari ruang kerja ini. Talian telefon belum tersedia." : "Belum ada panggilan dibuat atau dijawab dari ruang kerja ini. Langkah pemilik dalam panduan talian telefon menyambungkan penyedia.",
                )}
              </p>
            )}
            <p>
              {w(
                "Every call opens with the AI disclosure, then the recording notice when recording is on. It cannot be skipped.",
                "Setiap panggilan bermula dengan makluman AI, kemudian makluman rakaman jika rakaman dihidupkan. Ia tidak boleh dilangkau.",
              )}
            </p>
          </section>
          {editing && (
            <NumberEditor
              key={editing === "new" ? "new" : editing.id}
              number={editing === "new" ? undefined : editing}
              onDone={() => {
                setEditing(undefined);
                void list.reload();
              }}
            />
          )}
          <section className="core-panel">
            {!list.data.items.length ? (
              <p className="core-empty">{w("No numbers yet.", "Belum ada nombor.")}</p>
            ) : (
              list.data.items.map((n) => (
                <div className="directory-row" key={n.id}>
                  <span className="crm-avatar">
                    <Phone size={16} />
                  </span>
                  <span>
                    <strong>{n.e164}</strong>
                    <small>
                      {[
                        n.label,
                        n.active ? w("Active", "Aktif") : w("Off", "Dimatikan"),
                        n.transfer_e164
                          ? w("Transfers to ", "Pindah ke ") + n.transfer_e164
                          : w("No staff transfer", "Tiada pindahan kepada staf"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  {manager && (
                    <button onClick={() => setEditing(n)}>{w("Edit", "Sunting")}</button>
                  )}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}

function NumberEditor({ number, onDone }: { number?: PhoneNumber; onDone: () => void }) {
  const w = useWords(),
    { client, workspace } = useCore();
  const action = useAction();
  const [e164, setE164] = useState(number?.e164 ?? "+60");
  const [label, setLabel] = useState(number?.label ?? "");
  const [locationId, setLocationId] = useState(number?.location_id ?? workspace.locations[0]?.id ?? "");
  const [transfer, setTransfer] = useState(number?.transfer_e164 ?? "");
  const [active, setActive] = useState(number?.active ?? true);
  const save = async () => {
    const saved = await action.run(() =>
      number
        ? client.execute("updatePhoneNumber", {
            id: number.id,
            label,
            locationId,
            agentId: workspace.agent.id,
            transferE164: transfer.trim() || null,
            active,
            expectedRevision: number.revision,
          })
        : client.execute("createPhoneNumber", {
            e164: e164.replace(/[\s-]/g, ""),
            label,
            locationId,
            agentId: workspace.agent.id,
            transferE164: transfer.trim() || null,
          }),
    );
    if (saved) onDone();
  };
  return (
    <section className="core-panel">
      <h2>{number ? w("Edit number", "Sunting nombor") : w("Add a number", "Tambah nombor")}</h2>
      <Field
        label={w("Number (E.164)", "Nombor (E.164)")}
        hint={w("For example +60312345678", "Contohnya +60312345678")}
      >
        <input
          value={e164}
          inputMode="tel"
          disabled={!!number}
          onChange={(e) => setE164(e.target.value)}
        />
      </Field>
      <Field label={w("Label", "Label")}>
        <input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label={w("Location", "Lokasi")}>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {workspace.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={w("Staff number for transfers", "Nombor staf untuk pindahan")}
        hint={w(
          "Optional. Used during opening hours only; after hours the agent takes a message.",
          "Pilihan. Digunakan pada waktu operasi sahaja; selepas waktu, ejen mengambil mesej.",
        )}
      >
        <input value={transfer} inputMode="tel" onChange={(e) => setTransfer(e.target.value)} />
      </Field>
      {number && (
        <label className="product-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {w("Answer calls on this number", "Jawab panggilan pada nombor ini")}
        </label>
      )}
      <Notice error={action.error} />
      <div className="core-actions">
        <button className="button button-dark" disabled={action.busy} onClick={save}>
          {w("Save", "Simpan")}
        </button>
        <button onClick={onDone}>{w("Cancel", "Batal")}</button>
      </div>
    </section>
  );
}

function outcomeText(c: CallSummary, w: (en: string, ms: string) => string) {
  if (c.state === "refused")
    return c.refusal === "LINES_BUSY" || c.refusal === "CALLER_LIMIT"
      ? w("Busy line played", "Talian sibuk dimainkan")
      : w("Not answered", "Tidak dijawab");
  if (c.state === "active") return w("On the line", "Sedang dalam talian");
  const map: Record<string, [string, string]> = {
    answered: ["Answered", "Dijawab"],
    booking_proposed: ["Booking to confirm", "Tempahan untuk disahkan"],
    message: ["Message taken", "Mesej diambil"],
    handoff: ["Staff follow-up", "Susulan staf"],
    transferred: ["Transferred", "Dipindahkan"],
    transfer_failed: ["Transfer not answered", "Pindahan tidak dijawab"],
    abandoned: ["Caller hung up", "Pemanggil meletak telefon"],
  };
  const pair = c.outcome ? map[c.outcome] : undefined;
  return pair ? w(pair[0], pair[1]) : w("Ended", "Tamat");
}

export function LocalCalls() {
  const w = useWords(),
    ms = useMs(),
    { client } = useCore();
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const list = useResource(() => client.execute("calls", { cursor, limit: 25 }), "calls|" + cursor);
  return (
    <>
      <Heading
        title={w("Calls", "Panggilan")}
        description={w(
          "Real phone calls answered by your agent. Browser tests stay in the test panel.",
          "Panggilan telefon sebenar yang dijawab oleh ejen anda. Ujian pelayar kekal di panel ujian.",
        )}
      />
      <div className={`core-contact-desk ${selected ? "core-has-profile" : ""}`}>
        <section className="contact-directory">
          {list.error ? (
            <Notice error={list.error} />
          ) : !list.data ? (
            <Loading />
          ) : !list.data.items.length ? (
            <p className="core-empty">
              {w(
                "No calls yet. Calls appear here once a phone line is connected.",
                "Belum ada panggilan. Panggilan muncul di sini selepas talian telefon disambungkan.",
              )}
            </p>
          ) : (
            list.data.items.map((c) => (
              <button
                key={c.id}
                className={`directory-row ${selected === c.id ? "selected" : ""}`}
                aria-pressed={selected === c.id}
                onClick={() => setSelected(c.id)}
              >
                <span className="crm-avatar">
                  <Phone size={16} />
                </span>
                <span>
                  <strong>{c.caller_e164 ?? w("Number withheld", "Nombor disembunyikan")}</strong>
                  <small>
                    {[
                      when(c.started_at, ms),
                      outcomeText(c, w),
                      c.after_hours ? w("After hours", "Selepas waktu") : "",
                      c.do_not_contact ? w("Do not contact", "Jangan hubungi") : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </button>
            ))
          )}
          <div className="core-actions core-pagination">
            {cursor && (
              <button onClick={() => setCursor(undefined)}>{w("First page", "Halaman pertama")}</button>
            )}
            {list.data?.nextCursor && (
              <button onClick={() => setCursor(list.data!.nextCursor!)}>
                {w("Next page", "Halaman seterusnya")}
              </button>
            )}
          </div>
        </section>
        <section className="core-contact-profile">
          {selected && (
            <>
              <button className="core-back" onClick={() => setSelected(undefined)}>
                <ArrowLeft size={18} />
                {w("Back to calls", "Kembali ke panggilan")}
              </button>
              <CallDetail key={selected} id={selected} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

function CallDetail({ id }: { id: string }) {
  const w = useWords(),
    ms = useMs(),
    { client } = useCore();
  const call = useResource(() => client.execute("call", { id }), "call|" + id);
  if (call.error) return <Notice error={call.error} />;
  if (!call.data) return <Loading />;
  const c = call.data;
  return (
    <div className="core-panel">
      <h2>{c.caller_e164 ?? w("Number withheld", "Nombor disembunyikan")}</h2>
      <p>
        {when(c.started_at, ms)} · {seconds(c.duration_seconds)} · {outcomeText(c, w)}
      </p>
      <p>
        {c.disclosure_played_at
          ? w("AI disclosure played", "Makluman AI dimainkan")
          : w("Disclosure not played (call not answered)", "Makluman tidak dimainkan (panggilan tidak dijawab)")}
        {c.recording_enabled ? w(" · recording notice included", " · makluman rakaman disertakan") : ""}
      </p>
      {c.turns === null ? (
        <p className="core-empty">
          {w(
            "What was said is visible to owners and admins only.",
            "Perbualan hanya boleh dilihat oleh pemilik dan pentadbir.",
          )}
        </p>
      ) : (
        <ol className="core-call-turns">
          {c.turns.map((t) => (
            <li key={t.id}>
              <p>
                <strong>{w("Caller", "Pemanggil")}:</strong> {t.input}
              </p>
              {t.answer && (
                <p>
                  <strong>{w("Agent", "Ejen")}:</strong> {t.answer}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {!!c.proposals?.length && (
        <>
          <h3>{w("To follow up", "Untuk disusuli")}</h3>
          <ul>
            {c.proposals.map((p) => (
              <li key={p.id}>
                {p.kind === "booking"
                  ? w("Booking to confirm", "Tempahan untuk disahkan")
                  : p.kind === "message"
                    ? w("Message", "Mesej")
                    : w("Staff follow-up", "Susulan staf")}{" "}
                · {p.state}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
