"use client";
import { localNumber } from "@/lib/core/phone-format";
import { Picker } from "@/components/picker";
import { HOSTED } from "@/lib/hosted";
import { useState } from "react";
import { ArrowLeft, Phone } from "@phosphor-icons/react";
import {
  phoneAreas,
  type PhoneNumber,
  type PhoneNumbers,
  type CallSummary,
} from "../../../packages/contracts/src/phone";
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

// Whether this workspace's line rings: a telephony provider set up on the
// agent side and an active number here. Until both, nothing rings.
function ProviderChip({ configured, live }: { configured: boolean; live: boolean }) {
  const w = useWords();
  return (
    <span className="remaining-chip" role="status">
      {!configured
        ? w("Not connected", "Belum disambungkan")
        : live
          ? w("Phone line connected", "Talian telefon disambungkan")
          : w("No number yet", "Belum ada nombor")}
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
        description={
          HOSTED
            ? w(
                "Your JomCall number is answered by your published agent. Keep your existing business number and forward its calls here.",
                "Nombor JomCall anda dijawab oleh ejen anda yang diterbitkan. Kekalkan nombor perniagaan sedia ada dan majukan panggilannya ke sini.",
              )
            : w(
                "Each number reaches one location and its published agent. Calls are answered only after a telephony provider is connected.",
                "Setiap nombor sampai ke satu lokasi dan ejen yang diterbitkan. Panggilan hanya dijawab selepas penyedia telefoni disambungkan.",
              )
        }
      >
        {manager && !HOSTED && (
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
            <ProviderChip
              configured={list.data.provider.configured}
              live={list.data.items.some((n) => n.active)}
            />
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
                "Every call opens with the AI disclosure. It cannot be skipped.",
                "Setiap panggilan bermula dengan makluman AI. Ia tidak boleh dilangkau.",
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
          {HOSTED && !list.data.items.some((n) => n.active) && (
            <NumberRequest data={list.data} manager={manager} onDone={() => void list.reload()} />
          )}
          <section className="core-panel">
            {!list.data.items.length ? (
              <p className="core-empty">
                {/* The badge above already says there is no number yet. */}
                {HOSTED
                  ? w(
                      "Your number shows here once it is ready.",
                      "Nombor anda dipaparkan di sini apabila sedia.",
                    )
                  : w("No numbers yet.", "Belum ada nombor.")}
              </p>
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
          {list.data.items
            .filter((n) => n.active)
            .slice(0, 1)
            .map((n) => (
              <Forwarding key={n.id} e164={n.e164} />
            ))}
        </>
      )}
    </>
  );
}

const AREAS: Record<(typeof phoneAreas)[number], [string, string]> = {
  any: ["No preference", "Tiada pilihan"],
  klang_valley: ["Kuala Lumpur and Selangor (03)", "Kuala Lumpur dan Selangor (03)"],
  penang: ["Penang (04)", "Pulau Pinang (04)"],
  kedah: ["Kedah and Perlis (04)", "Kedah dan Perlis (04)"],
  perak: ["Perak (05)", "Perak (05)"],
  melaka: ["Melaka (06)", "Melaka (06)"],
  negeri_sembilan: ["Negeri Sembilan (06)", "Negeri Sembilan (06)"],
  johor: ["Johor (07)", "Johor (07)"],
  pahang: ["Pahang, Terengganu and Kelantan (09)", "Pahang, Terengganu dan Kelantan (09)"],
  sabah: ["Sabah (088)", "Sabah (088)"],
  sarawak: ["Sarawak (082)", "Sarawak (082)"],
};

// Numbers are set up by a person, so the owner asks and waits. Shown in the
// hosted app while the workspace has no active number.
function NumberRequest({
  data,
  manager,
  onDone,
}: {
  data: PhoneNumbers;
  manager: boolean;
  onDone: () => void;
}) {
  const w = useWords(),
    ms = useMs(),
    { href } = useExperience(),
    { client } = useCore();
  const action = useAction();
  const [area, setArea] = useState<(typeof phoneAreas)[number]>("any");
  const [own, setOwn] = useState("");
  const open = data.request?.state === "open" ? data.request : null;
  const wait = w(
    "We set each number up by hand. It is usually ready within 2 working hours (Monday to Friday, 9am to 6pm), and we email you when it is.",
    "Kami menyediakan setiap nombor secara manual. Biasanya sedia dalam 2 jam bekerja (Isnin hingga Jumaat, 9 pagi hingga 6 petang), dan kami e-mel anda apabila sedia.",
  );
  if (open)
    return (
      <section className="core-panel" role="status">
        <h2>{w("Your number is being set up", "Nombor anda sedang disediakan")}</h2>
        <p>
          {w("Asked on ", "Diminta pada ") + when(open.created_at, ms)}
          {" · "}
          {w(AREAS[open.area][0], AREAS[open.area][1])}
        </p>
        <p>{wait}</p>
      </section>
    );
  if (!manager) return null;
  if (!data.planIncludesNumber)
    return (
      <section className="core-panel">
        <h2>{w("Get your phone number", "Dapatkan nombor telefon anda")}</h2>
        <p>
          {w(
            "A phone number comes with the Starter and Growth plans. Choose a plan first, then ask for your number here.",
            "Nombor telefon disertakan dengan pelan Starter dan Growth. Pilih pelan dahulu, kemudian minta nombor anda di sini.",
          )}
        </p>
        <a className="button button-dark" href={href("/app/billing")}>
          {w("Choose a plan", "Pilih pelan")}
        </a>
      </section>
    );
  const cleaned = own.replace(/[\s-]/g, "");
  const ownE164 = cleaned.startsWith("0") ? "+6" + cleaned : cleaned;
  const ownBad = cleaned !== "" && !/^\+[1-9][0-9]{6,14}$/.test(ownE164);
  const send = async () => {
    const saved = await action.run(() =>
      client.execute("requestPhoneNumber", {
        area,
        forwardFrom: cleaned ? ownE164 : null,
      }),
    );
    if (saved) onDone();
  };
  return (
    <section className="core-panel">
      <h2>{w("Get your phone number", "Dapatkan nombor telefon anda")}</h2>
      <p>{wait}</p>
      <Field
        label={w("Area you would like", "Kawasan pilihan anda")}
        hint={w(
          "We match it when a number is available there. Your customers keep calling your existing number, so the new number's area rarely matters.",
          "Kami padankan jika ada nombor di kawasan itu. Pelanggan anda terus menelefon nombor sedia ada, jadi kawasan nombor baharu jarang penting.",
        )}
      >
        <Picker
          value={area}
          onChange={setArea}
          options={phoneAreas.map((a) => ({ value: a, label: w(AREAS[a][0], AREAS[a][1]) }))}
        />
      </Field>
      <Field
        label={w("Your existing business number (optional)", "Nombor perniagaan sedia ada anda (pilihan)")}
        hint={
          ownBad
            ? w("Enter a full number, for example 0312345678.", "Masukkan nombor penuh, contohnya 0312345678.")
            : w(
                "The number your customers call today. You will forward it to the new one.",
                "Nombor yang pelanggan anda telefon hari ini. Anda akan memajukannya ke nombor baharu.",
              )
        }
      >
        <input value={own} inputMode="tel" maxLength={20} onChange={(e) => setOwn(e.target.value)} />
      </Field>
      <Notice error={action.error} />
      <div className="core-actions">
        <button className="button button-dark" disabled={action.busy || ownBad} onClick={send}>
          {w("Request my number", "Minta nombor saya")}
        </button>
      </div>
    </section>
  );
}

// How to send an existing line's calls to the JomCall number. The codes are
// the standard mobile network ones; a carrier may name or charge for the
// service differently, so the text says to ask it when a code is refused.
function Forwarding({ e164 }: { e164: string }) {
  const w = useWords();
  const local = localNumber(e164);
  const rows: [string, string, string][] = [
    [w("Every call", "Semua panggilan"), `**21*${local}#`, "##21#"],
    [w("Only when you do not answer", "Hanya apabila anda tidak menjawab"), `**61*${local}#`, "##61#"],
    [w("Only when your line is busy", "Hanya apabila talian anda sibuk"), `**67*${local}#`, "##67#"],
    [w("Only when your phone is off or out of coverage", "Hanya apabila telefon anda dimatikan atau di luar liputan"), `**62*${local}#`, "##62#"],
  ];
  return (
    <section className="core-panel">
      <h2>{w("Forward your existing number", "Majukan nombor sedia ada anda")}</h2>
      <p>
        {w(
          `Your customers keep calling the number they know. Forward that line to ${local} and your agent answers.`,
          `Pelanggan anda terus menelefon nombor yang mereka kenal. Majukan talian itu ke ${local} dan ejen anda menjawab.`,
        )}
      </p>
      <h3>{w("Mobile line (Maxis, CelcomDigi, U Mobile, Unifi Mobile and others)", "Talian mudah alih (Maxis, CelcomDigi, U Mobile, Unifi Mobile dan lain-lain)")}</h3>
      <p>
        {w(
          "On the phone that holds the line, open the keypad, type one code and press call. Type the second code the same way to stop. ##002# stops every kind of forwarding at once.",
          "Pada telefon yang memegang talian itu, buka pad kekunci, taip satu kod dan tekan panggil. Taip kod kedua dengan cara yang sama untuk berhenti. ##002# menghentikan semua jenis pemajuan sekali gus.",
        )}
      </p>
      <ul className="forward-codes">
        {rows.map(([what, start, stop]) => (
          <li key={start}>
            <strong>{what}</strong>
            <span>
              {w("Start", "Mula")} <code>{start}</code>
            </span>
            <span>
              {w("Stop", "Henti")} <code>{stop}</code>
            </span>
          </li>
        ))}
      </ul>
      <h3>{w("Office or fixed line (TM, Unifi, TIME, Maxis Business)", "Talian pejabat atau tetap (TM, Unifi, TIME, Maxis Business)")}</h3>
      <p>
        {w(
          `Ask your provider to switch on call forwarding to ${local}. Office phone systems (PBX) are forwarded by whoever looks after the system.`,
          `Minta pembekal anda menghidupkan pemajuan panggilan ke ${local}. Sistem telefon pejabat (PBX) dimajukan oleh pihak yang menyelenggara sistem itu.`,
        )}
      </p>
      <p>
        {w(
          "Then call your own number from another phone to check. If a code is refused, your provider has to switch the service on first. Your provider may charge you for forwarded calls.",
          "Kemudian telefon nombor anda sendiri dari telefon lain untuk menyemak. Jika kod ditolak, pembekal anda perlu menghidupkan perkhidmatan itu dahulu. Pembekal anda mungkin mengenakan caj bagi panggilan yang dimajukan.",
        )}
      </p>
    </section>
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
        <Picker
          value={locationId}
          onChange={setLocationId}
          options={workspace.locations.map((l) => ({ value: l.id, label: l.name }))}
        />
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
      : c.refusal === "NO_PHONE_ENTITLEMENT"
        ? w(
            "Not answered: no plan with a phone number. Choose a plan in Billing.",
            "Tidak dijawab: tiada pelan dengan nombor telefon. Pilih pelan di Bil & penggunaan.",
          )
        : c.refusal === "WALLET_UNFUNDED" || c.refusal === "WALLET_EXHAUSTED"
          ? w(
              "Not answered: the wallet was empty. Top up in Billing.",
              "Tidak dijawab: dompet kosong. Tambah nilai di Bil & penggunaan.",
            )
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
