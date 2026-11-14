"use client";
// Stage 2: one question per screen. Answers are sent as the owner types
// (600 ms after the last change) or leaves the field, and once more on
// Continue. The queue is this visit's snapshot of the unanswered questions.
import { useId, useState } from "react";
import { Check } from "@phosphor-icons/react";
import type {
  SetupItem,
  SetupQuestionView,
} from "../../../../packages/contracts/src/setup";
import { useCore, useWords } from "../state";
import { HOSTED } from "@/lib/hosted";
import {
  itemFor,
  useAutosave,
  useLanding,
  useSetup,
  SaveMark,
  SetupNotice,
} from "./flow";

type Words = (en: string, ms: string) => string;
export type Day = { open: boolean; start: string; end: string };
export type Hours = { timezone: string; days: Day[] };
export type FirstWords = { greeting: string; aiDisclosure: string };

// Index 0 is Monday, as in the schedule screen.
export const dayNames = (w: Words) => [
  w("Monday", "Isnin"),
  w("Tuesday", "Selasa"),
  w("Wednesday", "Rabu"),
  w("Thursday", "Khamis"),
  w("Friday", "Jumaat"),
  w("Saturday", "Sabtu"),
  w("Sunday", "Ahad"),
];

export function defaultHours(timezone: string): Hours {
  return {
    timezone,
    days: Array.from({ length: 7 }, (_, i) => ({
      open: i < 6,
      start: "09:00",
      end: "18:00",
    })),
  };
}
// The editor keeps one opening per day; a day with no opening is closed.
export function hoursFrom(payload: unknown, timezone: string): Hours | null {
  const p = payload as {
    timezone?: string;
    weekdays?: { start: string; end: string }[][];
  } | null;
  if (!p?.weekdays || p.weekdays.length !== 7) return null;
  return {
    timezone: p.timezone ?? timezone,
    days: p.weekdays.map((xs) =>
      xs[0]
        ? { open: true, start: xs[0].start, end: xs[0].end }
        : { open: false, start: "09:00", end: "18:00" },
    ),
  };
}
export const weekdaysOf = (h: Hours) =>
  h.days.map((d) => (d.open ? [{ start: d.start, end: d.end }] : []));
export const hoursValid = (h: Hours) =>
  h.days.every((d) => !d.open || (!!d.start && !!d.end && d.end > d.start));

// "Monday–Saturday 09:00–18:00 · Sunday closed": runs of equal days.
export function hoursSummary(
  weekdays: { start: string; end: string }[][],
  w: Words,
) {
  const names = dayNames(w);
  const label = (xs: { start: string; end: string }[]) =>
    xs.length
      ? xs.map((x) => `${x.start}–${x.end}`).join(", ")
      : w("closed", "tutup");
  const parts: string[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && label(weekdays[j + 1]) === label(weekdays[i])) j++;
    parts.push(
      `${i === j ? names[i] : `${names[i]}–${names[j]}`} ${label(weekdays[i])}`,
    );
    i = j + 1;
  }
  return parts.join(" · ");
}

export function wordsFrom(payload: unknown): FirstWords | null {
  const p = payload as Partial<FirstWords> | null;
  return p?.greeting || p?.aiDisclosure
    ? { greeting: p.greeting ?? "", aiDisclosure: p.aiDisclosure ?? "" }
    : null;
}
export const wordsValid = (v: FirstWords) =>
  !!v.greeting.trim() && !!v.aiDisclosure.trim();

export function HoursEditor({
  value,
  onChange,
  onLeave,
}: {
  value: Hours;
  onChange: (v: Hours) => void;
  onLeave: () => void;
}) {
  const w = useWords(),
    id = useId();
  const names = dayNames(w);
  const set = (i: number, d: Partial<Day>) =>
    onChange({
      ...value,
      days: value.days.map((x, n) => (n === i ? { ...x, ...d } : x)),
    });
  const first = value.days.find((d) => d.open);
  return (
    <div className="setup-hours" onBlur={onLeave}>
      <button
        type="button"
        className="setup-link"
        disabled={!first}
        aria-describedby={`${id}-same`}
        onClick={() =>
          first &&
          onChange({
            ...value,
            days: value.days.map((d) =>
              d.open ? { ...d, start: first.start, end: first.end } : d,
            ),
          })
        }
      >
        {w("Same every day", "Sama setiap hari")}
      </button>
      <small id={`${id}-same`} className="setup-hint">
        {w(
          "Copies the first open day's times to every open day.",
          "Menyalin waktu hari buka pertama ke semua hari buka.",
        )}
      </small>
      <ul className="setup-days">
        {value.days.map((d, i) => (
          <li key={i} className="setup-day">
            <label className="setup-day-open">
              <input
                type="checkbox"
                checked={d.open}
                onChange={(e) => set(i, { open: e.target.checked })}
              />
              <span>{names[i]}</span>
            </label>
            {d.open ? (
              <div className="setup-day-times">
                <label htmlFor={`${id}-${i}-start`}>{w("Opens", "Buka")}</label>
                <input
                  id={`${id}-${i}-start`}
                  type="time"
                  value={d.start}
                  onChange={(e) => set(i, { start: e.target.value })}
                />
                <label htmlFor={`${id}-${i}-end`}>{w("Closes", "Tutup")}</label>
                <input
                  id={`${id}-${i}-end`}
                  type="time"
                  value={d.end}
                  aria-invalid={!!d.start && !!d.end && d.end <= d.start}
                  onChange={(e) => set(i, { end: e.target.value })}
                />
              </div>
            ) : (
              <span className="setup-day-closed">{w("Closed", "Tutup")}</span>
            )}
          </li>
        ))}
      </ul>
      {!hoursValid(value) && (
        <p className="setup-error" role="alert">
          {w(
            "Each closing time must be after the opening time.",
            "Waktu tutup mesti selepas waktu buka.",
          )}
        </p>
      )}
    </div>
  );
}

export function WordsEditor({
  value,
  onChange,
  onLeave,
}: {
  value: FirstWords;
  onChange: (v: FirstWords) => void;
  onLeave: () => void;
}) {
  const w = useWords(),
    id = useId();
  return (
    <div className="setup-words">
      <div className="product-field">
        <label htmlFor={`${id}-greeting`}>{w("Greeting", "Salam")}</label>
        <textarea
          id={`${id}-greeting`}
          rows={2}
          maxLength={2000}
          value={value.greeting}
          aria-invalid={!value.greeting.trim()}
          onChange={(e) => onChange({ ...value, greeting: e.target.value })}
          onBlur={onLeave}
        />
      </div>
      <div className="product-field">
        <label htmlFor={`${id}-ai`}>
          {w("AI introduction", "Pengenalan AI")}
        </label>
        <textarea
          id={`${id}-ai`}
          rows={2}
          maxLength={2000}
          value={value.aiDisclosure}
          aria-invalid={!value.aiDisclosure.trim()}
          aria-describedby={`${id}-ai-hint`}
          onChange={(e) => onChange({ ...value, aiDisclosure: e.target.value })}
          onBlur={onLeave}
        />
        <small id={`${id}-ai-hint`}>
          {w(
            "Callers must hear that they are speaking to an AI assistant.",
            "Pemanggil mesti tahu mereka bercakap dengan pembantu AI.",
          )}
        </small>
      </div>
      {!wordsValid(value) && (
        <p className="setup-error" role="alert">
          {w(
            "Fill in both the greeting and the AI introduction.",
            "Isi kedua-dua salam dan pengenalan AI.",
          )}
        </p>
      )}
    </div>
  );
}

export function Interview({
  queue,
  total,
  onBack,
  onDone,
}: {
  queue: SetupQuestionView[];
  // Null for a single "still missing" fact added from the review page.
  total: number | null;
  onBack: () => void;
  onDone: (skipped?: boolean) => void;
}) {
  const w = useWords();
  const [pos, setPos] = useState(0);
  const q = queue[pos];
  if (!q) return null;
  const answeredBefore = total === null ? 0 : total - queue.length;
  return (
    <div className="setup-flow">
      <header className="setup-head setup-head-row">
        <h1 className="setup-title-small">
          {total === null
            ? w("Add a missing answer", "Tambah jawapan yang tiada")
            : w("Set up your agent", "Sediakan ejen anda")}
        </h1>
        {total !== null && (
          <p className="setup-count">
            {w(
              `Question ${answeredBefore + pos + 1} of ${total}`,
              `Soalan ${answeredBefore + pos + 1} daripada ${total}`,
            )}
          </p>
        )}
      </header>
      {total !== null && (
        <div className="setup-bar" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} data-done={i < answeredBefore + pos} />
          ))}
        </div>
      )}
      <QuestionScreen
        key={q.id}
        question={q}
        single={total === null}
        onBack={() => (pos > 0 ? setPos(pos - 1) : onBack())}
        onNext={(skipped) =>
          total === null || pos === queue.length - 1
            ? onDone(skipped)
            : setPos(pos + 1)
        }
      />
    </div>
  );
}

type Value =
  | { kind: "fact"; text: string }
  | { kind: "hours"; hours: Hours }
  | { kind: "first_words"; words: FirstWords };

function initialValue(
  q: SetupQuestionView,
  item: SetupItem | undefined,
  timezone: string,
  name: string,
  w: Words,
): Value {
  // A skipped item starts empty (or prefilled) again.
  const live = item && item.state !== "removed" ? item.payload : null;
  if (q.kind === "hours")
    return {
      kind: "hours",
      hours: hoursFrom(live, timezone) ?? defaultHours(timezone),
    };
  if (q.kind === "first_words")
    return {
      kind: "first_words",
      words: wordsFrom(live) ?? {
        greeting: w(
          `Hello, thank you for calling ${name}.`,
          `Helo, terima kasih kerana menghubungi ${name}.`,
        ),
        aiDisclosure: w(
          `I'm the AI assistant for ${name}. How can I help you today?`,
          `Saya pembantu AI untuk ${name}. Ada apa-apa yang boleh saya bantu?`,
        ),
      },
    };
  const v = (live as { value?: unknown } | null)?.value;
  if (typeof v === "string") return { kind: "fact", text: v };
  // The name was typed at workspace creation; offer it, editable. It is kept
  // only if the owner continues, like any answer on screen.
  const asksName = q.fills.includes("facts.business_name");
  return { kind: "fact", text: asksName && !live ? name : "" };
}

function QuestionScreen({
  question: q,
  single,
  onBack,
  onNext,
}: {
  question: SetupQuestionView;
  single: boolean;
  onBack: () => void;
  onNext: (skipped?: boolean) => void;
}) {
  const { client, workspace } = useCore(),
    w = useWords(),
    store = useSetup(),
    id = useId();
  const timezone =
    (
      workspace.locations.find((l) => l.primary_location) ??
      workspace.locations[0]
    )?.timezone ?? "Asia/Kuala_Lumpur";
  const [value, setValue] = useState<Value>(() =>
    initialValue(
      q,
      itemFor(store.view.items, q),
      timezone,
      workspace.workspace.name,
      w,
    ),
  );
  const [moving, setMoving] = useState(false);
  const heading = useLanding<HTMLHeadingElement>("question:" + q.id);
  const send = (v: Value) =>
    store.write((expectedRevision) =>
      client.execute("answerSetup", {
        id: store.agentId,
        questionId: q.id,
        expectedRevision,
        answer:
          v.kind === "fact"
            ? { kind: "fact", text: v.text }
            : v.kind === "hours"
              ? {
                  kind: "hours",
                  timezone: v.hours.timezone,
                  weekdays: weekdaysOf(v.hours),
                }
              : { kind: "first_words", ...v.words },
      }),
    );
  const auto = useAutosave(send);
  const valid =
    value.kind === "hours"
      ? hoursValid(value.hours)
      : value.kind === "first_words"
        ? wordsValid(value.words)
        : true;
  const change = (v: Value) => {
    setValue(v);
    const ok =
      v.kind === "hours"
        ? hoursValid(v.hours)
        : v.kind === "first_words"
          ? wordsValid(v.words)
          : true;
    if (ok) auto.change(v);
    else auto.cancel();
  };
  const leave = () => {
    if (valid) void auto.flush();
  };

  const next = async () => {
    if (!valid) return;
    setMoving(true);
    const item = itemFor(store.view.items, q);
    // Nothing kept yet (or skipped before): keep what is on screen, so a
    // prefilled answer counts. Empty fact text is kept as a skip.
    const ok = auto.dirty()
      ? await auto.flush()
      : !item || item.state === "removed"
        ? await send(value)
        : true;
    setMoving(false);
    if (ok) onNext();
  };
  const skip = async () => {
    auto.cancel();
    setMoving(true);
    const item = itemFor(store.view.items, q);
    // A missing fact with nothing typed has nothing to undo on the server.
    const ok =
      single && !item
        ? true
        : await store.write((expectedRevision) =>
            client.execute("answerSetup", {
              id: store.agentId,
              questionId: q.id,
              expectedRevision,
              answer: { kind: "skip" },
            }),
          );
    setMoving(false);
    if (ok) onNext(true);
  };
  const back = async () => {
    if (valid) await auto.flush();
    else auto.cancel();
    onBack();
  };

  return (
    <form
      className="setup-body"
      onSubmit={(e) => {
        e.preventDefault();
        void next();
      }}
    >
      {value.kind === "fact" ? (
        <div className="setup-question">
          <h2 className="setup-ask" ref={heading} tabIndex={-1}>
            <label htmlFor={`${id}-answer`}>{w(q.en, q.ms)}</label>
          </h2>
          <textarea
            id={`${id}-answer`}
            className="setup-answer"
            rows={4}
            maxLength={2000}
            value={value.text}
            aria-describedby={`${id}-hint`}
            onChange={(e) => change({ kind: "fact", text: e.target.value })}
            onBlur={leave}
          />
          <small id={`${id}-hint`} className="setup-hint">
            {w(
              "Answer in your own words, in any language. Leave it empty to skip.",
              "Jawab dengan ayat anda sendiri, dalam apa-apa bahasa. Biarkan kosong untuk langkau.",
            )}
          </small>
        </div>
      ) : (
        <fieldset className="setup-question">
          <legend>
            <h2 className="setup-ask" ref={heading} tabIndex={-1}>
              {w(q.en, q.ms)}
            </h2>
          </legend>
          {value.kind === "hours" ? (
            <HoursEditor
              value={value.hours}
              onChange={(hours) => change({ kind: "hours", hours })}
              onLeave={leave}
            />
          ) : (
            <WordsEditor
              value={value.words}
              onChange={(words) => change({ kind: "first_words", words })}
              onLeave={leave}
            />
          )}
        </fieldset>
      )}
      <SaveMark />
      <SetupNotice error={store.error} />
      <p className="setup-hint setup-private">
        <Check size={14} aria-hidden="true" />
        {w(
          HOSTED
            ? "Kept as you go. Your agent uses nothing until you confirm the review page."
            : "Kept in your local workspace as you go. Your agent uses nothing until you confirm the review page.",
          HOSTED
            ? "Disimpan semasa anda menjawab. Ejen tidak menggunakan apa-apa sehingga anda sahkan halaman semakan."
            : "Disimpan dalam ruang kerja setempat semasa anda menjawab. Ejen tidak menggunakan apa-apa sehingga anda sahkan halaman semakan.",
        )}
      </p>
      <div className="setup-nav">
        <button
          type="button"
          className="button secondary-button"
          disabled={moving}
          onClick={() => void back()}
        >
          {w("Back", "Kembali")}
        </button>
        <button
          type="button"
          className="setup-link"
          disabled={moving}
          onClick={() => void skip()}
        >
          {w("Skip", "Langkau")}
        </button>
        <button className="button button-dark" disabled={moving || !valid}>
          {w("Continue", "Teruskan")}
        </button>
      </div>
    </form>
  );
}
