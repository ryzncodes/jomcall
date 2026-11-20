"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { rm } from "@/content/public/format";
import { worksheetCopy } from "@/content/public/guides";
import { pricing } from "@/content/public/pricing";
import type { PublicLocale } from "@/lib/site";
import { clampMinutes, MAX_MINUTES } from "./estimates";
import {
  clampAverageSen,
  clampCostSen,
  clampPerWeek,
  costCompare,
  MAX_AVERAGE_SEN,
  MAX_COST_SEN,
  MAX_PER_WEEK,
  missedValueSen,
  monthlyCalls,
  shareFromPercent,
} from "./worksheet-math";

// The worksheet island. "missed": calls missed a week, the share that would
// have booked and an average booking in, the ringgit at stake each month out.
// "cost": the visitor's own monthly receptionist cost beside JomCall's month
// at the same minutes. Every figure is the visitor's; the arithmetic is in
// worksheet-math.ts. Nothing is sent anywhere. The sentence read to a screen
// reader waits 500 ms after the last change, so typing is announced once.
export function Worksheet({ locale, mode }: { locale: PublicLocale; mode: "missed" | "cost" }) {
  return mode === "missed" ? <Missed locale={locale} /> : <Cost locale={locale} />;
}

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

// Whole and one-decimal numbers in the house style: "43.3", "30%".
const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");

function useSettled<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), 500);
    return () => clearTimeout(id);
  }, [value]);
  return settled;
}

function Field({
  id,
  label,
  hint,
  unit,
  unitFirst,
  value,
  max,
  step,
  inputMode,
  placeholder,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  hint?: string;
  unit: string;
  unitFirst?: boolean;
  value: string;
  max: number;
  step: number | "any";
  inputMode: "numeric" | "decimal";
  placeholder?: string;
  onChange: (raw: string) => void;
  onBlur: () => void;
}) {
  const unitNode: ReactNode = (
    <span className="ws-unit t-data" aria-hidden="true">
      {unit}
    </span>
  );
  return (
    <div className="ws-field">
      <label className="ws-label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <p className="t-small t-muted" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <div className="ws-box" data-unit-first={unitFirst ? "true" : undefined}>
        {unitFirst && unitNode}
        <input
          id={id}
          className="t-data"
          type="number"
          inputMode={inputMode}
          min={0}
          max={max}
          step={step}
          value={value}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        {!unitFirst && unitNode}
      </div>
    </div>
  );
}

function Missed({ locale }: { locale: PublicLocale }) {
  const t = worksheetCopy[locale].missed;
  const id = useId();
  // Example figures to start from; the page says so above the fields.
  const [week, setWeek] = useState("10");
  const [share, setShare] = useState("30");
  const [average, setAverage] = useState("80");

  const perWeek = clampPerWeek(week);
  const s = shareFromPercent(share);
  const averageSen = clampAverageSen(average);
  const sen = missedValueSen({ perWeek, share: s, averageSen });
  const said = useSettled(sen);

  const working = fill(t.working, {
    calls: oneDecimal(monthlyCalls(perWeek)),
    share: `${oneDecimal(s * 100)}%`,
    average: rm(averageSen),
  });

  return (
    <div className="ws" role="group" aria-label={t.label}>
      <div className="ws-fields">
        <p className="ws-example t-small">{t.example}</p>
        <Field
          id={`${id}-week`}
          label={t.perWeek.label}
          unit={t.perWeek.unit}
          value={week}
          max={MAX_PER_WEEK}
          step={1}
          inputMode="numeric"
          onChange={setWeek}
          onBlur={() => setWeek(String(perWeek))}
        />
        <Field
          id={`${id}-share`}
          label={t.share.label}
          unit={t.share.unit}
          value={share}
          max={100}
          step="any"
          inputMode="decimal"
          onChange={setShare}
          onBlur={() => setShare(oneDecimal(s * 100))}
        />
        <Field
          id={`${id}-average`}
          label={t.average.label}
          unit={t.average.unit}
          unitFirst
          value={average}
          max={MAX_AVERAGE_SEN / 100}
          step="any"
          inputMode="decimal"
          onChange={setAverage}
          onBlur={() => setAverage((averageSen / 100).toFixed(2).replace(/\.00$/, ""))}
        />
      </div>
      <div className="ws-out">
        <p className="ws-out-label">{t.result}</p>
        <p className="ws-amount t-data">{rm(sen)}</p>
        <p className="ws-working t-small t-data">{working}</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {fill(t.said, { amount: rm(said) })}
      </p>
      <p className="ws-fine t-small t-muted">{t.fine}</p>
    </div>
  );
}

function Cost({ locale }: { locale: PublicLocale }) {
  const t = worksheetCopy[locale].cost;
  const names = pricing[locale].plans.plans;
  const id = useId();
  // No starting cost: the page never states a salary figure.
  const [cost, setCost] = useState("");
  const [minutesText, setMinutesText] = useState("300");

  const minutes = clampMinutes(minutesText, 1);
  const costSen = clampCostSen(cost);
  const result = costCompare({ costSen, minutes });
  // Settle the two numbers, not the result object (a new object each render).
  const settledCost = useSettled(costSen);
  const settledMinutes = useSettled(minutes);
  const settled = costCompare({ costSen: settledCost, minutes: settledMinutes });
  const top = Math.max(result.costSen, result.jomcallSen, 1);
  const jomcallLabel = fill(t.jomcall, { plan: names[result.plan].name, minutes: String(minutes) });
  const saidValues = {
    cost: rm(settled.costSen),
    plan: names[settled.plan].name,
    minutes: String(settledMinutes),
    jomcall: rm(settled.jomcallSen),
  };

  return (
    <div className="ws" role="group" aria-label={t.label}>
      <div className="ws-fields">
        <Field
          id={`${id}-cost`}
          label={t.cost.label}
          hint={t.cost.hint}
          unit={t.cost.unit}
          unitFirst
          value={cost}
          max={MAX_COST_SEN / 100}
          step="any"
          inputMode="decimal"
          onChange={setCost}
          onBlur={() => setCost(cost.trim() === "" ? "" : (result.costSen / 100).toFixed(2).replace(/\.00$/, ""))}
        />
        <Field
          id={`${id}-minutes`}
          label={t.minutes.label}
          unit={t.minutes.unit}
          value={minutesText}
          max={MAX_MINUTES}
          step={10}
          inputMode="numeric"
          onChange={setMinutesText}
          onBlur={() => setMinutesText(String(clampMinutes(minutesText)))}
        />
      </div>
      <ul className="ws-out ws-lines">
        <li className="ws-line">
          <span className="ws-line-name t-small">{t.yours}</span>
          <span className="ws-fig t-data" data-empty={result.costSen === 0 ? "true" : undefined}>
            {result.costSen > 0 ? rm(result.costSen) : t.empty}
          </span>
          <span className="ws-bar" aria-hidden="true">
            {result.costSen > 0 && <i style={{ width: `${(result.costSen / top) * 100}%` }} />}
          </span>
        </li>
        <li className="ws-line" data-us="true">
          <span className="ws-line-name t-small">{jomcallLabel}</span>
          <span className="ws-fig t-data">{rm(result.jomcallSen)}</span>
          <span className="ws-bar" aria-hidden="true">
            <i style={{ width: `${(result.jomcallSen / top) * 100}%` }} />
          </span>
        </li>
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {fill(settled.costSen > 0 ? t.said : t.saidEmpty, saidValues)}
      </p>
      <p className="ws-fine t-small t-muted">{t.fine}</p>
    </div>
  );
}
