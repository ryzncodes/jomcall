"use client";
import { useState } from "react";
import {
  Buildings,
  ArrowUpRight,
  MagnifyingGlass,
  Phone,
  ShieldWarning,
  CheckCircle,
  Database,
  Cpu,
  Waveform,
  PlugsConnected,
  DownloadSimple,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { PublicFrame } from "../public-pages";
import { useProduct } from "./provider";
import { useCrm } from "./crm-provider";
import { Field } from "./setup";
import { CrmDialog, dateLabel, downloadJson } from "./crm-ui";
import { money } from "@/lib/api/client";
import { walletBalance } from "@/lib/api/service";
import { installationReady, type Health } from "@/lib/api/remaining";
export function Platform() {
  const { t, href } = useExperience(),
    p = t.remaining,
    { draft: d, update } = useProduct(),
    { data: c } = useCrm();
  const [tab, setTab] = useState<"tenants" | "pool" | "abuse" | "usage">(
      "tenants",
    ),
    [search, setSearch] = useState(""),
    [pause, setPause] = useState<string | null>(null);
  if (!d || !c)
    return (
      <PublicFrame>
        <main tabIndex={-1} id="content" className="public-content">
          {t.product.loading}
        </main>
      </PublicFrame>
    );
  const tenants = [
      {
        id: d.organization.id,
        name: d.organization.name,
        current: true,
        calls: c.calls.length,
        messages: c.contacts
          .flatMap((x) => x.events)
          .filter((e) => e.delivery === "delivered" && e.kind === "message")
          .length,
        wallet: walletBalance(d),
      },
      {
        id: "sample-tenant-south",
        name: p.sampleTenantOne,
        current: false,
        calls: 48,
        messages: 126,
        wallet: 15400,
      },
      {
        id: "sample-tenant-north",
        name: p.sampleTenantTwo,
        current: false,
        calls: 23,
        messages: 64,
        wallet: 8200,
      },
    ],
    platform = d.extensions.platform;
  const setPauseState = (id: string, suspended: boolean) =>
    update((v) => ({
      ...v,
      extensions: {
        ...v.extensions,
        platform: {
          ...v.extensions.platform,
          suspended: suspended
            ? [...new Set([...v.extensions.platform.suspended, id])]
            : v.extensions.platform.suspended.filter((x) => x !== id),
        },
      },
    }));
  return (
    <PublicFrame>
      <main tabIndex={-1} id="content" className="public-content platform-main">
        <div className="platform-heading">
          <div>
            <span className="remaining-chip">{p.previewOnly}</span>
            <h1>{p.platformTitle}</h1>
            <p>{p.platformIntro}</p>
          </div>
          <a className="button secondary-button" href={href("/app")}>
            {p.authEnter}
            <ArrowUpRight size={18} />
          </a>
        </div>
        <div className="platform-stats">
          {[
            [p.tenants, tenants.length],
            [
              p.active,
              tenants.filter((x) => !platform.suspended.includes(x.id)).length,
            ],
            [p.callCount, tenants.reduce((n, x) => n + x.calls, 0)],
            [p.messageCount, tenants.reduce((n, x) => n + x.messages, 0)],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="remaining-tabs" role="group" aria-label={p.platform}>
          {(["tenants", "pool", "abuse", "usage"] as const).map((k) => (
            <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>
              {p[k]}
            </button>
          ))}
        </div>
        {tab === "tenants" ? (
          <>
            <label className="platform-search">
              <MagnifyingGlass size={20} />
              <input
                aria-label={p.tenantSearch}
                placeholder={p.tenantSearch}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="tenant-list">
              {tenants
                .filter((x) =>
                  x.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((x) => (
                  <article key={x.id}>
                    <span className="tenant-icon">
                      <Buildings size={29} />
                    </span>
                    <div>
                      <small>
                        {x.current ? p.current : p.sampleTenantNote}
                      </small>
                      <h2>{x.name}</h2>
                      <p>
                        {x.calls} {p.callCount} · {money(x.wallet)}
                      </p>
                    </div>
                    <span
                      className={`remaining-chip ${platform.suspended.includes(x.id) ? "warn" : ""}`}
                    >
                      {platform.suspended.includes(x.id)
                        ? p.suspended
                        : p.active}
                    </span>
                    <button
                      className="button secondary-button"
                      onClick={() =>
                        platform.suspended.includes(x.id)
                          ? setPauseState(x.id, false)
                          : setPause(x.id)
                      }
                    >
                      {platform.suspended.includes(x.id) ? p.resume : p.pause}
                    </button>
                  </article>
                ))}
              {!tenants.some((x) =>
                x.name.toLowerCase().includes(search.toLowerCase()),
              ) && <p>{p.noResults}</p>}
            </div>
          </>
        ) : tab === "pool" ? (
          <>
            <p className="remaining-callout">
              <Phone size={22} />
              {p.numberHint}
            </p>
            <div className="number-pool">
              {["MY-SAMPLE-01", "MY-SAMPLE-02", "MY-SAMPLE-03"].map((id, i) => {
                const assigned = platform.assignments[id];
                return (
                  <article key={id}>
                    <span className="remaining-chip">
                      {assigned ? p.assigned : p.available}
                    </span>
                    <Phone size={32} />
                    <h2>+60 3 •••• 00{String(i + 1).padStart(2, "0")}</h2>
                    <small>{id}</small>
                    <p>{assigned ? d.organization.name : p.available}</p>
                    <button
                      className="button secondary-button"
                      disabled={
                        !assigned &&
                        Object.values(platform.assignments).includes(
                          d.organization.id,
                        )
                      }
                      onClick={() =>
                        update((v) => {
                          const assignments = {
                            ...v.extensions.platform.assignments,
                          };
                          if (assigned) delete assignments[id];
                          else assignments[id] = v.organization.id;
                          return {
                            ...v,
                            phone_line: {
                              ...v.phone_line,
                              reserved: !assigned,
                              verified: false,
                            },
                            extensions: {
                              ...v.extensions,
                              platform: {
                                ...v.extensions.platform,
                                assignments,
                              },
                            },
                          };
                        })
                      }
                    >
                      {assigned ? p.release : p.assign}
                    </button>
                  </article>
                );
              })}
            </div>
            <a className="text-link" href={href("/app/phone-numbers")}>
              {t.services.phones}
              <ArrowUpRight size={18} />
            </a>
          </>
        ) : tab === "abuse" ? (
          <article className="abuse-review">
            <ShieldWarning size={40} />
            <div>
              <span className="remaining-chip">
                {platform.resolved.includes("sample-alert-1")
                  ? p.resolved
                  : p.reviewing}
              </span>
              <h2>{p.abuseTitle}</h2>
              <strong>{p.sampleTenantOne}</strong>
              <p>{p.abuseBody}</p>
              <button
                className="button button-dark"
                disabled={platform.resolved.includes("sample-alert-1")}
                onClick={() =>
                  update((v) => ({
                    ...v,
                    extensions: {
                      ...v.extensions,
                      platform: {
                        ...v.extensions.platform,
                        resolved: [
                          ...new Set([
                            ...v.extensions.platform.resolved,
                            "sample-alert-1",
                          ]),
                        ],
                      },
                    },
                  }))
                }
              >
                {p.resolveAbuse}
              </button>
            </div>
          </article>
        ) : (
          <>
            <p>{p.usageHint}</p>
            <div className="platform-usage">
              {tenants.map((x) => (
                <article key={x.id}>
                  <h2>{x.name}</h2>
                  <small>{x.current ? p.current : p.sampleTenantNote}</small>
                  <dl>
                    {[
                      [p.callCount, x.calls],
                      [p.messageCount, x.messages],
                      [p.wallet, money(x.wallet)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="usage-bar" aria-hidden="true">
                    <i
                      style={{
                        width: `${Math.min(100, (x.calls / 60) * 100)}%`,
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {pause && (
          <CrmDialog
            title={p.pause}
            description={p.tenantNote}
            onClose={() => setPause(null)}
          >
            <p>{tenants.find((x) => x.id === pause)?.name}</p>
            <button
              className="button button-dark"
              onClick={() => {
                setPauseState(pause, true);
                setPause(null);
              }}
            >
              {p.pause}
            </button>
          </CrmDialog>
        )}
      </main>
    </PublicFrame>
  );
}
export function SelfHost() {
  const { t, href, locale } = useExperience(),
    p = t.remaining,
    { draft: d, update } = useProduct(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  if (!d)
    return (
      <PublicFrame>
        <main tabIndex={-1} id="content" className="public-content">
          {t.product.loading}
        </main>
      </PublicFrame>
    );
  const i = d.extensions.installation,
    ready = installationReady(i),
    icons = {
      database: Database,
      speech: Waveform,
      model: Cpu,
      sip: PlugsConnected,
    };
  return (
    <PublicFrame>
      <main tabIndex={-1} id="content" className="public-content selfhost-main">
        <div className="public-title">
          <span className="remaining-chip">{p.selfhost}</span>
          <h1>{p.selfTitle}</h1>
          <p>{p.selfIntro}</p>
        </div>
        <div className="selfhost-layout">
          <section>
            <div className="selfhost-progress">
              <strong>{Object.values(icons).length}</strong>
              <span>{p.check}</span>
              <small>
                {i.checked_at ? dateLabel(i.checked_at, locale) : p.unchecked}
              </small>
            </div>
            {(["database", "speech", "model", "sip"] as const).map(
              (k, index) => {
                const Icon = icons[k];
                return (
                  <article className="health-row" key={k}>
                    <span className="health-index">0{index + 1}</span>
                    <Icon size={25} />
                    <div>
                      <h2>{p[k]}</h2>
                      <span
                        className={`remaining-chip ${i.checked_at && i[k] !== "ready" ? "warn" : ""}`}
                      >
                        {i.checked_at ? p[i[k]] : p.unchecked}
                      </span>
                    </div>
                    <Field label={`${p.fixture} · ${p[k]}`}>
                      <select
                        value={i[k]}
                        disabled={busy}
                        onChange={(e) =>
                          update((v) => ({
                            ...v,
                            extensions: {
                              ...v.extensions,
                              installation: {
                                ...v.extensions.installation,
                                [k]: e.target.value as Health,
                                checked_at: null,
                                completed: false,
                              },
                            },
                          }))
                        }
                      >
                        {(["missing", "ready", "invalid"] as const).map((x) => (
                          <option key={x} value={x}>
                            {p[x]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </article>
                );
              },
            )}
          </section>
          <aside className="selfhost-summary">
            <PlugsConnected size={40} />
            <h2>{i.completed ? p.selfDone : p.selfhost}</h2>
            <p>{p.selfHint}</p>
            <button
              disabled={busy}
              className="button button-dark"
              onClick={async () => {
                setBusy(true);
                await new Promise((r) => setTimeout(r, 450));
                update((v) => ({
                  ...v,
                  extensions: {
                    ...v.extensions,
                    installation: {
                      ...v.extensions.installation,
                      checked_at: new Date().toISOString(),
                    },
                  },
                }));
                setNotice(p.checked);
                setBusy(false);
              }}
            >
              {busy ? p.checking : p.check}
            </button>
            <button
              className="button secondary-button"
              disabled={!ready || !i.checked_at || i.completed || busy}
              onClick={() => {
                update((v) => ({
                  ...v,
                  extensions: {
                    ...v.extensions,
                    installation: {
                      ...v.extensions.installation,
                      completed: true,
                    },
                  },
                }));
                setNotice(p.selfDone);
              }}
            >
              <CheckCircle size={18} />
              {p.completeSetup}
            </button>
            {i.completed && (
              <a className="text-link" href={href("/app/setup")}>
                {p.nextSetup}
                <ArrowUpRight size={18} />
              </a>
            )}
            <button
              className="text-link"
              onClick={() =>
                downloadJson(
                  JSON.stringify(
                    {
                      sample: true,
                      requirements: [
                        "Postgres",
                        "Speech provider",
                        "Language model",
                        "SIP trunk",
                      ],
                      ...i,
                    },
                    null,
                    2,
                  ),
                  "sample-installation-checklist.json",
                )
              }
            >
              <DownloadSimple size={18} />
              {p.downloadConfig}
            </button>
            <p role="status">{notice}</p>
          </aside>
        </div>
      </main>
    </PublicFrame>
  );
}
