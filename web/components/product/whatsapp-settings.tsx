"use client";
import { useState } from "react";
import {
  WhatsappLogo,
  ArrowUpRight,
  Plus,
  ShieldCheck,
  ChatCircleDots,
  CheckCircle,
  PaperPlaneTilt,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { AppShell } from "./shell";
import { CrmDialog, dateLabel } from "./crm-ui";
import type { MessageTemplate, ServiceSettings } from "@/lib/api/service";
export function WhatsappSettings() {
  const { t, locale, href } = useExperience(),
    p = t.services,
    { draft: d, update } = useProduct();
  const [selected, setSelected] = useState<string | null>(null),
    [editor, setEditor] = useState<MessageTemplate | null>(null),
    [notice, setNotice] = useState("");
  const current =
    d?.services.templates.find((x) => x.id === selected) ??
    d?.services.templates[0];
  const changeStatus = (status: MessageTemplate["status"]) => {
    if (!current) return;
    update((v) => ({
      ...v,
      services: {
        ...v.services,
        templates: v.services.templates.map((x) =>
          x.id === current.id
            ? { ...x, status, updated_at: new Date().toISOString() }
            : x,
        ),
      },
    }));
    setNotice(p[status]);
  };
  const create = () =>
    setEditor({
      id: crypto.randomUUID(),
      org_id: d!.organization.id,
      name: p.newTemplateName,
      body: p.reminderBody,
      language: locale,
      status: "draft",
      category: "utility",
      updated_at: new Date().toISOString(),
    });
  return (
    <AppShell active="whatsapp">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main service-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.waTitle}</h1>
            <p>{p.waIntro}</p>
          </div>
          <a href={href("/app/inbox")} className="button secondary-button">
            <ChatCircleDots size={18} />
            {p.openInbox}
          </a>
        </div>
        {d ? (
          <>
            <section className="wa-channel">
              <div className="wa-channel-main">
                <span className="wa-channel-icon">
                  <WhatsappLogo size={34} />
                </span>
                <div>
                  <small>{p.channel}</small>
                  <h2>{d.organization.name}</h2>
                  <p>{t.product.numberValue}</p>
                </div>
                <span
                  className={`service-status ${d.whatsapp_channel.status === "connected" ? "good" : ""}`}
                >
                  <i />
                  {d.whatsapp_channel.status === "connected"
                    ? p.connected
                    : p.disconnected}
                </span>
              </div>
              <div className="wa-channel-bottom">
                <p>{p.connectHelp}</p>
                <button
                  className={`button ${d.whatsapp_channel.status === "connected" ? "secondary-button" : "button-dark"}`}
                  onClick={() =>
                    update((v) => ({
                      ...v,
                      whatsapp_channel: {
                        ...v.whatsapp_channel,
                        status:
                          v.whatsapp_channel.status === "connected"
                            ? "disconnected"
                            : "connected",
                      },
                      completed: false,
                      completedSteps: v.completedSteps.filter((s) => s !== 4),
                    }))
                  }
                >
                  {d.whatsapp_channel.status === "connected"
                    ? p.disconnect
                    : p.connect}
                </button>
              </div>
            </section>
            <div className="wa-health">
              <div>
                <ShieldCheck size={22} />
                <h3>{p.quality}</h3>
                <span
                  className={`service-status ${d.services.quality === "healthy" ? "good" : d.services.quality === "restricted" ? "bad" : "warn"}`}
                >
                  <i />
                  {p[d.services.quality]}
                </span>
              </div>
              <div
                className={`quality-track ${d.services.quality}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </div>
              <p>{p.qualityHelp}</p>
              <details className="service-recovery">
                <summary>{p.previewControls}</summary>
                <label className="product-field">
                  {p.quality}
                  <select
                    aria-label={p.quality}
                    value={d.services.quality}
                    onChange={(e) =>
                      update((v) => ({
                        ...v,
                        services: {
                          ...v.services,
                          quality: e.target.value as ServiceSettings["quality"],
                        },
                      }))
                    }
                  >
                    {(["healthy", "watch", "restricted"] as const).map((q) => (
                      <option key={q} value={q}>
                        {p[q]}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
            </div>
            <div className="template-section-heading">
              <div>
                <h2>{p.templates}</h2>
                <p>{p.templatesIntro}</p>
              </div>
              <button className="button button-dark" onClick={create}>
                <Plus size={18} />
                {p.newTemplate}
              </button>
            </div>
            <div className="template-workbench">
              <section className="template-directory" aria-label={p.templates}>
                {d.services.templates.map((x) => (
                  <button
                    key={x.id}
                    aria-pressed={current?.id === x.id}
                    onClick={() => setSelected(x.id)}
                    className="template-row"
                  >
                    <span>
                      <strong>{x.name}</strong>
                      <small>
                        {x.language.toUpperCase()} · {p[x.category]}
                      </small>
                    </span>
                    <span
                      className={`service-status ${x.status === "approved" ? "good" : x.status === "rejected" ? "bad" : ""}`}
                    >
                      <i />
                      {p[x.status]}
                    </span>
                  </button>
                ))}
                {!d.services.templates.length && (
                  <p className="service-note">{p.noTemplates}</p>
                )}
              </section>
              <section className="template-preview" aria-label={p.preview}>
                {current && (
                  <>
                    <header>
                      <div>
                        <small>{p.preview}</small>
                        <h3>{current.name}</h3>
                      </div>
                      <button
                        className="crm-text-button"
                        onClick={() => setEditor({ ...current })}
                      >
                        {p.edit}
                      </button>
                    </header>
                    <div className="message-preview-canvas">
                      <div className="message-preview-header">
                        <span>
                          <ChatCircleDots size={19} />
                        </span>
                        <div>
                          <strong>{p.sampleRecipient}</strong>
                          <small>{p.whatsapp}</small>
                        </div>
                      </div>
                      <div className="template-bubble">
                        <p>{current.body}</p>
                        <span>
                          {p[current.status]}
                          <CheckCircle size={13} />
                        </span>
                      </div>
                      <p className="preview-language">
                        {current.language === "ms"
                          ? "Bahasa Melayu"
                          : "English"}{" "}
                        · {p[current.category]}
                      </p>
                    </div>
                    <footer>
                      <p>
                        {dateLabel(current.updated_at, locale)} ·{" "}
                        {p[current.status]}
                      </p>
                      {current.status === "rejected" && (
                        <p className="crm-form-error">{p.rejectionReason}</p>
                      )}
                      <div className="service-actions">
                        {(current.status === "draft" ||
                          current.status === "rejected") && (
                          <button
                            className="button button-dark"
                            onClick={() => changeStatus("pending")}
                          >
                            <PaperPlaneTilt size={16} />
                            {p.submit}
                          </button>
                        )}
                        {current.status === "pending" && (
                          <>
                            <button
                              className="button button-dark"
                              onClick={() => changeStatus("approved")}
                            >
                              {p.approve}
                            </button>
                            <button
                              className="button secondary-button"
                              onClick={() => changeStatus("rejected")}
                            >
                              {p.reject}
                            </button>
                          </>
                        )}
                        {current.status === "approved" && (
                          <a
                            className="button secondary-button"
                            href={href("/app/inbox?contact=sample-contact-3")}
                          >
                            {p.openInbox}
                            <ArrowUpRight size={17} />
                          </a>
                        )}
                      </div>
                    </footer>
                  </>
                )}
              </section>
            </div>
            <p role="status" className="crm-notice">
              {notice}
            </p>
            <footer className="service-footer">{p.localNote}</footer>
            {editor && (
              <CrmDialog
                title={
                  d.services.templates.some((x) => x.id === editor.id)
                    ? p.edit
                    : p.newTemplate
                }
                description={p.editWarning}
                onClose={() => setEditor(null)}
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget),
                      name = String(f.get("name")).trim(),
                      body = String(f.get("body")).trim();
                    if (!name || !body) return;
                    const next: MessageTemplate = {
                      ...editor,
                      name,
                      body,
                      language: String(f.get("language")) as "en" | "ms",
                      category: String(
                        f.get("category"),
                      ) as MessageTemplate["category"],
                      status: "draft",
                      updated_at: new Date().toISOString(),
                    };
                    update((v) => ({
                      ...v,
                      services: {
                        ...v.services,
                        templates: [
                          ...v.services.templates.filter(
                            (x) => x.id !== next.id,
                          ),
                          next,
                        ],
                      },
                    }));
                    setSelected(next.id);
                    setEditor(null);
                    setNotice(p.templateSaved);
                  }}
                >
                  <label className="product-field">
                    {p.templateName}
                    <input
                      name="name"
                      required
                      pattern=".*\S.*"
                      maxLength={80}
                      defaultValue={editor.name}
                    />
                  </label>
                  <div className="field-pair">
                    <label className="product-field">
                      {p.language}
                      <select
                        name="language"
                        aria-label={p.language}
                        defaultValue={editor.language}
                      >
                        <option value="ms">Bahasa Melayu</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                    <label className="product-field">
                      {p.category}
                      <select
                        name="category"
                        aria-label={p.category}
                        defaultValue={editor.category}
                      >
                        <option value="utility">{p.utility}</option>
                        <option value="marketing">{p.marketing}</option>
                      </select>
                    </label>
                  </div>
                  <label className="product-field">
                    {p.body}
                    <textarea
                      name="body"
                      required
                      maxLength={1000}
                      rows={5}
                      defaultValue={editor.body}
                    />
                  </label>
                  <button className="button button-dark">{p.save}</button>
                </form>
              </CrmDialog>
            )}
          </>
        ) : (
          <div className="skeleton" aria-busy="true" />
        )}
      </main>
    </AppShell>
  );
}
