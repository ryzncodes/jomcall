"use client";
// Done, Dismiss, Confirm booking, Decline and Reopen for one follow-up item,
// the "Done. Undo" toast, and the follow-up list on the call page and in the
// chat. The local and hosted apps load this module on demand; the mock
// preview never does.
import { useEffect, useRef, useState } from "react";
import type { FollowUp } from "../../../packages/contracts/src/follow-up";
import { CoreError } from "@/lib/core/client";
import {
  ACTION_WORDS,
  CANCEL_KEEP,
  CANCEL_YES,
  cancelQuestion,
  commandOf,
  FOLLOW_UPS_CHANGED,
  KIND_WORDS,
  actionsFor,
  bookingStart,
  itemText,
  needsReload,
  refusalWords,
  stateWords,
  type FollowUpAction,
  type Pair,
} from "@/lib/core/follow-up-rules";
import { useExperience } from "../experience";
import { errorText, useCore, useWords } from "./state";

export function usePair() {
  const w = useWords();
  return (p: Pair) => w(p[0], p[1]);
}

export function useKlWhen() {
  const { locale } = useExperience();
  return (iso: string, withDate = true) =>
    new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      ...(withDate ? { dateStyle: "medium" as const } : {}),
      timeStyle: "short",
    }).format(new Date(iso));
}

export type RunResult =
  | { ok: true; item: FollowUp }
  | { ok: false; error: unknown; code: string | null };

// One command at a time per screen; a second tap while one runs is ignored.
export function useFollowUpRun() {
  const { client } = useCore();
  const lock = useRef(false);
  const [busy, setBusy] = useState<string>();
  async function run(action: FollowUpAction, item: FollowUp): Promise<RunResult | undefined> {
    if (lock.current) return;
    lock.current = true;
    setBusy(item.id);
    const base = { id: item.id, expectedRevision: item.revision };
    const command = commandOf(action);
    try {
      if (!command) throw new Error("NOT_A_COMMAND");
      const updated =
        command === "confirm"
          ? await client.execute("confirmFollowUpBooking", base)
          : command === "reopen"
            ? await client.execute("reopenFollowUp", base)
            : await client.execute("closeFollowUp", {
                ...base,
                state: command === "close_done" ? "done" : "dismissed",
              });
      window.dispatchEvent(new Event(FOLLOW_UPS_CHANGED));
      return { ok: true, item: updated };
    } catch (error) {
      return { ok: false, error, code: error instanceof CoreError ? error.code : null };
    } finally {
      lock.current = false;
      setBusy(undefined);
    }
  }
  return { run, busy };
}

// What the screen says after a command: a refusal in words, or nothing.
export type Said = { id: string; text: string } | null;

// Runs a command and, on a CONFLICT or NOT_FOUND, reads the item again
// through `find` (undefined: it is gone) before choosing the words.
export function useFollowUpCommand(find: (id: string) => Promise<FollowUp | undefined>) {
  const { locale } = useExperience();
  const ms = locale === "ms";
  const { run, busy } = useFollowUpRun();
  const [said, setSaid] = useState<Said>(null);
  async function act(action: FollowUpAction, item: FollowUp) {
    setSaid(null);
    const r = await run(action, item);
    if (!r) return;
    if (r.ok) return r.item;
    if (needsReload(r.code)) {
      let again: FollowUp | undefined;
      try {
        again = await find(item.id);
      } catch {
        again = undefined;
      }
      const words = refusalWords(r.code, action, !!again);
      setSaid({ id: item.id, text: words ? words[ms ? 1 : 0] : errorText(r.error, ms) });
      return;
    }
    setSaid({ id: item.id, text: errorText(r.error, ms) });
  }
  return { act, busy, said, clear: () => setSaid(null) };
}

export function ActionButtons({
  item,
  busy,
  onAct,
}: {
  item: FollowUp;
  busy: boolean;
  onAct: (a: FollowUpAction) => void;
}) {
  const say = usePair(),
    when = useKlWhen(),
    { href, t } = useExperience();
  // reopen_booking asks first: reopening cancels the confirmed booking.
  const [asking, setAsking] = useState(false);
  if (asking) {
    const start = bookingStart(item);
    return (
      <div className="follow-up-ask" role="group">
        <p>{say(cancelQuestion(start ? when(start) : undefined))}</p>
        <button
          type="button"
          className="button button-small button-dark"
          disabled={busy}
          onClick={() => {
            setAsking(false);
            onAct("reopen_booking");
          }}
        >
          {say(CANCEL_YES)}
        </button>
        <button type="button" className="button button-small secondary-button" onClick={() => setAsking(false)}>
          {say(CANCEL_KEEP)}
        </button>
      </div>
    );
  }
  return (
    <>
      {actionsFor(item).map((a, i) =>
        a === "bookings" ? (
          <a key={a} className="button button-small secondary-button" href={href("/app/bookings")}>
            {t.crm.bookings}
          </a>
        ) : (
          <button
            key={a}
            type="button"
            className={`button button-small ${i === 0 && a !== "reopen" && a !== "reopen_booking" ? "button-dark" : "secondary-button"}`}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => (a === "reopen_booking" ? setAsking(true) : onAct(a))}
          >
            {say(ACTION_WORDS[a])}
          </button>
        ),
      )}
    </>
  );
}

// Shown for about five seconds after an item is closed. Undo reopens it at
// the revision the close returned (a confirmed booking is cancelled again).
export function UndoToast({
  item,
  onUndone,
  onClose,
}: {
  item: FollowUp | null;
  onUndone: (item: FollowUp) => void;
  onClose: () => void;
}) {
  const w = useWords();
  const { run, busy } = useFollowUpRun();
  const { locale } = useExperience();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!item) return;
    setError(undefined);
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.revision]);
  if (!item && !error) return null;
  return (
    <div className="follow-up-toast" role="status" aria-live="polite">
      {error ? (
        <>
          <span>{error}</span>
          <button type="button" onClick={() => setError(undefined)}>
            {w("Close", "Tutup")}
          </button>
        </>
      ) : item ? (
        <>
          <span>
            {item.kind === "booking" && item.state === "done"
              ? w("Booking confirmed.", "Tempahan disahkan.")
              : w("Done.", "Selesai.")}
          </span>
          <button
            type="button"
            disabled={!!busy}
            onClick={async () => {
              const r = await run("reopen", item);
              if (!r) return;
              if (r.ok) onUndone(r.item);
              else {
                const words = refusalWords(r.code, "reopen", false);
                setError(words ? words[locale === "ms" ? 1 : 0] : errorText(r.error, locale === "ms"));
              }
              onClose();
            }}
          >
            {w("Undo", "Buat asal")}
          </button>
        </>
      ) : null}
    </div>
  );
}

// The call page's and the chat's follow-ups: kind, text, state in words and
// the same buttons as the follow-up page. `load` reads the source again and
// returns its items; the screen then shows them.
export function FollowUpInline({
  items,
  openOnly,
  load,
}: {
  items: FollowUp[];
  // The chat shows open items only; one closed here stays until its Undo ends.
  openOnly?: boolean;
  load: () => Promise<FollowUp[]>;
}) {
  const w = useWords(),
    say = usePair(),
    when = useKlWhen();
  const [undo, setUndo] = useState<FollowUp | null>(null);
  // The source's poll replaces the list; a command's reload does too.
  const [list, setList] = useState(items);
  useEffect(() => setList(items), [items]);
  const reload = async () => {
    const fresh = await load().catch(() => undefined);
    if (fresh) setList(fresh);
    return fresh;
  };
  const { act, busy, said } = useFollowUpCommand(async (id) =>
    (await reload())?.find((f) => f.id === id),
  );
  const shown = list.filter(
    (f) => !openOnly || f.state === "open" || f.id === undo?.id || f.id === said?.id,
  );
  if (!shown.length && !undo) return null;
  return (
    <section className="follow-up-inline" aria-label={w("To follow up", "Untuk disusuli")}>
      <h3>{w("To follow up", "Untuk disusuli")}</h3>
      <ul>
        {shown.map((f) => {
          const text = itemText(f);
          const start = bookingStart(f);
          return (
            <li key={f.id}>
              <p>
                <strong>{say(KIND_WORDS[f.kind])}</strong>
                {" · "}
                <span>{say(stateWords(f))}</span>
              </p>
              {(text || start) && (
                <p dir="auto">
                  {f.kind === "handoff" && text
                    ? w(`Reason: ${text}`, `Sebab: ${text}`)
                    : text}
                  {text && start ? " · " : ""}
                  {start ? when(start) : ""}
                </p>
              )}
              {said?.id === f.id && (
                <p className="storage-warning" role="alert">
                  {said.text}
                </p>
              )}
              {(!openOnly || f.state === "open") && (
                <div className="core-actions">
                  <ActionButtons
                    item={f}
                    busy={busy === f.id}
                    onAct={async (a) => {
                      const done = await act(a, f);
                      if (done && done.state !== "open") setUndo(done);
                      if (done && done.state === "open") setUndo(null);
                      if (done) await reload();
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <UndoToast
        item={undo}
        onUndone={() => void reload()}
        onClose={() => setUndo(null)}
      />
    </section>
  );
}
