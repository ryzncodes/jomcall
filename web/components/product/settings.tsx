"use client";
import { useEffect, useRef, useState } from "react";
import {
  Buildings,
  MapPin,
  Users,
  Bell,
  Key,
  ShieldCheck,
  ClockCounterClockwise,
  Plus,
  ArrowUpRight,
  CheckCircle,
  Copy,
  DownloadSimple,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { useCrm } from "./crm-provider";
import { AppShell } from "./shell";
import { CrmDialog, dateLabel, downloadJson } from "./crm-ui";
import {
  branchesFor,
  branchInUse,
  auditEntry,
  sampleKeyResponse,
  type Branch,
  type Member,
  type PreviewKey,
  type AuditAction,
} from "@/lib/api/admin";
import { businessTypes } from "@/lib/api/builder-types";
import type { BusinessType } from "@/lib/api/product-types";
import { channelReady } from "@/lib/api/service";
import { dashboardData } from "@/lib/api/dashboard";
import { klDay } from "@/lib/api/crm";
import { money } from "@/lib/api/client";
const sections = [
  "workspace",
  "branches",
  "team",
  "notifications",
  "keys",
  "privacy",
  "audit",
] as const;
type Section = (typeof sections)[number];
const icons = [
  Buildings,
  MapPin,
  Users,
  Bell,
  Key,
  ShieldCheck,
  ClockCounterClockwise,
];
export function Settings() {
  const { t, locale, href } = useExperience(),
    p = t.admin,
    { draft: d, update } = useProduct(),
    { data: c } = useCrm();
  const sectionNav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!matchMedia("(max-width:1200px)").matches) return;
    const nav = sectionNav.current,
      active = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (nav && active)
      nav.scrollLeft =
        active.offsetLeft -
        nav.offsetLeft -
        nav.clientWidth / 2 +
        active.offsetWidth / 2;
  });
  const [section, setSection] = useState<Section>("workspace"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [branch, setBranch] = useState<Branch | null>(null),
    [member, setMember] = useState<Member | null>(null),
    [newKey, setNewKey] = useState(false),
    [shownKey, setShownKey] = useState<{
      key: PreviewKey;
      token: string;
    } | null>(null),
    [revoke, setRevoke] = useState<string | null>(null),
    [testKey, setTestKey] = useState<string | null>(null),
    [response, setResponse] = useState(""),
    [summary, setSummary] = useState(false),
    [auditFilter, setAuditFilter] = useState("all");
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("section");
    if (sections.includes(q as Section)) setSection(q as Section);
  }, []);
  const choose = (s: Section) => {
    setSection(s);
    setNotice("");
    setError("");
    const url = new URL(location.href);
    url.searchParams.set("section", s);
    history.replaceState(null, "", url);
  };
  const saveNotice = () => {
    setError("");
    setNotice(p.saved);
  };
  const audit = [...(d?.admin.audit ?? []), ...(c?.activity_audit ?? [])].sort(
    (a, b) => b.at.localeCompare(a.at),
  );
  const view = d && c ? dashboardData(d, c, klDay()) : null;
  const currentKey = d?.admin.keys.find((k) => k.id === testKey);
  const toggleMember = (id: string, status: Member["status"]) =>
    update((v) => ({
      ...v,
      admin: {
        ...v.admin,
        members: v.admin.members.map((m) =>
          m.id === id && m.role !== "owner" ? { ...m, status } : m,
        ),
      },
    }));
  return (
    <AppShell active="settings">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main admin-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.settingsTitle}</h1>
            <p>{p.settingsIntro}</p>
          </div>
          <span className="admin-heading-icon">
            <Buildings size={32} weight="light" />
          </span>
        </div>
        <div className="admin-layout">
          <nav ref={sectionNav} className="admin-nav" aria-label={p.settings}>
            {sections.map((s, i) => {
              const Icon = icons[i];
              return (
                <button
                  key={s}
                  aria-current={section === s ? "page" : undefined}
                  className={section === s ? "active" : ""}
                  onClick={() => choose(s)}
                >
                  <Icon size={19} />
                  <span>{p[s]}</span>
                  {s === "team" && d && (
                    <small>
                      {
                        d.admin.members.filter((m) => m.status === "active")
                          .length
                      }
                    </small>
                  )}
                </button>
              );
            })}
            <p>{p.local}</p>
          </nav>
          <section className="admin-content" aria-label={p[section]}>
            {d && c ? (
              <>
                {section === "workspace" && (
                  <>
                    <div className="admin-section-heading">
                      <span className="admin-section-icon">
                        <Buildings size={24} />
                      </span>
                      <div>
                        <h2>{p.workspace}</h2>
                        <p>{p.workspaceHint}</p>
                      </div>
                    </div>
                    <form
                      className="admin-form"
                      key={JSON.stringify(d.organization)}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          name = String(f.get("name")).trim();
                        if (!name) return;
                        update(
                          (v) => ({
                            ...v,
                            organization: {
                              ...v.organization,
                              name,
                              business_type: String(
                                f.get("type"),
                              ) as BusinessType,
                            },
                          }),
                          true,
                        );
                        saveNotice();
                      }}
                    >
                      <label className="product-field">
                        {p.name}
                        <input
                          name="name"
                          required
                          maxLength={100}
                          defaultValue={d.organization.name}
                        />
                      </label>
                      <label className="product-field">
                        {p.type}
                        <select
                          name="type"
                          aria-label={p.type}
                          defaultValue={d.organization.business_type}
                        >
                          {businessTypes.map((b) => (
                            <option key={b} value={b}>
                              {t.product.types[b]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="admin-fact">
                        <MapPin size={20} />
                        <span>
                          <strong>{d.location.name}</strong>
                          <small>{d.location.timezone} · MYR</small>
                        </span>
                        <button
                          type="button"
                          onClick={() => choose("branches")}
                        >
                          {p.edit}
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <button className="button button-dark">{p.save}</button>
                    </form>
                  </>
                )}
                {section === "branches" && (
                  <>
                    <div className="admin-section-heading">
                      <div>
                        <h2>{p.branches}</h2>
                        <p>{p.branchHint}</p>
                      </div>
                      <button
                        className="button button-dark"
                        onClick={() => {
                          setError("");
                          setBranch({
                            id: crypto.randomUUID(),
                            org_id: d.organization.id,
                            name: "",
                            address: "",
                            archived: false,
                          });
                        }}
                      >
                        <Plus size={17} />
                        {p.newBranch}
                      </button>
                    </div>
                    <div className="admin-rows">
                      {branchesFor(d).map((b) => (
                        <article className="admin-row" key={b.id}>
                          <span className="admin-row-icon">
                            <MapPin size={22} />
                          </span>
                          <div>
                            <h3>{b.name}</h3>
                            <p>{b.address || d.location.timezone}</p>
                            <small className="service-status">
                              {b.id === d.location.id
                                ? p.primary
                                : b.archived
                                  ? p.archived
                                  : p.active}
                            </small>
                          </div>
                          <div className="admin-row-actions">
                            <button
                              onClick={() => {
                                setError("");
                                setBranch({ ...b });
                              }}
                            >
                              {p.edit}
                            </button>
                            <button
                              disabled={!b.archived && branchInUse(d, c, b.id)}
                              onClick={() => {
                                update((v) => ({
                                  ...v,
                                  admin: {
                                    ...v.admin,
                                    branches: v.admin.branches.map((x) =>
                                      x.id === b.id
                                        ? { ...x, archived: !x.archived }
                                        : x,
                                    ),
                                  },
                                }));
                                saveNotice();
                              }}
                            >
                              {b.archived ? p.restore : p.archive}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="admin-note">{p.inUse}</p>
                    <a className="crm-text-button" href={href("/app/hours")}>
                      {p.hours}
                      <ArrowUpRight size={15} />
                    </a>
                  </>
                )}
                {section === "team" && (
                  <>
                    <div className="admin-section-heading">
                      <div>
                        <h2>{p.team}</h2>
                        <p>{p.teamHint}</p>
                      </div>
                      <button
                        className="button button-dark"
                        onClick={() => {
                          setError("");
                          setMember({
                            id: crypto.randomUUID(),
                            org_id: d.organization.id,
                            name: "",
                            email: "",
                            role: "staff",
                            status: "invited",
                          });
                        }}
                      >
                        <Plus size={17} />
                        {p.newMember}
                      </button>
                    </div>
                    <div className="admin-rows">
                      {d.admin.members.map((m) => (
                        <article className="admin-row" key={m.id}>
                          <span className="member-avatar">
                            {m.name.slice(0, 1)}
                          </span>
                          <div>
                            <h3>{m.name}</h3>
                            <p>{m.email}</p>
                            <small>
                              {p[m.role]} · {p[m.status]}
                            </small>
                          </div>
                          <div className="admin-row-actions">
                            {m.role === "owner" ? (
                              <span className="admin-note">
                                {p.ownerProtected}
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setError("");
                                    setMember({ ...m });
                                  }}
                                >
                                  {p.edit}
                                </button>
                                <button
                                  onClick={() => {
                                    toggleMember(
                                      m.id,
                                      m.status === "active"
                                        ? "inactive"
                                        : "active",
                                    );
                                    saveNotice();
                                  }}
                                >
                                  {m.status === "invited"
                                    ? p.activate
                                    : m.status === "active"
                                      ? p.deactivate
                                      : p.reactivate}
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                    <p className="admin-note">{p.roleHint}</p>
                  </>
                )}
                {section === "notifications" && (
                  <>
                    <div className="admin-section-heading">
                      <span className="admin-section-icon">
                        <Bell size={24} />
                      </span>
                      <div>
                        <h2>{p.notifications}</h2>
                        <p>{p.notificationHint}</p>
                      </div>
                    </div>
                    <form
                      className="admin-form"
                      key={JSON.stringify(d.admin.notifications)}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        update((v) => ({
                          ...v,
                          admin: {
                            ...v.admin,
                            notifications: {
                              ...v.admin.notifications,
                              enabled: f.get("enabled") === "on",
                              time: String(f.get("time")),
                              callbacks: f.get("callbacks") === "on",
                            },
                          },
                        }));
                        saveNotice();
                      }}
                    >
                      <label className="crm-switch-row">
                        <span>{p.enableSummary}</span>
                        <input
                          type="checkbox"
                          role="switch"
                          name="enabled"
                          defaultChecked={d.admin.notifications.enabled}
                        />
                      </label>
                      <label className="product-field">
                        {p.summaryTime}
                        <input
                          type="time"
                          name="time"
                          required
                          defaultValue={d.admin.notifications.time}
                        />
                        <small>Asia/Kuala_Lumpur</small>
                      </label>
                      <label className="crm-switch-row">
                        <span>{p.includeCallbacks}</span>
                        <input
                          name="callbacks"
                          type="checkbox"
                          role="switch"
                          defaultChecked={d.admin.notifications.callbacks}
                        />
                      </label>
                      <div className="admin-fact">
                        <Users size={20} />
                        <span>
                          <small>{p.recipient}</small>
                          <strong>
                            {
                              d.admin.members.find((m) => m.role === "owner")
                                ?.name
                            }{" "}
                            · {t.product.numberValue}
                          </strong>
                        </span>
                      </div>
                      <div className="service-actions">
                        <button className="button button-dark">{p.save}</button>
                        <button
                          type="button"
                          className="button secondary-button"
                          onClick={() => {
                            setNotice("");
                            setSummary(true);
                          }}
                        >
                          {p.previewSummary}
                        </button>
                      </div>
                      <p className="admin-note">{p.notificationNote}</p>
                      <p className="admin-note">
                        {p.lastSummary}:{" "}
                        {d.admin.notifications.last_preview_at
                          ? dateLabel(
                              d.admin.notifications.last_preview_at,
                              locale,
                            )
                          : p.never}
                      </p>
                    </form>
                  </>
                )}
                {section === "keys" && (
                  <>
                    <div className="admin-section-heading">
                      <div>
                        <h2>{p.keys}</h2>
                        <p>{p.keyHint}</p>
                      </div>
                      <button
                        className="button button-dark"
                        onClick={() => {
                          setError("");
                          setNewKey(true);
                        }}
                      >
                        <Plus size={17} />
                        {p.newKey}
                      </button>
                    </div>
                    <div className="admin-rows">
                      {d.admin.keys.map((k) => (
                        <article className="admin-row" key={k.id}>
                          <span className="admin-row-icon">
                            <Key size={22} />
                          </span>
                          <div>
                            <h3>{k.name}</h3>
                            <p>
                              •••• {k.suffix} ·{" "}
                              {k.scope === "activity"
                                ? p.activityScope
                                : p.bookingsScope}
                            </p>
                            <small>
                              {p[k.status]} · {dateLabel(k.created_at, locale)}
                            </small>
                          </div>
                          <div className="admin-row-actions">
                            <button
                              onClick={() => {
                                setTestKey(k.id);
                                setResponse("");
                              }}
                            >
                              {p.testKey}
                            </button>
                            <button
                              disabled={k.status === "revoked"}
                              onClick={() => setRevoke(k.id)}
                            >
                              {p.revoke}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    {!d.admin.keys.length && (
                      <div className="admin-empty">
                        <Key size={36} weight="light" />
                        <p>{p.keyEmpty}</p>
                      </div>
                    )}
                  </>
                )}
                {section === "privacy" && (
                  <>
                    <div className="admin-section-heading">
                      <span className="admin-section-icon">
                        <ShieldCheck size={24} />
                      </span>
                      <div>
                        <h2>{p.privacy}</h2>
                        <p>{p.retentionIntro}</p>
                      </div>
                    </div>
                    <form
                      className="admin-form"
                      key={d.admin.retention_days}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        update((v) => ({
                          ...v,
                          admin: {
                            ...v.admin,
                            retention_days: Number(f.get("days")),
                          },
                        }));
                        saveNotice();
                      }}
                    >
                      <label className="product-field">
                        {p.retention}
                        <select
                          name="days"
                          aria-label={p.retention}
                          defaultValue={d.admin.retention_days}
                        >
                          {[7, 30, 90, 365].map((n) => (
                            <option key={n} value={n}>
                              {n} {p.days}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="button button-dark">{p.save}</button>
                      <div className="admin-privacy">
                        <ShieldCheck size={24} />
                        <div>
                          <h3>{t.product.disclosureAlways}</h3>
                          <p>
                            {d.agent.recording_enabled
                              ? t.enabled
                              : t.product.recordingOff}
                          </p>
                          <a href={href("/app/agent")}>
                            {p.recordingSettings}
                            <ArrowUpRight size={15} />
                          </a>
                        </div>
                      </div>
                      <p className="admin-note">{p.privacyNote}</p>
                      <a
                        className="crm-text-button"
                        href={href("/app/contacts")}
                      >
                        {p.openContacts}
                        <ArrowUpRight size={15} />
                      </a>
                    </form>
                  </>
                )}
                {section === "audit" && (
                  <>
                    <div className="admin-section-heading">
                      <div>
                        <h2>{p.audit}</h2>
                        <p>{p.auditHint}</p>
                      </div>
                      <button
                        className="button secondary-button"
                        onClick={() => {
                          downloadJson(
                            JSON.stringify(
                              { sample: true, entries: audit },
                              null,
                              2,
                            ),
                            "sample-audit.json",
                          );
                          update((v) => ({
                            ...v,
                            admin: {
                              ...v.admin,
                              audit: [...v.admin.audit, auditEntry("export")],
                            },
                          }));
                          saveNotice();
                        }}
                      >
                        <DownloadSimple size={17} />
                        {p.exportAudit}
                      </button>
                    </div>
                    <label className="product-field audit-filter">
                      {p.auditFilter}
                      <select
                        value={auditFilter}
                        aria-label={p.auditFilter}
                        onChange={(e) => setAuditFilter(e.target.value)}
                      >
                        <option value="all">{p.all}</option>
                        {Object.entries(p.auditActions).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="audit-list">
                      {audit
                        .filter(
                          (e) =>
                            auditFilter === "all" || e.action === auditFilter,
                        )
                        .map((e) => (
                          <article key={e.id}>
                            <span className="audit-dot" />
                            <div>
                              <strong>
                                {p.auditActions[e.action as AuditAction] ??
                                  e.action}
                              </strong>
                              <small>{p.auditActor}</small>
                            </div>
                            <time>{dateLabel(e.at, locale)}</time>
                          </article>
                        ))}
                    </div>
                    {!audit.filter(
                      (e) => auditFilter === "all" || e.action === auditFilter,
                    ).length && <p className="admin-empty">{p.auditEmpty}</p>}
                  </>
                )}
                <p className="crm-notice" role="status">
                  {notice}
                </p>
                {branch && (
                  <CrmDialog
                    title={
                      branchesFor(d).some((b) => b.id === branch.id)
                        ? p.editBranch
                        : p.newBranch
                    }
                    description={p.branchHint}
                    onClose={() => {
                      setBranch(null);
                      setError("");
                    }}
                  >
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          name = String(f.get("name")).trim(),
                          address = String(f.get("address")).trim();
                        if (!name) return;
                        if (
                          branchesFor(d).some(
                            (b) =>
                              b.id !== branch.id &&
                              b.name.toLowerCase() === name.toLowerCase(),
                          )
                        ) {
                          setError(p.duplicateBranch);
                          return;
                        }
                        update(
                          (v) =>
                            branch.id === v.location.id
                              ? {
                                  ...v,
                                  location: { ...v.location, name },
                                  admin: {
                                    ...v.admin,
                                    primary_address: address,
                                  },
                                }
                              : {
                                  ...v,
                                  admin: {
                                    ...v.admin,
                                    branches: [
                                      ...v.admin.branches.filter(
                                        (b) => b.id !== branch.id,
                                      ),
                                      { ...branch, name, address },
                                    ],
                                  },
                                },
                          branch.id === d.location.id,
                        );
                        setBranch(null);
                        saveNotice();
                      }}
                    >
                      <label className="product-field">
                        {p.branchName}
                        <input
                          name="name"
                          required
                          maxLength={80}
                          defaultValue={branch.name}
                        />
                      </label>
                      <label className="product-field">
                        {p.address}
                        <textarea
                          name="address"
                          rows={3}
                          maxLength={250}
                          defaultValue={branch.address}
                        />
                      </label>
                      {error && (
                        <p className="crm-form-error" role="alert">
                          {error}
                        </p>
                      )}
                      <button className="button button-dark">{p.save}</button>
                    </form>
                  </CrmDialog>
                )}
                {member && (
                  <CrmDialog
                    title={
                      d.admin.members.some((m) => m.id === member.id)
                        ? p.editMember
                        : p.newMember
                    }
                    description={p.teamHint}
                    onClose={() => {
                      setMember(null);
                      setError("");
                    }}
                  >
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          name = String(f.get("name")).trim(),
                          email = String(f.get("email")).trim().toLowerCase();
                        if (!name) return;
                        if (
                          d.admin.members.some(
                            (m) =>
                              m.id !== member.id &&
                              m.email.toLowerCase() === email,
                          )
                        ) {
                          setError(p.duplicateMember);
                          return;
                        }
                        update((v) => ({
                          ...v,
                          admin: {
                            ...v.admin,
                            members: [
                              ...v.admin.members.filter(
                                (m) => m.id !== member.id,
                              ),
                              {
                                ...member,
                                name,
                                email,
                                role: String(f.get("role")) as Member["role"],
                              },
                            ],
                          },
                        }));
                        setMember(null);
                        saveNotice();
                      }}
                    >
                      <label className="product-field">
                        {p.memberName}
                        <input
                          name="name"
                          required
                          maxLength={80}
                          defaultValue={member.name}
                        />
                      </label>
                      <label className="product-field">
                        {p.email}
                        <input
                          name="email"
                          type="email"
                          required
                          maxLength={150}
                          placeholder="team@example.invalid"
                          defaultValue={member.email}
                        />
                      </label>
                      <label className="product-field">
                        {p.role}
                        <select
                          name="role"
                          aria-label={p.role}
                          defaultValue={member.role}
                        >
                          <option value="admin">{p.admin}</option>
                          <option value="staff">{p.staff}</option>
                        </select>
                      </label>
                      {error && (
                        <p className="crm-form-error" role="alert">
                          {error}
                        </p>
                      )}
                      <button className="button button-dark">{p.save}</button>
                    </form>
                  </CrmDialog>
                )}
                {newKey && (
                  <CrmDialog
                    title={p.newKey}
                    description={p.keyHint}
                    onClose={() => setNewKey(false)}
                  >
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          name = String(f.get("name")).trim();
                        if (!name) return;
                        const token = `preview-not-a-key-${crypto.randomUUID()}`,
                          key: PreviewKey = {
                            id: crypto.randomUUID(),
                            org_id: d.organization.id,
                            name,
                            suffix: token.slice(-6),
                            scope: String(
                              f.get("scope"),
                            ) as PreviewKey["scope"],
                            status: "active",
                            created_at: new Date().toISOString(),
                          };
                        update((v) => ({
                          ...v,
                          admin: { ...v.admin, keys: [...v.admin.keys, key] },
                        }));
                        setNewKey(false);
                        setShownKey({ key, token });
                        setNotice("");
                      }}
                    >
                      <label className="product-field">
                        {p.keyName}
                        <input name="name" required maxLength={80} />
                      </label>
                      <label className="product-field">
                        {p.scope}
                        <select name="scope" aria-label={p.scope}>
                          <option value="activity">{p.activityScope}</option>
                          <option value="bookings">{p.bookingsScope}</option>
                        </select>
                      </label>
                      <button className="button button-dark">
                        {p.createKey}
                      </button>
                    </form>
                  </CrmDialog>
                )}
                {shownKey && (
                  <CrmDialog
                    title={p.keyCreated}
                    description={p.keyOnce}
                    onClose={() => setShownKey(null)}
                  >
                    <code className="sample-key-value">{shownKey.token}</code>
                    <button
                      className="button secondary-button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(shownKey.token);
                          setNotice(p.copied);
                        } catch {
                          setNotice(p.copyFailed);
                        }
                      }}
                    >
                      <Copy size={17} />
                      {p.copy}
                    </button>
                    <p role="status" className="crm-notice">
                      {notice}
                    </p>
                  </CrmDialog>
                )}
                {revoke && (
                  <CrmDialog
                    title={p.revokeTitle}
                    description={p.revokeHint}
                    onClose={() => setRevoke(null)}
                  >
                    <div className="service-actions">
                      <button
                        className="button button-dark"
                        onClick={() => {
                          update((v) => ({
                            ...v,
                            admin: {
                              ...v.admin,
                              keys: v.admin.keys.map((k) =>
                                k.id === revoke
                                  ? { ...k, status: "revoked" }
                                  : k,
                              ),
                            },
                          }));
                          setRevoke(null);
                          saveNotice();
                        }}
                      >
                        {p.revoke}
                      </button>
                      <button
                        className="button secondary-button"
                        onClick={() => setRevoke(null)}
                      >
                        {p.cancel}
                      </button>
                    </div>
                  </CrmDialog>
                )}
                {currentKey && (
                  <CrmDialog
                    title={p.testKey}
                    description={p.keyHint}
                    onClose={() => setTestKey(null)}
                  >
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        setResponse(
                          JSON.stringify(
                            sampleKeyResponse(
                              currentKey,
                              String(f.get("resource")) as
                                "activity" | "bookings",
                              c,
                            ),
                            null,
                            2,
                          ),
                        );
                      }}
                    >
                      <label className="product-field">
                        {p.requestResource}
                        <select name="resource" aria-label={p.requestResource}>
                          <option value="activity">{p.activityScope}</option>
                          <option value="bookings">{p.bookingsScope}</option>
                        </select>
                      </label>
                      <button className="button button-dark">
                        {p.runRequest}
                      </button>
                    </form>
                    {response && (
                      <pre
                        className="sample-response"
                        role="status"
                        aria-label={p.requestResult}
                      >
                        {response}
                      </pre>
                    )}
                  </CrmDialog>
                )}
                {summary && view && (
                  <CrmDialog
                    title={p.summaryTitle}
                    description={p.notificationNote}
                    onClose={() => setSummary(false)}
                  >
                    <div className="summary-preview">
                      <header>
                        <Bell size={23} />
                        <strong>{d.organization.name}</strong>
                        <small>{klDay()} · Asia/Kuala_Lumpur</small>
                      </header>
                      <dl>
                        <div>
                          <dt>{p.calls}</dt>
                          <dd>{view.inbound.length}</dd>
                        </div>
                        <div>
                          <dt>{p.bookings}</dt>
                          <dd>{view.confirmed}</dd>
                        </div>
                        <div>
                          <dt>{p.recovered}</dt>
                          <dd>{view.recovered}</dd>
                        </div>
                        <div>
                          <dt>{p.spend}</dt>
                          <dd>{money(view.spend)}</dd>
                        </div>
                        {d.admin.notifications.callbacks && (
                          <div>
                            <dt>{p.handoff}</dt>
                            <dd>
                              {view.alerts.find((a) => a.kind === "handoff")
                                ?.count ?? 0}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <button
                      className="button button-dark"
                      disabled={
                        !d.admin.notifications.enabled || !channelReady(d)
                      }
                      onClick={() => {
                        update((v) => ({
                          ...v,
                          admin: {
                            ...v.admin,
                            notifications: {
                              ...v.admin.notifications,
                              last_preview_at: new Date().toISOString(),
                            },
                          },
                        }));
                        setNotice(p.summaryDone);
                      }}
                    >
                      <CheckCircle size={17} />
                      {p.simulateSummary}
                    </button>
                    {(!d.admin.notifications.enabled || !channelReady(d)) && (
                      <p className="admin-note">
                        {p.summaryBlocked}{" "}
                        <a href={href("/app/whatsapp")}>
                          {t.services.whatsapp}
                        </a>
                      </p>
                    )}
                    <p className="crm-notice" role="status">
                      {notice}
                    </p>
                  </CrmDialog>
                )}
              </>
            ) : (
              <div className="skeleton" aria-busy="true" />
            )}
          </section>
        </div>
        <nav className="remaining-utility" aria-label={t.remaining.docs}>
          <a href={href("/app/hours")}>{t.remaining.branchHours}</a>
          <a href={href("/invite")}>{t.remaining.invite}</a>
          <a href={href("/login")}>{t.remaining.signedAs}</a>
          <a href={href("/admin")}>{t.remaining.platform}</a>
          <a href={href("/self-host")}>{t.remaining.selfhost}</a>
          <a href={href("/docs")}>{t.remaining.docs}</a>
        </nav>
      </main>
    </AppShell>
  );
}
