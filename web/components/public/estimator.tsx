"use client";
import { useState } from "react";
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
// The figures are the same `monthlyEstimateSen` the wallet uses. The slider
// and the number box are two views of one value; the result is read out
// politely, in one sentence, so a screen reader hears the answer and not
// every step of a drag.
export function Estimator({ locale }: { locale: PublicLocale }) {
  const t = pricing[locale].estimator;
  const names = pricing[locale].plans.plans;
  const [minutes, setMinutes] = useState(300);
  const [text, setText] = useState("300");
  const { rows, cheapest } = estimates(minutes);
  const top = Math.max(...rows.map((r) => r.sen));
  const winner = rows.find((r) => r.code === cheapest)!;
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
                setText(e.target.value);
                // While typing, the figures follow the exact number.
                setMinutes(clampMinutes(e.target.value, 1));
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
              <span className="est-bar" aria-hidden="true">
                <i style={{ width: `${top ? (row.sen / top) * 100 : 0}%` }} />
              </span>
            </li>
          );
        })}
      </ul>

      <p className="est-summary t-small" role="status" aria-live="polite">
        {t.summary(minutes, names[winner.code].name, rmExact(winner.sen))}
      </p>
      <p className="t-small t-muted">{t.fine}</p>
    </div>
  );
}
