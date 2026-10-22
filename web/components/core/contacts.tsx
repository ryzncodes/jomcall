"use client";
import { useSearchParams } from "next/navigation";
import { ContactBookings } from "./bookings";
import { useState } from "react";
import { MagnifyingGlass, Users, ArrowLeft } from "@phosphor-icons/react";
import type {
  Profile,
  Contact,
  Job,
} from "../../../packages/contracts/src/core";
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
import { ContactNameField } from "./contact-fields";
export function LocalContacts() {
  const w = useWords(),
    { client } = useCore();
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [selected, setSelected] = useState<string | undefined>(
      useSearchParams().get("contact") ?? undefined,
    ),
    [adding, setAdding] = useState(false);
  const list = useResource(
    () => client.execute("listContacts", { search, cursor, limit: 25 }),
    search + "|" + cursor,
  );
  return (
    <>
      <Heading
        title={w("People, remembered.", "Setiap pelanggan, diingati.")}
        description={w(
          "A shared record for each customer. Notes, consent and privacy controls stay together.",
          "Rekod bersama bagi setiap pelanggan. Nota, persetujuan dan kawalan privasi di satu tempat.",
        )}
      >
        <button
          className="button button-dark"
          onClick={() => {
            setAdding(true);
            setSelected(undefined);
          }}
        >
          {w("Add contact", "Tambah kenalan")}
        </button>
      </Heading>
      <div
        className={`core-contact-desk ${selected || adding ? "core-has-profile" : ""}`}
      >
        <section className="contact-directory">
          <div className="crm-search">
            <MagnifyingGlass size={19} />
            <input
              aria-label={w("Search contacts", "Cari kenalan")}
              placeholder={w("Search contacts", "Cari kenalan")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(undefined);
              }}
            />
          </div>
          {list.error ? (
            <Notice error={list.error} />
          ) : !list.data ? (
            <Loading />
          ) : !list.data.items.length ? (
            <p className="core-empty">
              {w("No contacts here yet.", "Belum ada kenalan di sini.")}
            </p>
          ) : (
            list.data.items.map((c) => (
              <button
                className={`directory-row ${selected === c.id ? "selected" : ""}`}
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setAdding(false);
                }}
                aria-pressed={selected === c.id}
              >
                <span className="crm-avatar">{c.name.slice(0, 1)}</span>
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.deletion_pending
                      ? w("Deletion pending", "Menunggu pemadaman")
                      : c.do_not_contact
                        ? w("Do not contact", "Jangan hubungi")
                        : c.preferred_language.toUpperCase()}
                  </small>
                </span>
              </button>
            ))
          )}
          <div className="core-actions core-pagination">
            {cursor && (
              <button onClick={() => setCursor(undefined)}>
                {w("First page", "Halaman pertama")}
              </button>
            )}
            {list.data?.nextCursor && (
              <button onClick={() => setCursor(list.data!.nextCursor!)}>
                {w("Next page", "Halaman seterusnya")}
              </button>
            )}
          </div>
        </section>
        <section className="core-contact-profile">
          {selected || adding ? (
            <button
              className="core-back"
              onClick={() => {
                setSelected(undefined);
                setAdding(false);
              }}
            >
              <ArrowLeft size={18} />
              {w("Back to contacts", "Kembali ke kenalan")}
            </button>
          ) : null}
          {adding ? (
            <ContactEditor
              onSaved={(id) => {
                setSelected(id);
                setAdding(false);
              }}
            />
          ) : selected ? (
            <ContactProfile
              key={selected}
              id={selected}
              onDeleted={() => setSelected(undefined)}
            />
          ) : (
            <div className="core-empty core-profile-empty">
              <Users size={42} weight="light" />
              <h2>{w("Start with a person.", "Mulakan dengan seseorang.")}</h2>
              <p>
                {w(
                  "Choose a contact to see their details, notes and consent.",
                  "Pilih kenalan untuk melihat butiran, nota dan persetujuan.",
                )}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function ContactEditor({
  contact,
  onSaved,
}: {
  contact?: Contact;
  onSaved: (id: string) => void;
}) {
  const w = useWords(),
    { client } = useCore(),
    a = useAction();
  const [name, setName] = useState(contact?.name ?? ""),
    [phone, setPhone] = useState(contact?.phone_e164 ?? ""),
    [language, setLanguage] = useState<Contact["preferred_language"]>(
      contact?.preferred_language ?? "ms",
    ),
    [revision] = useState(contact?.revision ?? 1);
  return (
    <form
      className="core-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const input = {
          name,
          phone: phone.trim() || null,
          preferredLanguage: language,
        };
        const result = await a.run(() =>
          contact
            ? client.execute("updateContact", {
                id: contact.id,
                expectedRevision: revision,
                ...input,
              })
            : client.execute("createContact", input),
        );
        if (result) onSaved(result.id);
      }}
    >
      <h2>
        {contact
          ? w("Edit contact", "Sunting kenalan")
          : w("New contact", "Kenalan baharu")}
      </h2>
      <Notice {...a} />
      <fieldset disabled={a.busy || contact?.deletion_pending}>
        <ContactNameField value={name} onChange={setName} />
        <Field
          label={w("Phone number (optional)", "Nombor telefon (pilihan)")}
          hint={w(
            "International format, for example +60…",
            "Format antarabangsa, contohnya +60…",
          )}
        >
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            pattern="\+[1-9][0-9]{1,14}"
            maxLength={16}
          />
        </Field>
        <Field label={w("Preferred language", "Bahasa pilihan")}>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
          >
            <option value="ms">Bahasa Melayu</option>
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </Field>
        <button className="button button-dark">
          {a.busy
            ? w("Saving…", "Menyimpan…")
            : w("Save contact", "Simpan kenalan")}
        </button>
      </fieldset>
    </form>
  );
}
function ContactProfile({
  id,
  onDeleted,
}: {
  id: string;
  onDeleted: () => void;
}) {
  const w = useWords(),
    { client, workspace } = useCore();
  const resource = useResource(() => client.execute("getContact", { id }), id);
  const [editing, setEditing] = useState(false),
    [reload, setReload] = useState(0);
  if (!resource.data) return <Loading error={resource.error} />;
  const c = resource.data;
  return (
    <>
      <Notice error={resource.error} />
      <header className="core-profile-heading">
        <span className="crm-avatar">{c.name.slice(0, 1)}</span>
        <div>
          <h2>{c.name}</h2>
          <p>
            {c.phone_e164 ?? w("No phone number", "Tiada nombor telefon")} ·{" "}
            {c.preferred_language.toUpperCase()}
          </p>
        </div>
      </header>
      {c.deletion_pending && (
        <p className="storage-warning">
          {w(
            "Deletion pending. Editing is locked until this job finishes.",
            "Pemadaman belum selesai. Suntingan dikunci sehingga tugas selesai.",
          )}
        </p>
      )}
      <div className="core-actions">
        <button
          className="button secondary-button"
          onClick={() => setEditing(!editing)}
          disabled={c.deletion_pending}
        >
          {editing
            ? w("Close editor", "Tutup penyunting")
            : w("Edit details", "Sunting butiran")}
        </button>
        {editing && (
          <button
            onClick={async () => {
              if (await resource.reload()) setReload((v) => v + 1);
            }}
          >
            {w("Reload latest values", "Muat semula nilai terkini")}
          </button>
        )}
      </div>
      {editing && (
        <ContactEditor
          key={id + reload}
          contact={c}
          onSaved={() => setEditing(false)}
        />
      )}
      <ContactRecords contact={c} />
      <ContactBookings contactId={id} />
      {workspace.role !== "staff" && (
        <Privacy contact={c} onDeleted={onDeleted} />
      )}
    </>
  );
}
function ContactRecords({ contact: c }: { contact: Profile }) {
  const w = useWords(),
    { client } = useCore(),
    a = useAction();
  const [note, setNote] = useState(""),
    [reason, setReason] = useState(""),
    [evidence, setEvidence] = useState("");
  return (
    <>
      <Notice {...a} />
      <section className="contact-section">
        <h3>{w("Internal notes", "Nota dalaman")}</h3>
        {c.notes.items.map((n) => (
          <article className="core-record" key={n.id}>
            <p>{n.text}</p>
            <time>
              {new Date(n.created_at).toLocaleString("en-MY", {
                timeZone: "Asia/Kuala_Lumpur",
              })}
            </time>
          </article>
        ))}
        <MoreRecords kind="notes" id={c.id} cursor={c.notes.nextCursor} />
        <form
          className="core-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await a.run(() =>
                client.execute("addNote", {
                  id: c.id,
                  expectedRevision: c.revision,
                  text: note,
                }),
              )
            )
              setNote("");
          }}
        >
          <Field label={w("Add a note", "Tambah nota")}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              maxLength={5000}
              rows={3}
            />
          </Field>
          <button
            disabled={a.busy || c.deletion_pending}
            className="button secondary-button"
          >
            {w("Save note", "Simpan nota")}
          </button>
        </form>
      </section>
      <section className="contact-section">
        <h3>{w("Contact preferences", "Pilihan hubungan")}</h3>
        <p>
          {c.do_not_contact
            ? w(
                "Do not contact is on. Consent records are kept independently.",
                "Jangan hubungi diaktifkan. Rekod persetujuan disimpan berasingan.",
              )
            : w(
                "Do not contact is off. Check channel consent before any outreach.",
                "Jangan hubungi dimatikan. Semak persetujuan saluran sebelum menghubungi.",
              )}
        </p>
        <form
          className="core-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await a.run(() =>
                client.execute("setDnc", {
                  id: c.id,
                  expectedRevision: c.revision,
                  enabled: !c.do_not_contact,
                  reason,
                }),
              )
            )
              setReason("");
          }}
        >
          <Field label={w("Reason for change", "Sebab perubahan")}>
            <input
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <button
            disabled={a.busy || c.deletion_pending}
            className="button secondary-button"
          >
            {c.do_not_contact
              ? w("Turn off do not contact", "Matikan jangan hubungi")
              : w("Turn on do not contact", "Aktifkan jangan hubungi")}
          </button>
        </form>
      </section>
      <section className="contact-section">
        <h3>{w("Channel consent", "Persetujuan saluran")}</h3>
        {c.consents.items.map((r) => (
          <article className="core-record" key={r.id}>
            <strong>
              {r.channel} · {r.purpose} ·{" "}
              {r.granted
                ? w("Granted", "Diberi")
                : w("Withdrawn", "Ditarik balik")}
            </strong>
            <p>{r.evidence}</p>
            <time>
              {new Date(r.created_at).toLocaleString("en-MY", {
                timeZone: "Asia/Kuala_Lumpur",
              })}
            </time>
          </article>
        ))}
        <MoreRecords kind="consents" id={c.id} cursor={c.consents.nextCursor} />
        <form
          className="core-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await a.run(() =>
                client.execute("addConsent", {
                  id: c.id,
                  expectedRevision: c.revision,
                  channel: f.get("channel") as "phone" | "whatsapp",
                  purpose: f.get("purpose") as "service" | "marketing",
                  granted: f.get("granted") === "yes",
                  source: "manual",
                  evidence,
                }),
              )
            )
              setEvidence("");
          }}
        >
          <div className="field-pair">
            <Field label={w("Channel", "Saluran")}>
              <select name="channel">
                <option value="whatsapp">WhatsApp</option>
                <option value="phone">{w("Phone", "Telefon")}</option>
              </select>
            </Field>
            <Field label={w("Purpose", "Tujuan")}>
              <select name="purpose">
                <option value="service">{w("Service", "Perkhidmatan")}</option>
                <option value="marketing">{w("Marketing", "Pemasaran")}</option>
              </select>
            </Field>
          </div>
          <Field label={w("Consent decision", "Keputusan persetujuan")}>
            <select name="granted">
              <option value="yes">{w("Granted", "Diberi")}</option>
              <option value="no">{w("Withdrawn", "Ditarik balik")}</option>
            </select>
          </Field>
          <Field label={w("Evidence / source", "Bukti / sumber")}>
            <textarea
              required
              maxLength={2000}
              rows={2}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </Field>
          <button
            disabled={a.busy || c.deletion_pending}
            className="button secondary-button"
          >
            {w("Record consent", "Rekod persetujuan")}
          </button>
        </form>
      </section>
    </>
  );
}
function MoreRecords({
  id,
  kind,
  cursor,
}: {
  id: string;
  kind: "notes" | "consents";
  cursor: string | null;
}) {
  const { client } = useCore(),
    a = useAction(),
    w = useWords();
  const [more, setMore] = useState<
      { id: string; text?: string; evidence?: string }[]
    >([]),
    [next, setNext] = useState(cursor);
  return (
    <>
      {more.map((r) => (
        <p key={r.id}>{r.text ?? r.evidence}</p>
      ))}
      <Notice error={a.error} />
      {next && (
        <button
          className="button secondary-button"
          onClick={async () => {
            const r = await a.run(() =>
              client.execute(kind, { id, cursor: next }),
            );
            if (r) {
              setMore((v) => [...v, ...r.items]);
              setNext(r.nextCursor);
            }
          }}
        >
          {w("Load older records", "Muatkan rekod terdahulu")}
        </button>
      )}
    </>
  );
}
function Privacy({
  contact: c,
  onDeleted,
}: {
  contact: Contact;
  onDeleted: () => void;
}) {
  const w = useWords(),
    { client } = useCore(),
    a = useAction(),
    jobs = useResource(() => client.execute("jobs", {}), "jobs");
  const [confirm, setConfirm] = useState(false);
  const related = jobs.data?.filter((j) => j.target_id === c.id) ?? [];
  return (
    <section className="contact-section">
      <h3>{w("Privacy controls", "Kawalan privasi")}</h3>
      <p>
        {w(
          "Exports expire after 24 hours. Deletion permanently removes contact details, notes, consent, bookings and linked agent tests after processing.",
          "Eksport tamat selepas 24 jam. Pemadaman membuang butiran kenalan, nota, persetujuan, tempahan dan ujian ejen berkaitan secara kekal selepas diproses.",
        )}
      </p>
      <Notice {...a} />
      <Notice error={jobs.error} />
      <div className="core-actions">
        <button
          className="button secondary-button"
          disabled={a.busy || c.deletion_pending}
          onClick={() =>
            a.run(() =>
              client.execute("requestExport", {
                id: c.id,
                expectedRevision: c.revision,
              }),
            )
          }
        >
          {w("Prepare export", "Sediakan eksport")}
        </button>
        <button
          className="button secondary-button"
          disabled={a.busy || c.deletion_pending}
          onClick={() => setConfirm(!confirm)}
        >
          {w("Delete contact", "Padam kenalan")}
        </button>
      </div>
      {confirm && (
        <form
          className="core-form core-danger"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await a.run(() =>
                client.execute("requestDeletion", {
                  id: c.id,
                  expectedRevision: c.revision,
                }),
              )
            )
              setConfirm(false);
          }}
        >
          <label className="product-check">
            <input required type="checkbox" />
            {w(
              "I understand this permanently deletes this contact and their records.",
              "Saya faham tindakan ini memadam kenalan dan rekodnya secara kekal.",
            )}
          </label>
          <button disabled={a.busy} className="button button-dark">
            {w("Request permanent deletion", "Mohon pemadaman kekal")}
          </button>
        </form>
      )}
      {related.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
      {related.some(
        (j) => j.kind === "deletion" && j.state === "completed",
      ) && (
        <button onClick={onDeleted}>
          {w("Return to contacts", "Kembali ke kenalan")}
        </button>
      )}
    </section>
  );
}
export function JobRow({ job: j }: { job: Job }) {
  const w = useWords(),
    { client } = useCore(),
    a = useAction();
  const labels = {
    pending: w(
      "Pending · local engine will process this",
      "Menunggu · enjin setempat akan memproses",
    ),
    completed: w("Completed", "Selesai"),
    failed: w("Failed · retry available", "Gagal · boleh cuba lagi"),
    expired: w("Expired", "Tamat tempoh"),
  };
  return (
    <div className="core-record">
      <strong>
        {j.kind === "export"
          ? w("Contact export", "Eksport kenalan")
          : w("Contact deletion", "Pemadaman kenalan")}
      </strong>
      <p role="status">{labels[j.state]}</p>
      <Notice error={a.error} />
      <div className="core-actions">
        {j.state === "completed" && j.kind === "export" && (
          <button
            className="button secondary-button"
            onClick={() =>
              a.run(async () => {
                const blob = await client.download(j.id),
                  url = URL.createObjectURL(blob),
                  link = document.createElement("a");
                link.href = url;
                link.download = "contact-export.json";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return true;
              })
            }
          >
            {w("Download export", "Muat turun eksport")}
          </button>
        )}
        {j.state === "failed" && (
          <button
            className="button secondary-button"
            disabled={a.busy}
            onClick={() =>
              a.run(() => client.execute("retryJob", { id: j.id }))
            }
          >
            {w("Retry job", "Cuba semula tugas")}
          </button>
        )}
      </div>
    </div>
  );
}
