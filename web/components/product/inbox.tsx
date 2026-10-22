"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Checks,
  ChatCircleDots,
  Headphones,
  MagnifyingGlass,
  NotePencil,
  Phone,
  ShieldCheck,
  Sparkle,
  UserCircle,
  WhatsappLogo,
  X,
  DownloadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { resolveRun } from "@/lib/api/outbound";
import { channelReady } from "@/lib/api/service";
import { useCrm } from "./crm-provider";
import { crmApi } from "@/lib/api/crm";
import { AppShell } from "./shell";
import { useProduct } from "./provider";
import { productApi } from "@/lib/api/product";
import { useExperience } from "../experience";
import {
  inboxApi,
  makeEvent,
  replyWindowOpen,
  type InboxContact,
  type Delivery,
  type InboxEvent,
} from "@/lib/api/inbox";
export function Inbox() {
  const { t, locale, href } = useExperience(),
    p = t.inbox;
  const { draft } = useProduct();
  const available = channelReady(draft);
  const [templateId, setTemplateId] = useState("");
  const approved =
    draft?.services.templates.filter((x) => x.status === "approved") ?? [];
  const chosenTemplate =
    approved.find((x) => x.id === templateId) ?? approved[0];
  const templateAllowed = (event?: InboxEvent) =>
    !!chosenTemplate &&
    (!event ||
      approved.some(
        (x) =>
          (event.template_id ? x.id === event.template_id : true) &&
          x.body === event.body,
      ));
  const { data, setData, saved } = useCrm();
  const [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(0),
    [details, setDetails] = useState(false),
    [mode, setMode] = useState<"reply" | "note">("reply"),
    [input, setInput] = useState(""),
    [outcome, setOutcome] = useState<Delivery>("delivered"),
    [pending, setPending] = useState(false),
    [calling, setCalling] = useState(false);
  const latest = useRef(data),
    active = useRef(true),
    title = useRef<HTMLHeadingElement>(null),
    list = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    contactHeading = useRef<HTMLHeadingElement>(null);
  latest.current = data;
  const latestChannel = useRef(available);
  latestChannel.current = available;
  useEffect(() => {
    active.current = true;
    setSelected(new URLSearchParams(location.search).get("contact"));
    return () => {
      active.current = false;
    };
  }, [locale]);
  const mutate = (id: string, fn: (c: InboxContact) => InboxContact) =>
    setData((d) =>
      d
        ? { ...d, contacts: d.contacts.map((c) => (c.id === id ? fn(c) : c)) }
        : d,
    );
  const contact = data?.contacts.find((c) => c.id === selected);
  const contacts =
    data?.contacts.filter(
      (c) =>
        (filter === 0 ||
          (filter === 1 && c.status === "waiting") ||
          (filter === 2 && c.owner === "ai" && c.status !== "resolved") ||
          (filter === 3 && c.status === "resolved")) &&
        `${c.name} ${c.events.map((e) => e.body).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const choose = (id: string) => {
    setSelected(id);
    setDetails(false);
    setInput("");
    setMode("reply");
    setTimeout(() => title.current?.focus(), 0);
  };
  const addSystem = (id: string, body: string, patch: Partial<InboxContact>) =>
    mutate(id, (c) => ({
      ...c,
      ...patch,
      events: [...c.events, makeEvent("system", "system", body)],
    }));
  const send = async (template = false, retry?: InboxEvent) => {
    if (!contact || pending) return;
    if (mode === "note" && !template && !retry) {
      if (!input.trim()) return;
      mutate(contact.id, (c) => ({
        ...c,
        events: [...c.events, makeEvent("note", "team", input.trim())],
      }));
      setInput("");
      return;
    }
    const current = latest.current?.contacts.find((c) => c.id === contact.id);
    if (
      !available ||
      !current ||
      ((template || retry?.template) && !templateAllowed(retry)) ||
      !inboxApi.canSend(current, template || retry?.template)
    )
      return;
    const body =
      retry?.body ?? (template ? chosenTemplate?.body : input.trim());
    if (!body) return;
    const id = contact.id,
      event = retry
        ? { ...retry, delivery: "sending" as const }
        : makeEvent("message", "team", body, {
            delivery: "sending",
            template,
            template_id: template ? chosenTemplate?.id : undefined,
          });
    mutate(id, (c) => ({
      ...c,
      status: "open",
      events: retry
        ? c.events.map((e) => (e.id === retry.id ? event : e))
        : [...c.events, event],
    }));
    setPending(true);
    if (!retry && !template) setInput("");
    const result = await inboxApi.settle(outcome);
    if (!active.current) return;
    // Local demonstration of provider acknowledgement. Unknown delivery is never auto-retried.
    mutate(id, (c) => ({
      ...c,
      events: c.events.map((e) =>
        e.id === event.id ? { ...e, delivery: result } : e,
      ),
    }));
    setPending(false);
    setOutcome("delivered");
  };
  const checkDelivery = async (event: InboxEvent) => {
    if (!contact || pending) return;
    const id = contact.id;
    setPending(true);
    await inboxApi.settle("delivered");
    if (!active.current) return;
    setData((current) => {
      if (!current) return current;
      const run = current.outbound.runs.find(
        (r) => r.event_id === event.id && r.state === "review",
      );
      if (run && draft)
        return resolveRun(
          current,
          run.id,
          true,
          new Date().toISOString(),
          draft,
        );
      return {
        ...current,
        contacts: current.contacts.map((c) =>
          c.id === id
            ? {
                ...c,
                events: c.events.map((e) =>
                  e.id === event.id ? { ...e, delivery: "delivered" } : e,
                ),
              }
            : c,
        ),
      };
    });
    setPending(false);
  };
  const call = async (whatsapp: boolean) => {
    if (
      !contact ||
      calling ||
      contact.do_not_contact ||
      contact.owner !== "staff" ||
      contact.status === "resolved" ||
      (whatsapp && (!available || contact.call_permission !== "granted")) ||
      (!whatsapp && !draft?.phone_line.reserved)
    )
      return;
    const id = contact.id;
    setCalling(true);
    await inboxApi.settle("delivered");
    if (!active.current) return;
    mutate(id, (c) => ({
      ...c,
      events: [
        ...c.events,
        makeEvent(whatsapp ? "whatsapp-call" : "phone", "system", p.callDone),
      ],
    }));
    setCalling(false);
  };
  const time = (at: string) =>
    new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kuala_Lumpur",
    }).format(new Date(at));
  const eventIcon = (kind: InboxEvent["kind"]) =>
    kind === "phone" ? (
      <Phone size={18} />
    ) : kind === "whatsapp-call" ? (
      <Headphones size={18} />
    ) : kind === "note" ? (
      <NotePencil size={16} />
    ) : (
      <Check size={16} />
    );
  const noReply = !available || !contact || !inboxApi.canSend(contact),
    open = contact && replyWindowOpen(contact);
  return (
    <AppShell active="inbox">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main inbox-main"
      >
        <header className="product-page-heading">
          <div>
            <p className="eyebrow">{p.nav}</p>
            <h1>{p.title}</h1>
            <p>{p.intro}</p>
          </div>
          <div className="inbox-count">
            <strong>
              {data?.contacts.filter((c) => c.status === "waiting").length ?? 0}
            </strong>
            <span>{p.needsCount}</span>
          </div>
        </header>
        {!saved && (
          <p role="alert" className="storage-warning">
            {p.storageError}
          </p>
        )}
        <div
          className={`inbox-layout ${contact ? "has-conversation" : ""} ${details ? "show-contact" : ""}`}
        >
          <section
            className="conversation-list"
            aria-label={p.back}
            ref={list}
            tabIndex={-1}
          >
            <label className="inbox-search">
              <MagnifyingGlass size={18} />
              <input
                value={search}
                placeholder={p.search}
                aria-label={p.search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
              />
            </label>
            <div className="inbox-filters" aria-label={p.nav}>
              {p.filters.map((f, i) => (
                <button
                  aria-pressed={filter === i}
                  key={f}
                  onClick={() => {
                    setFilter(i);
                    setSelected(null);
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            {!data ? (
              <p className="inbox-empty" role="status">
                {t.product.loading}
              </p>
            ) : !contacts.length ? (
              <p className="inbox-empty">{p.empty}</p>
            ) : (
              contacts.map((c) => (
                <button
                  key={c.id}
                  className={`conversation-row ${c.id === selected ? "selected" : ""}`}
                  onClick={() => choose(c.id)}
                  aria-current={selected === c.id ? "true" : undefined}
                >
                  <span className="contact-avatar">
                    {c.name.split(" ")[0][0]}
                  </span>
                  <span>
                    <strong>
                      {c.name}
                      <time>{time(c.events.at(-1)!.at)}</time>
                    </strong>
                    <span className="conversation-preview">
                      {c.events.at(-1)?.body}
                    </span>
                    <span
                      className={`owner-tag ${c.status === "waiting" ? "needs-team" : ""}`}
                    >
                      {c.status === "resolved"
                        ? p.resolved
                        : c.status === "waiting"
                          ? p.waiting
                          : c.owner === "ai"
                            ? p.ai
                            : p.staff}
                    </span>
                  </span>
                </button>
              ))
            )}
            <footer>
              <ShieldCheck size={15} />
              <span>{p.mock}</span>
            </footer>
          </section>
          {contact ? (
            <section className="conversation-detail" aria-label={p.timeline}>
              <header className="conversation-header">
                <button
                  className="icon-button inbox-back"
                  aria-label={p.back}
                  onClick={() => {
                    setSelected(null);
                    setTimeout(() => list.current?.focus(), 0);
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="contact-avatar">{contact.name[0]}</div>
                <div>
                  <h2 tabIndex={-1} ref={title}>
                    {contact.name}
                  </h2>
                  <span>
                    <WhatsappLogo size={14} />
                    {p.noNumber}
                  </span>
                </div>
                <button
                  className="icon-button contact-toggle"
                  aria-label={details ? p.closeContact : p.contact}
                  aria-expanded={details}
                  onClick={() => {
                    setDetails(!details);
                    setTimeout(() => contactHeading.current?.focus(), 0);
                  }}
                >
                  <UserCircle size={25} />
                </button>
              </header>
              <div className="ownership-bar">
                <span
                  className={
                    contact.status === "waiting" ? "attention-text" : ""
                  }
                >
                  {contact.status === "resolved"
                    ? p.resolved
                    : contact.owner === "ai"
                      ? p.ai
                      : p.staff}
                </span>
                <div>
                  {contact.status === "resolved" ? (
                    <button
                      onClick={() =>
                        addSystem(contact.id, p.reopenedEvent, {
                          status: "waiting",
                          owner: "staff",
                        })
                      }
                    >
                      {p.reopen}
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={pending || calling}
                        onClick={() =>
                          addSystem(
                            contact.id,
                            contact.owner === "ai"
                              ? p.takeoverEvent
                              : p.returnEvent,
                            {
                              owner: contact.owner === "ai" ? "staff" : "ai",
                              status: "open",
                            },
                          )
                        }
                      >
                        {contact.owner === "ai" ? p.takeover : p.returnAI}
                      </button>
                      <button
                        disabled={pending || calling}
                        onClick={() =>
                          addSystem(contact.id, p.resolvedEvent, {
                            status: "resolved",
                          })
                        }
                      >
                        {p.resolve}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div
                className="message-timeline"
                tabIndex={0}
                role="log"
                aria-label={p.timeline}
                aria-live="polite"
              >
                <p className="timeline-date">{p.time}</p>
                {contact.events.map((e) => (
                  <article
                    key={e.id}
                    className={`timeline-event event-${e.kind} author-${e.author}`}
                  >
                    {["system", "phone", "whatsapp-call"].includes(e.kind) ? (
                      <>
                        {eventIcon(e.kind)}
                        <div>
                          {e.kind !== "system" && (
                            <strong>
                              {e.kind === "phone" ? p.phone : p.whatsappCall}
                            </strong>
                          )}
                          <p>{e.body}</p>
                          <time>{time(e.at)}</time>
                        </div>
                      </>
                    ) : (
                      <>
                        <header>
                          {e.kind === "note" ? <NotePencil size={14} /> : null}
                          <span>
                            {e.kind === "note" ? p.note : p[e.author]}
                          </span>
                          <time>{time(e.at)}</time>
                        </header>
                        <p>{e.body}</p>
                        {e.template && <small>{p.template}</small>}
                      </>
                    )}
                    {e.delivery && (
                      <div className={`delivery delivery-${e.delivery}`}>
                        {e.delivery === "delivered" ? (
                          <Checks size={15} />
                        ) : e.delivery === "failed" ||
                          e.delivery === "unknown" ? (
                          <WarningCircle size={15} />
                        ) : (
                          <Check size={15} />
                        )}
                        <span>
                          {e.delivery === "sending" ? p.sending : p[e.delivery]}
                        </span>
                        {e.delivery === "failed" &&
                          e.id.startsWith("workflow-") && (
                            <a
                              className="crm-text-button"
                              href={href("/app/outbound")}
                            >
                              {t.remaining.outbound}
                            </a>
                          )}
                        {e.delivery === "failed" &&
                          !e.id.startsWith("workflow-") && (
                            <button
                              disabled={
                                pending ||
                                !available ||
                                (e.template && !templateAllowed(e)) ||
                                !inboxApi.canSend(contact, !!e.template)
                              }
                              onClick={() => send(!!e.template, e)}
                            >
                              {p.retry}
                            </button>
                          )}
                        {e.delivery === "unknown" && (
                          <button
                            disabled={pending}
                            onClick={() => checkDelivery(e)}
                          >
                            {p.check}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div className="inbox-composer">
                <div className="composer-modes">
                  <button
                    aria-pressed={mode === "reply"}
                    onClick={() => setMode("reply")}
                  >
                    <ChatCircleDots size={16} />
                    {p.reply}
                  </button>
                  <button
                    aria-pressed={mode === "note"}
                    onClick={() => setMode("note")}
                  >
                    <NotePencil size={16} />
                    {p.note}
                  </button>
                  <span className={!open ? "window-closed" : ""}>
                    {open ? p.windowOpen : p.windowClosed}
                  </span>
                </div>
                {mode === "reply" && (
                  <p className="composer-context">
                    {!available
                      ? t.services.channelBlocked
                      : contact.do_not_contact
                        ? p.blocked
                        : contact.events.some((e) => e.delivery === "unknown")
                          ? p.unknownNote
                          : contact.owner === "ai"
                            ? p.aiNote
                            : contact.status === "resolved"
                              ? p.resolved
                              : !open
                                ? p.windowNote
                                : p.handoffNote}
                  </p>
                )}
                {mode === "reply" && !open ? (
                  <div className="template-composer">
                    {approved.length > 0 ? (
                      <>
                        <label className="product-field">
                          {t.services.selectTemplate}
                          <select
                            aria-label={t.services.selectTemplate}
                            value={chosenTemplate?.id}
                            onChange={(e) => setTemplateId(e.target.value)}
                          >
                            {approved.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name} · {x.language.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p>{chosenTemplate?.body}</p>
                      </>
                    ) : (
                      <p>{t.services.noApproved}</p>
                    )}
                    <a className="crm-text-button" href={href("/app/whatsapp")}>
                      {t.services.whatsapp}
                    </a>
                    {!contact.opt_in && <small>{p.noOptIn}</small>}
                    <button
                      className="button button-dark"
                      disabled={
                        pending ||
                        !available ||
                        !templateAllowed() ||
                        !inboxApi.canSend(contact, true)
                      }
                      onClick={() => send(true)}
                    >
                      {p.sendTemplate}
                      <ArrowUp size={17} />
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                  >
                    <textarea
                      ref={composer}
                      rows={3}
                      maxLength={4000}
                      value={input}
                      disabled={pending || (mode === "reply" && noReply)}
                      aria-label={mode === "reply" ? p.compose : p.composeNote}
                      placeholder={mode === "reply" ? p.compose : p.composeNote}
                      onChange={(e) => setInput(e.target.value)}
                    />
                    <div>
                      {mode === "reply" && (
                        <button
                          type="button"
                          className="draft-reply"
                          disabled={noReply || pending}
                          onClick={() => {
                            setInput(p.suggestedReply);
                            composer.current?.focus();
                          }}
                        >
                          <Sparkle size={16} />
                          {p.draftReply}
                        </button>
                      )}
                      <button
                        className="button button-dark composer-send"
                        disabled={
                          !input.trim() ||
                          pending ||
                          (mode === "reply" && noReply)
                        }
                        type="submit"
                      >
                        {mode === "note" ? p.addNote : p.send}
                        <ArrowUp size={16} />
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>
          ) : (
            <section className="inbox-placeholder">
              <div>
                <ChatCircleDots size={45} />
                <h2>{p.choose}</h2>
                <p>{p.chooseHint}</p>
              </div>
            </section>
          )}
          {contact && (
            <aside className="contact-panel" aria-label={p.contact}>
              <header>
                <h2 ref={contactHeading} tabIndex={-1}>
                  {p.contact}
                </h2>
                <button
                  className="icon-button"
                  aria-label={p.closeContact}
                  onClick={() => {
                    setDetails(false);
                    setTimeout(() => title.current?.focus(), 0);
                  }}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="contact-profile">
                <span className="contact-avatar">{contact.name[0]}</span>
                <strong>{contact.name}</strong>
                <a
                  className="crm-text-button"
                  href={href(`/app/contacts?contact=${contact.id}`)}
                >
                  {t.crm.viewProfile}
                </a>
                <span>+60 1x-xxx xxxx</span>
              </div>
              <label className="contact-field">
                {p.stage}
                <select
                  value={contact.stage}
                  onChange={(e) =>
                    mutate(contact.id, (c) => ({
                      ...c,
                      stage: Number(e.target.value),
                    }))
                  }
                >
                  {p.stages.map((s, i) => (
                    <option value={i} key={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <dl>
                <dt>{p.language}</dt>
                <dd>
                  {
                    t.product.languageNames[
                      contact.language as keyof typeof t.product.languageNames
                    ]
                  }
                </dd>
                <dt>{p.source}</dt>
                <dd>{p.sourceValue}</dd>
              </dl>
              <section className="contact-section">
                <h3>
                  <ShieldCheck size={18} />
                  {p.consent}
                </h3>
                <p>{contact.opt_in ? p.optIn : p.noOptIn}</p>
                <label className="product-check">
                  <input
                    type="checkbox"
                    checked={contact.do_not_contact}
                    disabled={pending || calling}
                    onChange={(e) =>
                      mutate(contact.id, (c) => ({
                        ...c,
                        do_not_contact: e.target.checked,
                      }))
                    }
                  />
                  {p.dnc}
                </label>
                <button
                  className="contact-export"
                  onClick={() => {
                    const blob = new Blob(
                        [crmApi.exportContact(data!, contact.id)],
                        {
                          type: "application/json",
                        },
                      ),
                      url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = "sample-contact.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <DownloadSimple size={16} />
                  {p.export}
                </button>
              </section>
              <section className="contact-section">
                <h3>{p.permission}</h3>
                <span className="permission-status">
                  {p.permissions[contact.call_permission]}
                </span>
                <p>{p.permissionNote}</p>
                <button
                  className="button secondary-button"
                  disabled={
                    contact.do_not_contact ||
                    !available ||
                    !contact.opt_in ||
                    !open ||
                    contact.owner !== "staff" ||
                    contact.status === "resolved" ||
                    ["requested", "granted"].includes(
                      contact.call_permission,
                    ) ||
                    pending ||
                    calling
                  }
                  onClick={() =>
                    addSystem(contact.id, p.permissionEvent, {
                      call_permission: "requested",
                    })
                  }
                >
                  {p.requestPermission}
                </button>
                <button
                  className="button secondary-button"
                  disabled={
                    calling ||
                    pending ||
                    contact.do_not_contact ||
                    !available ||
                    contact.call_permission !== "granted" ||
                    contact.owner !== "staff" ||
                    contact.status === "resolved"
                  }
                  onClick={() => call(true)}
                >
                  <WhatsappLogo size={18} />
                  {p.waCall}
                </button>
                <button
                  className="button secondary-button"
                  disabled={
                    calling ||
                    pending ||
                    !draft?.phone_line.reserved ||
                    contact.do_not_contact ||
                    contact.owner !== "staff" ||
                    contact.status === "resolved"
                  }
                  onClick={() => call(false)}
                >
                  <Phone size={18} />
                  {p.phoneCall}
                </button>
                {!available && (
                  <p className="service-note">
                    <a href={href("/app/whatsapp")}>
                      {t.services.channelBlocked}
                    </a>
                  </p>
                )}
                {!draft?.phone_line.reserved && (
                  <p className="service-note">
                    <a href={href("/app/phone-numbers")}>
                      {t.services.phoneRequired}
                    </a>
                  </p>
                )}
                {calling && <p role="status">{p.callInProgress}</p>}
              </section>
              <details className="recovery-controls">
                <summary>{p.recovery}</summary>
                <label className="contact-field">
                  {p.nextOutcome}
                  <select
                    disabled={pending}
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value as Delivery)}
                  >
                    {Object.entries(p.outcomes).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={pending || calling || !available}
                  onClick={async () => {
                    const id = contact.id;
                    mutate(id, (c) => ({
                      ...c,
                      last_inbound_at: new Date().toISOString(),
                      status: c.owner === "staff" ? "waiting" : "open",
                      events: [
                        ...c.events,
                        makeEvent("message", "customer", p.incomingText),
                      ],
                    }));
                    if (contact.owner === "ai" && draft) {
                      const replies = await productApi.reply(
                        draft,
                        locale,
                        p.incomingText,
                      );
                      if (active.current)
                        mutate(id, (c) =>
                          !latestChannel.current ||
                          c.owner !== "ai" ||
                          c.status === "resolved" ||
                          c.do_not_contact
                            ? c
                            : {
                                ...c,
                                events: [
                                  ...c.events,
                                  ...replies
                                    .filter((r) => r.role === "agent")
                                    .map((r) =>
                                      makeEvent("message", "aiSender", r.text),
                                    ),
                                ],
                              },
                        );
                    }
                  }}
                >
                  {p.incoming}
                </button>
                <button
                  disabled={contact.call_permission !== "requested"}
                  onClick={() =>
                    addSystem(contact.id, p.grantEvent, {
                      call_permission: "granted",
                    })
                  }
                >
                  {p.grant}
                </button>
              </details>
            </aside>
          )}
        </div>
        <p className="inbox-save-state" role="status">
          {saved ? p.saved : p.storageError}
        </p>
      </main>
    </AppShell>
  );
}
