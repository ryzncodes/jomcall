"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useExperience } from "../../experience";
import { Field } from "../field";
import { errorText, useWords } from "../state";
import {
  MAX_BLOCKS,
  MAX_CLOSURES,
  MAX_REASON,
  applyPreset,
  closureProblem,
  copyToOpenDays,
  dayProblem,
  nextBlock,
  normalizeTime,
  presetOf,
  sameClosures,
  sameDay,
  todayKL,
  type Closure,
  type Interval,
  type Preset,
} from "./rules";
import type { createScheduleSync } from "./schedule-sync";

export type Sync = ReturnType<typeof createScheduleSync>;

const DAYS: [string, string][] = [
  ["Monday", "Isnin"],
  ["Tuesday", "Selasa"],
  ["Wednesday", "Rabu"],
  ["Thursday", "Khamis"],
  ["Friday", "Jumaat"],
  ["Saturday", "Sabtu"],
  ["Sunday", "Ahad"],
];

// Shows a date typed as 2026-12-25 the way people say it.
export function dateWords(date: string, ms: boolean) {
  const d = new Date(date + "T00:00:00Z");
  return isNaN(+d)
    ? date
    : new Intl.DateTimeFormat(ms ? "ms-MY" : "en-GB", {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(d);
}

// The week and the closed dates of one branch. Every edit goes to the sync,
// which saves one at a time; typed text stays in the sync.
export function HoursWeek({ sync, branch }: { sync: Sync; branch: string }) {
  const w = useWords(),
    { locale } = useExperience(),
    ms = locale === "ms",
    id = useId();
  const s = sync.state();
  const first = useRef<HTMLInputElement>(null);
  const preset: Preset = presetOf(s.weekdays);
  const dayName = (d: number) => w(DAYS[d]![0], DAYS[d]![1]);
  const problemText = (p: ReturnType<typeof dayProblem>) =>
    p === "format"
      ? w("Use a time like 09:00.", "Guna waktu seperti 09:00.")
      : p === "order"
        ? w(
            "Closing time must be after opening time.",
            "Waktu tutup mesti selepas waktu buka.",
          )
        : p === "overlap"
          ? w(
              "Hours overlap. Start each block after the one before.",
              "Waktu bertindih. Mulakan setiap blok selepas blok sebelumnya.",
            )
          : p === "tooMany"
            ? w(
                `At most ${MAX_BLOCKS} blocks a day.`,
                `Paling banyak ${MAX_BLOCKS} blok sehari.`,
              )
            : "";
  const setDay = (d: number, blocks: Interval[], save: boolean) => {
    sync.setWeek(s.weekdays.map((x, i) => (i === d ? blocks : x)));
    if (save) sync.save();
  };
  // The row loses focus (not just one of its two inputs): times are tidied
  // and the row is sent when it is valid.
  const leaveRow = (d: number) => {
    const tidy = sync.state().weekdays[d]!.map((b) => ({
      start: normalizeTime(b.start),
      end: normalizeTime(b.end),
    }));
    sync.setWeek(sync.state().weekdays.map((x, i) => (i === d ? tidy : x)));
    sync.save();
  };
  return (
    <div className="agent-week">
      <div
        className="agent-chips"
        role="group"
        aria-label={w("Quick fill", "Isi pantas")}
      >
        {(
          [
            ["everyday", w("Every day", "Setiap hari")],
            ["weekdays", w("Weekdays", "Hari bekerja")],
          ] as const
        ).map(([p, label]) => (
          <button
            key={p}
            type="button"
            className="agent-chip"
            aria-pressed={preset === p}
            onClick={() => {
              sync.setWeek(applyPreset(sync.state().weekdays, p));
              sync.save();
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="agent-chip"
          aria-pressed={preset === "custom"}
          // Custom is what the week is when it matches neither shortcut.
          onClick={() => first.current?.focus()}
        >
          {w("Custom", "Suai")}
        </button>
      </div>
      <ul className="agent-days">
        {s.weekdays.map((blocks, d) => {
          const dirty = !sameDay(blocks, s.server.weekdays[d] ?? []),
            problem = dayProblem(blocks),
            rowId = `${id}-day-${d}`,
            open = blocks.length > 0;
          const state = problem
            ? ""
            : dirty
              ? s.saving
                ? w("Saving…", "Menyimpan…")
                : w("Not saved", "Belum disimpan")
              : "";
          return (
            <li
              key={d}
              className="agent-day"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  leaveRow(d);
              }}
            >
              <div className="agent-day-top">
                <label className="agent-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={open}
                    aria-label={`${dayName(d)}: ${w("open", "buka")}`}
                    onChange={(e) =>
                      setDay(d, e.target.checked ? [nextBlock([])!] : [], true)
                    }
                  />
                  <strong>{dayName(d)}</strong>
                  <span>{open ? w("Open", "Buka") : w("Closed", "Tutup")}</span>
                </label>
                {state && (
                  <span
                    className="agent-day-state"
                    role="status"
                  >
                    {state}
                  </span>
                )}
              </div>
              {blocks.map((b, i) => {
                const which = blocks.length > 1 ? ` ${i + 1}` : "";
                return (
                  <div className="agent-block" key={i}>
                    {(["start", "end"] as const).map((k) => (
                      <input
                        key={k}
                        ref={
                          d === 0 && i === 0 && k === "start"
                            ? first
                            : undefined
                        }
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={5}
                        placeholder="09:00"
                        value={b[k]}
                        aria-label={`${dayName(d)} ${
                          k === "start"
                            ? w("opens", "buka")
                            : w("closes", "tutup")
                        }${which}`}
                        aria-invalid={!!problem}
                        aria-describedby={
                          problem ? `${rowId}-error` : undefined
                        }
                        onChange={(e) =>
                          setDay(
                            d,
                            blocks.map((x, j) =>
                              j === i ? { ...x, [k]: e.target.value } : x,
                            ),
                            false,
                          )
                        }
                      />
                    ))}
                    <button
                      type="button"
                      className="agent-mini"
                      aria-label={`${w("Remove hours", "Buang waktu")} ${dayName(d)}${which}`}
                      onClick={() =>
                        setDay(
                          d,
                          blocks.filter((_, j) => j !== i),
                          true,
                        )
                      }
                    >
                      {w("Remove", "Buang")}
                    </button>
                  </div>
                );
              })}
              {problem && (
                <p
                  className="agent-field-error"
                  id={`${rowId}-error`}
                  role="alert"
                >
                  {problemText(problem)}
                </p>
              )}
              {open && (
                <div className="agent-day-actions">
                  {blocks.length < MAX_BLOCKS && nextBlock(blocks) && (
                    <button
                      type="button"
                      className="agent-mini"
                      onClick={() =>
                        setDay(d, [...blocks, nextBlock(blocks)!], false)
                      }
                    >
                      {w("Add hours", "Tambah waktu")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="agent-mini"
                    aria-label={`${dayName(d)}: ${w("Copy to all open days", "Salin ke semua hari buka")}`}
                    disabled={!!problem}
                    onClick={() => {
                      sync.setWeek(copyToOpenDays(sync.state().weekdays, d));
                      sync.save();
                    }}
                  >
                    {w("Copy to all open days", "Salin ke semua hari buka")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {s.error != null && (
        <div className="storage-warning" role="alert">
          {errorText(s.error, ms, "hours")}{" "}
          <button
            type="button"
            className="button button-small"
            onClick={() => sync.save()}
          >
            {w("Try saving again", "Cuba simpan lagi")}
          </button>
        </div>
      )}
      {s.conflicted && (
        <p role="status" className="agent-notice">
          {w(
            "Someone else changed these hours. This shows the latest.",
            "Orang lain telah mengubah waktu ini. Ini yang terkini.",
          )}
        </p>
      )}
      <Closures sync={sync} branch={branch} />
    </div>
  );
}

function Closures({ sync, branch }: { sync: Sync; branch: string }) {
  const w = useWords(),
    { locale } = useExperience(),
    ms = locale === "ms",
    s = sync.state();
  const [date, setDate] = useState(""),
    [reason, setReason] = useState(""),
    [problem, setProblem] = useState<string | null>(null);
  // A branch chosen later starts with a clean form.
  useEffect(() => {
    setDate("");
    setReason("");
    setProblem(null);
  }, [branch]);
  const today = todayKL(new Date());
  const unsaved = !sameClosures(s.closures, s.server.closures);
  const errors: Record<string, string> = {
    invalid: w("Pick a date.", "Pilih tarikh."),
    past: w(
      "That date has passed. Pick today or later.",
      "Tarikh itu sudah berlalu. Pilih hari ini atau selepas itu.",
    ),
    duplicate: w(
      "That date is already listed.",
      "Tarikh itu sudah disenaraikan.",
    ),
    full: w(
      `You can list up to ${MAX_CLOSURES} closed dates.`,
      `Anda boleh senaraikan sehingga ${MAX_CLOSURES} tarikh tutup.`,
    ),
  };
  const set = (next: Closure[]) => {
    sync.setClosures(next);
    sync.save();
  };
  const sorted = [...s.closures].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section className="agent-closures" aria-labelledby={`closed-${branch}`}>
      <h3 id={`closed-${branch}`}>{w("Closed dates", "Tarikh tutup")}</h3>
      {unsaved && (
        <p className="agent-day-state" role="status">
          {s.saving
            ? w("Saving…", "Menyimpan…")
            : w("Not saved", "Belum disimpan")}
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="core-hint">
          {w(
            "No closed dates. Add public holidays or days you shut for another reason.",
            "Tiada tarikh tutup. Tambah cuti umum atau hari anda tutup atas sebab lain.",
          )}
        </p>
      ) : (
        <ul className="agent-closed-list">
          {sorted.map((c) => (
            <li key={c.date}>
              <span>
                <strong>{dateWords(c.date, ms)}</strong>
                {c.reason && <small>{c.reason}</small>}
              </span>
              <button
                type="button"
                className="agent-mini"
                aria-label={`${w("Remove closed date", "Buang tarikh tutup")} ${dateWords(c.date, ms)}`}
                onClick={() => set(s.closures.filter((x) => x.date !== c.date))}
              >
                {w("Remove", "Buang")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="agent-closed-add">
        <Field label={w("Date", "Tarikh")}>
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <Field
          label={w("Label (optional)", "Label (pilihan)")}
          hint={w(
            `Up to ${MAX_REASON} characters.`,
            `Sehingga ${MAX_REASON} aksara.`,
          )}
        >
          <input
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <button
          type="button"
          className="button secondary-button"
          onClick={() => {
            const p = closureProblem(date, s.closures, today);
            setProblem(p);
            if (p) return;
            set([...s.closures, { date, reason: reason.trim() }]);
            setDate("");
            setReason("");
          }}
        >
          {w("Add closed date", "Tambah tarikh tutup")}
        </button>
        {problem && (
          <p className="agent-field-error" role="alert">
            {errors[problem]}
          </p>
        )}
      </div>
    </section>
  );
}
