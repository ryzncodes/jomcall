"use client";
import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  MagnifyingGlass,
  ShieldCheck,
  DownloadSimple,
  Trash,
  ChatCircleDots,
  CalendarBlank,
  Users,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { AppShell } from "./shell";
import { useCrm } from "./crm-provider";
import { crmApi } from "@/lib/api/crm";
import { auditEntry } from "@/lib/api/admin";
import { CrmDialog, dateLabel, downloadJson } from "./crm-ui";
import { ContactNameField } from "../core/contact-fields";
export function Contacts() {
  const { t, locale, href } = useExperience(),
    p = t.crm,
    { data, setData } = useCrm();
  const [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [notice, setNotice] = useState("");
  const profileHeading = useRef<HTMLHeadingElement>(null);
  const ready = Boolean(data);
  useEffect(() => {
    if (selected && matchMedia("(max-width:1200px)").matches)
      profileHeading.current?.focus();
  }, [selected, ready]);
  useEffect(() => {
    setSelected(new URLSearchParams(location.search).get("contact"));
  }, []);
  const contact = data?.contacts.find((c) => c.id === selected),
    list =
      data?.contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) &&
          (filter === "all" ||
            (filter === "blocked"
              ? c.do_not_contact
              : c.opt_in && !c.do_not_contact)),
      ) ?? [];
  const patch = (values: Partial<NonNullable<typeof contact>>) =>
    setData((d) =>
      d
        ? {
            ...d,
            contacts: d.contacts.map((c) =>
              c.id === selected ? { ...c, ...values } : c,
            ),
          }
        : d,
    );
  const appointments =
    data?.bookings
      .filter((b) => b.contact_id === selected)
      .sort((a, b) => a.start_at.localeCompare(b.start_at)) ?? [];
  return (
    <AppShell active="contacts">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main crm-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.contactTitle}</h1>
            <p>{p.contactIntro}</p>
          </div>
          <span className="crm-heading-icon">
            <Users size={34} weight="light" />
          </span>
        </div>
        <div className="crm-overview">
          <span>
            <strong>{data?.contacts.length ?? "—"}</strong>
            {p.contacts}
          </span>
          <span>
            <strong>
              {data?.contacts.filter((c) => c.opt_in && !c.do_not_contact)
                .length ?? "—"}
            </strong>
            {p.allowed}
          </span>
          <span>
            <ShieldCheck size={19} />
            {p.consentSource}
          </span>
        </div>
        <div className={`contact-desk ${contact ? "has-profile" : ""}`}>
          <section className="contact-directory" aria-label={p.directory}>
            <div className="crm-search">
              <MagnifyingGlass size={19} />
              <input
                aria-label={p.search}
                placeholder={p.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="crm-filter-tabs">
              {(["all", "allowed", "blocked"] as const).map((key) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {p[key]}
                </button>
              ))}
            </div>
            <div className="directory-label">
              <span>{p.contact}</span>
              <span>{p.stage}</span>
            </div>
            {list.map((c, i) => (
              <button
                className={`directory-row ${selected === c.id ? "selected" : ""}`}
                key={c.id}
                aria-pressed={selected === c.id}
                onClick={() => {
                  setSelected(c.id);
                  setNotice("");
                }}
              >
                <span className={`crm-avatar tint-${i % 3}`}>
                  {c.name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.language.toUpperCase()}
                    <span aria-hidden="true"> · </span>
                    {c.do_not_contact
                      ? p.blocked
                      : c.opt_in
                        ? p.allowed
                        : p.off}
                  </small>
                </span>
                <span className="directory-stage">
                  {t.inbox.stages[c.stage]}
                  <ArrowUpRight size={15} />
                </span>
              </button>
            ))}
            {data && !list.length && (
              <div className="crm-empty">
                <Users size={32} />
                <p>{data.contacts.length ? p.empty : p.noContacts}</p>
                <a href={href("/app/integrations")}>{p.integrations}</a>
              </div>
            )}
            {!data && <div className="skeleton" aria-busy="true" />}
            <footer className="crm-footnote">{p.localNote}</footer>
          </section>
          <aside className="contact-profile" aria-label={p.profile}>
            {contact ? (
              <>
                <button
                  className="crm-back"
                  onClick={() => {
                    setSelected(null);
                    setTimeout(
                      () =>
                        document
                          .querySelector<HTMLInputElement>(".crm-search input")
                          ?.focus(),
                      0,
                    );
                  }}
                >
                  <ArrowLeft size={18} />
                  {p.directory}
                </button>
                <div className="profile-identity">
                  <span className="crm-avatar large">
                    {contact.name
                      .split(" ")
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <h2 ref={profileHeading} tabIndex={-1}>
                    {contact.name}
                  </h2>
                  <p>{p.phone}</p>
                  <button
                    className="crm-text-button"
                    onClick={() => setEditing(true)}
                  >
                    {p.editProfile}
                  </button>
                </div>
                <div className="profile-actions">
                  <a
                    className="button button-dark"
                    href={href(`/app/inbox?contact=${contact.id}`)}
                  >
                    <ChatCircleDots size={17} />
                    {p.conversation}
                  </a>
                  <a
                    className="button secondary-button"
                    href={href(`/app/bookings?contact=${contact.id}&new=1`)}
                  >
                    <CalendarBlank size={17} />
                    {p.appointment}
                  </a>
                </div>
                <section className="profile-section">
                  <h3>
                    <ShieldCheck size={18} />
                    {p.consent}
                  </h3>
                  <label className="crm-switch-row">
                    <span>
                      {p.blocked}
                      <small>{t.dncHint}</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={contact.do_not_contact}
                      onChange={(e) =>
                        patch({ do_not_contact: e.target.checked })
                      }
                    />
                  </label>
                  <label className="crm-switch-row">
                    <span>{p.optIn}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={contact.opt_in}
                      onChange={(e) => patch({ opt_in: e.target.checked })}
                    />
                  </label>
                  <p className="crm-caption">{p.consentHelp}</p>
                  <details className="consent-log">
                    <summary>
                      {p.history}
                      <span>
                        {
                          data?.consents.filter(
                            (c) => c.contact_id === selected,
                          ).length
                        }
                      </span>
                    </summary>
                    <ol>
                      {data?.consents
                        .filter((c) => c.contact_id === selected)
                        .slice()
                        .reverse()
                        .map((c) => (
                          <li key={c.id}>
                            <strong>
                              {c.kind === "opt_in" ? p.optIn : p.blocked}:{" "}
                              {c.granted ? p.on : p.off}
                            </strong>
                            <span>
                              {c.source === "sample" ? p.sample : p.staff} ·{" "}
                              {dateLabel(c.at, locale)}
                            </span>
                          </li>
                        ))}
                    </ol>
                  </details>
                </section>
                <section className="profile-section">
                  <div className="section-title">
                    <h3>{p.upcoming}</h3>
                    <a
                      href={href(`/app/bookings?contact=${contact.id}`)}
                      aria-label={p.viewBookings}
                    >
                      <ArrowUpRight size={19} />
                    </a>
                  </div>
                  {appointments.length ? (
                    appointments.map((b) => (
                      <a
                        className="profile-booking"
                        href={href(
                          `/app/bookings?booking=${b.id}&contact=${contact.id}`,
                        )}
                        key={b.id}
                      >
                        <CalendarBlank size={19} />
                        <span>
                          <strong>{b.title}</strong>
                          <small>{dateLabel(b.start_at, locale)}</small>
                        </span>
                        <span className={`crm-chip ${b.status}`}>
                          {p[b.status]}
                        </span>
                      </a>
                    ))
                  ) : (
                    <p className="crm-caption">{p.noneBookings}</p>
                  )}
                </section>
                <section className="profile-section">
                  <h3>{p.timeline}</h3>
                  <ol className="profile-timeline">
                    {contact.events
                      .slice(-3)
                      .reverse()
                      .map((e) => (
                        <li key={e.id}>
                          <small>{dateLabel(e.at, locale)}</small>
                          <p>{e.body}</p>
                        </li>
                      ))}
                  </ol>
                </section>
                <div className="profile-privacy">
                  <button
                    onClick={() => {
                      downloadJson(
                        crmApi.exportContact(data!, contact.id),
                        `${contact.id}-personal-data.json`,
                      );
                      setData((d) =>
                        d
                          ? {
                              ...d,
                              activity_audit: [
                                ...d.activity_audit,
                                auditEntry("export"),
                              ],
                            }
                          : d,
                      );
                      setNotice(p.exported);
                    }}
                  >
                    <DownloadSimple size={17} />
                    {p.export}
                  </button>
                  <button onClick={() => setDeleting(true)}>
                    <Trash size={17} />
                    {p.delete}
                  </button>
                </div>
                <p className="crm-caption" role="status">
                  {notice}
                </p>
              </>
            ) : (
              <div className="profile-placeholder">
                <span className="profile-orbit">
                  <Users size={42} weight="light" />
                </span>
                <h2>{p.profile}</h2>
                <p>{p.choose}</p>
              </div>
            )}
          </aside>
        </div>
        {editing && contact && (
          <CrmDialog
            title={p.editProfile}
            description={p.saved}
            onClose={() => setEditing(false)}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  name = String(f.get("name") ?? "").trim();
                if (!name) return;
                patch({
                  name,
                  language: String(f.get("language")),
                  stage: Number(f.get("stage")),
                });
                setEditing(false);
                setNotice(p.saved);
              }}
            >
              <ContactNameField value={contact.name} />
              <div className="field-pair">
                <label className="product-field">
                  {p.language}
                  <select
                    aria-label={p.language}
                    name="language"
                    defaultValue={contact.language}
                  >
                    {["ms", "en", "zh", "mix"].map((l) => (
                      <option key={l} value={l}>
                        {l === "ms"
                          ? "Bahasa Melayu"
                          : l === "en"
                            ? "English"
                            : l === "zh"
                              ? "中文"
                              : "Manglish"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="product-field">
                  {p.stage}
                  <select
                    aria-label={p.stage}
                    name="stage"
                    defaultValue={contact.stage}
                  >
                    {t.inbox.stages.map((s, i) => (
                      <option key={s} value={i}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="button button-dark">{p.save}</button>
            </form>
          </CrmDialog>
        )}
        {deleting && contact && (
          <CrmDialog
            title={p.deleteTitle}
            description={`${contact.name}. ${p.deleteBody}`}
            onClose={() => setDeleting(false)}
          >
            <div className="crm-dialog-actions">
              <button
                className="button secondary-button"
                onClick={() => setDeleting(false)}
              >
                {p.cancel}
              </button>
              <button
                className="button button-dark"
                onClick={() => {
                  setData((d) => (d ? crmApi.removeContact(d, contact.id) : d));
                  setDeleting(false);
                  setSelected(null);
                }}
              >
                {p.deleteConfirm}
              </button>
            </div>
          </CrmDialog>
        )}
      </main>
    </AppShell>
  );
}
