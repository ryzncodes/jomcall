"use client";
// Stage 3: one page to check. Prices read from documents first, then cards
// for hours and first words, the answered facts with Edit, what is still
// missing, and a keep-or-replace choice for every value already set on the
// agent. One button applies it all; price rows still unconfirmed are left
// out and cannot be reached again from this flow.
import { useEffect, useRef, useState } from "react";
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
import { RemoveFileConfirm } from "./bring";
import {
  amountText,
  applyButtonText,
  applyConfirmText,
  applySummary,
  checkReasonText,
  chooseRow,
  conflictText,
  duplicateText,
  factFlagged,
  groupRows,
  leftOutText,
  liveRows,
  needCheckIds,
  onlyReadProgress,
  overLimit,
  overLimitText,
  readPrice,
  removeFailedText,
  rowActions,
  rowChanges,
  rowName,
  rowPayload,
  rowSection,
  rowStatusText,
  senderShown,
  sendingLabel,
  splitPlan,
  uploadLabel,
  uploadName,
  useThisSteps,
  type RowActions,
  type RowEditValues,
  type RowSection,
  type ApplySummary,
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
  const [asking, setAsking] = useState(false);
  const [fixFirst, setFixFirst] = useState(false);
  const [allMissing, setAllMissing] = useState(false);
  const [said, setSaid] = useState("");
  // Price fields whose text is not a price: apply waits until they are fixed.
  const invalid = useRef(new Set<string>());
  const backRef = useRef<HTMLButtonElement>(null);
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
  const facts = view.items.filter(
    (i) => i.kind === "fact" && (i.state !== "removed" || i.id === editing),
  );
  const missing = view.missing.filter(
    (m) => !dismissed.includes(`missing:${m.pack}:${m.key}`),
  );
  // What the button will do, live: the planner re-plans price rows with
  // every "Use new" the owner picked.
  const summary = applySummary(view, choices, w);
  const blocked = overLimit(summary.totals);
  const leftOut = leftOutText(summary.counts, w);
  const question = asking ? applyConfirmText(summary.counts, w) : null;
  const showPrices = liveRows(view.items).length > 0 || view.uploads.length > 0;

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
          setSaid(`${uploadName(u, w)}: ${uploadLabel(u, w)}`);
      }
    seen.current = next;
    // Runs when an upload's state changes, not on every view.
  }, [uploadSig]);
  useEffect(() => {
    if (asking && question) backRef.current?.focus();
    // Nothing left to ask (the owner fixed the rows): the question closes
    // for good, so a later poll cannot bring it back unprompted.
    if (asking && !question) setAsking(false);
  }, [asking, question !== null]);

  const apply = async (sure: boolean) => {
    setApplyError(undefined);
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
      const now = applySummary(base, choices, w);
      if (overLimit(now.totals)) return;
      if (!sure && applyConfirmText(now.counts, w)) {
        setAsking(true);
        return;
      }
      setAsking(false);
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
          e.code === "CONFLICT" && !!fresh && onlyReadProgress(base, fresh),
        );
        setAsking(false);
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
                onChange={() => onChoice(i.id, k)}
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
            "Ejen anda akan mempunyai terlalu banyak harga atau jenis panggilan. Buang satu fail atau beberapa baris, atau buang satu jenis panggilan di halaman Ejen, kemudian cuba lagi.",
          )
        : limitCode
          ? w(
              "Too many call types would be active on this agent. Remove one on the Agent page, then try again.",
              "Terlalu banyak jenis panggilan akan aktif pada ejen ini. Buang satu di halaman Ejen, kemudian cuba lagi.",
            )
          : null;

  return (
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
            {w("Add a document", "Tambah dokumen")}
          </button>
        )}
      </header>
      <div className="setup-body">
        <p className="sr-only" role="status" aria-live="polite">
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
            announce={announce}
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
                        onClick={() =>
                          onAdd({
                            id,
                            kind: "fact",
                            en: m.en,
                            ms: m.ms,
                            fills: ["facts." + m.key],
                          })
                        }
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
              "Betulkan harga yang ditanda merah dahulu.",
            )}
          </div>
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
                disabled={busy || blocked}
                onClick={() => void apply(true)}
              >
                {applyButtonText(summary.counts, w)}
              </button>
              <button
                type="button"
                ref={backRef}
                className="button button-small secondary-button"
                disabled={busy}
                onClick={() => setAsking(false)}
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
            disabled={busy || blocked}
            onClick={() => void apply(false)}
          >
            {busy
              ? w("Updating your draft…", "Mengemas kini draf…")
              : applyButtonText(summary.counts, w)}
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

// Sets the state of a staged item (confirm or remove) with the latest
// revision.
function useItemState() {
  const { client } = useCore(),
    store = useSetup();
  return (itemId: string, state: "confirmed" | "removed") =>
    store.write((expectedRevision) =>
      client.execute("saveSetupItem", {
        id: store.agentId,
        itemId,
        expectedRevision,
        state,
      }),
    );
}

function FactRow({
  item,
  label,
  open,
  onToggle,
  announce,
  choice,
}: {
  item: SetupItem;
  label: string;
  open: boolean;
  onToggle: () => void;
  announce: (text: string) => void;
  choice: (next: string) => React.ReactNode;
}) {
  const { client } = useCore(),
    w = useWords(),
    store = useSetup();
  const setState = useItemState();
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
  return (
    <li className="setup-card" data-check={flagged || undefined}>
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
      {flagged && !open && text.trim() && (
        <div className="setup-check">
          <p className="setup-check-title">{w("Please check", "Sila semak")}</p>
          <p className="setup-hint">{checkReasonText(item.checkReason, w)}</p>
          <div className="setup-card-actions">
            <button
              type="button"
              className="button button-small button-dark"
              aria-label={w(`Confirm ${label}`, `Sahkan ${label}`)}
              onClick={async () => {
                if ((await auto.flush()) && (await setState(item.id, "confirmed")))
                  announce(w(`${label} confirmed`, `${label} disahkan`));
              }}
            >
              {w("Confirm", "Sahkan")}
            </button>
            <button
              type="button"
              className="button button-small secondary-button"
              aria-label={w(`Remove ${label}`, `Buang ${label}`)}
              onClick={async () => {
                auto.cancel();
                if (await setState(item.id, "removed"))
                  announce(w(`${label} removed`, `${label} dibuang`));
              }}
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
  announce,
  onInvalid,
}: {
  summary: ApplySummary;
  choices: Record<string, Choice>;
  onChoice: (id: string, choice: Choice) => void;
  announce: (text: string) => void;
  onInvalid: (id: string, bad: boolean) => void;
}) {
  const w = useWords(),
    store = useSetup();
  const { view, now, queuedSince } = store;
  const setState = useItemState();
  // While the owner is in the list, each row keeps its section; leaving the
  // list re-sorts.
  const [held, setHeld] = useState<Map<string, RowSection> | null>(null);
  const [bulk, setBulk] = useState<
    "idle" | "asking" | { done: number; total: number }
  >("idle");
  const bulkKeep = useRef<HTMLButtonElement>(null);
  const live = new Map(summary.plans.map((p) => [p.id, p]));
  const rows = liveRows(view.items);
  const groups = groupRows(
    view.items,
    summary.plans,
    view.uploads.map((u) => u.id),
    held,
  );
  const attention = [...groups.check, ...groups.conflict, ...groups.duplicate];
  const reading = view.uploads.filter(
    (u) => u.state === "queued" || u.state === "reading",
  );
  const unsure = needCheckIds(summary.plans);
  useEffect(() => {
    if (bulk === "asking") bulkKeep.current?.focus();
  }, [bulk]);
  // A focused control that went away (a removed row) fires no blur: once
  // focus is outside the list, rows re-sort on the next view.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (held && !sectionRef.current?.contains(document.activeElement))
      setHeld(null);
  }, [view, held]);
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
      : uploadLabel(u, w, now, queuedSince.get(u.id));
  };

  const removeUnsure = async () => {
    const ids = needCheckIds(summary.plans);
    let done = 0;
    setBulk({ done: 0, total: ids.length });
    for (const id of ids) {
      const it = store.latest().items.find((i) => i.id === id);
      if (it && (it.state === "pending" || it.state === "confirmed")) {
        if (!(await setState(id, "removed"))) break;
      }
      setBulk({ done: ++done, total: ids.length });
    }
    setBulk("idle");
    announce(
      w(
        done === 1 ? "1 price removed" : `${done} prices removed`,
        `${done} harga dibuang`,
      ),
    );
  };

  const row = (i: SetupItem) => {
    const plan = live.get(i.id);
    const winner = plan?.duplicateOf
      ? view.items.find((x) => x.id === plan.duplicateOf)
      : undefined;
    return (
      <PriceRow
        key={i.id}
        item={i}
        actions={rowActions(i.outcome, plan?.outcome, i.state)}
        winner={winner ? rowPayload(winner.payload) : null}
        choice={choices[i.id] ?? "keep"}
        onChoice={onChoice}
        replace={summary.replace}
        announce={announce}
        onInvalid={onInvalid}
      />
    );
  };

  return (
    <section
      ref={sectionRef}
      className="setup-section setup-prices"
      aria-labelledby="setup-prices"
      onFocus={() => {
        if (held) return;
        setHeld(
          new Map(
            rows.map((i) => [
              i.id,
              rowSection(i.outcome, live.get(i.id)?.outcome),
            ]),
          ),
        );
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setHeld(null);
      }}
    >
      <h2 id="setup-prices">{w("Prices and services", "Harga dan perkhidmatan")}</h2>
      {reading.map((u) => (
        <p key={u.id} className="setup-hint setup-reading">
          {w(
            `Still reading ${uploadName(u, w)}…`,
            `Masih membaca ${uploadName(u, w)}…`,
          )}
        </p>
      ))}
      {unsure.length > 1 && bulk === "idle" && (
        <button
          type="button"
          className="setup-link"
          aria-expanded={false}
          onClick={() => setBulk("asking")}
        >
          {w(
            `Remove all ${unsure.length} that still need checking`,
            `Buang semua ${unsure.length} yang masih perlu disemak`,
          )}
        </button>
      )}
      {bulk === "asking" && (
        <div className="setup-confirm" role="group" aria-labelledby="setup-bulk-ask">
          <p id="setup-bulk-ask" className="setup-hint">
            {w(
              `Remove ${unsure.length} prices that still need checking? They will not be saved.`,
              `Buang ${unsure.length} harga yang masih perlu disemak? Harga itu tidak akan disimpan.`,
            )}
          </p>
          <div className="setup-card-actions">
            <button
              type="button"
              className="button button-small button-dark"
              onClick={() => void removeUnsure()}
            >
              {w("Remove", "Buang")}
            </button>
            <button
              type="button"
              ref={bulkKeep}
              className="button button-small secondary-button"
              onClick={() => setBulk("idle")}
            >
              {w("Keep", "Kekalkan")}
            </button>
          </div>
        </div>
      )}
      {typeof bulk === "object" && (
        <p className="setup-hint">
          {w(
            `Removing ${bulk.done} of ${bulk.total}…`,
            `Membuang ${bulk.done} daripada ${bulk.total}…`,
          )}
        </p>
      )}
      {attention.length > 0 && (
        <div className="setup-price-group">
          <h3 className="setup-group-title">
            {w("Needs your attention", "Perlu perhatian anda")}
          </h3>
          <PriceHead />
          <ul className="setup-price-list">{attention.map(row)}</ul>
        </div>
      )}
      {groups.files.map((f) => {
        const upload = view.uploads.find((u) => u.id === f.uploadId);
        return (
          <div className="setup-price-group" key={f.uploadId ?? "earlier"}>
            {upload ? (
              <FileHead
                upload={upload}
                label={fileLabel(upload)}
                sending={
                  !!senderOf(upload) && senderOf(upload)?.phase !== "failed"
                }
                announce={announce}
              />
            ) : (
              <h3 className="setup-group-title">
                {w("From a removed file", "Daripada fail yang dibuang")}
              </h3>
            )}
            {f.rows.length > 0 && (
              <>
                <PriceHead />
                <ul className="setup-price-list">{f.rows.map(row)}</ul>
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
  sending,
  announce,
}: {
  upload: SetupUpload;
  label: string;
  // This browser is still sending it: not an interrupted upload.
  sending: boolean;
  announce: (text: string) => void;
}) {
  const w = useWords(),
    store = useSetup();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const name = uploadName(upload, w);
  const bad =
    upload.state === "failed" || (upload.state === "uploading" && !sending);
  const done = upload.state === "done";
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);
  const remove = async () => {
    setRemoving(true);
    setFailed(false);
    const ok = await store.uploads.remove({
      key: store.uploads.rowKey(upload.id),
      uploadId: upload.id,
    });
    setRemoving(false);
    if (ok) announce(w(`${name} removed`, `${name} dibuang`));
    else {
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
            disabled={removing}
            onClick={() => setConfirming(true)}
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
          onRemove={() => void remove()}
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
// modal dialog that keeps focus inside and closes on Escape. The picture's
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
  // Leaving the page with the picture open frees it too.
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
            // A tap on the backdrop closes it.
            if (e.target === dialog.current) dialog.current?.close();
          }}
        >
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
        </dialog>
      )}
    </>
  );
}

// One price row: a card on a phone (name and price on the first line, unit,
// state and actions on the second), a table row on wide screens. The price
// is always editable; name, variant, unit and notes open with Edit.
function PriceRow({
  item,
  actions: a,
  winner,
  choice,
  onChoice,
  replace,
  announce,
  onInvalid,
}: {
  item: SetupItem;
  actions: RowActions;
  winner: ReturnType<typeof rowPayload> | null;
  choice: Choice;
  onChoice: (id: string, choice: Choice) => void;
  replace: string[];
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
  const [fields, setFields] = useState({
    item: p.item,
    variant: p.variant,
    unit: p.unit,
    notes: p.notes,
  });
  const [nameBad, setNameBad] = useState(false);
  const focused = useRef(false);

  // Sends only what changed against the row as last stored; nothing when
  // nothing changed (decided again when the write's turn comes).
  const send = (next: RowEditValues) => {
    const change = () => {
      const cur = store.latest().items.find((i) => i.id === item.id);
      if (!cur || (cur.state !== "pending" && cur.state !== "confirmed"))
        return null;
      const c = rowChanges(rowPayload(cur.payload), cur.state, next);
      return c === null || c === "NAME_REQUIRED" ? null : c;
    };
    if (!change()) return Promise.resolve(true);
    return store.write((expectedRevision) => {
      const c = change();
      if (!c) return Promise.resolve(store.latest());
      return client.execute("saveSetupItem", {
        id: store.agentId,
        itemId: item.id,
        expectedRevision,
        payload: c.payload,
        ...(c.state ? { state: c.state } : {}),
      });
    });
  };
  // The price is sent when the field is left or Enter is pressed (and
  // before apply), never on a pause: a changed price confirms the row.
  const priceSave = useAutosave(
    async (v: number | null) => {
      const ok = await send({ priceSen: v });
      if (ok)
        announce(w(`Price of ${name} saved`, `Harga ${name} disimpan`));
      return ok;
    },
    { debounce: false },
  );
  const fieldSave = useAutosave((f: typeof fields) => send(f));

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

  const leavePrice = () => {
    const v = readPrice(price);
    if (v === "invalid") {
      setPriceBad(true);
      return;
    }
    void priceSave.flush();
  };

  return (
    <li className="setup-price" data-status={a.status}>
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
          placeholder={a.status === "no_price" ? "0.00" : undefined}
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
          {a.confirmed && (
            <span className="setup-mark">{w("Confirmed", "Disahkan")}</span>
          )}
        </span>
      </div>
      <div className="setup-price-actions">
        {a.confirm && (
          <button
            type="button"
            className="setup-link"
            aria-label={w(`Confirm ${name}`, `Sahkan ${name}`)}
            onClick={async () => {
              if (
                (await priceSave.flush()) &&
                (await setState(item.id, "confirmed"))
              )
                announce(w(`${name} confirmed`, `${name} disahkan`));
            }}
          >
            {w("Confirm", "Sahkan")}
          </button>
        )}
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
          onClick={async () => {
            if (open && !nameBad) await fieldSave.flush();
            if (open && nameBad) {
              fieldSave.cancel();
              setNameBad(false);
            }
            setOpen(!open);
          }}
        >
          {open ? w("Done", "Siap") : w("Edit", "Sunting")}
        </button>
        <button
          type="button"
          className="setup-link"
          aria-label={w(`Remove ${name}`, `Buang ${name}`)}
          onClick={async () => {
            priceSave.cancel();
            fieldSave.cancel();
            if (await setState(item.id, "removed"))
              announce(w(`${name} removed`, `${name} dibuang`));
          }}
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
        <p className="setup-hint setup-price-extra">
          {checkReasonText(item.checkReason, w)}
        </p>
      )}
      {a.status === "no_price" && (
        <p className="setup-hint setup-price-extra">
          {w(
            "Type a price to keep this row.",
            "Taip harga untuk menyimpan baris ini.",
          )}
        </p>
      )}
      {a.choice && item.current && (
        <fieldset className="setup-conflict setup-price-extra">
          <legend>{conflictText(item.current, p.priceSen, w)}</legend>
          <div className="setup-choice">
            {(["keep", "new"] as const).map((k) => (
              <label key={k} className="setup-option">
                <input
                  type="radio"
                  name={`setup-choice-${item.id}`}
                  checked={choice === k}
                  onChange={() => {
                    onChoice(item.id, k);
                    announce(
                      k === "new"
                        ? w(
                            `${name}: the new price will be used`,
                            `${name}: harga baharu akan digunakan`,
                          )
                        : w(
                            `${name}: the current price is kept`,
                            `${name}: harga semasa dikekalkan`,
                          ),
                    );
                  }}
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
        <div className="setup-price-extra setup-price-dup">
          <p className="setup-hint">{duplicateText(winner, w)}</p>
          <button
            type="button"
            className="button button-small secondary-button"
            aria-label={w(`Use ${name} instead`, `Guna ${name}`)}
            onClick={async () => {
              const steps = useThisSteps(store.latest().items, replace, item.id);
              for (const s of steps)
                if (!(await setState(s.id, s.state))) return;
              if (steps.length)
                announce(w(`${name} will be saved`, `${name} akan disimpan`));
            }}
          >
            {w("Use this one instead", "Guna yang ini")}
          </button>
        </div>
      )}
      {open && (
        <div id={`${pid}-edit`} className="setup-price-extra setup-price-edit">
          {(
            [
              ["item", w("Name", "Nama"), 200],
              ["variant", w("Variant or size", "Varian atau saiz"), 200],
              ["unit", w("Unit, for example per kg", "Unit, contohnya sekilo"), 60],
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
