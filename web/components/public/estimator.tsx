"use client";
import { useEffect, useState } from "react";
import { rmExact } from "@/content/public/format";
import { pricing } from "@/content/public/pricing";
import type { PublicLocale } from "@/lib/site";
import {
  clampMinutes,
  estimates,
  MAX_MINUTES,
  MIN_MINUTES,
  STEP_MINUTES,
} from "./estimates";

// The one island on the pricing page: voice minutes in, each plan's month out.
// The figures are the same `monthlyEstimateSen` the wallet uses and follow
// every change. The sentence read out to a screen reader waits 500 ms after
// the last change, so a drag is announced once, with its final answer.
export function Estimator({ locale }: { locale: PublicLocale }) {
  const t = pricing[locale].estimator;
  const names = pricing[locale].plans.plans;
  const [minutes, setMinutes] = useState(300);
  const [text, setText] = useState("300");
  const [said, setSaid] = useState(300);
  useEffect(() => {
    const id = setTimeout(() => setSaid(minutes), 500);
    return () => clearTimeout(id);
  }, [minutes]);
  const { rows, cheapest } = estimates(minutes);
  // Bars compare the plans that can take calls; the others have no bar.
  const top = Math.max(...rows.filter((r) => r.phone).map((r) => r.sen));
  const heard = estimates(said);
  const winner = heard.rows.find((r) => r.code === heard.cheapest)!;
  const fill = `${(minutes / MAX_MINUTES) * 100}%`;
  return (
    <div className="estimator">
      <div className="est-controls">
        <div className="est-field">
          <label className="t-label" htmlFor="est-range">
            {t.sliderLabel}
          </label>
          <input
            id="est-range"
            className="est-range"
            type="range"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={STEP_MINUTES}
            value={minutes}
            style={{ "--fill": fill } as React.CSSProperties}
            onChange={(e) => {
              const n = clampMinutes(e.target.value);
              setMinutes(n);
              setText(String(n));
            }}
          />
          <div className="est-scale t-small t-muted" aria-hidden="true">
            <span className="t-data">{MIN_MINUTES}</span>
            <span className="t-data">{MAX_MINUTES.toLocaleString("en-MY")}</span>
          </div>
        </div>
        <div className="est-field est-number">
          <label className="t-label" htmlFor="est-input">
            {t.inputLabel}
          </label>
          <div className="est-box">
            <input
              id="est-input"
              className="t-data"
              type="number"
              inputMode="numeric"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              step={STEP_MINUTES}
              value={text}
              onChange={(e) => {
                const raw = e.target.value;
                // Past the top of the range the box shows the top at once.
                setText(Number(raw) > MAX_MINUTES ? String(MAX_MINUTES) : raw);
                // While typing, the figures follow the exact number.
                setMinutes(clampMinutes(raw, 1));
              }}
              onBlur={() => {
                const n = clampMinutes(text);
                setMinutes(n);
                setText(String(n));
              }}
            />
            <span className="t-small t-muted">{t.unit}</span>
          </div>
        </div>
      </div>

      <ul className="est-rows" aria-label={t.resultsLabel}>
        {rows.map((row) => {
          const plan = names[row.code];
          return (
            <li key={row.code} className="est-row" data-cheapest={row.code === cheapest}>
              <div className="est-name">
                <h3 className="t-h3">{plan.name}</h3>
                {row.code === cheapest && <span className="badge badge-solid">{t.cheapest}</span>}
                <p className="t-small t-muted">
                  {row.phone
                    ? row.includedMinutes
                      ? t.included(row.includedMinutes)
                      : t.nothingIncluded
                    : t.noPhone}
                </p>
              </div>
              <p className="est-figure t-data">{rmExact(row.sen)}</p>
              <span className="est-bar" data-none={!row.phone} aria-hidden="true">
                {row.phone && <i style={{ width: `${top ? (row.sen / top) * 100 : 0}%` }} />}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="est-summary t-small" role="status" aria-live="polite">
        {t.summary(said, names[winner.code].name, rmExact(winner.sen))}
      </p>
      <p className="t-small t-muted">{t.fine}</p>
    </div>
  );
}
