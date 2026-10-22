"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  MapPin,
  Plus,
  Trash,
  Clock,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { AppShell } from "./shell";
import { Field } from "./setup";
import { branchesFor } from "@/lib/api/admin";
import { scheduleFor, type Schedule } from "@/lib/api/remaining";
import { malaysiaStates } from "@/lib/api/builder-types";
import { timeValid } from "@/lib/api/outbound";
export function BranchHours() {
  const { t, href } = useExperience(),
    p = t.remaining,
    b = t.builder,
    { draft: d, update } = useProduct(),
    [branch, setBranch] = useState(""),
    [form, setForm] = useState<Schedule | null>(null),
    [date, setDate] = useState(""),
    [notice, setNotice] = useState("");
  if (!d)
    return (
      <AppShell active="hours">
        <main tabIndex={-1} id="workspace-content" className="product-main">
          {t.product.loading}
        </main>
      </AppShell>
    );
  const id = branch || d.location.id,
    s = form ?? structuredClone(scheduleFor(d, id));
  const patch = (v: Partial<Schedule>) => {
    setForm({ ...s, ...v });
    setNotice("");
  };
  return (
    <AppShell active="hours">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main remaining-main"
      >
        <div className="workspace-title">
          <div>
            <p className="eyebrow">{p.branchHours}</p>
            <h1>{p.branchHoursTitle}</h1>
            <p>{p.branchHoursIntro}</p>
          </div>
          <a className="text-link" href={href("/app/bookings")}>
            {t.crm.bookings}
            <ArrowUpRight size={18} />
          </a>
        </div>
        <div className="branch-schedule-layout">
          <aside className="branch-selector">
            <MapPin size={30} />
            <h2>{t.admin.branches}</h2>
            {branchesFor(d)
              .filter((x) => !x.archived)
              .map((x) => (
                <button
                  key={x.id}
                  aria-pressed={id === x.id}
                  onClick={() => {
                    setBranch(x.id);
                    setForm(null);
                    setNotice("");
                  }}
                >
                  {x.name}
                  <ArrowUpRight size={17} />
                </button>
              ))}
            <a
              className="text-link"
              href={href("/app/settings?section=branches")}
            >
              {t.admin.branches}
              <Plus size={18} />
            </a>
          </aside>
          <section className="branch-schedule">
            <h2>{branchesFor(d).find((x) => x.id === id)?.name}</h2>
            <Field label={b.state}>
              <select
                value={s.state}
                onChange={(e) => patch({ state: e.target.value })}
              >
                {malaysiaStates.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <div className="hours-editor">
              {s.weekly_hours.map((h, i) => (
                <div className="hours-line" key={i}>
                  <label className="product-check">
                    <input
                      type="checkbox"
                      checked={h.open}
                      onChange={(e) =>
                        patch({
                          weekly_hours: s.weekly_hours.map((x, j) =>
                            i === j ? { ...x, open: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    {b.days[i]}
                  </label>
                  <div>
                    {h.open ? (
                      <>
                        <input
                          aria-label={`${b.days[i]} ${b.from}`}
                          type="time"
                          value={h.from}
                          onChange={(e) =>
                            patch({
                              weekly_hours: s.weekly_hours.map((x, j) =>
                                i === j ? { ...x, from: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <span>–</span>
                        <input
                          aria-label={`${b.days[i]} ${b.to}`}
                          type="time"
                          value={h.to}
                          onChange={(e) =>
                            patch({
                              weekly_hours: s.weekly_hours.map((x, j) =>
                                i === j ? { ...x, to: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </>
                    ) : (
                      <span>{b.closed}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="editor-divider" />
            <h3>{b.closures}</h3>
            <p>{p.holidayHint}</p>
            <div className="field-pair">
              <Field label={b.date}>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <button
                className="button secondary-button"
                onClick={() => {
                  if (!date || s.closures.some((x) => x.date === date)) {
                    setNotice(p.hoursError);
                    return;
                  }
                  patch({
                    closures: [
                      ...s.closures,
                      {
                        id: crypto.randomUUID(),
                        date,
                        label: `${p.holidayLabel} · ${s.state}`,
                      },
                    ].sort((a, b) => a.date.localeCompare(b.date)),
                  });
                  setDate("");
                }}
              >
                <Plus size={18} />
                {p.holidaySample}
              </button>
            </div>
            {s.closures.map((x) => (
              <div className="closure-row" key={x.id}>
                <Clock size={18} />
                <span>
                  <strong>{x.date}</strong>
                  {x.label}
                </span>
                <button
                  className="icon-button"
                  aria-label={`${p.remove} ${x.label}`}
                  onClick={() =>
                    patch({ closures: s.closures.filter((v) => v.id !== x.id) })
                  }
                >
                  <Trash size={18} />
                </button>
              </div>
            ))}
            <div className="branch-save">
              <button
                className="button button-dark"
                onClick={() => {
                  if (
                    s.weekly_hours.some(
                      (x) =>
                        x.open &&
                        (!timeValid(x.from) ||
                          !timeValid(x.to) ||
                          x.from >= x.to),
                    )
                  ) {
                    setNotice(p.hoursError);
                    return;
                  }
                  update(
                    (v) =>
                      id === v.location.id
                        ? {
                            ...v,
                            settings: { ...v.settings, ...s },
                            location: {
                              ...v.location,
                              hours: s.weekly_hours
                                .map(
                                  (h, i) =>
                                    `${b.days[i]}: ${h.open ? `${h.from}–${h.to}` : b.closed}`,
                                )
                                .join("; "),
                            },
                          }
                        : {
                            ...v,
                            extensions: {
                              ...v.extensions,
                              branch_hours: {
                                ...v.extensions.branch_hours,
                                [id]: s,
                              },
                            },
                          },
                    true,
                  );
                  setForm(null);
                  setNotice(p.saved);
                }}
              >
                {p.customSchedule}
              </button>
              {id !== d.location.id && (
                <button
                  className="text-link"
                  onClick={() => {
                    update((v) => {
                      const rows = { ...v.extensions.branch_hours };
                      delete rows[id];
                      return {
                        ...v,
                        extensions: { ...v.extensions, branch_hours: rows },
                      };
                    }, true);
                    setForm(null);
                    setNotice(p.saved);
                  }}
                >
                  {p.inherit}
                </button>
              )}
            </div>
            <p role="status" className="remaining-notice">
              {notice}
            </p>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
