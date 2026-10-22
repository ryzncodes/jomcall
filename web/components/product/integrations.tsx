"use client";
import { useState } from "react";
import {
  CalendarBlank,
  Table,
  WebhooksLogo,
  MetaLogo,
  TiktokLogo,
  ArrowUpRight,
  CheckCircle,
  PlugsConnected,
  WarningCircle,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useCrm } from "./crm-provider";
import { useProduct } from "./provider";
import { AppShell } from "./shell";
import { CrmDialog, dateLabel, downloadJson } from "./crm-ui";
import { type ConnectorId } from "@/lib/api/crm";
import { makeEvent } from "@/lib/api/inbox";
const icons = {
  google: CalendarBlank,
  cal: CalendarBlank,
  sheets: Table,
  facebook: MetaLogo,
  tiktok: TiktokLogo,
  webhook: WebhooksLogo,
};
export function Integrations() {
  const { t, locale, href } = useExperience(),
    p = t.crm,
    { draft, update } = useProduct(),
    { data, setData } = useCrm();
  const [switchTo, setSwitchTo] = useState<ConnectorId | null>(null),
    [busy, setBusy] = useState<ConnectorId | null>(null),
    [notice, setNotice] = useState(""),
    [result, setResult] = useState<string | null>(null);
  const isCalendar = (id: ConnectorId) => id === "google" || id === "cal";
  const status = (id: ConnectorId) =>
    isCalendar(id)
      ? draft?.calendar.provider === id && draft.calendar.status === "connected"
        ? "connected"
        : data?.connectors.find((c) => c.id === id)?.status === "error"
          ? "error"
          : "disconnected"
      : (data?.connectors.find((c) => c.id === id)?.status ?? "disconnected");
  const connect = (id: ConnectorId, connected = true) => {
    if (isCalendar(id))
      update(
        (d) => ({
          ...d,
          calendar: {
            provider: id as "google" | "cal",
            status: connected ? "connected" : "disconnected",
          },
        }),
        true,
      );
    setData((d) =>
      d
        ? {
            ...d,
            connectors: d.connectors.map((c) =>
              c.id === id
                ? {
                    ...c,
                    status: connected ? "connected" : "disconnected",
                    checked_at: new Date().toISOString(),
                  }
                : isCalendar(id) && isCalendar(c.id)
                  ? { ...c, status: "disconnected" }
                  : c,
            ),
          }
        : d,
    );
    setNotice(connected ? p.connected : p.disconnected);
    setSwitchTo(null);
  };
  const check = async (id: ConnectorId) => {
    setBusy(id);
    await new Promise((r) => setTimeout(r, 450));
    setData((d) =>
      d
        ? {
            ...d,
            connectors: d.connectors.map((c) =>
              c.id === id ? { ...c, checked_at: new Date().toISOString() } : c,
            ),
          }
        : d,
    );
    setNotice(p.checked);
    setBusy(null);
  };
  const run = (id: ConnectorId, importLead = false) => {
    if (status(id) !== "connected" || !data) return;
    const at = new Date().toISOString();
    if (
      id === "facebook" ||
      id === "tiktok" ||
      (importLead && (id === "sheets" || id === "webhook"))
    ) {
      const contactId = `sample-lead-${crypto.randomUUID()}`,
        name = `${p.leadName} ${data.connectors.find((c) => c.id === id)!.runs + 1}`;
      setData((d) =>
        d
          ? {
              ...d,
              contacts: [
                ...d.contacts,
                {
                  id: contactId,
                  lead_source: id,
                  org_id: "sample-org",
                  name,
                  phone_e164: null,
                  language: locale,
                  stage: 0,
                  do_not_contact: false,
                  opt_in: false,
                  call_permission: "unknown",
                  owner: "staff",
                  status: "waiting",
                  last_inbound_at: "2000-01-01T00:00:00Z",
                  events: [
                    makeEvent(
                      "system",
                      "system",
                      `${p.providers[id].name}: ${p.leadMessage}`,
                    ),
                  ],
                },
              ],
              connectors: d.connectors.map((c) =>
                c.id === id ? { ...c, runs: c.runs + 1, checked_at: at } : c,
              ),
            }
          : d,
      );
      setNotice(p.leadImported);
      setResult(null);
    } else {
      const payload = {
        sample: true,
        provider: id,
        created_at: at,
        contacts: data.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          do_not_contact: c.do_not_contact,
        })),
        bookings: data.bookings,
      };
      setResult(JSON.stringify(payload, null, 2));
      setData((d) =>
        d
          ? {
              ...d,
              connectors: d.connectors.map((c) =>
                c.id === id ? { ...c, runs: c.runs + 1, checked_at: at } : c,
              ),
            }
          : d,
      );
      setNotice(
        `${p.success} ${data.contacts.length + data.bookings.length} ${p.records}.`,
      );
    }
  };
  return (
    <AppShell active="integrations">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main crm-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.integrationTitle}</h1>
            <p>{p.integrationIntro}</p>
          </div>
          <span className="crm-heading-icon">
            <PlugsConnected size={36} weight="light" />
          </span>
        </div>
        <div className="integration-summary">
          <div className="integration-symbol">
            <CalendarBlank size={25} />
          </div>
          <div>
            <span>{p.activeCalendar}</span>
            <strong>
              {draft?.calendar.status === "connected"
                ? p.providers[draft.calendar.provider].name
                : p.noCalendar}
            </strong>
          </div>
          <a href={href("/app/bookings")}>
            {p.viewBookings}
            <ArrowUpRight size={18} />
          </a>
        </div>
        <p className="crm-notice" role="status">
          {notice}
        </p>
        {result && (
          <div className="integration-result">
            <CheckCircle size={20} />
            <span>{p.syncResult}</span>
            <button
              className="crm-text-button"
              onClick={() =>
                downloadJson(result, "sample-integration-result.json")
              }
            >
              {p.download}
            </button>
          </div>
        )}
        {(
          [
            { key: "scheduling", ids: ["google", "cal"] },
            { key: "operations", ids: ["sheets", "webhook"] },
            { key: "leads", ids: ["facebook", "tiktok"] },
          ] as const
        ).map((group) => (
          <section className="integration-group" key={group.key}>
            <div className="integration-group-heading">
              <h2>{p[group.key]}</h2>
              <p>{p[`${group.key}Intro`]}</p>
            </div>
            <div className="connector-grid">
              {group.ids.map((id) => {
                const c = data?.connectors.find((c) => c.id === id),
                  state = status(id),
                  Icon = icons[id];
                return (
                  <article className={`connector ${state}`} key={id}>
                    <header>
                      <span className={`connector-icon ${id}`}>
                        <Icon size={27} weight="regular" />
                      </span>
                      <span className={`crm-chip ${state}`}>
                        {state === "connected" ? (
                          <CheckCircle size={13} />
                        ) : state === "error" ? (
                          <WarningCircle size={13} />
                        ) : null}
                        {p[state]}
                      </span>
                    </header>
                    <h3>{p.providers[id].name}</h3>
                    <p>{p.providers[id].description}</p>
                    <span className="connector-scope">
                      {p.providers[id].scope}
                    </span>
                    <div className="connector-actions">
                      <button
                        disabled={!draft || !data || busy === id}
                        className={`button ${state === "connected" ? "secondary-button" : "button-dark"}`}
                        onClick={() => {
                          if (state === "connected") connect(id, false);
                          else if (
                            isCalendar(id) &&
                            draft?.calendar.status === "connected" &&
                            draft.calendar.provider !== id
                          )
                            setSwitchTo(id);
                          else connect(id);
                        }}
                      >
                        {state === "connected"
                          ? p.disconnect
                          : state === "error"
                            ? p.reconnect
                            : p.connect}
                      </button>
                      {state === "connected" && (
                        <button
                          className="crm-text-button"
                          disabled={busy === id}
                          onClick={() => (isCalendar(id) ? check(id) : run(id))}
                        >
                          {busy === id
                            ? p.checking
                            : isCalendar(id)
                              ? p.check
                              : id === "facebook" || id === "tiktok"
                                ? p.importLead
                                : id === "webhook"
                                  ? p.testWebhook
                                  : p.run}
                        </button>
                      )}
                    </div>
                    {state === "connected" &&
                      (id === "sheets" || id === "webhook") && (
                        <button
                          className="crm-text-button"
                          onClick={() => run(id, true)}
                        >
                          {p.importLead}
                        </button>
                      )}
                    <details className="connector-health">
                      <summary>
                        {p.health}
                        <span className={`connection-dot ${state}`} />
                      </summary>
                      <p>{p.healthIntro}</p>
                      <dl>
                        <div>
                          <dt>{p.activity}</dt>
                          <dd>
                            {c?.checked_at
                              ? dateLabel(c.checked_at, locale)
                              : p.neverChecked}
                          </dd>
                        </div>
                        {!isCalendar(id) && (
                          <div>
                            <dt>{p.runs}</dt>
                            <dd>{c?.runs ?? 0}</dd>
                          </div>
                        )}
                      </dl>
                      {state === "connected" && (
                        <button
                          className="crm-text-button"
                          onClick={() => {
                            if (isCalendar(id))
                              update(
                                (d) => ({
                                  ...d,
                                  calendar: {
                                    ...d.calendar,
                                    status: "disconnected",
                                  },
                                }),
                                true,
                              );
                            setData((d) =>
                              d
                                ? {
                                    ...d,
                                    connectors: d.connectors.map((c) =>
                                      c.id === id
                                        ? {
                                            ...c,
                                            status: "error",
                                            checked_at:
                                              new Date().toISOString(),
                                          }
                                        : c,
                                    ),
                                  }
                                : d,
                            );
                            setNotice(p.error);
                          }}
                        >
                          <ArrowClockwise size={15} />
                          {p.failure}
                        </button>
                      )}
                    </details>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        <footer className="integrations-footer">
          <PlugsConnected size={22} />
          <div>
            <p>{p.localNote}</p>
            <small>{p.calendarConfigured}</small>
          </div>
          <a href={href("/app/contacts")}>
            {p.contacts}
            <ArrowUpRight size={16} />
          </a>
        </footer>
        {switchTo && (
          <CrmDialog
            title={p.switchTitle}
            description={p.switchBody}
            onClose={() => setSwitchTo(null)}
          >
            <div className="crm-dialog-actions">
              <button
                className="button secondary-button"
                onClick={() => setSwitchTo(null)}
              >
                {p.keepConnection}
              </button>
              <button
                className="button button-dark"
                onClick={() => connect(switchTo)}
              >
                {p.switchConfirm}
              </button>
            </div>
          </CrmDialog>
        )}
      </main>
    </AppShell>
  );
}
