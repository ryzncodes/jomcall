"use client";
// Stage 3: one page to check. Prices read from documents first, then cards
// for hours and first words, the answered facts with Edit, what is still
// missing, and a keep-or-replace choice for every value already set on the
// agent. One button applies it all; price rows still unconfirmed are left
// out and cannot be reached again from this flow.
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CoreError } from "@/lib/core/client";
import type {
  SetupItem,
  SetupQuestionView,
} from "../../../../packages/contracts/src/setup";
import type { SetupUpload } from "../../../../packages/contracts/src/setup-upload";
import { useCore, useWords, errorText } from "../state";
import { useExperience } from "../../experience";
import { HOSTED } from "@/lib/hosted";
import {
  packOf,
  useAutosave,
  useLanding,
  useSetup,
  SaveMark,
  SetupNotice,
  type PackInfo,
} from "./flow";
import { RemoveFileConfirm, UploadProblems, failDetail } from "./bring";
import { LinksCard } from "./links-card";
import {
  amountText,
  applyButtonText,
  applyConfirmText,
  applySummary,
  askAgainWhy,
  bulkRemovable,
  bulkSlot,
  bulkText,
  checkReason,
  choiceKey,
  chooseRow,
  conflictText,
  duplicateText,
  factFlagged,
  groupRows,
  layoutOf,
  leftOutText,
  liveRows,
  needCheckIds,
  onlyReadProgress,
  overLimit,
  overLimitText,
  priceReplace,
  readPrice,
  reasonParts,
  removeFailedText,
  rowActions,
  rowChanges,
  rowName,
  rowPayload,
  rowStatusText,
  skippedText,
  senderShown,
  sendingLabel,
  splitPlan,
  stableLayout,
  uploadLabel,
  uploadName,
  useThisSteps,
  useThisText,
  createSettle,
  layoutKey,
  type ApplySummary,
  type Settle,
  type RowActions,
  type RowEditValues,
  type RowLayout,
} from "./rules";
import {
  HoursEditor,
  WordsEditor,
  defaultHours,
  hoursFrom,
  hoursSummary,
  hoursValid,
  weekdaysOf,
  wordsFrom,
  wordsValid,
  type FirstWords,
  type Hours,
} from "./interview";

type Words = (en: string, ms: string) => string;
type Choice = "keep" | "new";

// The review page's one settle guard (rules.ts: createSettle). Every
// confirming or destructive control runs through settled(), which does
// nothing while the layout is still settling (SETTLE_MS after the last
// action or layout change) and otherwise touches the guard and acts.
const SettleContext = createContext<Settle>(createSettle());
const useSettle = () => useContext(SettleContext);
function settled(guard: Settle, act: () => void) {
  const now = performance.now();
  if (!guard.ready(now)) return;
  guard.touch(now);
  act();
}
// A harmless page change (Keep current): it always acts, and touches the
// guard because it can change what is shown.
function touched(guard: Settle, act: () => void) {
  guard.touch(performance.now());
  act();
}

const factText = (v: unknown) =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.join(", ")
      : v === undefined || v === null
        ? ""
        : JSON.stringify(v);

export function Review({
  packs,
  dismissed,
  choices,
  onChoice,
  onAdd,
  onBring,
  onDismiss,
  onApplied,
}: {
  packs: PackInfo[];
  dismissed: string[];
  // Default for every conflict is "keep".
  choices: Record<string, Choice>;
  onChoice: (itemId: string, choice: Choice) => void;
  onAdd: (q: SetupQuestionView) => void;
  // Opens the "bring a document" stage; absent when reading is off.
  onBring?: () => void;
  onDismiss: (id: string) => void;
  onApplied: () => void;
}) {
  const { client, refresh } = useCore(),
    w = useWords(),
    { locale } = useExperience(),
    store = useSetup();
  const { view } = store;
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<unknown>();
  // The 409 after apply came only from a document finishing its read.
  const [readMoved, setReadMoved] = useState(false);
  // The counts the question was asked with; null when no question is open.
  const [asked, setAsked] = useState<ApplySummary["counts"] | null>(null);
  // Prices came in after the owner answered the question: said on the page,
  // since the question itself may have nothing left to ask.
  const [arrived, setArrived] = useState(false);
  // "Remove all that still need checking" is running: every row action and
  // the apply buttons wait.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [fixFirst, setFixFirst] = useState(false);
  const [allMissing, setAllMissing] = useState(false);
  const [said, setSaid] = useState("");
  // Price fields whose text is not a price: apply waits until they are fixed.
  const invalid = useRef(new Set<string>());
  const backRef = useRef<HTMLButtonElement>(null);
  // Focus goes here when the control the owner used goes away (a removed
  // row, a removed file), never onto another row's button.
  const statusRef = useRef<HTMLParagraphElement>(null);
  // preventScroll: the status line sits at the top of the page.
  const focusStatus = () => statusRef.current?.focus({ preventScroll: true });
  const heading = useLanding<HTMLHeadingElement>("review");
  const label = (i: SetupItem) => {
    const f = packs
      .find((p) => p.id === packOf(i))
      ?.facts.find((x) => x.key === i.key)?.label;
    return f
      ? w(f.en, f.ms)
      : String((i.payload as { title?: unknown })?.title ?? i.key);
  };
  const conflictOf = (i: SetupItem) =>
    view.conflicts.find((c) => c.itemId === i.id);
  const hours = view.items.find((i) => i.kind === "schedule");
  const words = view.items.find((i) => i.kind === "settings");
  // Answers removed from their check block on this visit stay folded in
  // place with Undo (the state each had then), so the next card never
  // slides up under the owner's finger.
  const [factFolds, setFactFolds] = useState<
    Map<string, "pending" | "confirmed">
  >(() => new Map());
  const removeItem = useRemove();
  const setItemState = useItemState();
  // The links have their own card below the hours and first words.
  const links = view.items.find((i) => i.kind === "fact" && i.key === "social_links");
  const facts = view.items.filter(
    (i) =>
      i.kind === "fact" &&
      i.key !== "social_links" &&
      (i.state !== "removed" || i.id === editing || factFolds.has(i.id)),
  );
  const unfoldFact = (id: string) =>
    setFactFolds((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  const missing = view.missing.filter(
    (m) => !dismissed.includes(`missing:${m.pack}:${m.key}`),
  );
  // What the button will do, live: the planner re-plans price rows with
  // every "Use new" the owner picked.
  // Files still being sent from this browser count as not in yet; facts
  // whose field is not in their pack are not counted (apply skips them).
  const summaryOpts = { senders: store.uploads.senders, packs };
  const summary = applySummary(view, choices, w, summaryOpts);
  const blocked = overLimit(summary.totals);
  const leftOut = leftOutText(summary.counts, w);
  const question = asked ? applyConfirmText(summary.counts, w) : null;
  // The price section shows with price rows or files; without it the
  // button keeps its old words.
  const showPrices = liveRows(view.items).length > 0 || view.uploads.length > 0;
  const locked = busy || bulkRunning;

  // One polite line announces what changed: a file read, a row confirmed or
  // removed, a choice made.
  const announce = (text: string) => setSaid(text);
  const uploadSig = view.uploads.map((u) => `${u.id}:${u.state}`).join("|");
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const next = new Map(view.uploads.map((u) => [u.id, u.state] as const));
    if (seen.current)
      for (const u of view.uploads) {
        const before = seen.current.get(u.id);
        if (before && before !== u.state && (u.state === "done" || u.state === "failed"))
          setSaid(`${uploadName(u, w)}: ${uploadLabel(u, w, undefined, undefined, true)}`);
      }
    seen.current = next;
    // Runs when an upload's state changes, not on every view.
  }, [uploadSig]);
  useEffect(() => {
    if (asked && question) backRef.current?.focus();
    // Nothing left to ask (the owner fixed the rows): the question closes
    // for good, so a later poll cannot bring it back unprompted.
    if (asked && !question) setAsked(null);
  }, [asked, question !== null]);

  // The settle guard: touched by every action (settled) and whenever the
  // rows or their states change, or the page's height changes for any other
  // reason (a fold, a slot, a file group, an edit panel, a wrap).
  const [guard] = useState(createSettle);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rowsKey = layoutKey(view);
  useLayoutEffect(() => {
    guard.touch(performance.now());
  }, [guard, rowsKey]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => guard.touch(performance.now()));
    watch.observe(el);
    return () => watch.disconnect();
  }, [guard]);

  const apply = async (sure: boolean) => {
    setApplyError(undefined);
    setArrived(false);
    if (invalid.current.size) {
      setFixFirst(true);
      document
        .getElementById(`setup-price-${[...invalid.current][0]}`)
        ?.focus();
      return;
    }
    setFixFirst(false);
    setBusy(true);
    // The view apply is decided on, taken after the last write; a 409 is
    // compared with this, never with a view a poll brought in meanwhile.
    let base = store.latest();
    try {
      if (!(await store.flushAll())) return;
      // Decided on the view as it is after the last write, not this render.
      base = store.latest();
      const sent = store.revision();
      const now = applySummary(base, choices, w, summaryOpts);
      if (overLimit(now.totals)) return;
      if (!sure && applyConfirmText(now.counts, w)) {
        setAsked(now.counts);
        return;
      }
      // More would be left out than when the owner answered, more prices
      // would be saved, or a file named as still being read is no longer
      // being read: ask again, so nothing is saved unseen.
      const why = sure && asked ? askAgainWhy(asked, now.counts) : null;
      if (why) {
        setAsked(now.counts);
        if (why === "arrived") setArrived(true);
        else if (why === "changed")
          announce(
            w(
              "Your files changed since the question was asked. Check it again.",
              "Fail anda berubah sejak soalan ini ditanya. Sila semaknya sekali lagi.",
            ),
          );
        else
          announce(
            w(
              "More would be left out now. Check the question again.",
              "Sekarang lebih banyak yang tidak akan dimasukkan. Sila semak soalan ini sekali lagi.",
            ),
          );
        return;
      }
      setAsked(null);
      await client.execute("applySetup", {
        id: store.agentId,
        expectedRevision: sent,
        // Only "Use new" replaces; anything left as it is stays current.
        replace: now.replace,
      });
      refresh();
      onApplied();
    } catch (e) {
      if (
        e instanceof CoreError &&
        (e.code === "CONFLICT" || e.code === "KNOWLEDGE_LIMIT")
      ) {
        // The latest rows are loaded; choices still valid are kept (they
        // live in the flow, by item id).
        const fresh = await store.reload();
        setReadMoved(
          e.code === "CONFLICT" &&
            !!fresh &&
            onlyReadProgress(base, fresh, store.removedHere),
        );
        setAsked(null);
      }
      setApplyError(e);
    } finally {
      setBusy(false);
    }
  };

  const choice = (i: SetupItem, current: string, next: string) => {
    const c = conflictOf(i);
    if (!c) return null;
    const value = choices[i.id] ?? "keep";
    const name = `setup-choice-${i.id}`;
    return (
      <fieldset className="setup-conflict">
        <legend>
          {w(
            "Your agent already has an answer here.",
            "Ejen anda sudah ada jawapan di sini.",
          )}
        </legend>
        <dl>
          <dt>{w("Current", "Sedia ada")}</dt>
          <dd>{current}</dd>
          <dt>{w("New", "Baharu")}</dt>
          <dd>{next}</dd>
        </dl>
        <div className="setup-choice">
          {(["keep", "new"] as const).map((k) => (
            <label key={k} className="setup-option">
              <input
                type="radio"
                name={name}
                checked={value === k}
                onChange={() =>
                  (k === "new" ? settled : touched)(guard, () => onChoice(i.id, k))
                }
              />
              <span>
                {k === "keep"
                  ? w("Keep current", "Kekalkan yang sedia ada")
                  : w("Use new", "Guna yang baharu")}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  };

  const limitCode =
    applyError instanceof CoreError && applyError.code === "KNOWLEDGE_LIMIT";
  const applyMessage =
    applyError instanceof CoreError && applyError.code === "BOOKINGS_AFFECTED"
      ? w(
          "Some future bookings fall outside these hours. Change the hours or move those bookings, then try again.",
          "Ada tempahan akan datang di luar waktu ini. Ubah waktu operasi atau pindahkan tempahan tersebut, kemudian cuba lagi.",
        )
      : limitCode && summary.counts.prices > 0
        ? w(
            "Your agent would have too many prices or call types. Remove a file or some rows, or remove a call type on the Agent page, then try again.",
            "Ejen anda akan ada terlalu banyak harga atau jenis panggilan. Buang satu fail atau beberapa baris, atau buang satu jenis panggilan di halaman Ejen, kemudian cuba lagi.",
          )
        : limitCode
          ? w(
              "Too many call types would be active on this agent. Remove one on the Agent page, then try again.",
              "Terlalu banyak jenis panggilan akan aktif pada ejen ini. Buang satu di halaman Ejen, kemudian cuba lagi.",
            )
          : null;

  return (
    <SettleContext.Provider value={guard}>
    <div className="setup-flow">
      <header className="setup-head">
        <h1 className="setup-title" ref={heading} tabIndex={-1}>
          {w("Here is what I understood", "Ini yang saya faham")}
        </h1>
        <p className="setup-lead">
          {w(
            "Fix anything that is wrong. Answers are saved when you confirm below. Callers hear them after you publish; opening hours apply to bookings straight away.",
            "Betulkan apa-apa yang salah. Jawapan disimpan apabila anda sahkan di bawah. Pemanggil mendengarnya selepas anda terbitkan; waktu operasi terus digunakan untuk tempahan.",
          )}
        </p>
        {onBring && (
          <button type="button" className="setup-link" onClick={onBring}>
            {w("Add a document", "Tambah fail atau senarai harga")}
          </button>
        )}
        <UploadProblems />
      </header>
      <div className="setup-body" ref={bodyRef}>
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          ref={statusRef}
          tabIndex={-1}
        >
          {said}
        </p>
        {showPrices && (
          <PriceSection
            summary={summary}
            choices={choices}
            onChoice={(id, c) => {
              for (const [k, v] of chooseRow(store.latest().items, id, c))
                onChoice(k, v);
            }}
            locked={bulkRunning}
            onBulk={setBulkRunning}
            focusStatus={focusStatus}
            announce={announce}
            onBring={onBring}
            onInvalid={(id, bad) => {
              if (bad) invalid.current.add(id);
              else invalid.current.delete(id);
              if (!invalid.current.size) setFixFirst(false);
            }}
          />
        )}
        {hours && (
          <HoursCard
            item={hours}
            open={editing === hours.id}
            onToggle={() => setEditing(editing === hours.id ? null : hours.id)}
            choice={(next) =>
              choice(hours, summaryOf(conflictOf(hours)?.current, w), next)
            }
          />
        )}
        {words && (
          <WordsCard
            item={words}
            open={editing === words.id}
            onToggle={() => setEditing(editing === words.id ? null : words.id)}
            choice={(next) => {
              const cur = wordsFrom(conflictOf(words)?.current);
              return choice(
                words,
                cur ? `${cur.greeting} ${cur.aiDisclosure}` : "",
                next,
              );
            }}
          />
        )}
        <LinksCard
          item={links}
          choice={(next) =>
            links ? choice(links, factText(conflictOf(links)?.current), next) : null
          }
          onConfirm={() => (links ? setItemState(links.id, "confirmed") : Promise.resolve(false))}
        />
        {facts.length > 0 && (
          <section className="setup-section" aria-labelledby="setup-facts">
            <h2 id="setup-facts">{w("Your answers", "Jawapan anda")}</h2>
            <ul className="setup-cards">
              {facts.map((i) => (
                <FactRow
                  key={i.id}
                  item={i}
                  label={label(i)}
                  open={editing === i.id}
                  onToggle={() => setEditing(editing === i.id ? null : i.id)}
                  announce={announce}
                  choice={(next) =>
                    choice(i, factText(conflictOf(i)?.current), next)
                  }
                  folded={
                    i.state === "removed" ? factFolds.get(i.id) ?? null : null
                  }
                  onRemove={async () => {
                    const r = await removeItem(i.id, (prev) =>
                      setFactFolds((m) => new Map(m).set(i.id, prev)),
                    );
                    if (r === "failed") unfoldFact(i.id);
                    return r;
                  }}
                  onUndo={async () => {
                    const prev = factFolds.get(i.id);
                    if (!prev || !(await setItemState(i.id, prev))) return false;
                    unfoldFact(i.id);
                    return true;
                  }}
                />
              ))}
            </ul>
          </section>
        )}
        {missing.length > 0 && (
          <section className="setup-section" aria-labelledby="setup-missing">
            <h2 id="setup-missing">{w("Still missing", "Masih tiada")}</h2>
            <p className="setup-hint">
              {w(
                "Optional. You can add these later on the Agent page. Your agent takes a message when callers ask about these.",
                "Pilihan. Anda boleh menambahnya kemudian di halaman Ejen. Ejen akan mengambil pesanan apabila pemanggil bertanya tentang perkara ini.",
              )}
            </p>
            <ul className="setup-cards" id="setup-missing-list">
              {(allMissing ? missing : missing.slice(0, 3)).map((m) => {
                const id = `missing:${m.pack}:${m.key}`;
                return (
                  <li key={id} className="setup-card setup-missing">
                    <span className="setup-card-value">{w(m.en, m.ms)}</span>
                    <div className="setup-card-actions">
                      <button
                        type="button"
                        className="setup-link"
                        onClick={async () => {
                          // Fields still being typed are sent first, as
                          // before "Add a document": a price field's value
                          // is dropped when it unmounts.
                          if (await store.flushAll())
                            onAdd({
                              id,
                              kind: "fact",
                              en: m.en,
                              ms: m.ms,
                              fills: ["facts." + m.key],
                            });
                        }}
                      >
                        {w("Add now", "Tambah sekarang")}
                      </button>
                      <button
                        type="button"
                        className="setup-link"
                        onClick={() => onDismiss(id)}
                      >
                        {w("Skip", "Langkau")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!allMissing && missing.length > 3 && (
              <button
                type="button"
                className="setup-link"
                aria-controls="setup-missing-list"
                aria-expanded={false}
                onClick={() => setAllMissing(true)}
              >
                {w(
                  `Show all ${missing.length}`,
                  `Lihat semua ${missing.length}`,
                )}
              </button>
            )}
          </section>
        )}
        <SaveMark />
        <SetupNotice error={store.error} />
        {applyError !== undefined && (
          <div className="storage-warning" role="alert">
            {applyMessage ??
              (applyError instanceof CoreError && applyError.code === "CONFLICT"
                ? readMoved
                  ? w(
                      "A document finished reading while you were checking. Its prices are now shown; check them and try again.",
                      "Satu dokumen selesai dibaca semasa anda menyemak. Harganya kini dipaparkan; semak dan cuba lagi.",
                    )
                  : w(
                      "Setup changed in another window. The latest answers are loaded; check them and try again.",
                      "Persediaan telah berubah di tetingkap lain. Jawapan terkini sudah dimuatkan; semak dan cuba lagi.",
                    )
                : errorText(applyError, locale === "ms"))}
          </div>
        )}
        {blocked && (
          <div className="storage-warning" role="alert">
            {overLimitText(w)}
          </div>
        )}
        {fixFirst && (
          <div className="storage-warning" role="alert">
            {w(
              "Fix the prices marked in red first.",
              "Betulkan harga yang bertanda merah dahulu.",
            )}
          </div>
        )}
        {arrived && (
          <p className="setup-hint" role="status">
            {w(
              "New prices came in from your files. Check them, then save again.",
              "Harga baharu masuk daripada fail anda. Semak harga itu, kemudian simpan semula.",
            )}
          </p>
        )}
        {question && (
          <div
            className="setup-confirm"
            role="group"
            aria-labelledby="setup-apply-ask"
          >
            <p id="setup-apply-ask" className="setup-hint">
              {question}
            </p>
            <div className="setup-card-actions setup-apply-ask">
              <button
                type="button"
                className="button button-small button-dark"
                disabled={locked || blocked}
                onClick={() => settled(guard, () => void apply(true))}
              >
                {applyButtonText(summary.counts, w, showPrices)}
              </button>
              <button
                type="button"
                ref={backRef}
                className="button button-small secondary-button"
                disabled={busy}
                onClick={() => setAsked(null)}
              >
                {w("Go back and check", "Kembali dan semak")}
              </button>
            </div>
          </div>
        )}
        <div className="setup-nav setup-nav-apply">
          <button
            type="button"
            className="button button-dark"
            disabled={locked || blocked}
            onClick={() => settled(guard, () => void apply(false))}
          >
            {busy
              ? w("Updating your draft…", "Mengemas kini draf…")
              : applyButtonText(summary.counts, w, showPrices)}
          </button>
          {leftOut && <p className="setup-hint setup-nav-note">{leftOut}</p>}
        </div>
        <p className="setup-hint">
          {w(
            HOSTED
              ? "This updates your draft agent. It does not publish."
              : "This updates your draft agent in this workspace. It does not publish.",
            HOSTED
              ? "Ini mengemas kini draf ejen anda. Ejen belum diterbitkan."
              : "Ini mengemas kini draf ejen dalam ruang kerja ini. Ejen belum diterbitkan.",
          )}
        </p>
      </div>
    </div>
    </SettleContext.Provider>
  );
}

function summaryOf(payload: unknown, w: Words) {
  const h = payload as { weekdays?: { start: string; end: string }[][] } | null;
  return h?.weekdays?.length === 7 ? hoursSummary(h.weekdays, w) : "";
}

// Saves an edit of a staged item. A skipped item comes back as pending.
function useItemSave<T>(item: SetupItem, payload: (v: T) => unknown) {
  const { client } = useCore(),
    store = useSetup();
  return useAutosave((v: T) =>
    store.write((expectedRevision) =>
      client.execute("saveSetupItem", {
        id: store.agentId,
        itemId: item.id,
        expectedRevision,
        payload: payload(v),
        ...(item.state === "removed" ? { state: "pending" as const } : {}),
      }),
    ),
  );
}

function EditButton({
  open,
  onToggle,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  const w = useWords();
  return (
    <button
      type="button"
      className="setup-link"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {open ? w("Done", "Siap") : w("Edit", "Sunting")}
    </button>
  );
}

function HoursCard({
  item,
  open,
  onToggle,
  choice,
}: {
  item: SetupItem;
  open: boolean;
  onToggle: () => void;
  choice: (next: string) => React.ReactNode;
}) {
  const { workspace } = useCore(),
    w = useWords();
  const timezone =
    workspace.locations.find((l) => l.primary_location)?.timezone ??
    "Asia/Kuala_Lumpur";
  const stored =
    item.state === "removed" ? null : hoursFrom(item.payload, timezone);
  const [value, setValue] = useState<Hours | null>(stored);
  const edited = useRef(false);
  const auto = useItemSave<Hours>(item, (h) => ({
    timezone: h.timezone,
    weekdays: weekdaysOf(h),
  }));
  const id = `setup-edit-${item.id}`;
  const text = value
    ? hoursSummary(weekdaysOf(value), w)
    : w("Skipped. Your current hours stay.", "Dilangkau. Waktu semasa kekal.");
  return (
    <section className="setup-card" aria-labelledby={`${id}-title`}>
      <div className="setup-card-row">
        <div>
          <h2 id={`${id}-title`} className="setup-card-label">
            {w("Opening hours", "Waktu operasi")}
          </h2>
          <p className="setup-card-value">{text}</p>
        </div>
        <EditButton
          open={open}
          controls={id}
          onToggle={async () => {
            // A skipped item comes back only after a real edit; opening and
            // closing it untouched keeps it skipped.
            if (open && item.state === "removed" && !edited.current)
              setValue(null);
            else if (open && value && hoursValid(value)) await auto.flush();
            if (!open && !value) setValue(defaultHours(timezone));
            onToggle();
          }}
        />
      </div>
      {open && (
        <div id={id}>
          <HoursEditor
            value={value ?? defaultHours(timezone)}
            onChange={(h) => {
              edited.current = true;
              setValue(h);
              if (hoursValid(h)) auto.change(h);
              else auto.cancel();
            }}
            onLeave={() => value && hoursValid(value) && void auto.flush()}
          />
        </div>
      )}
      {value && choice(text)}
    </section>
  );
}

function WordsCard({
  item,
  open,
  onToggle,
  choice,
}: {
  item: SetupItem;
  open: boolean;
  onToggle: () => void;
  choice: (next: string) => React.ReactNode;
}) {
  const w = useWords();
  const [value, setValue] = useState<FirstWords | null>(
    item.state === "removed" ? null : wordsFrom(item.payload),
  );
  const edited = useRef(false);
  const auto = useItemSave<FirstWords>(item, (v) => v);
  const id = `setup-edit-${item.id}`;
  const text = value
    ? `“${value.greeting} ${value.aiDisclosure}”`
    : w(
        "Skipped. Your current first words stay.",
        "Dilangkau. Kata-kata pembukaan semasa kekal.",
      );
  return (
    <section className="setup-card" aria-labelledby={`${id}-title`}>
      <div className="setup-card-row">
        <div>
          <h2 id={`${id}-title`} className="setup-card-label">
            {w(
              "First words on every call",
              "Kata-kata pertama setiap panggilan",
            )}
          </h2>
          <p className="setup-card-value">{text}</p>
        </div>
        <EditButton
          open={open}
          controls={id}
          onToggle={async () => {
            if (open && item.state === "removed" && !edited.current)
              setValue(null);
            else if (open && value && wordsValid(value)) await auto.flush();
            else if (open && value && !wordsValid(value))
              setValue(
                item.state === "removed" ? null : wordsFrom(item.payload),
              );
            if (!open && !value) setValue({ greeting: "", aiDisclosure: "" });
            onToggle();
          }}
        />
      </div>
      {open && value && (
        <div id={id}>
          <WordsEditor
            value={value}
            onChange={(v) => {
              edited.current = true;
              setValue(v);
              if (wordsValid(v)) auto.change(v);
              else auto.cancel();
            }}
            onLeave={() => wordsValid(value) && void auto.flush()}
          />
        </div>
      )}
      {value && choice(text)}
    </section>
  );
}

// Sets the state of a staged item (confirm, remove, or back to what it was
// for Undo) with the latest revision.
function useItemState() {
  const { client } = useCore(),
    store = useSetup();
  return (itemId: string, state: "pending" | "confirmed" | "removed") =>
    store.write((expectedRevision) =>
      client.execute("saveSetupItem", {
        id: store.agentId,
        itemId,
        expectedRevision,
        state,
      }),
    );
}

// Removes a staged item when its write's turn in the queue comes, if it is
// still pending or confirmed then (and `may` agrees, against the view at
// that moment). The state it had then goes to `onPrev` before the request,
// so the fold in place is ready before the view says removed, and Undo
// restores exactly that state (a write that raced the tap has landed).
function useRemove() {
  const { client } = useCore(),
    store = useSetup();
  return async (
    itemId: string,
    onPrev: (prev: "pending" | "confirmed") => void,
    may: (items: readonly SetupItem[]) => boolean = () => true,
  ): Promise<"removed" | "skipped" | "failed"> => {
    let sent = false;
    const ok = await store.write((expectedRevision) => {
      const items = store.latest().items;
      const cur = items.find((i) => i.id === itemId);
      sent = false;
      if (
        !cur ||
        (cur.state !== "pending" && cur.state !== "confirmed") ||
        !may(items)
      )
        return Promise.resolve(store.latest());
      sent = true;
      onPrev(cur.state);
      return client.execute("saveSetupItem", {
        id: store.agentId,
        itemId,
        expectedRevision,
        state: "removed",
      });
    });
    return !ok ? "failed" : sent ? "removed" : "skipped";
  };
}

// A removed row or card folds in place at the height it had (measured on
// every render before it folds), so nothing below it moves. Taps on its Undo
// go through the page's settle guard.
function useFold(gone: boolean) {
  const li = useRef<HTMLLIElement>(null);
  const height = useRef(0);
  useLayoutEffect(() => {
    // The exact height (not offsetHeight's whole pixels), so a fold of an
    // 87.5px row moves nothing below it by even 1px.
    if (!gone && li.current)
      height.current = li.current.getBoundingClientRect().height;
  });
  return {
    li,
    style:
      gone && height.current ? { minHeight: `${height.current}px` } : undefined,
  };
}

// The reader's reason after "Reason:"; its own words are English text, our
// fixed sentences among them are translated (rules.ts: reasonParts).
function Reason({
  reason,
  className,
  price = true,
}: {
  reason: string | null;
  className: string;
  price?: boolean;
}) {
  const w = useWords();
  const r = checkReason(reason, w, price);
  // Our own sentences in the page's language; the reader's words stay
  // English and are marked so.
  const parts = r.reader ? reasonParts(r.text, w) : [{ text: r.text, own: true }];
  return (
    <p className={className}>
      {r.label}{" "}
      {parts.map((x, i) =>
        x.own ? (
          <span key={i}>{x.text}</span>
        ) : (
          <span key={i} lang="en">
            {x.text}
          </span>
        ),
      )}
    </p>
  );
}

function FactRow({
  item,
  label,
  open,
  onToggle,
  announce,
  choice,
  folded,
  onRemove,
  onUndo,
}: {
  item: SetupItem;
  label: string;
  open: boolean;
  onToggle: () => void;
  announce: (text: string) => void;
  choice: (next: string) => React.ReactNode;
  // Removed on this visit from its check block: the state Undo restores.
  folded: "pending" | "confirmed" | null;
  onRemove: () => Promise<"removed" | "skipped" | "failed">;
  onUndo: () => Promise<boolean>;
}) {
  const { client } = useCore(),
    w = useWords(),
    store = useSetup();
  const setState = useItemState();
  const guard = useSettle();
  const [busy, setBusy] = useState(false);
  const fold = useFold(folded !== null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(
    factText((item.payload as { value?: unknown })?.value),
  );
  // Clearing an answer leaves it out; typing again brings it back.
  const auto = useAutosave((v: string) =>
    store.write((expectedRevision) =>
      client.execute(
        "saveSetupItem",
        v.trim()
          ? {
              id: store.agentId,
              itemId: item.id,
              expectedRevision,
              payload: { value: v },
              ...(item.state === "removed"
                ? { state: "pending" as const }
                : {}),
            }
          : {
              id: store.agentId,
              itemId: item.id,
              expectedRevision,
              state: "removed" as const,
            },
      ),
    ),
  );
  const id = `setup-edit-${item.id}`;
  // A fact read from a document that the reader was unsure of: left out
  // unless the owner confirms it. Editing the text does not confirm it.
  const flagged = factFlagged(item);
  // Once shown, the check block keeps its place for the visit (Confirm then
  // reads a disabled "Confirmed"), so the next card never slides up.
  const shown = useRef(false);
  const checking = flagged && !open && !!text.trim();
  useEffect(() => {
    if (checking) shown.current = true;
  });
  // Focus follows the fold: to Undo when folded, back to Remove after Undo.
  const wasFolded = useRef(false);
  useEffect(() => {
    const active = document.activeElement;
    const lost =
      !active || active === document.body || !!fold.li.current?.contains(active);
    if (folded && lost) undoRef.current?.focus();
    if (!folded && wasFolded.current && lost) removeRef.current?.focus();
    wasFolded.current = folded !== null;
  }, [folded !== null]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  if (folded)
    return (
      <li ref={fold.li} className="setup-card setup-card-gone" style={fold.style}>
        <button
          type="button"
          ref={undoRef}
          className="setup-link setup-undo"
          aria-label={w(`Undo removing ${label}`, `Buat asal: ${label}`)}
          aria-disabled={busy || undefined}
          onClick={() =>
            settled(
              guard,
              () =>
                void run(async () => {
                  if (await onUndo())
                    announce(w(`${label} is back`, `${label} dikembalikan`));
                }),
            )
          }
        >
          {w("Undo", "Buat asal")}
        </button>
        <p className="setup-hint">{w(`${label} removed.`, `${label} dibuang.`)}</p>
      </li>
    );
  return (
    <li ref={fold.li} className="setup-card" data-check={flagged || undefined}>
      <div className="setup-card-row">
        <div>
          <h3 className="setup-card-label">{label}</h3>
          {item.source === "import" && (
            <p className="setup-mark">
              {w("From your document", "Daripada dokumen anda")}
            </p>
          )}
          {!open && (
            <p className="setup-card-value">
              {text.trim() || w("Left out", "Tidak dimasukkan")}
            </p>
          )}
        </div>
        <EditButton
          open={open}
          controls={id}
          onToggle={async () => {
            if (open) await auto.flush();
            onToggle();
          }}
        />
      </div>
      {(checking || (shown.current && !open && text.trim())) && (
        <div className="setup-check">
          <p className="setup-check-title">
            {flagged ? w("Please check", "Sila semak") : w("Checked", "Sudah disemak")}
          </p>
          {/* Once confirmed the card says it was checked: no reason. */}
          {flagged && (
            <Reason reason={item.checkReason} className="setup-hint" price={false} />
          )}
          <div className="setup-card-actions">
            {flagged ? (
              <button
                type="button"
                className="button button-small button-dark"
                aria-label={w(`Confirm ${label}`, `Sahkan ${label}`)}
                aria-disabled={busy || undefined}
                onClick={() =>
                  settled(guard, () =>
                    void run(async () => {
                      if ((await auto.flush()) && (await setState(item.id, "confirmed")))
                        announce(w(`${label} confirmed`, `${label} disahkan`));
                    }),
                  )
                }
              >
                {w("Confirm", "Sahkan")}
              </button>
            ) : (
              <button
                type="button"
                className="button button-small button-dark"
                aria-disabled="true"
                aria-label={w(`${label} confirmed`, `${label} disahkan`)}
              >
                {w("Confirmed", "Disahkan")}
              </button>
            )}
            <button
              type="button"
              ref={removeRef}
              className="button button-small secondary-button"
              aria-label={w(`Remove ${label}`, `Buang ${label}`)}
              aria-disabled={busy || undefined}
              onClick={() =>
                settled(
                  guard,
                  () =>
                    void run(async () => {
                      auto.cancel();
                      const r = await onRemove();
                      if (r === "removed")
                        announce(w(`${label} removed`, `${label} dibuang`));
                      else if (r === "skipped") announce(skippedText(label, w));
                    }),
                )
              }
            >
              {w("Remove", "Buang")}
            </button>
          </div>
        </div>
      )}
      {open && (
        <div id={id} className="product-field">
          <label htmlFor={`${id}-text`}>{label}</label>
          <textarea
            id={`${id}-text`}
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              auto.change(e.target.value);
            }}
            onBlur={() => void auto.flush()}
          />
        </div>
      )}
      {!open && text.trim() && choice(text)}
    </li>
  );
}

// ---- Prices and services ---------------------------------------------------

function PriceSection({
  summary,
  choices,
  onChoice,
  locked,
  onBulk,
  focusStatus,
  announce,
  onBring,
  onInvalid,
}: {
  summary: ApplySummary;
  choices: Record<string, Choice>;
  onChoice: (id: string, choice: Choice) => void;
  // "Remove all" is running: every row waits.
  locked: boolean;
  onBulk: (running: boolean) => void;
  focusStatus: () => void;
  announce: (text: string) => void;
  // Opens the bring stage, where a failed send can be retried.
  onBring?: () => void;
  onInvalid: (id: string, bad: boolean) => void;
}) {
  const w = useWords(),
    store = useSetup();
  const { view, now, queuedSince } = store;
  const setState = useItemState();
  const removeItem = useRemove();
  const guard = useSettle();
  const [bulk, setBulk] = useState<
    "idle" | "asking" | { done: number; total: number }
  >("idle");
  const [bulkNote, setBulkNote] = useState("");
  const bulkKeep = useRef<HTMLButtonElement>(null);
  const bulkOpen = useRef<HTMLButtonElement>(null);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  // Rows removed on this visit and the state each had then. They stay folded
  // in place with Undo for the whole visit (the server takes them back until
  // apply); counts and apply skip them as removed.
  const [removed, setRemoved] = useState<Map<string, "pending" | "confirmed">>(
    () => new Map(),
  );
  const mark = (id: string, prev: "pending" | "confirmed") =>
    setRemoved((m) => new Map(m).set(id, prev));
  const unmark = (id: string) =>
    setRemoved((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  // Removes a row when its write's turn comes (the state it had then is kept
  // for Undo); `may` decides against the view at that moment.
  const removeRow = async (
    id: string,
    may?: (items: readonly SetupItem[]) => boolean,
  ) => {
    const r = await removeItem(id, (prev) => mark(id, prev), may);
    if (r === "failed") unmark(id);
    return r;
  };
  const restore = async (id: string) => {
    const prev = removed.get(id);
    if (!prev || !(await setState(id, prev))) return false;
    unmark(id);
    return true;
  };
  // Files removed on this visit: their group leaves a "<name> removed"
  // placeholder at the height the group had when the removal was confirmed
  // (no Undo: the server deletes the file's pending rows), so the next group
  // does not slide up.
  const groupEls = useRef(new Map<string, HTMLDivElement>());
  const [goneFiles, setGoneFiles] = useState<
    Map<string, { name: string; height: number }>
  >(() => new Map());
  const fileRemoving = (id: string, name: string) => {
    const height =
      groupEls.current.get(id)?.getBoundingClientRect().height ?? 0;
    setGoneFiles((m) => new Map(m).set(id, { name, height }));
  };
  const fileKept = (id: string) =>
    setGoneFiles((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  const live = new Map(summary.plans.map((p) => [p.id, p]));
  // The order is stable for the whole visit (stableLayout): worked out when
  // the page is entered; later rows are only added in their place.
  const layoutRef = useRef<RowLayout | null>(null);
  const positions = new Map(
    view.items
      .filter((i) => i.position !== undefined)
      .map((i) => [i.id, i.position!] as const),
  );
  const layout = stableLayout(
    layoutRef.current,
    layoutOf(groupRows(view.items, summary.plans, view.uploads.map((u) => u.id))),
    positions,
  );
  layoutRef.current = layout;
  const reading = view.uploads.filter(
    (u) => u.state === "queued" || u.state === "reading",
  );
  const unsure = needCheckIds(summary.plans);
  // The "Remove all" slot is there from the first render whenever a price
  // row shows (disabled with its reason below 2), so it never appears later
  // and pushes the file groups down; it keeps the tallest height it has had.
  const slotRef = useRef<HTMLDivElement>(null);
  const slotHeight = useRef(0);
  useLayoutEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    if (el.offsetHeight > slotHeight.current) {
      slotHeight.current = el.offsetHeight;
      el.style.minHeight = `${slotHeight.current}px`;
    }
  });
  // Leaving the question (Keep, or nothing left to ask) puts focus back on
  // the link once it is rendered again; the end of a run does not (focus is
  // on the status line then).
  const refocusLink = useRef(false);
  useEffect(() => {
    if (bulk === "asking") bulkKeep.current?.focus();
    // Nothing left to remove: no "Remove 0" question.
    if (bulk === "asking" && unsure.length < 2) {
      refocusLink.current = true;
      setBulk("idle");
    }
  }, [bulk, unsure.length]);
  // A change of the slot (question, progress, note) moves its controls.
  useLayoutEffect(() => {
    guard.touch(performance.now());
  }, [guard, bulk, bulkNote]);
  useEffect(() => {
    if (bulk !== "idle" || !refocusLink.current) return;
    refocusLink.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || slotRef.current?.contains(active))
      bulkOpen.current?.focus();
  }, [bulk]);

  // Fields still being typed are sent first; then each row is checked again
  // inside its own queued write, against the view at that moment: a row the
  // owner confirmed or priced meanwhile is kept.
  const removeUnsure = async () => {
    const ids = needCheckIds(summary.plans);
    const total = ids.length;
    let done = 0,
      stopped = false;
    setBulkNote("");
    onBulk(true);
    focusStatus();
    setBulk({ done: 1, total });
    try {
      if (!(await store.flushAll())) stopped = true;
      else
        for (const [n, id] of ids.entries()) {
          // Progress names the row being worked on: never "0 of N".
          setBulk({ done: n + 1, total });
          const r = await removeRow(id, (items) =>
            bulkRemovable(items, priceReplace(items, choicesRef.current), id),
          );
          if (r === "failed") {
            stopped = true;
            break;
          }
          if (r === "removed") done++;
        }
    } finally {
      onBulk(false);
      setBulk("idle");
    }
    const note = stopped
      ? bulkText("stopped", { done, total }, w)
      : bulkText(done ? "done" : "none", { done, total }, w);
    if (stopped) setBulkNote(note);
    announce(note);
  };

  const row = (id: string) => {
    const i = view.items.find((x) => x.id === id);
    if (!i) return null;
    const isLive =
      i.outcome !== undefined && (i.state === "pending" || i.state === "confirmed");
    const gone = i.state === "removed" ? removed.get(id) ?? null : null;
    if (!isLive && !gone) return null;
    const plan = live.get(id);
    const winner = plan?.duplicateOf
      ? view.items.find((x) => x.id === plan.duplicateOf)
      : undefined;
    const p = rowPayload(i.payload);
    return (
      <PriceRow
        key={id}
        item={i}
        actions={rowActions(i.outcome, plan?.outcome, i.state, !!p.item.trim())}
        winner={winner ? rowPayload(winner.payload) : null}
        choice={choices[choiceKey(i)] ?? "keep"}
        onChoice={onChoice}
        replace={summary.replace}
        locked={locked}
        gone={gone}
        onRemove={(other) => removeRow(other ?? id)}
        onUndo={() => restore(id)}
        announce={announce}
        onInvalid={onInvalid}
      />
    );
  };
  const rows = (ids: string[]) => ids.map(row).filter((x) => x !== null);
  const attention = rows([...layout.check, ...layout.conflict, ...layout.duplicate]);
  const files = layout.files.map((f) => ({ f, listed: rows(f.ids) }));
  const anyRow = attention.length > 0 || files.some((x) => x.listed.length > 0);
  const slot = bulkSlot(unsure.length, w);
  const running = typeof bulk === "object";
  const slotLine = running
    ? bulkText("progress", bulk, w)
    : bulk === "asking"
      ? bulkText("ask", { done: 0, total: unsure.length }, w)
      : bulkNote || slot.hint;

  // While this browser is still sending a file (the owner moved on from the
  // bring stage), its progress shows, as there.
  const senderOf = (u: SetupUpload) => {
    const s = store.uploads.senders.find((x) => x.uploadId === u.id);
    return s && senderShown(u) ? s : undefined;
  };
  const fileLabel = (u: SetupUpload) => {
    const s = senderOf(u);
    return s
      ? sendingLabel(s, w)
      : uploadLabel(u, w, now, queuedSince.get(u.id), true);
  };

  return (
    <section className="setup-section setup-prices" aria-labelledby="setup-prices">
      <h2 id="setup-prices">{w("Prices and services", "Harga dan perkhidmatan")}</h2>
      {reading.map((u) => (
        <p key={u.id} className="setup-hint setup-reading">
          {w(
            `Still reading ${uploadName(u, w)}…`,
            `Masih membaca ${uploadName(u, w)}…`,
          )}
        </p>
      ))}
      {attention.length > 0 && (
        <div className="setup-price-group">
          <h3 className="setup-group-title">
            {w("Needs your attention", "Perlu perhatian anda")}
          </h3>
          <PriceHead />
          <ul className="setup-price-list">{attention}</ul>
        </div>
      )}
      {anyRow && (
        <div
          ref={slotRef}
          className="setup-bulk"
          role="group"
          aria-labelledby="setup-bulk-line"
        >
          <div className="setup-card-actions">
            {bulk === "asking" ? (
              <>
                {/* Keep first: the control under the finger that opened the
                    question is the harmless one. */}
                <button
                  type="button"
                  ref={bulkKeep}
                  className="button button-small secondary-button"
                  onClick={() => {
                    refocusLink.current = true;
                    setBulk("idle");
                  }}
                >
                  {w("Keep", "Kekalkan")}
                </button>
                <button
                  type="button"
                  className="button button-small button-dark"
                  onClick={() => settled(guard, () => void removeUnsure())}
                >
                  {w("Remove", "Buang")}
                </button>
              </>
            ) : (
              <button
                type="button"
                ref={bulkOpen}
                className="setup-link"
                aria-expanded={false}
                aria-disabled={!slot.enabled || running || locked || undefined}
                onClick={() => {
                  if (!slot.enabled || running || locked) return;
                  settled(guard, () => {
                    setBulkNote("");
                    setBulk("asking");
                  });
                }}
              >
                {slot.label}
              </button>
            )}
          </div>
          <p
            id="setup-bulk-line"
            className={bulkNote && !running && bulk === "idle" ? "setup-error" : "setup-hint"}
          >
            {slotLine}
          </p>
        </div>
      )}
      {files.map(({ f, listed }) => {
        const upload = f.uploadId
          ? view.uploads.find((u) => u.id === f.uploadId)
          : undefined;
        // Held from the moment the removal is confirmed, whether the rows
        // and the file leave the view together or apart.
        const noted = f.uploadId ? goneFiles.get(f.uploadId) : undefined;
        const gone = !upload ? noted : undefined;
        if (!upload && !gone && !listed.length) return null;
        const s = upload ? senderOf(upload) : undefined;
        return (
          <div
            className={
              gone ? "setup-price-group setup-file-gone" : "setup-price-group"
            }
            key={f.uploadId ?? "earlier"}
            style={noted?.height ? { minHeight: `${noted.height}px` } : undefined}
            ref={(el) => {
              if (!f.uploadId) return;
              if (el) groupEls.current.set(f.uploadId, el);
              else groupEls.current.delete(f.uploadId);
            }}
          >
            {upload ? (
              <FileHead
                upload={upload}
                label={fileLabel(upload)}
                failure={s?.phase === "failed" ? failDetail(s, w, true) : null}
                onBring={onBring}
                sending={!!s && s.phase !== "failed"}
                locked={locked}
                focusStatus={focusStatus}
                announce={announce}
                onRemoving={() =>
                  fileRemoving(upload.id, uploadName(upload, w))
                }
                onKept={() => fileKept(upload.id)}
              />
            ) : gone ? (
              <h3 className="setup-group-title">
                {w(`${gone.name} removed`, `${gone.name} dibuang`)}
              </h3>
            ) : (
              <h3 className="setup-group-title">
                {w("From a removed file", "Daripada fail yang dibuang")}
              </h3>
            )}
            {listed.length > 0 && (
              <>
                <PriceHead />
                <ul className="setup-price-list">{listed}</ul>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

// Column names for the wide table; each row's controls carry their own
// labels, so this is hidden from screen readers.
function PriceHead() {
  const w = useWords();
  return (
    <div className="setup-price-head" aria-hidden="true">
      <span>{w("Item", "Item")}</span>
      <span>{w("Unit", "Unit")}</span>
      <span>{w("Price", "Harga")}</span>
      <span />
    </div>
  );
}

// "From: <file name>", its state, "View file" for a photo, and remove.
function FileHead({
  upload,
  label,
  failure,
  onBring,
  sending,
  locked,
  focusStatus,
  announce,
  onRemoving,
  onKept,
}: {
  upload: SetupUpload;
  label: string;
  // Why this browser's send of it failed, when it did.
  failure: string | null;
  onBring?: () => void;
  // This browser is still sending it: not an interrupted upload.
  sending: boolean;
  locked: boolean;
  focusStatus: () => void;
  announce: (text: string) => void;
  // The removal is confirmed (the group's height is noted for its
  // placeholder), or it failed (the placeholder is dropped).
  onRemoving: () => void;
  onKept: () => void;
}) {
  const w = useWords(),
    store = useSetup();
  const guard = useSettle();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const name = uploadName(upload, w);
  const bad =
    upload.state === "failed" ||
    (upload.state === "uploading" && !sending) ||
    failure !== null;
  const done = upload.state === "done";
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);
  const remove = async () => {
    onRemoving();
    setRemoving(true);
    setFailed(false);
    const ok = await store.uploads.remove({
      key: store.uploads.rowKey(upload.id),
      uploadId: upload.id,
    });
    setRemoving(false);
    if (ok) {
      // This heading and its rows go: focus to the status line.
      focusStatus();
      announce(w(`${name} removed`, `${name} dibuang`));
    } else {
      onKept();
      setFailed(true);
      setConfirming(false);
      removeRef.current?.focus();
    }
  };
  return (
    <div className="setup-file-head">
      <div className="setup-card-row">
        <div>
          <h3 className="setup-group-title">
            {w(`From: ${name}`, `Daripada: ${name}`)}
          </h3>
          <p className={bad ? "setup-error" : "setup-hint"}>{label}</p>
          {failure && <p className="setup-error">{failure}</p>}
          {failure && onBring && (
            <button type="button" className="setup-link" onClick={onBring}>
              {w("Add a document", "Tambah fail atau senarai harga")}
            </button>
          )}
          {failed && <p className="setup-error">{removeFailedText(w)}</p>}
        </div>
        <div className="setup-card-actions setup-file-actions">
          {upload.kind === "image" &&
            done &&
            (upload.bytesDeletedAt ? (
              <span className="setup-hint">
                {w("File no longer kept", "Fail tidak lagi disimpan")}
              </span>
            ) : (
              <ViewFile upload={upload} name={name} />
            ))}
          <button
            type="button"
            ref={removeRef}
            className="setup-link"
            aria-expanded={confirming}
            aria-label={
              done
                ? w(`Remove everything from ${name}`, `Buang semua daripada ${name}`)
                : w(`Remove ${name}`, `Buang ${name}`)
            }
            disabled={removing || locked}
            onClick={() => settled(guard, () => setConfirming(true))}
          >
            {done
              ? w("Remove everything from this file", "Buang semua daripada fail ini")
              : w("Remove", "Buang")}
          </button>
        </div>
      </div>
      {confirming && (
        <RemoveFileConfirm
          id={`setup-file-confirm-${upload.id}`}
          removing={removing}
          keepRef={keepRef}
          onRemove={() => settled(guard, () => void remove())}
          onKeep={() => {
            setConfirming(false);
            removeRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

// "View file" for a photo: its chunks are fetched in order and joined into
// one JPEG (photos are always shrunk to JPEG before sending), shown in a
// modal dialog that keeps focus inside and closes on Escape, the close
// button or a tap on the backdrop (not inside the dialog). The picture's
// address is freed on close.
function ViewFile({ upload, name }: { upload: SetupUpload; name: string }) {
  const { client } = useCore(),
    w = useWords(),
    store = useSetup();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "opening" | "failed">("idle");
  useEffect(() => {
    if (url && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [url]);
  // Closing (url back to null) or leaving the page frees the picture.
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const open = async () => {
    setState("opening");
    try {
      const count = Math.max(1, splitPlan(upload.bytes).length);
      const parts: BlobPart[] = [];
      for (let seq = 0; seq < count; seq++)
        parts.push(
          (await client.getChunk({
            id: store.agentId,
            uploadId: upload.id,
            seq,
          })) as BlobPart,
        );
      setUrl(URL.createObjectURL(new Blob(parts, { type: "image/jpeg" })));
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  const closed = () => {
    setUrl(null);
    opener.current?.focus();
  };
  return (
    <>
      <button
        type="button"
        ref={opener}
        className="setup-link"
        aria-label={w(`View ${name}`, `Lihat ${name}`)}
        disabled={state === "opening"}
        onClick={() => void open()}
      >
        {state === "opening" ? w("Opening…", "Membuka…") : w("View file", "Lihat fail")}
      </button>
      {state === "failed" && (
        <span className="setup-error" role="alert">
          {w("Could not open this file. Try again.", "Fail ini tidak dapat dibuka. Cuba lagi.")}
        </span>
      )}
      {url && (
        <dialog
          ref={dialog}
          className="setup-viewer"
          aria-label={name}
          onClose={closed}
          onClick={(e) => {
            // The dialog has no padding of its own: a click whose target is
            // the dialog itself is on the backdrop.
            if (e.target === dialog.current) dialog.current?.close();
          }}
        >
          <div className="setup-viewer-body">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={w(`Photo: ${name}`, `Foto: ${name}`)} />
            <button
              type="button"
              className="button button-dark"
              autoFocus
              onClick={() => dialog.current?.close()}
            >
              {w("Close", "Tutup")}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

// One price row: a card on a phone (name and price on the first line, unit,
// state and actions on the second), a table row on wide screens. The price
// is always editable; name, variant, unit and notes open with Edit. It keeps
// its place for the visit: confirming or editing changes its look, not its
// position; a removed row folds in place with Undo.
function PriceRow({
  item,
  actions: a,
  winner,
  choice,
  onChoice,
  replace,
  locked,
  gone,
  onRemove,
  onUndo,
  announce,
  onInvalid,
}: {
  item: SetupItem;
  actions: RowActions;
  winner: ReturnType<typeof rowPayload> | null;
  choice: Choice;
  onChoice: (id: string, choice: Choice) => void;
  replace: string[];
  locked: boolean;
  // Removed on this visit: the state Undo restores (the state the row had
  // when its remove write ran, after this row's earlier writes landed).
  gone: "pending" | "confirmed" | null;
  // Removes this row (or, for "Use this one instead", the other copy) and
  // keeps it folded in place.
  onRemove: (other?: string) => Promise<"removed" | "skipped" | "failed">;
  onUndo: () => Promise<boolean>;
  announce: (text: string) => void;
  onInvalid: (id: string, bad: boolean) => void;
}) {
  const { client } = useCore(),
    w = useWords(),
    store = useSetup();
  const setState = useItemState();
  const p = rowPayload(item.payload);
  const name = rowName(p) || w("Unnamed item", "Item tanpa nama");
  const pid = `setup-price-${item.id}`;
  const [price, setPrice] = useState(amountText(p.priceSen));
  const [priceBad, setPriceBad] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({
    item: p.item,
    variant: p.variant,
    unit: p.unit,
    notes: p.notes,
  });
  const [nameBad, setNameBad] = useState(false);
  const focused = useRef(false);
  const undoRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const fold = useFold(gone !== null);
  const guard = useSettle();
  // After "Use this one instead" the duplicate panel keeps its place and
  // height for the visit ("Chosen"), so the row does not shrink
  // under the finger.
  const [used, setUsed] = useState(false);
  const dupRef = useRef<HTMLDivElement>(null);
  const dupHeight = useRef(0);
  useLayoutEffect(() => {
    if (a.useThis && dupRef.current)
      dupHeight.current = dupRef.current.getBoundingClientRect().height;
  });
  const liRef = fold.li;
  // Once Confirm was offered, its place stays for the visit (a disabled
  // "Confirmed" after it), so focus has somewhere to stay.
  const offered = useRef(false);
  useEffect(() => {
    if (a.confirm) offered.current = true;
  });
  const confirmSlot = a.confirm || offered.current;
  // A row's actions wait while its own write is in flight or "Remove all"
  // runs. aria-disabled, not disabled, so a focused button keeps focus.
  const off = busy || locked;
  const priceInvalid = readPrice(price) === "invalid";

  // Sends only what changed against the row as last stored: "same" when
  // nothing changed (decided again when the write's turn comes).
  const send = async (next: RowEditValues): Promise<"same" | "sent" | "failed"> => {
    const change = () => {
      const cur = store.latest().items.find((i) => i.id === item.id);
      if (!cur || (cur.state !== "pending" && cur.state !== "confirmed"))
        return null;
      const c = rowChanges(rowPayload(cur.payload), cur.state, next);
      return c === null || c === "NAME_REQUIRED" ? null : c;
    };
    if (!change()) return "same";
    let sent = false;
    const ok = await store.write((expectedRevision) => {
      const c = change();
      if (!c) return Promise.resolve(store.latest());
      sent = true;
      return client.execute("saveSetupItem", {
        id: store.agentId,
        itemId: item.id,
        expectedRevision,
        payload: c.payload,
        ...(c.state ? { state: c.state } : {}),
      });
    });
    return !ok ? "failed" : sent ? "sent" : "same";
  };
  // The price is sent when the field is left or Enter is pressed (and
  // before apply), never on a pause or when the tab is hidden: a changed
  // price confirms the row.
  const priceSave = useAutosave(
    async (v: number | null) => {
      const r = await send({ priceSen: v });
      if (r === "sent")
        announce(w(`Price of ${name} saved`, `Harga ${name} disimpan`));
      return r !== "failed";
    },
    { debounce: false },
  );
  const fieldSave = useAutosave(
    async (f: typeof fields) => (await send(f)) !== "failed",
  );

  // A stored change (another write, a reload) shows unless the owner is
  // typing in the field.
  useEffect(() => {
    if (focused.current || priceSave.dirty()) return;
    setPrice(amountText(p.priceSen));
    setPriceBad(false);
    onInvalid(item.id, false);
  }, [p.priceSen]);
  useEffect(() => {
    if (!open) setFields({ item: p.item, variant: p.variant, unit: p.unit, notes: p.notes });
  }, [open, p.item, p.variant, p.unit, p.notes]);
  useEffect(() => () => onInvalid(item.id, false), []);
  // Folded after Remove: the Remove button is gone, so focus (on it, or
  // dropped to the page) moves to Undo in the same row.
  // Back after Undo: the Undo button is gone, so focus moves to Remove.
  const wasGone = useRef(false);
  useEffect(() => {
    const active = document.activeElement;
    const lost =
      !active || active === document.body || !!liRef.current?.contains(active);
    if (gone && lost) undoRef.current?.focus();
    if (!gone && wasGone.current && lost) removeRef.current?.focus();
    wasGone.current = gone !== null;
  }, [gone !== null]);

  const run = async (fn: () => Promise<void>) => {
    if (off) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const leavePrice = () => {
    if (readPrice(price) === "invalid") {
      setPriceBad(true);
      return;
    }
    void priceSave.flush();
  };

  // Folded at the height the row had, so nothing below moves. Undo comes
  // first, at the start of the row, away from where Remove was (the end),
  // and ignores taps for UNDO_GUARD_MS after the fold appears.
  if (gone)
    return (
      <li
        id={`setup-row-${item.id}`}
        ref={liRef}
        className="setup-price setup-price-gone"
        style={fold.style}
      >
        <button
          type="button"
          ref={undoRef}
          className="setup-link setup-undo"
          aria-label={w(`Undo removing ${name}`, `Buat asal: ${name}`)}
          aria-disabled={off || undefined}
          onClick={() =>
            settled(
              guard,
              () =>
                void run(async () => {
                  if (await onUndo())
                    announce(w(`${name} is back`, `${name} dikembalikan`));
                }),
            )
          }
        >
          {w("Undo", "Buat asal")}
        </button>
        <p className="setup-hint">{w(`${name} removed.`, `${name} dibuang.`)}</p>
      </li>
    );

  const removes =
    a.useThis &&
    useThisSteps(store.view.items, replace, item.id).some((s) => s.state === "removed");

  return (
    <li
      id={`setup-row-${item.id}`}
      ref={liRef}
      className="setup-price"
      data-status={a.status}
      aria-busy={busy || undefined}
    >
      <div className="setup-price-name">
        <span className="setup-price-item">{p.item || name}</span>
        {p.variant && <span className="setup-price-variant">{p.variant}</span>}
      </div>
      <div className="setup-price-amount">
        <label htmlFor={pid} className="sr-only">
          {w(`Price of ${name}`, `Harga ${name}`)}
        </label>
        <span aria-hidden="true">RM</span>
        <input
          id={pid}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={price}
          readOnly={locked}
          aria-invalid={priceBad || undefined}
          aria-describedby={priceBad ? `${pid}-bad` : undefined}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => {
            const t = e.target.value;
            setPrice(t);
            const v = readPrice(t);
            if (v === "invalid") {
              priceSave.cancel();
              onInvalid(item.id, true);
            } else {
              setPriceBad(false);
              onInvalid(item.id, false);
              priceSave.change(v);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              leavePrice();
            }
          }}
          onBlur={() => {
            focused.current = false;
            leavePrice();
          }}
        />
      </div>
      <div className="setup-price-meta">
        <span className="setup-price-unit">{p.unit}</span>
        <span className="setup-price-state">
          {rowStatusText(a, w)}
          {a.confirmed && !confirmSlot && (
            <span className="setup-mark">{w("Confirmed", "Disahkan")}</span>
          )}
        </span>
      </div>
      <div className="setup-price-actions">
        {confirmSlot &&
          (a.confirm ? (
            <button
              type="button"
              className="setup-link"
              aria-label={w(`Confirm ${name}`, `Sahkan ${name}`)}
              aria-disabled={off || priceInvalid || undefined}
              onClick={() => {
                // Not with text the price field refused: that would confirm
                // the stored price the owner is correcting.
                if (priceInvalid) {
                  setPriceBad(true);
                  return;
                }
                settled(
                  guard,
                  () =>
                    void run(async () => {
                      // Waits for a price save already in flight on this row;
                      // never confirms the old price if that save failed.
                      if (!(await priceSave.flush())) {
                        announce(
                          w(
                            `The price of ${name} was not saved, so it was not confirmed. Try again.`,
                            `Harga ${name} tidak disimpan, jadi belum disahkan. Cuba lagi.`,
                          ),
                        );
                        return;
                      }
                      if (await setState(item.id, "confirmed"))
                        announce(w(`${name} confirmed`, `${name} disahkan`));
                    }),
                );
              }}
            >
              {w("Confirm", "Sahkan")}
            </button>
          ) : (
            <button
              type="button"
              className="setup-link setup-link-done"
              aria-disabled="true"
              aria-label={
                a.confirmed
                  ? w(`${name} confirmed`, `${name} disahkan`)
                  : w(`Confirm ${name}`, `Sahkan ${name}`)
              }
            >
              {a.confirmed ? w("Confirmed", "Disahkan") : w("Confirm", "Sahkan")}
            </button>
          ))}
        <button
          type="button"
          className="setup-link"
          aria-expanded={open}
          aria-controls={`${pid}-edit`}
          aria-label={
            open
              ? w(`Done editing ${name}`, `Siap menyunting ${name}`)
              : w(`Edit ${name}`, `Sunting ${name}`)
          }
          aria-disabled={off || undefined}
          onClick={() =>
            void run(async () => {
              if (open && !nameBad) await fieldSave.flush();
              if (open && nameBad) {
                fieldSave.cancel();
                setNameBad(false);
              }
              setOpen(!open);
            })
          }
        >
          {open ? w("Done", "Siap") : w("Edit", "Sunting")}
        </button>
        <button
          type="button"
          ref={removeRef}
          className="setup-link"
          aria-label={w(`Remove ${name}`, `Buang ${name}`)}
          aria-disabled={off || undefined}
          onClick={() =>
            settled(
              guard,
              () =>
                void run(async () => {
                  priceSave.cancel();
                  fieldSave.cancel();
                  // The state Undo restores is read when this write's turn
                  // comes, after a price write that raced the tap has landed.
                  const r = await onRemove();
                  if (r === "removed") {
                    onInvalid(item.id, false);
                    setPriceBad(false);
                    setPrice(amountText(p.priceSen));
                    announce(w(`${name} removed`, `${name} dibuang`));
                  } else if (r === "skipped") announce(skippedText(name, w));
                }),
            )
          }
        >
          {w("Remove", "Buang")}
        </button>
      </div>
      {priceBad && (
        <p id={`${pid}-bad`} className="setup-error setup-price-extra">
          {w(
            "Type a price like 80 or 80.50.",
            "Taip harga seperti 80 atau 80.50.",
          )}
        </p>
      )}
      {a.status === "check" && (
        <Reason reason={item.checkReason} className="setup-hint setup-price-extra" />
      )}
      {a.status === "no_price" && (
        <p className="setup-hint setup-price-extra">
          {w(
            "Type a price to keep this row.",
            "Taip harga supaya baris ini disimpan.",
          )}
        </p>
      )}
      {a.choice && item.current && (
        <fieldset className="setup-conflict setup-price-extra" disabled={locked}>
          <legend>{conflictText(item.current, p.priceSen, w)}</legend>
          <div className="setup-choice">
            {(["keep", "new"] as const).map((k) => (
              <label key={k} className="setup-option">
                <input
                  type="radio"
                  name={`setup-choice-${item.id}`}
                  checked={choice === k}
                  onChange={() =>
                    (k === "new" ? settled : touched)(guard, () => {
                      onChoice(item.id, k);
                      announce(
                        k === "new"
                          ? w(
                              `${name}: the new price will be used`,
                              `${name}: harga baharu akan digunakan`,
                            )
                          : w(
                              `${name}: the current price is kept`,
                              `${name}: harga sedia ada dikekalkan`,
                            ),
                      );
                    })
                  }
                />
                <span>
                  {k === "keep"
                    ? w("Keep current", "Kekalkan yang sedia ada")
                    : w("Use new", "Guna yang baharu")}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {a.useThis && (
        <div className="setup-price-extra setup-price-dup" ref={dupRef}>
          <p className="setup-hint">{duplicateText(winner, w)}</p>
          <button
            type="button"
            className="button button-small secondary-button"
            aria-label={w(`Use ${name} instead`, `Guna ${name} sebagai ganti`)}
            aria-disabled={off || undefined}
            onClick={() =>
              settled(guard, () =>
                void run(async () => {
                  const steps = useThisSteps(store.latest().items, replace, item.id);
                  if (!steps.length) return;
                  // Reserved before the writes: the write that ends the
                  // duplicate state never renders a row without its panel.
                  setUsed(true);
                  // A copy this removes folds in place with Undo too.
                  for (const s of steps)
                    if (
                      s.state === "removed"
                        ? (await onRemove(s.id)) === "failed"
                        : !(await setState(s.id, s.state))
                    ) {
                      setUsed(false);
                      return;
                    }
                  announce(w(`${name} will be saved`, `${name} akan disimpan`));
                }),
              )
            }
          >
            {useThisText(removes, w)}
          </button>
        </div>
      )}
      {!a.useThis && used && (
        <div
          className="setup-price-extra setup-price-dup"
          style={dupHeight.current ? { minHeight: `${dupHeight.current}px` } : undefined}
        >
          <p className="setup-hint">
            {w("This one will be saved.", "Yang ini akan disimpan.")}
          </p>
          <button
            type="button"
            className="button button-small secondary-button"
            aria-disabled="true"
          >
            {w("Chosen", "Dipilih")}
          </button>
        </div>
      )}
      {open && (
        <div id={`${pid}-edit`} className="setup-price-extra setup-price-edit">
          {(
            [
              ["item", w("Name", "Nama"), 200],
              ["variant", w("Variant or size", "Varian atau saiz"), 200],
              ["unit", w("Unit, for example per kg", "Unit, contohnya per kg"), 60],
              ["notes", w("Notes", "Catatan"), 300],
            ] as const
          ).map(([k, text, max]) => (
            <div className="product-field" key={k}>
              <label htmlFor={`${pid}-${k}`}>{text}</label>
              <input
                id={`${pid}-${k}`}
                className="setup-answer"
                maxLength={max}
                value={fields[k]}
                readOnly={locked}
                aria-invalid={(k === "item" && nameBad) || undefined}
                aria-describedby={k === "item" && nameBad ? `${pid}-name-bad` : undefined}
                onChange={(e) => {
                  const next = { ...fields, [k]: e.target.value };
                  setFields(next);
                  if (!next.item.trim()) {
                    setNameBad(true);
                    fieldSave.cancel();
                  } else {
                    setNameBad(false);
                    fieldSave.change(next);
                  }
                }}
                onBlur={() => void fieldSave.flush()}
              />
              {k === "item" && nameBad && (
                <p id={`${pid}-name-bad`} className="setup-error">
                  {w("Type a name.", "Taip nama.")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
