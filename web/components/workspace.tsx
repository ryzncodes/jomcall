"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  ArrowUpRight,
  PhoneIncoming,
  CalendarBlank,
  CheckCircle,
  Clock,
  Headphones,
  MagnifyingGlass,
  DownloadSimple,
  X,
  ShieldCheck,
  ChatCircleDots,
  CaretDown,
  ArrowBendUpRight,
} from "@phosphor-icons/react";
import { previewActivity, clock, money, duration } from "@/lib/api/client";
import type { Call, Contact, WorkspaceSnapshot } from "@/lib/api/types";
import { useExperience } from "./experience";
import { useProduct } from "./product/provider";
import { auditEntry, branchesFor } from "@/lib/api/admin";
import { useCrm } from "./product/crm-provider";
import { crmApi, klDay } from "@/lib/api/crm";
import { AppShell } from "./product/shell";
import { CallDemo, Wave } from "./call-demo";
export function Outcome({ value }: { value: Call["outcome"] }) {
  const { t } = useExperience();
  const Icon = [CheckCircle, Clock, ChatCircleDots, ArrowBendUpRight][value];
  return (
    <span className={`outcome outcome-${value}`}>
      <Icon size={13} weight={value === 1 ? "bold" : "regular"} />
      {t.outcomes[value]}
    </span>
  );
}
function Metrics({ calls }: { calls: Call[] }) {
  const { t } = useExperience();
  return (
    <div className="metrics">
      {[
        [t.remaining.callCount, calls.length],
        [t.booked, calls.filter((c) => c.outcome === 0).length],
        [t.attention, calls.filter((c) => c.outcome === 1).length],
        [t.spend, money(calls.reduce((n, c) => n + c.cost_sen, 0))],
      ].map(([label, value], i) => (
        <div key={label}>
          <span>{label}</span>
          <strong className={i === 2 ? "needs-action" : ""}>{value}</strong>
        </div>
      ))}
    </div>
  );
}
export function MiniWorkspace() {
  const { t, href } = useExperience();
  const data = previewActivity();
  return (
    <div className="mini-workspace">
      <aside>
        <div className="workspace-avatar">C</div>
        <strong>{t.workspace}</strong>
        <small>{t.sampleBranch}</small>
        <div className="mini-nav">
          <span className="active">
            <PhoneIncoming size={16} />
            {t.calls}
          </span>
          <span>
            <Headphones size={16} />
            {t.testAgent}
          </span>
        </div>
        <div className="mini-disclosure">
          <ShieldCheck size={17} />
          <small>
            {t.disclosure}
            <br />
            {t.enabled}
          </small>
        </div>
      </aside>
      <div className="mini-main">
        <div className="mini-top">
          <span>{t.activity}</span>
          <span>{t.today}</span>
        </div>
        <h3>{t.calls}</h3>
        <Metrics calls={data.calls} />
        <div className="mini-table-head">
          <span>{t.contact}</span>
          <span>{t.outcome}</span>
          <span>{t.duration}</span>
          <span>{t.cost}</span>
        </div>
        {data.calls.slice(0, 4).map((c) => (
          <a
            href={`${href("/app/calls")}&call=${c.id}`}
            className="mini-row"
            key={c.id}
          >
            <span>
              <strong>
                {data.contacts.find((p) => p.id === c.contact_id)?.name}
              </strong>
              <small>
                {clock(c.started_at)} · {c.language}
              </small>
            </span>
            <Outcome value={c.outcome} />
            <span className="mono">{duration(c.duration_seconds)}</span>
            <span className="mono">{money(c.cost_sen)}</span>
          </a>
        ))}
        <small className="sample-footnote">{t.fakeNote}</small>
      </div>
    </div>
  );
}
function CallDetail({
  call,
  contact,
  onContactChange,
}: {
  call: Call;
  contact: Contact;
  onContactChange: (contact: Contact) => void;
}) {
  const { t, href } = useExperience();
  const crm = useCrm();
  const { draft, update } = useProduct();
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [exported, setExported] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    setTab("summary");
    setExported(false);
    if (audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
    }
  }, [call.id]);
  const summary =
    call.direction === "outbound"
      ? t.remaining.callBody
      : [t.summaryA, t.summaryB, t.summaryC, t.summaryD][call.outcome];
  const exportContact = () => {
    const blob = new Blob(
      [
        crm.data
          ? crmApi.exportContact(crm.data, contact.id)
          : JSON.stringify({ sample: true, contact, call }, null, 2),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.exportName}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
    update((v) => ({
      ...v,
      admin: { ...v.admin, audit: [...v.admin.audit, auditEntry("export")] },
    }));
  };
  return (
    <div className="call-detail">
      <div className="detail-header">
        <div className="detail-avatar">
          <PhoneIncoming size={26} />
        </div>
        <Outcome value={call.outcome} />
        <h2>{contact.name}</h2>
        <a
          className="crm-text-button"
          href={href(`/app/contacts?contact=${contact.id}`)}
        >
          {t.crm.viewProfile}
        </a>
        <p>
          +60 12-xxx xxxx <span>{call.language}</span>
        </p>
        <div className="detail-facts">
          <span>
            {clock(call.started_at)}
            <small>{t.timezone}</small>
          </span>
          <span>
            {duration(call.duration_seconds)}
            <small>{t.duration}</small>
          </span>
          <span>
            {money(call.cost_sen)}
            <small>{t.cost}</small>
          </span>
        </div>
      </div>
      <div className="recording-preview">
        <h3>{t.remaining.recording}</h3>
        {call.recording_preview ? (
          <>
            <p>{t.remaining.toneHint}</p>
            <audio
              ref={audio}
              controls
              preload="none"
              aria-label={t.remaining.recording}
              src="/audio/sample-tone.wav"
            />
            <div className="sample-seek">
              {[0, 2, 4].map((second) => (
                <button
                  key={second}
                  onClick={() => {
                    if (audio.current) audio.current.currentTime = second;
                  }}
                  aria-label={`${t.remaining.seek} 0:0${second}`}
                >
                  0:0{second}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p>{t.remaining.noRecording}</p>
        )}
        <p>
          {t.remaining.callDirection}:{" "}
          {call.direction === "outbound"
            ? t.remaining.outgoing
            : t.remaining.inbound}
        </p>
        {call.transfer_result && (
          <p>
            {t.remaining.transfer}:{" "}
            {t.remaining.transferStates[call.transfer_result]}
          </p>
        )}
      </div>
      <div className="detail-tabs" role="tablist" aria-label={t.details}>
        <button
          id="summary-tab"
          role="tab"
          aria-selected={tab === "summary"}
          aria-controls="summary-panel"
          onClick={() => setTab("summary")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              setTab("transcript");
              document.getElementById("transcript-tab")?.focus();
            }
          }}
          tabIndex={tab === "summary" ? 0 : -1}
        >
          {t.summary}
        </button>
        <button
          id="transcript-tab"
          role="tab"
          aria-selected={tab === "transcript"}
          aria-controls="transcript-panel"
          onClick={() => setTab("transcript")}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              setTab("summary");
              document.getElementById("summary-tab")?.focus();
            }
          }}
          tabIndex={tab === "transcript" ? 0 : -1}
        >
          {t.transcript}
        </button>
      </div>
      <div
        role="tabpanel"
        id={tab === "summary" ? "summary-panel" : "transcript-panel"}
        aria-labelledby={tab === "summary" ? "summary-tab" : "transcript-tab"}
        className="detail-panel"
      >
        {tab === "summary" ? (
          <>
            <p>{summary}</p>
            {call.outcome === 0 && (
              <a
                className="detail-booking"
                href={href(`/app/bookings?contact=${contact.id}`)}
              >
                <CalendarBlank size={23} />
                <div>
                  <strong>{t.crm.viewBookings}</strong>
                  <small>{contact.name}</small>
                </div>
                <ArrowUpRight size={17} />
              </a>
            )}
          </>
        ) : (
          <div className="detail-transcript">
            <small>{t.sampleNotice}</small>
            <p>
              <b>{t.agent}</b>
              {t.turn0}
            </p>
            <p>
              <b>{t.caller}</b>
              {call.outcome === 0 ? t.turn1 : summary}
            </p>
            {call.outcome === 0 && (
              <>
                <span className="tool-inline">
                  <CheckCircle size={14} />
                  {t.toolCheck}
                </span>
                <p>
                  <b>{t.agent}</b>
                  {t.turn5}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      <div className="compliance">
        <h3>
          <ShieldCheck size={17} />
          {t.privacy}
        </h3>
        <dl>
          <div>
            <dt>{t.disclosure}</dt>
            <dd>{t.enabled}</dd>
          </div>
          <div>
            <dt>{t.consent}</dt>
            <dd>{t.consentValue}</dd>
          </div>
        </dl>
        <label className="dnc-control">
          <span>{t.dnc}</span>
          <input
            type="checkbox"
            checked={contact.do_not_contact}
            onChange={(e) =>
              onContactChange({ ...contact, do_not_contact: e.target.checked })
            }
          />
        </label>
        {contact.do_not_contact && <p className="dnc-hint">{t.dncHint}</p>}
        <button className="export-button" onClick={exportContact}>
          <DownloadSimple size={16} />
          {t.export}
        </button>
        {exported && (
          <p className="download-status" role="status">
            {t.downloadStatus}
          </p>
        )}
      </div>
      <p className="detail-retention">
        <ShieldCheck size={16} />
        {t.admin.recordingPolicy}: {draft?.admin.retention_days} {t.admin.days}.{" "}
        {t.admin.retentionHint}{" "}
        <a href={href("/app/settings?section=privacy")}>{t.admin.settings}</a>
      </p>
      <small className="detail-version">
        {t.remaining.version}{" "}
        {draft?.revisions.find((r) => r.id === call.agent_version_id)?.number ??
          (call.agent_version_id === "sample-version-1"
            ? 1
            : call.agent_version_id)}{" "}
        · {t.sampleBadge}
      </small>
    </div>
  );
}
export function Workspace() {
  const { t, href } = useExperience();
  const { draft } = useProduct();
  const [language, setLanguage] = useState("all"),
    [day, setDay] = useState(""),
    [branch, setBranch] = useState("all"),
    [line, setLine] = useState("all");
  const crm = useCrm();
  const data = useMemo<WorkspaceSnapshot | null>(
    () =>
      crm.data
        ? {
            organization: { id: "sample-org", name: t.workspace },
            contacts: crm.data.contacts,
            calls: crm.data.calls,
          }
        : null,
    [crm.data, t.workspace],
  );
  const [selected, setSelected] = useState<string>("sample-call-0");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [mobileDetail, setMobileDetail] = useState(false);
  const [wide, setWide] = useState(true);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("call");
    if (id) {
      setSelected(id);
      setMobileDetail(matchMedia("(max-width:1179px)").matches);
    }
  }, []);
  useEffect(() => {
    const m = matchMedia("(min-width: 1180px)");
    const update = () => setWide(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  const calls = useMemo(
    () =>
      data?.calls.filter((c) => {
        const p = data.contacts.find((p) => p.id === c.contact_id)!;
        return (
          (filter === "all" ||
            (filter === "attention" && c.outcome === 1) ||
            (filter === "booked" && c.outcome === 0) ||
            String(c.outcome) === filter) &&
          (language === "all" || c.language === language) &&
          (!day || klDay(new Date(c.started_at)) === day) &&
          (branch === "all" || (c.location_id ?? "unknown") === branch) &&
          (line === "all" || (c.phone_line_id ?? "unknown") === line) &&
          `${p.name} ${t.outcomes[c.outcome]}`
            .toLowerCase()
            .includes(search.toLowerCase())
        );
      }) ?? [],
    [data, filter, search, t, language, day, branch, line],
  );
  useEffect(() => {
    if (data && !calls.some((c) => c.id === selected))
      setSelected(calls[0]?.id ?? "");
  }, [calls, selected, data]);
  const call = data?.calls.find((c) => c.id === selected);
  const contact = data?.contacts.find((p) => p.id === call?.contact_id);
  const onContactChange = (changed: Contact) =>
    crm.setData((d) =>
      d
        ? {
            ...d,
            contacts: d.contacts.map((c) =>
              c.id === changed.id
                ? { ...c, do_not_contact: changed.do_not_contact }
                : c,
            ),
          }
        : d,
    );
  const detail =
    call && contact ? (
      <CallDetail
        call={call}
        contact={contact}
        onContactChange={onContactChange}
      />
    ) : null;
  return (
    <AppShell active="calls">
      <main tabIndex={-1} id="workspace-content" className="workspace-main">
        <div className="workspace-title">
          <div>
            <p className="eyebrow">
              {t.calls} · {t.timezone}
            </p>
            <h1>{t.appHeading}</h1>
            <p>{t.appIntro}</p>
          </div>
          <a className="button button-dark" href={href("/app/test")}>
            <PlayIcon />
            {t.testAgent}
          </a>
        </div>
        <>
          {data ? (
            <Metrics calls={data.calls} />
          ) : (
            <div className="skeleton" aria-busy="true" />
          )}
          <div className="call-workbench">
            <section className="call-list" aria-label={t.calls}>
              <div className="call-list-heading">
                <h2>{t.calls}</h2>
                <span>
                  {calls.length} {t.filterCount}
                </span>
              </div>
              <div className="call-filters">
                <label>
                  <MagnifyingGlass size={18} />
                  <span className="sr-only">{t.search}</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t.search}
                  />
                </label>
                <select
                  aria-label={t.filterLabel}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">{t.all}</option>
                  <option value="attention">{t.filterAttention}</option>
                  <option value="booked">{t.filterBookings}</option>
                  <option value="2">{t.outcomes[2]}</option>
                  <option value="3">{t.outcomes[3]}</option>
                </select>
              </div>
              <div className="call-extra-filters">
                <label>
                  {t.remaining.callLanguage}
                  <select
                    aria-label={t.remaining.callLanguage}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="all">{t.remaining.allLanguages}</option>
                    {[...new Set(data?.calls.map((c) => c.language) ?? [])].map(
                      (l) => (
                        <option key={l}>{l}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  {t.remaining.callDay}
                  <input
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </label>
                <label>
                  {t.admin.branches}
                  <select
                    aria-label={t.admin.branches}
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  >
                    <option value="all">{t.remaining.allBranches}</option>
                    {draft &&
                      branchesFor(draft).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    <option value="unknown">{t.remaining.unknownBranch}</option>
                  </select>
                </label>
                <label>
                  {t.services.phones}
                  <select
                    aria-label={t.services.phones}
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                  >
                    <option value="all">{t.remaining.allLines}</option>
                    <option value="sample-line">
                      {t.remaining.sampleLine}
                    </option>
                    <option value="unknown">{t.remaining.unknownLine}</option>
                  </select>
                </label>
                <button
                  className="text-link"
                  onClick={() => {
                    setLanguage("all");
                    setDay("");
                    setBranch("all");
                    setLine("all");
                    setFilter("all");
                    setSearch("");
                  }}
                >
                  {t.remaining.clearFilters}
                </button>
              </div>
              <div className="call-list-labels" aria-hidden="true">
                <span>{t.contact}</span>
                <span>{t.outcome}</span>
                <span>{t.cost}</span>
              </div>
              {calls.map((c) => (
                <button
                  className={`activity-row ${selected === c.id ? "selected" : ""}`}
                  key={c.id}
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    setSelected(c.id);
                    if (!wide) setMobileDetail(true);
                  }}
                  aria-pressed={selected === c.id}
                >
                  <span className="row-contact">
                    <span className="row-avatar">
                      <PhoneIncoming size={17} />
                    </span>
                    <span>
                      <strong>
                        {
                          data?.contacts.find((p) => p.id === c.contact_id)
                            ?.name
                        }
                      </strong>
                      <small>
                        {clock(c.started_at)}
                        <span className="row-language">{c.language}</span>
                        {duration(c.duration_seconds)}
                      </small>
                    </span>
                  </span>
                  <Outcome value={c.outcome} />
                  <span className="row-cost">
                    {money(c.cost_sen)}
                    <ArrowUpRight size={15} />
                  </span>
                </button>
              ))}
              {data && calls.length === 0 && (
                <div className="empty-state" role="status">
                  <MagnifyingGlass size={30} />
                  <p>{t.empty}</p>
                </div>
              )}
              <p className="list-footnote">{t.fakeNote}</p>
            </section>
            {wide && (
              <aside className="detail-aside" aria-label={t.details}>
                {detail}
              </aside>
            )}
          </div>
        </>
      </main>
      <Dialog.Root open={!wide && mobileDetail} onOpenChange={setMobileDetail}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="mobile-detail-dialog"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              (
                returnFocus.current ??
                document.querySelector<HTMLButtonElement>(
                  ".activity-row.selected",
                )
              )?.focus();
            }}
          >
            <Dialog.Title className="sr-only">{t.details}</Dialog.Title>
            <Dialog.Description className="sr-only">
              {t.appSample}
            </Dialog.Description>
            <Dialog.Close className="dialog-close" aria-label={t.close}>
              <X size={22} />
            </Dialog.Close>
            {!wide && detail}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </AppShell>
  );
}
function PlayIcon() {
  return <Headphones size={17} />;
}
