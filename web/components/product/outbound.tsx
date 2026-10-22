"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash,
  GitBranch,
  Clock,
  WhatsappLogo,
  Phone,
  Play,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { useCrm } from "./crm-provider";
import { AppShell } from "./shell";
import { Field } from "./setup";
import { dateLabel } from "./crm-ui";
import { klDay } from "@/lib/api/crm";
import { makeEvent } from "@/lib/api/inbox";
import {
  advance,
  enroll,
  enrollReason,
  publishWorkflow,
  publishable,
  resolveRun,
  type StepKind,
  type OutboundData,
} from "@/lib/api/outbound";

const stepIcons = {
  wait: Clock,
  condition: GitBranch,
  whatsapp: WhatsappLogo,
  call: Phone,
};
export function Outbound() {
  const { t, locale, href } = useExperience(),
    p = t.remaining,
    { draft: d } = useProduct(),
    { data: c, setData } = useCrm();
  const [tab, setTab] = useState<"workflow" | "runs" | "review">("workflow"),
    [notice, setNotice] = useState(""),
    [contact, setContact] = useState(""),
    [kind, setKind] = useState<StepKind>("wait"),
    [outcome, setOutcome] = useState<"delivered" | "unknown">("delivered"),
    [clock, setClock] = useState(() => `${klDay()}T10:00`);
  if (!d || !c)
    return (
      <AppShell active="outbound">
        <main tabIndex={-1} id="workspace-content" className="product-main">
          {t.product.loading}
        </main>
      </AppShell>
    );
  const o = c.outbound,
    last = o.revisions.at(-1),
    review = o.runs.filter((r) => r.state === "review");
  const edit = (fn: (o: OutboundData) => OutboundData) =>
    setData((x) => (x ? { ...x, outbound: fn(x.outbound) } : x));
  const at = () => new Date(`${clock}:00+08:00`).toISOString();
  const patch = (v: Partial<OutboundData["draft"]>) =>
    edit((x) => ({ ...x, draft: { ...x.draft, ...v } }));
  const mutateStep = (
    id: string,
    v: Partial<OutboundData["draft"]["steps"][number]>,
  ) =>
    patch({
      steps: o.draft.steps.map((s) => (s.id === id ? { ...s, ...v } : s)),
    });
  const move = (i: number, by: number) => {
    const rows = [...o.draft.steps];
    [rows[i], rows[i + by]] = [rows[i + by], rows[i]];
    patch({ steps: rows });
  };
  const states = {
    active: p.active,
    waiting: p.waiting,
    review: p.reviewing,
    complete: p.completed,
    stopped: p.stopped,
  };
  return (
    <AppShell active="outbound">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main remaining-main"
      >
        <div className="workspace-title">
          <div>
            <p className="eyebrow">{p.outbound}</p>
            <h1>{p.outboundTitle}</h1>
            <p>{p.outboundIntro}</p>
          </div>
          <a className="text-link" href={href("/app/integrations")}>
            {p.connectSources}
            <ArrowUpRight size={18} />
          </a>
        </div>
        <div className="remaining-tabs" role="group" aria-label={p.outbound}>
          {(["workflow", "runs", "review"] as const).map((k) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>
              {p[k]}
              <span>
                {k === "workflow"
                  ? o.revisions.length
                  : k === "runs"
                    ? o.runs.length
                    : review.length}
              </span>
            </button>
          ))}
        </div>
        <p role="status" className="remaining-notice">
          {notice}
        </p>
        {tab === "workflow" ? (
          <div className="workflow-layout">
            <section className="flow-canvas" aria-label={p.steps}>
              <div className="flow-trigger">
                <span className="flow-icon">
                  <GitBranch size={24} />
                </span>
                <div>
                  <small>{p.source}</small>
                  <h2>
                    {o.draft.source === "manual"
                      ? p.manual
                      : t.crm.providers[o.draft.source].name}
                  </h2>
                </div>
              </div>
              <ol className="flow-steps">
                {o.draft.steps.map((s, i) => {
                  const Icon = stepIcons[s.kind];
                  return (
                    <li key={s.id}>
                      <span className="flow-index">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <article>
                        <div className="flow-step-heading">
                          <Icon size={23} />
                          <h3>{p[s.kind]}</h3>
                          <div>
                            <button
                              className="icon-button"
                              disabled={i === 0}
                              aria-label={`${p.up} ${i + 1}`}
                              onClick={() => move(i, -1)}
                            >
                              <ArrowUp size={17} />
                            </button>
                            <button
                              className="icon-button"
                              disabled={i === o.draft.steps.length - 1}
                              aria-label={`${p.down} ${i + 1}`}
                              onClick={() => move(i, 1)}
                            >
                              <ArrowDown size={17} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`${p.remove} ${i + 1}`}
                              onClick={() =>
                                patch({
                                  steps: o.draft.steps.filter(
                                    (x) => x.id !== s.id,
                                  ),
                                })
                              }
                            >
                              <Trash size={17} />
                            </button>
                          </div>
                        </div>
                        {s.kind === "wait" ? (
                          <Field label={p.minutes}>
                            <input
                              type="number"
                              min={1}
                              max={10080}
                              value={s.minutes}
                              onChange={(e) =>
                                mutateStep(s.id, {
                                  minutes: Number(e.target.value),
                                })
                              }
                            />
                          </Field>
                        ) : s.kind === "whatsapp" ? (
                          <Field label={p.template}>
                            <select
                              value={s.template_id}
                              onChange={(e) =>
                                mutateStep(s.id, {
                                  template_id: e.target.value,
                                })
                              }
                            >
                              <option value="">—</option>
                              {d.services.templates
                                .filter(
                                  (x) =>
                                    x.status === "approved" ||
                                    x.id === s.template_id,
                                )
                                .map((x) => (
                                  <option
                                    key={x.id}
                                    value={x.id}
                                    disabled={x.status !== "approved"}
                                  >
                                    {x.name} · {t.services[x.status]}
                                  </option>
                                ))}
                            </select>
                          </Field>
                        ) : (
                          <p>
                            {s.kind === "condition"
                              ? p.reasons.engagement
                              : p.quietHint}
                          </p>
                        )}
                      </article>
                    </li>
                  );
                })}
              </ol>
              <div className="flow-add">
                <Field label={p.addStep}>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as StepKind)}
                  >
                    {(["wait", "condition", "whatsapp", "call"] as const).map(
                      (k) => (
                        <option key={k} value={k}>
                          {p[k]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <button
                  className="button secondary-button"
                  disabled={o.draft.steps.length >= 12}
                  onClick={() =>
                    patch({
                      steps: [
                        ...o.draft.steps,
                        {
                          id: crypto.randomUUID(),
                          kind,
                          minutes: 30,
                          template_id:
                            d.services.templates.find(
                              (t) => t.status === "approved",
                            )?.id ?? "",
                        },
                      ],
                    })
                  }
                >
                  <Plus size={18} />
                  {p.addStep}
                </button>
              </div>
            </section>
            <aside className="flow-rules">
              <h2>{p.enrollment}</h2>
              <Field label={p.source}>
                <select
                  value={o.draft.source}
                  onChange={(e) =>
                    patch({ source: e.target.value as typeof o.draft.source })
                  }
                >
                  <option value="manual">{p.manual}</option>
                  {(["facebook", "tiktok", "sheets", "webhook"] as const).map(
                    (k) => (
                      <option key={k} value={k}>
                        {t.crm.providers[k].name}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <p>{p.sourceHint}</p>
              <label className="product-check">
                <input
                  type="checkbox"
                  checked={o.draft.reentry}
                  onChange={(e) => patch({ reentry: e.target.checked })}
                />
                {p.reentry}
              </label>
              <div className="editor-divider" />
              <h3>{p.quiet}</h3>
              <div className="field-pair">
                <Field label={p.start}>
                  <input
                    type="time"
                    value={o.draft.quiet_from}
                    onChange={(e) => patch({ quiet_from: e.target.value })}
                  />
                </Field>
                <Field label={p.end}>
                  <input
                    type="time"
                    value={o.draft.quiet_to}
                    onChange={(e) => patch({ quiet_to: e.target.value })}
                  />
                </Field>
              </div>
              <p>{p.quietHint}</p>
              <button
                className="button button-dark"
                onClick={() => {
                  if (!publishable(o, d)) {
                    setNotice(p.publishInvalid);
                    return;
                  }
                  edit((x) => publishWorkflow(x, d));
                  setNotice(p.published);
                }}
              >
                <CheckCircle size={18} />
                {p.publish}
              </button>
              <small>
                {last
                  ? `${p.version} ${last.number} · ${dateLabel(last.at, locale)}`
                  : p.noRevision}
              </small>
            </aside>
          </div>
        ) : (
          <section className="run-board">
            <div className="run-controls">
              <Field label={p.sampleClock} hint={p.clockHint}>
                <input
                  type="datetime-local"
                  value={clock}
                  required
                  onChange={(e) => setClock(e.target.value)}
                />
              </Field>
              <Field label={p.outcome}>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                >
                  <option value="delivered">{p.delivered}</option>
                  <option value="unknown">{p.unknown}</option>
                </select>
              </Field>
            </div>
            {tab === "runs" && (
              <form
                className="enroll-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = enrollReason(c, d, contact);
                  if (reason) {
                    setNotice(p.reasons[reason]);
                    return;
                  }
                  setData((x) => (x ? enroll(x, d, contact, at()) : x));
                  setNotice(p.enrolled);
                }}
              >
                <Field label={p.contact}>
                  <select
                    required
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  >
                    <option value="">{p.chooseContact}</option>
                    {c.contacts.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  className="button button-dark"
                  disabled={!clock || !last}
                >
                  {p.enroll}
                </button>
              </form>
            )}
            {tab === "review" && (
              <p className="remaining-callout">
                <WarningCircle size={22} />
                {p.reviewHint}
              </p>
            )}
            {!(tab === "review" ? review : o.runs).length && (
              <div className="remaining-empty">
                <GitBranch size={38} />
                <h2>{tab === "review" ? p.emptyReview : p.emptyRuns}</h2>
                <button
                  className="text-link"
                  onClick={() => setTab("workflow")}
                >
                  {p.workflow}
                  <ArrowUpRight size={18} />
                </button>
              </div>
            )}
            {(tab === "review" ? review : o.runs)
              .slice()
              .reverse()
              .map((r) => {
                const person = c.contacts.find((x) => x.id === r.contact_id),
                  rev = o.revisions.find((v) => v.id === r.revision_id)!;
                return (
                  <article className="run-row" key={r.id}>
                    <div>
                      <span
                        className={`remaining-chip ${r.state === "review" ? "warn" : ""}`}
                      >
                        {states[r.state]}
                      </span>
                      <h3>{person?.name ?? p.reasons.deleted}</h3>
                      <p>
                        {p.version} {rev.number} / {p.stepOf}{" "}
                        {Math.min(r.step + 1, rev.steps.length)} ·{" "}
                        {rev.steps[r.step]
                          ? p[rev.steps[r.step].kind]
                          : p.completed}
                      </p>
                      {r.reason && (
                        <p className="run-reason">{p.reasons[r.reason]}</p>
                      )}
                      {r.next_at && (
                        <small>{dateLabel(r.next_at, locale)}</small>
                      )}
                      <a
                        className="text-link"
                        href={href(`/app/inbox?contact=${r.contact_id}`)}
                      >
                        {p.openInbox}
                        <ArrowUpRight size={16} />
                      </a>
                    </div>
                    <div className="run-actions">
                      {r.state === "review" ? (
                        <>
                          <button
                            className="button button-dark"
                            onClick={() =>
                              setData((x) =>
                                x
                                  ? resolveRun(
                                      x,
                                      r.id,
                                      true,
                                      new Date().toISOString(),
                                      d,
                                    )
                                  : x,
                              )
                            }
                          >
                            {p.resolve}
                          </button>
                          <button
                            className="button secondary-button"
                            onClick={() =>
                              setData((x) =>
                                x
                                  ? resolveRun(
                                      x,
                                      r.id,
                                      false,
                                      new Date().toISOString(),
                                      d,
                                    )
                                  : x,
                              )
                            }
                          >
                            {p.notSent}
                          </button>
                        </>
                      ) : (
                        !["complete", "stopped"].includes(r.state) && (
                          <>
                            <button
                              className="button button-dark"
                              disabled={!clock}
                              onClick={() =>
                                setData((x) =>
                                  x
                                    ? advance(
                                        x,
                                        d,
                                        r.id,
                                        at(),
                                        outcome,
                                        outcome === "unknown"
                                          ? p.callAttempt
                                          : p.callBody,
                                      )
                                    : x,
                                )
                              }
                            >
                              <Play size={16} />
                              {p.advance}
                            </button>
                            <button
                              className="button secondary-button"
                              disabled={
                                !clock ||
                                Date.parse(`${clock}:00+08:00`) <=
                                  Date.parse(r.created_at)
                              }
                              onClick={() =>
                                setData((x) =>
                                  x
                                    ? {
                                        ...x,
                                        contacts: x.contacts.map((v) =>
                                          v.id === r.contact_id
                                            ? {
                                                ...v,
                                                last_inbound_at: at(),
                                                events: [
                                                  ...v.events,
                                                  makeEvent(
                                                    "message",
                                                    "customer",
                                                    p.replyBody,
                                                    { at: at() },
                                                  ),
                                                ],
                                              }
                                            : v,
                                        ),
                                      }
                                    : x,
                                )
                              }
                            >
                              {p.reply}
                            </button>
                            <button
                              className="text-link"
                              onClick={() =>
                                edit((x) => ({
                                  ...x,
                                  runs: x.runs.map((v) =>
                                    v.id === r.id
                                      ? { ...v, state: "stopped", reason: null }
                                      : v,
                                  ),
                                }))
                              }
                            >
                              {p.stop}
                            </button>
                          </>
                        )
                      )}
                    </div>
                  </article>
                );
              })}
          </section>
        )}
        <p className="remaining-footnote">
          {p.previewOnly} ·{" "}
          <a href={href("/app/billing")}>{t.services.billing}</a> ·{" "}
          <a href={href("/app/contacts")}>{t.crm.contacts}</a>
        </p>
      </main>
    </AppShell>
  );
}
