"use client";
import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Headphones,
  Phone,
  WhatsappLogo,
  FileText,
  Trash,
  Clock,
  ShieldCheck,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { AppShell } from "./shell";
import { GreetingField } from "../core/agent-fields";
import { Field, VoicePreview } from "./setup";
import { productApi, stepReady } from "@/lib/api/product";
import {
  malaysiaStates,
  type AgentSettings,
  type AgentRevision,
} from "@/lib/api/builder-types";
import type { SetupDraft, VoiceStyle } from "@/lib/api/product-types";

export function AgentBuilder() {
  const { t, locale, href } = useExperience(),
    b = t.builder,
    p = t.product;
  const { draft: d, update, storage } = useProduct();
  const [section, setSection] = useState(0),
    [busy, setBusy] = useState(false),
    [fail, setFail] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [date, setDate] = useState(""),
    [reason, setReason] = useState(""),
    [compare, setCompare] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  if (!d)
    return (
      <AppShell active="builder">
        <main tabIndex={-1} id="workspace-content" className="product-main">
          <p role="status">{p.loading}</p>
        </main>
      </AppShell>
    );
  const edit = (fn: (v: SetupDraft) => SetupDraft) => {
    update(fn, true);
    setNotice("");
    setError("");
  };
  const settings = (patch: Partial<AgentSettings>) =>
    edit((v) => ({ ...v, settings: { ...v.settings, ...patch } }));
  const agent = (patch: Partial<SetupDraft["agent"]>) =>
    edit((v) => ({ ...v, agent: { ...v.agent, ...patch } }));
  const valid =
    stepReady(d, 0) &&
    stepReady(d, 1) &&
    stepReady(d, 2) &&
    d.settings.persona.trim() &&
    d.settings.instructions.trim() &&
    d.settings.after_hours.trim() &&
    Number.isInteger(d.settings.duration_minutes) &&
    Number.isInteger(d.settings.buffer_minutes) &&
    d.settings.duration_minutes >= 5 &&
    d.settings.duration_minutes <= 480 &&
    d.settings.buffer_minutes >= 0 &&
    d.settings.buffer_minutes <= 120 &&
    (!d.settings.transfer_enabled ||
      /^\+[1-9]\d{7,14}$/.test(d.settings.transfer_number)) &&
    d.settings.weekly_hours.every(
      (h) =>
        !h.open ||
        (/^([01]\d|2[0-3]):[0-5]\d$/.test(h.from) &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(h.to) &&
          h.from < h.to),
    );
  const run = async (action: () => void, failure: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await productApi.simulate(fail);
      action();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
      setFail(false);
    }
  };
  const publish = () =>
    run(() => {
      const revision: AgentRevision = {
        id: crypto.randomUUID(),
        number: Math.max(0, ...d.revisions.map((r) => r.number)) + 1,
        created_at: new Date().toISOString(),
        agent: structuredClone(d.agent),
        settings: structuredClone(d.settings),
        hours: d.location.hours,
        knowledge: structuredClone(d.knowledge_items),
      };
      update((v) => ({
        ...v,
        revisions: [revision, ...v.revisions],
        agent: { ...v.agent, version_id: revision.id },
      }));
      setNotice(b.published);
    }, b.publishError);
  const restore = (r: AgentRevision) => {
    edit((v) => ({
      ...v,
      agent: structuredClone(r.agent),
      settings: structuredClone(r.settings),
      location: { ...v.location, hours: r.hours },
      knowledge_items: structuredClone(r.knowledge),
    }));
    setNotice(b.restored);
  };
  const updateHours = (
    index: number,
    patch: Partial<AgentSettings["weekly_hours"][number]>,
  ) => {
    const rows = d.settings.weekly_hours.map((h, i) =>
      i === index ? { ...h, ...patch } : h,
    );
    edit((v) => ({
      ...v,
      settings: { ...v.settings, weekly_hours: rows },
      location: {
        ...v.location,
        hours: rows
          .map(
            (h, i) =>
              `${b.days[i]}: ${h.open ? `${h.from}–${h.to}` : b.closed}`,
          )
          .join("; "),
      },
    }));
  };
  const selected = d.revisions.find((r) => r.id === compare);
  const describeBooking = (s: AgentSettings) =>
    [
      s.booking_mode === "calendar" ? b.calendar : b.request,
      `${b.duration}: ${s.duration_minutes}`,
      `${b.buffer}: ${s.buffer_minutes}`,
    ].join("\n");
  const describeLanguages = (languages: string[]) =>
    languages
      .map((l) => p.languageNames[l as keyof typeof p.languageNames])
      .join(", ");
  const rows = selected
    ? [
        [b.persona, selected.settings.persona, d.settings.persona],
        [
          b.instructions,
          selected.settings.instructions,
          d.settings.instructions,
        ],
        [p.greeting, selected.agent.greeting, d.agent.greeting],
        [p.hours, selected.hours, d.location.hours],
        [
          p.services,
          selected.knowledge[0]?.content ?? "",
          d.knowledge_items[0].content,
        ],
        [
          p.faq,
          selected.knowledge[1]?.content ?? "",
          d.knowledge_items[1].content,
        ],
        [b.afterHours, selected.settings.after_hours, d.settings.after_hours],
        [
          p.languages,
          describeLanguages(selected.agent.languages),
          describeLanguages(d.agent.languages),
        ],
        [p.voice, p.voices[selected.agent.voice], p.voices[d.agent.voice]],
        [
          p.recording,
          selected.agent.recording_enabled
            ? selected.agent.recording_disclosure
            : p.recordingOff,
          d.agent.recording_enabled
            ? d.agent.recording_disclosure
            : p.recordingOff,
        ],
        [
          b.bookingMode,
          describeBooking(selected.settings),
          describeBooking(d.settings),
        ],
        [
          b.transfer,
          selected.settings.transfer_enabled
            ? selected.settings.transfer_number
            : "—",
          d.settings.transfer_enabled ? d.settings.transfer_number : "—",
        ],
        [
          b.takeMessage,
          selected.settings.take_message ? "✓" : "—",
          d.settings.take_message ? "✓" : "—",
        ],
        [b.state, selected.settings.state, d.settings.state],
        [
          b.closures,
          selected.settings.closures
            .map((c) => `${c.date}: ${c.label}`)
            .join("\n"),
          d.settings.closures.map((c) => `${c.date}: ${c.label}`).join("\n"),
        ],
        [
          b.documents,
          selected.settings.documents
            .map((c) => `${c.name}: ${c.content}`)
            .join("\n"),
          d.settings.documents.map((c) => `${c.name}: ${c.content}`).join("\n"),
        ],
      ]
    : [];
  return (
    <AppShell active="builder">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main builder-main"
      >
        <header className="product-page-heading">
          <div>
            <p className="eyebrow">{b.nav}</p>
            <h1>{b.title}</h1>
            <p>{b.intro}</p>
          </div>
          <a className="button secondary-button" href={href("/app/test")}>
            {b.test}
            <ArrowUpRight size={18} />
          </a>
        </header>
        <div className="builder-status">
          <span>
            <i />
            {b.draft}
          </span>
          <span>{storage === "saved" ? b.saved : p.saving}</span>
          <span>
            {d.revisions.length
              ? `${b.version} ${d.revisions[0].number}`
              : b.noVersions.split(".")[0]}
          </span>
        </div>
        <nav className="builder-tabs" aria-label={b.nav}>
          {b.sections.map((label, i) => (
            <button
              key={label}
              aria-current={section === i ? "page" : undefined}
              onClick={() => {
                setSection(i);
                setNotice("");
                setError("");
                setTimeout(() => heading.current?.focus(), 0);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="builder-grid">
          <section className="builder-editor">
            <header className="editor-heading">
              <span className="editor-index">
                {String(section + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 ref={heading} tabIndex={-1}>
                  {b.sections[section]}
                </h2>
                <p>{b.sectionDescriptions[section]}</p>
              </div>
            </header>
            <fieldset disabled={busy} className="builder-fields">
              {section === 0 && (
                <>
                  <Field label={b.persona}>
                    <input
                      maxLength={180}
                      value={d.settings.persona}
                      onChange={(e) => settings({ persona: e.target.value })}
                    />
                  </Field>
                  <Field label={b.instructions}>
                    <textarea
                      rows={5}
                      maxLength={6000}
                      value={d.settings.instructions}
                      onChange={(e) =>
                        settings({ instructions: e.target.value })
                      }
                    />
                  </Field>
                  <GreetingField
                    maxLength={500}
                    value={d.agent.greeting}
                    onChange={(greeting) => agent({ greeting })}
                  />
                  <fieldset className="builder-languages">
                    <legend>{p.languages}</legend>
                    {Object.entries(p.languageNames).map(([key, label]) => (
                      <label className="product-check" key={key}>
                        <input
                          type="checkbox"
                          checked={d.agent.languages.includes(key)}
                          onChange={(e) =>
                            agent({
                              languages: e.target.checked
                                ? [...d.agent.languages, key]
                                : d.agent.languages.filter((l) => l !== key),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  {!d.agent.languages.length && (
                    <p role="alert" className="form-error">
                      {b.languageRequired}
                    </p>
                  )}
                  <Field label={p.voice}>
                    <select
                      aria-label={p.voice}
                      value={d.agent.voice}
                      onChange={(e) =>
                        agent({ voice: e.target.value as VoiceStyle })
                      }
                    >
                      {Object.entries(p.voices).map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <VoicePreview draft={d} />
                  <div className="builder-disclosure">
                    <ShieldCheck size={22} />
                    <div>
                      <strong>{p.disclosureAlways}</strong>
                      <p>{p.aiDisclosure}</p>
                    </div>
                  </div>
                  <label className="product-check">
                    <input
                      type="checkbox"
                      checked={d.agent.recording_enabled}
                      onChange={(e) =>
                        agent({ recording_enabled: e.target.checked })
                      }
                    />
                    {p.recording}
                  </label>
                  {d.agent.recording_enabled && (
                    <Field label={p.recordingNotice}>
                      <textarea
                        rows={3}
                        value={d.agent.recording_disclosure}
                        maxLength={600}
                        onChange={(e) =>
                          agent({ recording_disclosure: e.target.value })
                        }
                      />
                    </Field>
                  )}
                </>
              )}
              {section === 1 && (
                <>
                  <p className="editor-note">{b.knowledgeNote}</p>
                  <Field label={p.source}>
                    <input
                      type="url"
                      value={d.source_url}
                      placeholder="https://example.com"
                      onChange={(e) =>
                        edit((v) => ({ ...v, source_url: e.target.value }))
                      }
                    />
                  </Field>
                  <button
                    className="button secondary-button"
                    onClick={() => {
                      try {
                        const u = new URL(d.source_url);
                        if (!["http:", "https:"].includes(u.protocol))
                          throw Error();
                        run(() => {
                          const items = t.product;
                          edit((v) => ({
                            ...v,
                            location: {
                              ...v.location,
                              hours: items.sampleHours,
                            },
                            knowledge_items: v.knowledge_items.map((k) => ({
                              ...k,
                              content:
                                k.kind === "services"
                                  ? items.sampleServices
                                  : items.sampleFaq,
                            })),
                          }));
                          setNotice(p.imported);
                        }, b.importError);
                      } catch {
                        setError(p.sourceError);
                      }
                    }}
                  >
                    {busy ? p.importing : p.import}
                  </button>
                  {d.knowledge_items.map((item, i) => (
                    <Field
                      key={item.id}
                      label={item.kind === "services" ? p.services : p.faq}
                    >
                      <textarea
                        rows={5}
                        maxLength={10000}
                        value={item.content}
                        onChange={(e) =>
                          edit((v) => ({
                            ...v,
                            knowledge_items: v.knowledge_items.map((k, j) =>
                              j === i ? { ...k, content: e.target.value } : k,
                            ),
                          }))
                        }
                      />
                    </Field>
                  ))}
                  <h3>{b.documents}</h3>
                  <Field label={b.upload} hint={b.uploadHint}>
                    <input
                      type="file"
                      accept=".txt,.md,text/plain,text/markdown"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        if (
                          !/\.(txt|md)$/i.test(file.name) ||
                          file.size > 100000 ||
                          !file.size
                        ) {
                          setError(b.uploadError);
                          return;
                        }
                        setBusy(true);
                        try {
                          const content = await file.text();
                          if (!content.trim()) throw Error();
                          edit((v) => ({
                            ...v,
                            settings: {
                              ...v.settings,
                              documents: [
                                ...v.settings.documents,
                                {
                                  id: crypto.randomUUID(),
                                  name: file.name,
                                  content,
                                },
                              ],
                            },
                          }));
                        } catch {
                          setError(b.uploadError);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </Field>
                  {!d.settings.documents.length && (
                    <p className="editor-note">{b.noDocuments}</p>
                  )}
                  {d.settings.documents.map((doc) => (
                    <div className="document-row" key={doc.id}>
                      <FileText size={22} />
                      <details>
                        <summary>{doc.name}</summary>
                        <p>{doc.content}</p>
                      </details>
                      <button
                        className="icon-button"
                        aria-label={`${b.remove} ${doc.name}`}
                        onClick={() =>
                          settings({
                            documents: d.settings.documents.filter(
                              (x) => x.id !== doc.id,
                            ),
                          })
                        }
                      >
                        <Trash size={18} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {section === 2 && (
                <>
                  <a className="text-link" href={href("/app/hours")}>
                    {t.remaining.branchHours}
                    <ArrowUpRight size={18} />
                  </a>
                  <Field label={b.state}>
                    <select
                      value={d.settings.state}
                      onChange={(e) => settings({ state: e.target.value })}
                    >
                      {malaysiaStates.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={p.hours} hint={b.scheduleHint}>
                    <textarea
                      rows={3}
                      value={d.location.hours}
                      onChange={(e) =>
                        edit((v) => ({
                          ...v,
                          location: { ...v.location, hours: e.target.value },
                        }))
                      }
                    />
                  </Field>
                  <p className="editor-note">{b.hoursNote}</p>
                  <div className="hours-editor">
                    {d.settings.weekly_hours.map((h, i) => (
                      <div className="hours-line" key={i}>
                        <label className="product-check">
                          <input
                            type="checkbox"
                            checked={h.open}
                            onChange={(e) =>
                              updateHours(i, { open: e.target.checked })
                            }
                          />
                          <span>{b.days[i]}</span>
                        </label>
                        <div>
                          {h.open ? (
                            <>
                              <input
                                type="time"
                                aria-label={`${b.days[i]} ${b.from}`}
                                value={h.from}
                                onChange={(e) =>
                                  updateHours(i, { from: e.target.value })
                                }
                              />
                              <span>–</span>
                              <input
                                type="time"
                                aria-label={`${b.days[i]} ${b.to}`}
                                value={h.to}
                                onChange={(e) =>
                                  updateHours(i, { to: e.target.value })
                                }
                              />
                            </>
                          ) : (
                            <span className="closed-day">{b.closed}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Field label={b.afterHours}>
                    <textarea
                      rows={4}
                      maxLength={1500}
                      value={d.settings.after_hours}
                      onChange={(e) =>
                        settings({ after_hours: e.target.value })
                      }
                    />
                  </Field>
                  <div className="editor-divider" />
                  <h3>{b.closures}</h3>
                  <p className="editor-note">{b.holidayNote}</p>
                  <div className="field-pair">
                    <Field label={b.date}>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </Field>
                    <Field label={b.reason}>
                      <input
                        maxLength={100}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </Field>
                  </div>
                  <button
                    className="button secondary-button"
                    onClick={() => {
                      if (
                        !date ||
                        !reason.trim() ||
                        d.settings.closures.some((c) => c.date === date)
                      ) {
                        setError(b.closureError);
                        return;
                      }
                      settings({
                        closures: [
                          ...d.settings.closures,
                          {
                            id: crypto.randomUUID(),
                            date,
                            label: reason.trim(),
                          },
                        ].sort((a, b) => a.date.localeCompare(b.date)),
                      });
                      setDate("");
                      setReason("");
                    }}
                  >
                    {b.addClosure}
                  </button>
                  {!d.settings.closures.length && (
                    <p className="editor-note">{b.noClosures}</p>
                  )}
                  {d.settings.closures.map((c) => (
                    <div className="closure-row" key={c.id}>
                      <Clock size={18} />
                      <span>
                        <strong>{c.date}</strong>
                        {c.label}
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`${b.remove} ${c.label}`}
                        onClick={() =>
                          settings({
                            closures: d.settings.closures.filter(
                              (x) => x.id !== c.id,
                            ),
                          })
                        }
                      >
                        <Trash size={18} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {section === 3 && (
                <>
                  <Field label={b.bookingMode} hint={b.calendarNote}>
                    <select
                      value={d.settings.booking_mode}
                      onChange={(e) =>
                        settings({
                          booking_mode: e.target.value as
                            | "request"
                            | "calendar",
                        })
                      }
                    >
                      <option value="request">{b.request}</option>
                      <option value="calendar">{b.calendar}</option>
                    </select>
                  </Field>
                  <div className="field-pair">
                    <Field label={b.duration}>
                      <input
                        type="number"
                        min={5}
                        max={480}
                        step={5}
                        value={d.settings.duration_minutes}
                        onChange={(e) =>
                          settings({ duration_minutes: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label={b.buffer}>
                      <input
                        type="number"
                        min={0}
                        max={120}
                        step={5}
                        value={d.settings.buffer_minutes}
                        onChange={(e) =>
                          settings({ buffer_minutes: Number(e.target.value) })
                        }
                      />
                    </Field>
                  </div>
                  <div className="editor-divider" />
                  <label className="product-check">
                    <input
                      type="checkbox"
                      checked={d.settings.transfer_enabled}
                      onChange={(e) =>
                        settings({ transfer_enabled: e.target.checked })
                      }
                    />
                    {b.transfer}
                  </label>
                  {d.settings.transfer_enabled && (
                    <Field label={b.transferNumber} hint={b.transferHint}>
                      <input
                        type="tel"
                        placeholder="+60…"
                        value={d.settings.transfer_number}
                        maxLength={16}
                        onChange={(e) =>
                          settings({ transfer_number: e.target.value })
                        }
                      />
                    </Field>
                  )}
                  <p className="editor-note channel-boundary">
                    <WhatsappLogo size={22} />
                    {b.waHandoff}
                  </p>
                  <label className="product-check">
                    <input
                      type="checkbox"
                      checked={d.settings.take_message}
                      onChange={(e) =>
                        settings({ take_message: e.target.checked })
                      }
                    />
                    {b.takeMessage}
                  </label>
                </>
              )}
              {section === 4 && (
                <>
                  <div className="publish-panel">
                    <ShieldCheck size={30} />
                    <h3>{b.publish}</h3>
                    <p>{b.publishHint}</p>
                    <button
                      className="button button-dark"
                      disabled={!valid || !d.test_passed || busy}
                      onClick={publish}
                    >
                      {busy ? b.publishing : b.publish}
                      <Check size={18} />
                    </button>
                    {!valid && <p className="form-error">{b.invalid}</p>}
                    <a href={href("/app/test")}>
                      {b.test}
                      <ArrowUpRight size={16} />
                    </a>
                  </div>
                  {!d.revisions.length && (
                    <p className="empty-versions">{b.noVersions}</p>
                  )}
                  {d.revisions.map((r) => (
                    <div className="revision-row" key={r.id}>
                      <div>
                        <strong>
                          {b.version} {r.number}
                        </strong>
                        <small>
                          {new Intl.DateTimeFormat(
                            locale === "ms" ? "ms-MY" : "en-MY",
                            {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "Asia/Kuala_Lumpur",
                            },
                          ).format(new Date(r.created_at))}
                        </small>
                      </div>
                      <button
                        className="button secondary-button"
                        onClick={() =>
                          setCompare(compare === r.id ? null : r.id)
                        }
                        aria-expanded={compare === r.id}
                      >
                        {b.compare}
                      </button>
                      <button
                        className="button secondary-button"
                        onClick={() => restore(r)}
                      >
                        <ArrowCounterClockwise size={16} />
                        {b.restore}
                      </button>
                    </div>
                  ))}
                  {selected && (
                    <div className="revision-comparison">
                      <h3>
                        {b.compare} · {b.version} {selected.number}
                      </h3>
                      {rows.map(([label, before, after]) => (
                        <div key={label}>
                          <h4>
                            {label}
                            <span>{before === after ? b.same : b.changed}</span>
                          </h4>
                          <div>
                            <section>
                              <small>{b.snapshot}</small>
                              <p>{before || "—"}</p>
                            </section>
                            <section>
                              <small>{b.current}</small>
                              <p>{after || "—"}</p>
                            </section>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="editor-feedback form-error">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="editor-feedback">
                {notice}
              </p>
            )}
            <footer className="editor-footer">
              <span>{b.mockNote}</span>
              {[1, 4].includes(section) && (
                <details className="recovery-controls">
                  <summary>{p.recovery}</summary>
                  <label className="product-check">
                    <input
                      type="checkbox"
                      checked={fail}
                      disabled={busy}
                      onChange={(e) => setFail(e.target.checked)}
                    />
                    {b.fail}
                  </label>
                </details>
              )}
            </footer>
          </section>
          <aside className="agent-brief">
            <div className="agent-seal">
              <Headphones size={34} />
              <span className="status-dot" />
            </div>
            <p className="eyebrow">{b.previewTitle}</p>
            <h2>{d.organization.name}</h2>
            <p>{d.settings.persona}</p>
            <blockquote>
              {d.agent.greeting.replaceAll("{name}", d.organization.name)}
            </blockquote>
            <div className="brief-languages">
              {d.agent.languages.map((l) => (
                <span key={l}>
                  {p.languageNames[l as keyof typeof p.languageNames]}
                </span>
              ))}
            </div>
            <div className="brief-rule" />
            <h3>{b.channels}</h3>
            <ul>
              <li>
                <Phone size={18} />
                {b.phone}
              </li>
              <li>
                <WhatsappLogo size={18} />
                {b.whatsapp}
              </li>
              <li>
                <Headphones size={18} />
                {b.whatsappCalls}
              </li>
            </ul>
            <p className="brief-note">{b.channelsNote}</p>
            <a href={href("/app/test")}>
              {b.test}
              <ArrowUpRight size={18} />
            </a>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
