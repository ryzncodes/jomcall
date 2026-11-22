"use client";
import { HOSTED } from "@/lib/hosted";
import { waPieces } from "@/lib/core/wa-format";
// The shared WhatsApp inbox for the local and hosted app. Every record comes
// from the inbox commands; on an error the screen says so and offers a retry,
// never sample data. The send rules live on the server: the screen shows the
// server's outlook before a reply and the agent process's decision after it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChatCircleDots } from "@phosphor-icons/react";
import { CoreError } from "@/lib/core/client";
import {
  displayName,
  keepAttempt,
  maskedNumber,
  nextAttempt,
  replyByteLimit,
  snippet,
  utf8Bytes,
  type ReplyAttempt,
} from "@/lib/core/inbox-rules";
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
  OPTED_OUT: ["Customer opted out", "Pelanggan tidak mahu terima mesej lagi"],
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
    "Pelanggan tidak mahu terima mesej lagi di WhatsApp, jadi tiada mesej lagi dihantar.",
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
  REPLY_REQUEST_SENT: [
    "The reply-request template already went out after the customer's last message.",
    "Templat minta-balas sudah dihantar selepas mesej terakhir pelanggan.",
  ],
};

const noticeWords: Record<string, Pair> = {
  notice_opt_out: [
    "Customer said STOP. Opt-out recorded; this confirmation is the last message.",
    "Pelanggan menaip STOP. Permintaan berhenti direkodkan; pengesahan ini mesej terakhir.",
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
      "Pelanggan tidak mahu terima mesej lagi di WhatsApp. Tiada mesej lagi boleh dihantar.",
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
    REPLY_REQUEST_SENT: [
      "The reply-request template already went out after the customer's last message. Wait for them to reply; sending again would only repeat it.",
      "Templat minta-balas sudah dihantar selepas mesej terakhir pelanggan. Tunggu mereka membalas; menghantar lagi hanya akan mengulanginya.",
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
  // Opening a chat adds a history entry, so the phone's Back button returns
  // to the list.
  useEffect(() => {
    const sync = () =>
      setSelected(
        new URL(location.href).searchParams.get("conversation") ?? "",
      );
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const choose = (id: string) => {
    if (!id && history.state?.inboxChat) {
      history.back();
      return;
    }
    const url = new URL(location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    if (id && !selected) history.pushState({ inboxChat: id }, "", url);
    else history.replaceState(id ? { inboxChat: id } : null, "", url);
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
      {items.length >= 100 && (
        <p className="editor-note">
          {w(
            "Showing the 100 most recent chats. Older chats are not shown.",
            "Memaparkan 100 perbualan terkini. Perbualan lebih lama tidak dipaparkan.",
          )}
        </p>
      )}
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
                  <strong dir="auto">
                    {displayName(c.contact_name, c.wa_id)}
                  </strong>
                  <time dateTime={c.last_message_at}>
                    {time(c.last_message_at)}
                  </time>
                </span>
                <span className="wa-snippet" dir="auto">
                  {c.last_body
                    ? snippet(c.last_body)
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
    headerAction = useAction(),
    replyAction = useAction();
  const [detail, setDetail] = useState<ConversationDetail>();
  const [error, setError] = useState<unknown>();
  const [draft, setDraft] = useState("");
  // Resolving closes the chat; a new customer message starts a new one. It
  // asks once more before acting.
  const [confirmResolve, setConfirmResolve] = useState(false);
  const alive = useRef(true);
  // Each read and each command result gets a number; an answer older than
  // the last one shown is dropped, so a slow poll cannot undo newer data.
  const sequence = useRef(0),
    shown = useRef(0),
    loading = useRef(false);
  // The reply being sent, kept until it succeeds or the draft changes.
  const attempt = useRef<ReplyAttempt | null>(null);
  const show = useCallback((d: ConversationDetail, at: number) => {
    if (!alive.current || at < shown.current) return;
    shown.current = at;
    setDetail(d);
    setError(undefined);
  }, []);
  const load = useCallback(
    async (poll = false) => {
      if (poll && loading.current) return;
      loading.current = true;
      const at = ++sequence.current;
      try {
        show(await client.execute("conversation", { id }), at);
      } catch (e) {
        if (alive.current && at >= shown.current) setError(e);
      } finally {
        loading.current = false;
      }
    },
    [client, id, show],
  );
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
    const timer = setInterval(() => void load(true), 5000);
    return () => clearInterval(timer);
  }, [visible, load]);
  const act = async (
    kind:
      | "takeoverConversation"
      | "handbackConversation"
      | "resolveConversation",
  ) => {
    if (!detail) return;
    const at = ++sequence.current;
    const done = await headerAction.run(() =>
      client.execute(kind, { id, expectedRevision: detail.revision }),
    );
    if (done) show(done, at);
    else void load();
    changed();
  };
  const bytes = utf8Bytes(draft),
    tooLong = bytes > replyByteLimit;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !draft.trim() || tooLong) return;
    const request = nextAttempt(attempt.current, draft, detail.revision, () =>
      crypto.randomUUID(),
    );
    attempt.current = request;
    const at = ++sequence.current;
    let failure: unknown;
    const done = await replyAction.run(async () => {
      try {
        return await client.execute(
          "replyConversation",
          {
            id,
            text: request.text,
            expectedRevision: request.expectedRevision,
          },
          request.key,
        );
      } catch (err) {
        failure = err;
        throw err;
      }
    });
    // The draft is kept on any refusal; it is never resent by itself.
    if (done) {
      attempt.current = null;
      show(done, at);
      setDraft("");
    } else {
      if (!keepAttempt(failure)) attempt.current = null;
      void load();
    }
    changed();
  };
  const forbidden = error instanceof CoreError && error.status === 403;
  // The "JomCall does not download files" line goes under the first media
  // message in view only.
  const firstMediaId = detail?.messages.find((m) => m.media)?.id;
  const replyRefusal =
    replyAction.error instanceof CoreError &&
    replyAction.error.status === 409 &&
    refusalWords[replyAction.error.code]
      ? outlookWords({
          allow: false,
          mode: null,
          fallback: false,
          reason: replyAction.error.code,
        })
      : null;
  return (
    <section className="wa-view" aria-label={w("Conversation", "Perbualan")}>
      <button className="wa-back core-back" onClick={back}>
        <ArrowLeft size={18} aria-hidden /> {w("All chats", "Semua perbualan")}
      </button>
      {forbidden ? (
        <p className="storage-warning" role="alert">
          {w(
            "You no longer have access to this workspace. Ask an owner to check your membership.",
            "Anda tiada lagi akses kepada ruang kerja ini. Minta pemilik menyemak keahlian anda.",
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
              <h2 dir="auto">
                {displayName(detail.contact_name, detail.wa_id)}
              </h2>
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
                    disabled={headerAction.busy}
                    onClick={() => void act("takeoverConversation")}
                  >
                    {w("Take over", "Ambil alih")}
                  </button>
                ) : (
                  <button
                    className="button secondary-button"
                    disabled={headerAction.busy}
                    onClick={() => void act("handbackConversation")}
                  >
                    {w("Hand back to agent", "Serah semula kepada ejen")}
                  </button>
                )}
                {confirmResolve ? (
                  <>
                    <button
                      className="button button-dark"
                      disabled={headerAction.busy}
                      onClick={() => {
                        setConfirmResolve(false);
                        void act("resolveConversation");
                      }}
                    >
                      {w(
                        "Yes, resolve. A new message from the customer starts a new chat",
                        "Ya, selesaikan. Mesej baharu daripada pelanggan memulakan perbualan baharu",
                      )}
                    </button>
                    <button onClick={() => setConfirmResolve(false)}>
                      {w("Keep open", "Biarkan terbuka")}
                    </button>
                  </>
                ) : (
                  <button
                    disabled={headerAction.busy}
                    onClick={() => setConfirmResolve(true)}
                  >
                    {w("Mark resolved", "Tanda selesai")}
                  </button>
                )}
              </div>
            )}
          </header>
          <Notice error={headerAction.error} />
          {error ? <Notice error={error} /> : null}
          <Compliance
            detail={detail}
            contactHref={href(`/app/contacts?contact=${detail.contact_id}`)}
          />
          <FollowUps items={detail.followUps} />
          {detail.messages.length >= 200 && (
            <p className="editor-note">
              {w(
                "Only the latest 200 messages are shown. Older messages are not shown.",
                "Hanya 200 mesej terkini dipaparkan. Mesej lebih lama tidak dipaparkan.",
              )}
            </p>
          )}
          <ol className="wa-messages">
            {detail.messages.map((m) => (
              <Message
                key={m.id}
                m={m}
                time={time}
                mediaHelp={m.id === firstMediaId}
              />
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
              {/* Stays editable when sending is refused, so the draft is
                  never trapped; only Send is disabled. */}
              <textarea
                id={`reply-${id}`}
                rows={3}
                dir="auto"
                value={draft}
                aria-invalid={tooLong || undefined}
                aria-describedby={`reply-size-${id}`}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // An edited draft is a new reply with a new key.
                  if (
                    attempt.current &&
                    attempt.current.text !== e.target.value
                  )
                    attempt.current = null;
                }}
              />
              <small
                id={`reply-size-${id}`}
                className={tooLong ? "wa-size warn" : "wa-size"}
              >
                {tooLong
                  ? w(
                      `Too long: ${bytes} of ${replyByteLimit} bytes. Emoji and some letters count as more than one byte. Shorten the reply to send it.`,
                      `Terlalu panjang: ${bytes} daripada ${replyByteLimit} bait. Emoji dan sesetengah huruf dikira lebih daripada satu bait. Pendekkan balasan untuk menghantarnya.`,
                    )
                  : w(
                      `${bytes} of ${replyByteLimit} bytes`,
                      `${bytes} daripada ${replyByteLimit} bait`,
                    )}
              </small>
              {detail.owner === "agent" && detail.reply_outlook.allow && (
                <small>
                  {w(
                    "Sending takes this chat over from the agent.",
                    "Menghantar akan mengambil alih perbualan ini daripada ejen.",
                  )}
                </small>
              )}
              {replyRefusal ? (
                <p className="storage-warning" role="alert">
                  {say(replyRefusal)}
                </p>
              ) : (
                <Notice error={replyAction.error} />
              )}
              <button
                className="button button-dark"
                disabled={
                  replyAction.busy ||
                  !draft.trim() ||
                  tooLong ||
                  !detail.reply_outlook.allow
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

const proposalWords: Record<string, Pair> = {
  booking: [
    "The agent proposed a booking. Confirm it with the customer, then add it in Bookings.",
    "Ejen mencadangkan tempahan. Sahkan dengan pelanggan, kemudian tambahkannya dalam Tempahan.",
  ],
  message: [
    "The customer left a message for your team.",
    "Pelanggan meninggalkan mesej untuk pasukan anda.",
  ],
  handoff: [
    "The agent handed this chat to your team.",
    "Ejen menyerahkan perbualan ini kepada pasukan anda.",
  ],
};

// Read-only for now: the chat's open follow-up items. Closed ones are no
// longer shown as open.
function FollowUps({ items }: { items: ConversationDetail["followUps"] }) {
  const say = usePair();
  const open = items.filter((p) => p.state === "open");
  if (!open.length) return null;
  return (
    <ul className="wa-proposals">
      {open.map((p) => {
        const text = [p.details.text, p.details.reason, p.details.title].find(
          (t) => typeof t === "string" && t,
        ) as string | undefined;
        return (
          <li key={p.id}>
            {say(
              proposalWords[p.kind] ?? [
                `Agent proposal: ${p.kind}`,
                `Cadangan ejen: ${p.kind}`,
              ],
            )}
            {text ? <> “{text}”</> : null}
          </li>
        );
      })}
    </ul>
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
        ? ["Opted out", "Tidak mahu terima mesej lagi"]
        : ["Not recorded", "Tiada rekod"];
  return (
    <dl className="wa-compliance">
      {c.deletion_pending && (
        <div>
          <dt>{w("Deletion", "Pemadaman")}</dt>
          <dd className="warn">
            {w("Contact is being deleted", "Kenalan sedang dipadam")}
          </dd>
        </div>
      )}
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

// Names the kind of file a customer sent. Plain wording calls rather than a
// wording table: "Video" is the same word in English and BM.
function useMediaLabel() {
  const w = useWords();
  return (media: NonNullable<ChatMessage["media"]>) => {
    switch (media.kind) {
      case "image":
        return w("Photo", "Gambar");
      case "audio":
        return w("Voice or audio message", "Mesej suara atau audio");
      case "video":
        return w("Video", "Video");
      case "sticker":
        return w("Sticker", "Pelekat");
      default:
        return media.filename
          ? w(`Document: ${media.filename}`, `Dokumen: ${media.filename}`)
          : w("Document", "Dokumen");
    }
  };
}

function Message({
  m,
  time,
  mediaHelp,
}: {
  m: ChatMessage;
  time: (iso: string, full?: boolean) => string;
  mediaHelp: boolean;
}) {
  const w = useWords(),
    say = usePair(),
    mediaLabel = useMediaLabel();
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
        </span>
        {m.media && (
          <p dir="auto">
            <strong>{mediaLabel(m.media)}</strong>
          </p>
        )}
        {m.kind === "unsupported" && m.direction === "inbound" && (
          <p>
            <strong>
              {w(
                "Message type JomCall cannot show",
                "Jenis mesej yang JomCall tidak dapat paparkan",
              )}
            </strong>
          </p>
        )}
        {(m.body || (!m.media && m.kind !== "unsupported")) && (
          <p dir="auto">
            {waPieces(m.body ?? "").map((piece, i) =>
              piece.bold ? <strong key={i}>{piece.text}</strong> : piece.text,
            )}
          </p>
        )}
        {mediaHelp && (
          <span className="wa-status">
            {w(
              "JomCall does not download files. Open WhatsApp on the business phone to see it.",
              "JomCall tidak memuat turun fail. Buka WhatsApp pada telefon perniagaan untuk melihatnya.",
            )}
          </span>
        )}
        {m.reply_request && (
          <span className="wa-why">
            {w(
              "Customer got the reply-request template; this text was not delivered.",
              "Pelanggan menerima templat minta-balas; teks ini tidak dihantar.",
            )}
          </span>
        )}
        {m.direction === "outbound" && (
          <span className="wa-status">{say(status)}</span>
        )}
        {why && <span className="wa-why">{say(why)}</span>}
      </li>
    </>
  );
}
