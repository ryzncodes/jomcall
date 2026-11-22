"use client";
// "To follow up": the messages, booking requests and requests for staff the
// agent left from real calls and WhatsApp chats, for every role. Owners and
// admins also assign items and set a due time. Every record comes from the
// follow-up commands; on an error the screen says so and offers a retry.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DotsThree } from "@phosphor-icons/react";
import type { FollowUp, FollowUpPage } from "../../../packages/contracts/src/follow-up";
import type { Member } from "../../../packages/contracts/src/core";
import { Picker } from "@/components/picker";
import { CoreError } from "@/lib/core/client";
import { localNumber } from "@/lib/core/phone-format";
import { klDate } from "@/lib/core/plan-rules";
import {
  KIND_WORDS,
  SOURCE_WORDS,
  bookingStart,
  dueChoice,
  dueFromInput,
  dueState,
  dueToInput,
  itemText,
  needsReload,
  FOLLOW_UPS_CHANGED,
  stateWords,
  type FollowUpAction,
} from "@/lib/core/follow-up-rules";
import { useExperience } from "../experience";
import { Field } from "./field";
import { Heading, Loading, Notice, errorText, useCore, useResource, useWords } from "./state";
import {
  ActionButtons,
  UndoToast,
  useFollowUpCommand,
  useKlWhen,
  usePair,
} from "./follow-up-actions";

type View = "open" | "mine" | "done";
const VIEWS: { id: View; label: [string, string] }[] = [
  { id: "open", label: ["Open", "Terbuka"] },
  { id: "mine", label: ["Mine", "Milik saya"] },
  { id: "done", label: ["Done", "Selesai"] },
];
// How many pages a link to one item (?item=) reads before it says closed.
const FIND_PAGES = 10;

export function LocalFollowUps() {
  const w = useWords(),
    say = usePair(),
    { client, workspace, session } = useCore();
  const manager = workspace.role !== "staff";
  const linked = useSearchParams().get("item");
  const [view, setView] = useState<View>("open");
  const first = useResource(() => client.execute("followUps", { view }), "follow-ups|" + view);
  const count = useResource(() => client.execute("followUpCount", {}), "follow-up-count");
  const members = useResource<Member[] | null>(
    () => (manager ? client.execute("members", {}) : Promise.resolve(null)),
    "follow-up-members|" + manager,
  );
  const memberList = { list: members.data ?? undefined, error: members.error };
  // Pages after the first, read with "Show more"; dropped on a view change.
  const [more, setMore] = useState<{ view: View; items: FollowUp[]; next: string | null }>();
  const [moreError, setMoreError] = useState<unknown>();
  const [undo, setUndo] = useState<FollowUp | null>(null);
  const [highlight, setHighlight] = useState<string>();
  const [linkClosed, setLinkClosed] = useState(false);
  // Items replaced by a command's answer until the next read shows them.
  const [patched, setPatched] = useState<Record<string, FollowUp>>({});

  const extra = more?.view === view ? more : undefined;
  const items = dedupe([...(first.data?.items ?? []), ...(extra?.items ?? [])])
    .map((f) => {
      const p = patched[f.id];
      return p && p.revision >= f.revision ? p : f;
    })
    .filter((f) => (view === "done" ? f.state !== "open" : f.state === "open"));
  const next = extra ? extra.next : first.data?.next ?? null;

  // Reads the open items, page by page, for one id.
  async function findOpen(id: string): Promise<FollowUp | undefined> {
    let cursor: string | undefined;
    for (let i = 0; i < FIND_PAGES; i++) {
      const page: FollowUpPage = await client.execute("followUps", { view: "open", ...(cursor ? { cursor } : {}) });
      const hit = page.items.find((f) => f.id === id);
      if (hit || !page.next) return hit;
      cursor = page.next;
    }
    return undefined;
  }
  const reloadAll = async () => {
    await Promise.all([first.reload(), count.reload()]);
    setMore(undefined);
  };
  const { act, busy, said, clear } = useFollowUpCommand(async (id) => {
    await reloadAll();
    return findOpen(id);
  });

  // ?item=<id>: scroll to it and mark it, or say it is closed.
  const linkDone = useRef(false);
  useEffect(() => {
    if (!linked || linkDone.current || view !== "open" || !first.data) return;
    linkDone.current = true;
    void (async () => {
      let found = first.data!.items.find((f) => f.id === linked);
      if (!found && first.data!.next) {
        try {
          found = await findOpen(linked);
          if (found) setMore({ view: "open", items: [found], next: first.data!.next });
        } catch {
          found = undefined;
        }
      }
      if (found) setHighlight(linked);
      else setLinkClosed(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, first.data, view]);
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`follow-up-${highlight}`);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }, [highlight, items.length]);

  const onAct = async (a: FollowUpAction, item: FollowUp) => {
    setUndo(null);
    const done = await act(a, item);
    if (!done) return;
    setPatched((p) => ({ ...p, [done.id]: done }));
    if (done.state !== "open") setUndo(done);
    void count.reload();
    void first.reload();
  };

  const open = count.data?.open;
  return (
    <div className="follow-ups">
      <Heading
        title={
          open === undefined
            ? w("To follow up", "Untuk disusuli")
            : w(`To follow up (${open} open)`, `Untuk disusuli (${open} terbuka)`)
        }
        description={w(
          "Messages, booking requests and requests for staff from your agent's calls and chats.",
          "Mesej, permintaan tempahan dan permintaan untuk kakitangan daripada panggilan dan sembang ejen anda.",
        )}
      />
      <div className="builder-tabs follow-up-tabs" role="group" aria-label={w("Show", "Tunjuk")}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-current={view === v.id ? "page" : undefined}
            onClick={() => {
              setView(v.id);
              setUndo(null);
              clear();
              setMoreError(undefined);
            }}
          >
            {say(v.label)}
            {v.id === "mine" && !!count.data?.mine && ` (${count.data.mine})`}
          </button>
        ))}
      </div>
      {linkClosed && view === "open" && (
        <p className="core-success" role="status">
          {w("This item is already closed.", "Item ini sudah ditutup.")}
        </p>
      )}
      {said && !items.some((f) => f.id === said.id) && (
        <p className="storage-warning" role="alert">
          {said.text}
        </p>
      )}
      {first.error && first.data ? <Notice error={first.error} /> : null}
      {!first.data ? (
        first.error ? (
          <>
            <Notice error={first.error} />
            <button className="button secondary-button" onClick={() => void first.reload()}>
              {w("Retry", "Cuba lagi")}
            </button>
          </>
        ) : (
          <Loading />
        )
      ) : !items.length ? (
        <p className="core-panel core-empty">
          {view === "open"
            ? w(
                "Nothing to follow up. New messages and requests from the agent appear here.",
                "Tiada apa untuk disusuli. Mesej dan permintaan baharu daripada ejen akan dipaparkan di sini.",
              )
            : view === "mine"
              ? w("Nothing is assigned to you.", "Tiada apa diserahkan kepada anda.")
              : w("Nothing closed yet.", "Belum ada yang ditutup.")}
        </p>
      ) : (
        <ul className="follow-up-list">
          {items.map((f) => (
            <ItemCard
              key={f.id}
              item={f}
              highlighted={highlight === f.id}
              busy={busy === f.id}
              said={said?.id === f.id ? said.text : undefined}
              me={session.userId}
              manager={manager}
              members={memberList}
              onAct={(a) => void onAct(a, f)}
              onAssigned={(updated) => {
                setPatched((p) => ({ ...p, [updated.id]: updated }));
                void count.reload();
                void first.reload();
              }}
              onConflict={() => void reloadAll()}
            />
          ))}
        </ul>
      )}
      {moreError ? <Notice error={moreError} /> : null}
      {next && (
        <div className="core-actions core-pagination">
          <button
            type="button"
            onClick={async () => {
              setMoreError(undefined);
              try {
                const page = await client.execute("followUps", { view, cursor: next });
                setMore({ view, items: [...(extra?.items ?? []), ...page.items], next: page.next });
              } catch (e) {
                setMoreError(e);
              }
            }}
          >
            {w("Show more", "Tunjuk lagi")}
          </button>
        </div>
      )}
      <UndoToast
        item={undo}
        onUndone={(reopened) => {
          setPatched((p) => ({ ...p, [reopened.id]: reopened }));
          void count.reload();
          void first.reload();
        }}
        onClose={() => setUndo(null)}
      />
    </div>
  );
}

function dedupe(list: FollowUp[]) {
  const seen = new Set<string>();
  return list.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

function ItemCard({
  item: f,
  highlighted,
  busy,
  said,
  me,
  manager,
  members,
  onAct,
  onAssigned,
  onConflict,
}: {
  item: FollowUp;
  highlighted: boolean;
  busy: boolean;
  said?: string;
  me: string;
  manager: boolean;
  members: MemberList;
  onAct: (a: FollowUpAction) => void;
  onAssigned: (f: FollowUp) => void;
  onConflict: () => void;
}) {
  const w = useWords(),
    say = usePair(),
    when = useKlWhen(),
    { href } = useExperience();
  const [menu, setMenu] = useState(false);
  const now = new Date();
  const text = itemText(f);
  const start = bookingStart(f);
  const created = klDate(new Date(f.created_at)) === klDate(now) ? when(f.created_at, false) : when(f.created_at);
  const due = f.due_at && f.state === "open" ? dueWords(f.due_at, now, w, when) : null;
  const source =
    f.source === "call" && f.call_id
      ? { href: `/app/calls?call=${f.call_id}`, label: w("View call", "Lihat panggilan") }
      : f.conversation_id
        ? { href: `/app/inbox?conversation=${f.conversation_id}`, label: w("Open chat", "Buka sembang") }
        : null;
  return (
    <li
      id={`follow-up-${f.id}`}
      tabIndex={-1}
      className="core-panel follow-up-item"
      data-highlight={highlighted || undefined}
      data-state={f.state}
    >
      <p className="follow-up-meta">
        <strong>{say(KIND_WORDS[f.kind])}</strong>
        <span>{say(SOURCE_WORDS[f.source])}</span>
        <span>{created}</span>
        {due && <span data-overdue={due.overdue || undefined}>{due.text}</span>}
        {f.state !== "open" && (
          <span>
            {say(stateWords(f))}
            {f.closed_at ? ` · ${when(f.closed_at)}` : ""}
          </span>
        )}
      </p>
      <p className="follow-up-contact">
        <span dir="auto">{f.contact?.name?.trim() || w("Unknown caller", "Pemanggil tidak dikenali")}</span>
        {f.contact?.phone && (
          <>
            <span>{localNumber(f.contact.phone)}</span>
            <a className="follow-up-link" href={`tel:${f.contact.phone}`}>
              {w("Call", "Telefon")}
            </a>
          </>
        )}
        {source && (
          <a className="follow-up-link" href={href(source.href)}>
            {source.label}
          </a>
        )}
      </p>
      {(text || start) && (
        <p className="follow-up-text" dir="auto">
          {f.kind === "message" && text
            ? `“${text}”`
            : f.kind === "handoff" && text
              ? w(`Reason: ${text}`, `Sebab: ${text}`)
              : text}
          {text && start ? " · " : ""}
          {start ? when(start) : ""}
        </p>
      )}
      {said && (
        <p className="storage-warning" role="alert">
          {said}
        </p>
      )}
      <div className="follow-up-foot">
        <span className="follow-up-assignee">
          {!f.assignee
            ? w("Unassigned", "Belum diserahkan")
            : f.assignee.userId === me
              ? w("Assigned to you", "Diserahkan kepada anda")
              : w(`Assigned to ${f.assignee.name}`, `Diserahkan kepada ${f.assignee.name}`)}
        </span>
        <div className="core-actions">
          <ActionButtons item={f} busy={busy} onAct={onAct} />
          {manager && f.state === "open" && (
            <button
              type="button"
              className="icon-button follow-up-more"
              aria-expanded={menu}
              aria-label={w("Assign or set a due time", "Serahkan atau tetapkan masa")}
              onClick={() => setMenu((v) => !v)}
            >
              <DotsThree size={22} weight="bold" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {menu && manager && f.state === "open" && (
        <AssignForm
          item={f}
          members={members}
          onDone={(updated) => {
            setMenu(false);
            onAssigned(updated);
          }}
          onConflict={onConflict}
        />
      )}
    </li>
  );
}

function dueWords(
  dueAt: string,
  now: Date,
  w: (en: string, ms: string) => string,
  when: (iso: string, withDate?: boolean) => string,
) {
  const s = dueState(dueAt, now);
  return {
    overdue: s === "overdue",
    text:
      s === "overdue"
        ? w(`Overdue: ${when(dueAt)}`, `Lewat: ${when(dueAt)}`)
        : s === "today"
          ? w("Due today", "Tarikh akhir hari ini")
          : s === "tomorrow"
            ? w("Due tomorrow", "Tarikh akhir esok")
            : w(`Due ${when(dueAt)}`, `Tarikh akhir ${when(dueAt)}`),
  };
}

type DueKind = "keep" | "none" | "today" | "tomorrow" | "at";
type MemberList = { list?: Member[]; error?: unknown };

// Owners and admins: who handles the item and by when. Members are listed
// by their sign-in email, which is all JomCall knows about them.
function AssignForm({
  item,
  members,
  onDone,
  onConflict,
}: {
  item: FollowUp;
  members: MemberList;
  onDone: (f: FollowUp) => void;
  onConflict: () => void;
}) {
  const w = useWords(),
    { client } = useCore(),
    { locale } = useExperience();
  const [assignee, setAssignee] = useState(item.assignee?.userId ?? "");
  const [due, setDue] = useState<DueKind>(item.due_at ? "keep" : "none");
  const [at, setAt] = useState(item.due_at ? dueToInput(item.due_at) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const active = (members.list ?? []).filter((m) => m.active);
  const options = [
    { value: "", label: w("Nobody", "Tiada sesiapa") },
    ...active.map((m) => ({ value: m.user_id, label: m.email })),
  ];
  const dueOptions: { value: DueKind; label: string }[] = [
    ...(item.due_at ? [{ value: "keep" as const, label: w("Keep the current time", "Kekalkan masa semasa") }] : []),
    { value: "none", label: w("No due time", "Tiada masa") },
    { value: "today", label: w("Today", "Hari ini") },
    { value: "tomorrow", label: w("Tomorrow", "Esok") },
    { value: "at", label: w("Date and time", "Tarikh dan masa") },
  ];
  return (
    <form
      className="follow-up-assign"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving) return;
        const now = new Date();
        const dueAt =
          due === "keep"
            ? item.due_at
            : due === "none"
              ? null
              : due === "at"
                ? dueFromInput(at) ?? null
                : dueChoice(due, now);
        if (due === "at" && !dueFromInput(at)) {
          setError(w("Choose a date and time.", "Pilih tarikh dan masa."));
          return;
        }
        setSaving(true);
        setError(undefined);
        try {
          const updated = await client.execute("assignFollowUp", {
            id: item.id,
            expectedRevision: item.revision,
            assigneeUserId: assignee || null,
            dueAt,
          });
          window.dispatchEvent(new Event(FOLLOW_UPS_CHANGED));
          onDone(updated);
        } catch (err) {
          setError(errorText(err, locale === "ms", "followUp"));
          if (err instanceof CoreError && needsReload(err.code)) onConflict();
        } finally {
          setSaving(false);
        }
      }}
    >
      {!members.list ? (
        <Loading error={members.error} />
      ) : (
        <>
          <Field label={w("Assign to (email)", "Serahkan kepada (e-mel)")}>
            <Picker value={assignee} onChange={setAssignee} options={options} />
          </Field>
          <Field label={w("Due · Kuala Lumpur time", "Masa · waktu Kuala Lumpur")}>
            <Picker value={due} onChange={setDue} options={dueOptions} />
          </Field>
          {due === "at" && (
            <Field label={w("Date and time", "Tarikh dan masa")}>
              <input type="datetime-local" step="900" required value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          )}
        </>
      )}
      {error && (
        <p className="storage-warning" role="alert">
          {error}
        </p>
      )}
      <div className="core-actions">
        <button className="button button-small button-dark" disabled={saving || !members.list}>
          {w("Save", "Simpan")}
        </button>
      </div>
    </form>
  );
}
