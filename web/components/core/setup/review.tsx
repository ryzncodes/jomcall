"use client";
// Stage 3: one page to check. Cards for hours and first words, the answered
// facts with Edit, what is still missing, and a keep-or-replace choice for
// every value already set on the agent. One button applies it all.
import { useRef, useState } from "react";
import { CoreError } from "@/lib/core/client";
import type {
  SetupItem,
  SetupQuestionView,
} from "../../../../packages/contracts/src/setup";
import { useCore, useWords, errorText } from "../state";
import { useExperience } from "../../experience";
import { HOSTED } from "@/lib/hosted";
import {
  packOf,
  useAutosave,
  useSetup,
  SaveMark,
  SetupNotice,
  type PackInfo,
} from "./flow";
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
  onDismiss,
  onApplied,
}: {
  packs: PackInfo[];
  dismissed: string[];
  // Default for every conflict is "keep".
  choices: Record<string, Choice>;
  onChoice: (itemId: string, choice: Choice) => void;
  onAdd: (q: SetupQuestionView) => void;
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

  const apply = async () => {
    setBusy(true);
    setApplyError(undefined);
    try {
      if (!(await store.flushAll())) return;
      await client.execute("applySetup", {
        id: store.agentId,
        expectedRevision: store.revision(),
        // Only "Use new" replaces; anything left as it is stays current.
        replace: view.conflicts
          .filter((c) => choices[c.itemId] === "new")
          .map((c) => c.itemId),
      });
      refresh();
      onApplied();
    } catch (e) {
      if (e instanceof CoreError && e.code === "CONFLICT") await store.reload();
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

  const applyMessage =
    applyError instanceof CoreError && applyError.code === "BOOKINGS_AFFECTED"
      ? w(
          "Some future bookings fall outside these hours. Change the hours or move those bookings, then try again.",
          "Ada tempahan akan datang di luar waktu ini. Ubah waktu operasi atau pindahkan tempahan tersebut, kemudian cuba lagi.",
        )
      : applyError instanceof CoreError &&
          applyError.code === "KNOWLEDGE_LIMIT"
        ? w(
            "Too many call types would be active on this agent. Remove one on the Agent page, then try again.",
            "Terlalu banyak jenis panggilan akan aktif pada ejen ini. Buang satu di halaman Ejen, kemudian cuba lagi.",
          )
        : null;

  return (
    <div className="setup-flow">
      <header className="setup-head">
        <h1 className="setup-title">
          {w("Here is what I understood", "Ini yang saya faham")}
        </h1>
        <p className="setup-lead">
          {w(
            "Fix anything that is wrong. Your agent uses these answers only after you confirm below. Nothing goes live until you publish.",
            "Betulkan apa-apa yang salah. Ejen hanya menggunakan jawapan ini selepas anda sahkan di bawah. Tiada apa-apa yang aktif sehingga anda terbitkan.",
          )}
        </p>
      </header>
      <div className="setup-body">
        {hours && (
          <HoursCard
            item={hours}
            open={editing === hours.id}
            onToggle={() => setEditing(editing === hours.id ? null : hours.id)}
            choice={(next) =>
              choice(
                hours,
                summaryOf(conflictOf(hours)?.current, w),
                next,
              )
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
                "Your agent takes a message when callers ask about these.",
                "Ejen akan mengambil pesanan apabila pemanggil bertanya tentang perkara ini.",
              )}
            </p>
            <ul className="setup-cards">
              {missing.map((m) => {
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
          </section>
        )}
        <SaveMark />
        <SetupNotice error={store.error} />
        {applyError !== undefined && (
          <div className="storage-warning" role="alert">
            {applyMessage ??
              (applyError instanceof CoreError &&
              applyError.code === "CONFLICT"
                ? w(
                    "Setup changed in another window. The latest answers are loaded; check them and try again.",
                    "Persediaan telah berubah di tetingkap lain. Jawapan terkini sudah dimuatkan; semak dan cuba lagi.",
                  )
                : errorText(applyError, locale === "ms"))}
          </div>
        )}
        <div className="setup-nav">
          <button
            type="button"
            className="button button-dark"
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy
              ? w("Updating your draft…", "Mengemas kini draf…")
              : w("Looks right, try a call", "Nampak betul, cuba panggilan")}
          </button>
        </div>
        <p className="setup-hint">
          {w(
            HOSTED
              ? "This updates your draft agent. It does not publish."
              : "This updates your draft agent in this workspace. It does not publish.",
            HOSTED
              ? "Ini mengemas kini draf ejen anda. Ia tidak menerbitkan."
              : "Ini mengemas kini draf ejen dalam ruang kerja ini. Ia tidak menerbitkan.",
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
  const stored = item.state === "removed" ? null : hoursFrom(item.payload, timezone);
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
            {w("First words on every call", "Kata-kata pertama setiap panggilan")}
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
              setValue(item.state === "removed" ? null : wordsFrom(item.payload));
            if (!open && !value)
              setValue({ greeting: "", aiDisclosure: "" });
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

function FactRow({
  item,
  label,
  open,
  onToggle,
  choice,
}: {
  item: SetupItem;
  label: string;
  open: boolean;
  onToggle: () => void;
  choice: (next: string) => React.ReactNode;
}) {
  const { client } = useCore(),
    w = useWords(),
    store = useSetup();
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
  return (
    <li className="setup-card">
      <div className="setup-card-row">
        <div>
          <h3 className="setup-card-label">{label}</h3>
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
