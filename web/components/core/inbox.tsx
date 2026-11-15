"use client";
import { HOSTED } from "@/lib/hosted";
// The shared WhatsApp inbox for the local and hosted app. Every record comes
// from the inbox commands; on an error the screen says so and offers a retry,
// never sample data. The send rules live on the server: the screen shows the
// server's outlook before a reply and the agent process's decision after it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChatCircleDots } from "@phosphor-icons/react";
import { CoreError } from "@/lib/core/client";
import type {
  ChatMessage,
  ConversationDetail,
  ConversationSummary,
  ReplyOutlook,
} from "../../../packages/contracts/src/whatsapp";
import { useExperience } from "../experience";
import {
  useCore,
  useWords,
  useResource,
  useAction,
  Heading,
  Notice,
  Loading,
} from "./state";

type Pair = [string, string];
const zone = "Asia/Kuala_Lumpur";

// Why a conversation waits for staff. Codes come from the agent process.
const attentionWords: Record<string, Pair> = {
  HANDOFF_REQUESTED: ["Customer asked for staff", "Pelanggan minta staf"],
  CUSTOMER_REPLIED: ["Customer replied", "Pelanggan membalas"],
  BOOKING_PROPOSED: ["Agent proposed a booking", "Ejen mencadangkan tempahan"],
  MESSAGE_LEFT: ["Customer left a message", "Pelanggan meninggalkan mesej"],
  OPTED_OUT: ["Customer opted out", "Pelanggan menarik diri"],
  UNSUPPORTED_MESSAGE: [
    "Sent something the agent cannot read",
    "Menghantar sesuatu yang ejen tidak boleh baca",
  ],
  AGENT_FAILED: ["Agent could not answer", "Ejen tidak dapat menjawab"],
  AGENT_NOT_PUBLISHED: [
    "Agent not published, no reply sent",
    "Ejen belum diterbitkan, tiada balasan dihantar",
  ],
  SEND_BLOCKED: ["A message was not sent", "Satu mesej tidak dihantar"],
  SEND_FAILED: ["A message failed", "Satu mesej gagal"],
  SEND_UNKNOWN: [
    "Delivery unknown, check before resending",
    "Penghantaran tidak pasti, semak sebelum menghantar semula",
  ],
};

const statusWords: Record<string, Pair> = {
  received: ["Received", "Diterima"],
  queued: ["Waiting to send", "Menunggu dihantar"],
  sending: ["Sending", "Sedang dihantar"],
  sent: ["Sent", "Dihantar"],
  delivered: ["Delivered", "Sampai"],
  read: ["Read", "Dibaca"],
  failed: ["Failed", "Gagal"],
  blocked: ["Not sent", "Tidak dihantar"],
  unknown: [
    "Unknown, check before resending",
    "Tidak pasti, semak sebelum menghantar semula",
  ],
};

// Why the agent process did not send a message, in plain words.
const refusalWords: Record<string, Pair> = {
  DO_NOT_CONTACT: [
    "This contact is marked do-not-contact, so nothing is sent to them.",
    "Kenalan ini bertanda jangan-hubungi, jadi tiada apa-apa dihantar kepadanya.",
  ],
  OPTED_OUT: [
    "The customer opted out on WhatsApp, so nothing more is sent.",
    "Pelanggan telah menarik diri di WhatsApp, jadi tiada mesej lagi dihantar.",
  ],
  WINDOW_CLOSED: [
    "More than 24 hours since the customer last wrote, and there is no approved reply-request template to send instead.",
    "Lebih 24 jam sejak pelanggan kali terakhir menulis, dan tiada templat minta-balas yang diluluskan untuk dihantar.",
  ],
  CONSENT_REQUIRED: [
    "A template needs the customer's recorded consent, and none is recorded.",
    "Templat memerlukan persetujuan pelanggan yang direkodkan, dan tiada yang direkodkan.",
  ],
  CHANNEL_NOT_CONNECTED: [
    "WhatsApp was not connected when this was due to send.",
    "WhatsApp tidak disambungkan semasa mesej ini sepatutnya dihantar.",
  ],
  CONTACT_UNAVAILABLE: [
    "This contact is being deleted.",
    "Kenalan ini sedang dipadam.",
  ],
  TEMPLATE_NOT_APPROVED: [
    "The template is not approved.",
    "Templat belum diluluskan.",
  ],
};

const noticeWords: Record<string, Pair> = {
  notice_opt_out: [
    "Customer said STOP. Opt-out recorded; this confirmation is the last message.",
    "Pelanggan menaip STOP. Penolakan direkodkan; pengesahan ini mesej terakhir.",
  ],
  notice_handoff: [
    "Customer asked for staff. The agent stopped answering.",
    "Pelanggan minta staf. Ejen berhenti menjawab.",
  ],
  notice_unsupported: [
    "Customer sent something other than text.",
    "Pelanggan menghantar sesuatu selain teks.",
  ],
};

const authorWords: Record<ChatMessage["author"], Pair> = {
  customer: ["Customer", "Pelanggan"],
  agent: ["Agent", "Ejen"],
  staff: ["Staff", "Staf"],
  system: ["Automatic notice", "Notis automatik"],
};

// What the send rules say about a plain staff text right now.
function outlookWords(o: ReplyOutlook): Pair {
  if (o.allow && o.mode === "text")
    return [
      "Inside the 24-hour window: your reply goes out as typed.",
      "Dalam tempoh 24 jam: balasan anda dihantar seperti ditaip.",
    ];
  if (o.allow)
    return [
      "More than 24 hours since the customer last wrote. WhatsApp allows only approved templates now, so the customer gets your reply-request template instead of your text. Your text stays here; send it again once they reply.",
      "Lebih 24 jam sejak pelanggan kali terakhir menulis. WhatsApp hanya membenarkan templat yang diluluskan, jadi pelanggan menerima templat minta-balas anda dan bukan teks anda. Teks anda kekal di sini; hantar semula selepas mereka membalas.",
    ];
  const blocked: Record<string, Pair> = {
    DO_NOT_CONTACT: [
      "This contact is marked do-not-contact. Nothing can be sent, even inside the 24-hour window.",
      "Kenalan ini bertanda jangan-hubungi. Tiada apa-apa boleh dihantar, walaupun dalam tempoh 24 jam.",
    ],
    OPTED_OUT: [
      "The customer opted out on WhatsApp. Nothing more can be sent.",
      "Pelanggan telah menarik diri di WhatsApp. Tiada mesej lagi boleh dihantar.",
    ],
    WINDOW_CLOSED: [
      "More than 24 hours since the customer last wrote. WhatsApp allows only approved templates now, and this business has no approved reply-request template. An owner or admin can add one in WhatsApp settings.",
      "Lebih 24 jam sejak pelanggan kali terakhir menulis. WhatsApp hanya membenarkan templat yang diluluskan, dan perniagaan ini tiada templat minta-balas yang diluluskan. Pemilik atau pentadbir boleh menambahnya dalam tetapan WhatsApp.",
    ],
    CONSENT_REQUIRED: [
      "More than 24 hours since the customer last wrote. The reply-request template needs the customer's recorded consent for service messages, and none is recorded. Record it on the contact if the customer gave it.",
      "Lebih 24 jam sejak pelanggan kali terakhir menulis. Templat minta-balas memerlukan persetujuan pelanggan untuk mesej perkhidmatan, dan tiada yang direkodkan. Rekodkannya pada kenalan jika pelanggan telah memberinya.",
    ],
    CHANNEL_NOT_CONNECTED: [
      "WhatsApp is not connected, so nothing can be sent.",
      "WhatsApp tidak disambungkan, jadi tiada apa-apa boleh dihantar.",
    ],
    CONTACT_UNAVAILABLE: [
      "This contact is being deleted. Nothing can be sent.",
      "Kenalan ini sedang dipadam. Tiada apa-apa boleh dihantar.",
    ],
  };
  return (
    blocked[o.reason] ?? [
      `Sending is not allowed right now (${o.reason}).`,
      `Penghantaran tidak dibenarkan sekarang (${o.reason}).`,
    ]
  );
}

function refusal(code: string | null): Pair | null {
  if (!code) return null;
  if (refusalWords[code]) return refusalWords[code];
  if (code.startsWith("META_"))
    return [
      `WhatsApp refused the message (${code}).`,
      `WhatsApp menolak mesej ini (${code}).`,
    ];
  return [`Not sent (${code}).`, `Tidak dihantar (${code}).`];
}

// Shows the country code and the last four digits only.
export function maskedNumber(waId: string) {
  const d = waId.replace(/\D/g, "");
  return d.length > 6 ? `+${d.slice(0, 2)} •••• ${d.slice(-4)}` : "+••••";
}

// Picks the English or BM half of a wording pair.
function usePair() {
  const w = useWords();
  return (p: Pair) => w(p[0], p[1]);
}

function useKlTime() {
  const { locale } = useExperience();
  const tag = locale === "ms" ? "ms-MY" : "en-MY";
  return (iso: string, full = false) => {
    const at = new Date(iso);
    const day = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
    const time = new Intl.DateTimeFormat(tag, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
    if (!full && day(at) === day(new Date())) return time;
    const date = new Intl.DateTimeFormat(tag, {
      timeZone: zone,
      day: "numeric",
      month: "short",
    }).format(at);
    return full ? `${date}, ${time}` : date;
  };
}

function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function LocalInbox() {
  const w = useWords(),
    { client } = useCore(),
    { href } = useExperience();
  const query = useSearchParams();
  const [selected, setSelected] = useState(query.get("conversation") ?? "");
  const choose = (id: string) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    history.replaceState(null, "", url);
    setSelected(id);
  };
  const overview = useResource(
    () => client.execute("whatsappOverview", {}),
    "inbox-whatsapp",
  );
  const list = useResource(
    () => client.execute("conversations", {}),
    "inbox-conversations",
  );
  const connected =
    !!overview.data?.readiness.configured &&
    overview.data.channel?.state === "connected";
  const failed = overview.error ?? list.error;
  return (
    <>
      <Heading
        title={w("Inbox", "Peti masuk")}
        description={w(
          "WhatsApp chats with your customers. The agent answers first; anyone on your team can take over.",
          "Perbualan WhatsApp dengan pelanggan anda. Ejen menjawab dahulu; sesiapa dalam pasukan anda boleh mengambil alih.",
        )}
      />
      {failed && (!overview.data || !list.data) ? (
        <section className="core-panel">
          <Notice error={failed} />
          <button
            className="button secondary-button"
            onClick={() => {
              void overview.reload();
              void list.reload();
            }}
          >
            {w("Retry", "Cuba lagi")}
          </button>
        </section>
      ) : !overview.data || !list.data ? (
        <Loading />
      ) : !connected && list.data.length === 0 ? (
        <section className="core-panel">
          <span className="remaining-chip">
            {w("Not connected", "Belum disambungkan")}
          </span>
          <h2>
            {w(
              "WhatsApp is not connected yet.",
              "WhatsApp belum disambungkan.",
            )}
          </h2>
          <p>
            {w(
              "Connect your WhatsApp Business number first. Customer chats appear here once it is connected.",
              "Sambungkan nombor WhatsApp Business anda dahulu. Perbualan pelanggan dipaparkan di sini selepas ia disambungkan.",
            )}
          </p>
          <a className="button button-dark" href={href("/app/whatsapp")}>
            {w("Open WhatsApp settings", "Buka tetapan WhatsApp")}
          </a>
        </section>
      ) : (
        <>
          {failed && <Notice error={failed} />}
          {!connected && (
            <p className="storage-warning" role="status">
              {w(
                "WhatsApp is not connected, so replies cannot be sent. ",
                "WhatsApp tidak disambungkan, jadi balasan tidak boleh dihantar. ",
              )}
              <a href={href("/app/whatsapp")}>
                {w("Open WhatsApp settings", "Buka tetapan WhatsApp")}
              </a>
            </p>
          )}
          {list.data.length === 0 ? (
            <section className="core-panel wa-empty">
              <ChatCircleDots size={28} aria-hidden />
              <h2>{w("No chats yet.", "Belum ada perbualan.")}</h2>
              <p>
                {w(
                  "When a customer writes to your WhatsApp number, the chat appears here.",
                  "Apabila pelanggan menulis ke nombor WhatsApp anda, perbualan dipaparkan di sini.",
                )}
              </p>
              {!HOSTED && overview.data.readiness.provider === "fake" && (
                <p className="editor-note">
                  {w(
                    "Practice mode: send a test message with npm run whatsapp:simulate.",
                    "Mod latihan: hantar mesej ujian dengan npm run whatsapp:simulate.",
                  )}
                </p>
              )}
            </section>
          ) : (
            <div className={`wa-inbox${selected ? " has-selection" : ""}`}>
              <ConversationList
                items={list.data}
                selected={selected}
                choose={choose}
              />
              {selected ? (
                <ConversationView
                  key={selected}
                  id={selected}
                  back={() => choose("")}
                  changed={() => void list.reload()}
                />
              ) : (
                <section className="wa-placeholder" aria-hidden>
                  <ChatCircleDots size={28} />
                  <p>
                    {w(
                      "Choose a chat to read it.",
                      "Pilih perbualan untuk membacanya.",
                    )}
                  </p>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function ConversationList({
  items,
  selected,
  choose,
}: {
  items: ConversationSummary[];
  selected: string;
  choose: (id: string) => void;
}) {
  const w = useWords(),
    time = useKlTime();
  const waiting = items.filter((c) => c.needs_attention).length;
  return (
    <section className="wa-list" aria-label={w("Conversations", "Perbualan")}>
      <p className="wa-count">
        {w(
          `${items.length} chats, ${waiting} waiting for staff`,
          `${items.length} perbualan, ${waiting} menunggu staf`,
        )}
      </p>
      <ul>
        {items.map((c) => {
          const reason = c.attention_reason
            ? (attentionWords[c.attention_reason] ?? [
                c.attention_reason.replaceAll("_", " "),
                c.attention_reason.replaceAll("_", " "),
              ])
            : null;
          return (
            <li key={c.id}>
              <button
                className="wa-row"
                aria-current={c.id === selected ? "true" : undefined}
                onClick={() => choose(c.id)}
              >
                <span className="wa-row-top">
                  <strong>{c.contact_name || maskedNumber(c.wa_id)}</strong>
                  <time dateTime={c.last_message_at}>
                    {time(c.last_message_at)}
                  </time>
                </span>
                <span className="wa-snippet">
                  {c.last_body
                    ? c.last_body.slice(0, 90)
                    : w("No messages", "Tiada mesej")}
                </span>
                <span className="wa-tags">
                  {c.needs_attention && (
                    <span className="wa-tag attention">
                      {w("Needs staff", "Perlu staf")}
                      {reason && `: ${w(reason[0], reason[1])}`}
                    </span>
                  )}
                  {c.state === "closed" ? (
                    <span className="wa-tag">{w("Resolved", "Selesai")}</span>
                  ) : (
                    <span className="wa-tag">
                      {c.owner === "agent"
                        ? w("Agent handling", "Ejen mengendalikan")
                        : w("Staff handling", "Staf mengendalikan")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ConversationView({
  id,
  back,
  changed,
}: {
  id: string;
  back: () => void;
  changed: () => void;
}) {
  const w = useWords(),
    { client, epoch } = useCore(),
    { href } = useExperience(),
    time = useKlTime(),
    visible = usePageVisible(),
    say = usePair(),
    action = useAction();
  const [detail, setDetail] = useState<ConversationDetail>();
  const [error, setError] = useState<unknown>();
  const [draft, setDraft] = useState("");
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const d = await client.execute("conversation", { id });
      if (alive.current) {
        setDetail(d);
        setError(undefined);
      }
    } catch (e) {
      if (alive.current) setError(e);
    }
  }, [client, id]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load, epoch]);
  // Polls while the page is visible, so the agent's replies and delivery
  // states appear without a reload.
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [visible, load]);
  const act = async (
    kind:
      | "takeoverConversation"
      | "handbackConversation"
      | "resolveConversation",
  ) => {
    if (!detail) return;
    const done = await action.run(() =>
      client.execute(kind, { id, expectedRevision: detail.revision }),
    );
    if (done) setDetail(done);
    else void load();
    changed();
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !draft.trim()) return;
    const done = await action.run(() =>
      client.execute("replyConversation", {
        id,
        text: draft,
        expectedRevision: detail.revision,
      }),
    );
    // The draft is kept on any refusal; it is never resent by itself.
    if (done) {
      setDetail(done);
      setDraft("");
    } else void load();
    changed();
  };
  const forbidden = error instanceof CoreError && error.status === 403;
  return (
    <section className="wa-view" aria-label={w("Conversation", "Perbualan")}>
      <button className="wa-back core-back" onClick={back}>
        <ArrowLeft size={18} aria-hidden /> {w("All chats", "Semua perbualan")}
      </button>
      {forbidden ? (
        <p className="storage-warning" role="alert">
          {w(
            "Your role cannot see the messages in this chat. Ask an owner or admin.",
            "Peranan anda tidak boleh melihat mesej dalam perbualan ini. Minta pemilik atau pentadbir.",
          )}
        </p>
      ) : !detail ? (
        error ? (
          <>
            <Notice error={error} />
            <button
              className="button secondary-button"
              onClick={() => void load()}
            >
              {w("Retry", "Cuba lagi")}
            </button>
          </>
        ) : (
          <Loading />
        )
      ) : (
        <>
          <header className="wa-head">
            <div>
              <h2>{detail.contact_name || maskedNumber(detail.wa_id)}</h2>
              <p>
                {maskedNumber(detail.wa_id)} ·{" "}
                {detail.state === "closed"
                  ? w("Resolved", "Selesai")
                  : detail.owner === "agent"
                    ? w("Agent handling", "Ejen mengendalikan")
                    : w("Staff handling", "Staf mengendalikan")}
              </p>
            </div>
            {detail.state === "open" && (
              <div className="core-actions">
                {detail.owner === "agent" ? (
                  <button
                    className="button secondary-button"
                    disabled={action.busy}
                    onClick={() => void act("takeoverConversation")}
                  >
                    {w("Take over", "Ambil alih")}
                  </button>
                ) : (
                  <button
                    className="button secondary-button"
                    disabled={action.busy}
                    onClick={() => void act("handbackConversation")}
                  >
                    {w("Hand back to agent", "Serah semula kepada ejen")}
                  </button>
                )}
                <button
                  disabled={action.busy}
                  onClick={() => void act("resolveConversation")}
                >
                  {w("Mark resolved", "Tanda selesai")}
                </button>
              </div>
            )}
          </header>
          {error ? <Notice error={error} /> : null}
          <Compliance
            detail={detail}
            contactHref={href(`/app/contacts?contact=${detail.contact_id}`)}
          />
          <ol className="wa-messages">
            {detail.messages.map((m) => (
              <Message key={m.id} m={m} time={time} />
            ))}
          </ol>
          {detail.state === "closed" ? (
            <p className="editor-note">
              {w(
                "This chat is resolved. A new message from the customer starts a new chat.",
                "Perbualan ini selesai. Mesej baharu daripada pelanggan memulakan perbualan baharu.",
              )}
            </p>
          ) : (
            <form className="wa-reply" onSubmit={send}>
              <p
                className={
                  detail.reply_outlook.allow
                    ? "wa-outlook"
                    : "wa-outlook blocked"
                }
                role="status"
              >
                {say(outlookWords(detail.reply_outlook))}{" "}
                <small>
                  {w(
                    "Checked just now; the final check happens when the message is sent.",
                    "Disemak sebentar tadi; semakan akhir berlaku semasa mesej dihantar.",
                  )}
                </small>
              </p>
              <label htmlFor={`reply-${id}`}>
                {w("Reply as staff", "Balas sebagai staf")}
              </label>
              <textarea
                id={`reply-${id}`}
                rows={3}
                maxLength={4000}
                value={draft}
                disabled={!detail.reply_outlook.allow}
                onChange={(e) => setDraft(e.target.value)}
              />
              {detail.owner === "agent" && detail.reply_outlook.allow && (
                <small>
                  {w(
                    "Sending takes this chat over from the agent.",
                    "Menghantar akan mengambil alih perbualan ini daripada ejen.",
                  )}
                </small>
              )}
              <Notice error={action.error} />
              <button
                className="button button-dark"
                disabled={
                  action.busy || !draft.trim() || !detail.reply_outlook.allow
                }
              >
                {w("Send", "Hantar")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function Compliance({
  detail,
  contactHref,
}: {
  detail: ConversationDetail;
  contactHref: string;
}) {
  const w = useWords(),
    say = usePair();
  const c = detail.compliance;
  const consent = (v: boolean | null): Pair =>
    v === true
      ? ["Agreed", "Bersetuju"]
      : v === false
        ? ["Opted out", "Menarik diri"]
        : ["Not recorded", "Tiada rekod"];
  return (
    <dl className="wa-compliance">
      <div>
        <dt>{w("Do-not-contact", "Jangan hubungi")}</dt>
        <dd className={c.do_not_contact ? "warn" : undefined}>
          {c.do_not_contact ? w("On", "Aktif") : w("Off", "Tidak aktif")}
        </dd>
      </div>
      <div>
        <dt>{w("WhatsApp service messages", "Mesej perkhidmatan WhatsApp")}</dt>
        <dd className={c.consent_service === false ? "warn" : undefined}>
          {say(consent(c.consent_service))}
        </dd>
      </div>
      <div>
        <dt>{w("WhatsApp marketing", "Pemasaran WhatsApp")}</dt>
        <dd>{say(consent(c.consent_marketing))}</dd>
      </div>
      <a href={contactHref}>{w("Open contact record", "Buka rekod kenalan")}</a>
    </dl>
  );
}

function Message({
  m,
  time,
}: {
  m: ChatMessage;
  time: (iso: string, full?: boolean) => string;
}) {
  const w = useWords(),
    say = usePair();
  const notice = m.notice ? noticeWords[m.notice] : null;
  const why =
    m.status === "blocked" || m.status === "failed"
      ? refusal(m.error_code)
      : null;
  const status = statusWords[m.status] ?? [m.status, m.status];
  const author = authorWords[m.author] ?? [m.author, m.author];
  return (
    <>
      {m.disclosure && (
        <li className="wa-system">
          {w(
            "The reply below starts with the AI introduction.",
            "Balasan di bawah bermula dengan pengenalan AI.",
          )}
        </li>
      )}
      {notice && <li className="wa-system">{say(notice)}</li>}
      <li
        className={`wa-message ${m.direction === "inbound" ? "in" : "out"}${m.author === "system" ? " system" : ""}${why ? " refused" : ""}`}
      >
        <span className="wa-meta">
          {say(author)} ·{" "}
          <time dateTime={m.created_at}>{time(m.created_at, true)}</time>
          {m.kind === "template" &&
            ` · ${w("sent as reply-request template", "dihantar sebagai templat minta-balas")}`}
        </span>
        <p>{m.body}</p>
        {m.direction === "outbound" && (
          <span className="wa-status">{say(status)}</span>
        )}
        {why && <span className="wa-why">{say(why)}</span>}
      </li>
    </>
  );
}
