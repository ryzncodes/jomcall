"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  PhoneIncoming,
  CalendarBlank,
  ArrowBendUpRight,
  Wallet,
  ArrowRight,
  CheckCircle,
  Bell,
  Headphones,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { useCrm } from "./crm-provider";
import { AppShell } from "./shell";
import { klDay } from "@/lib/api/crm";
import { dashboardData } from "@/lib/api/dashboard";
import { channelReady } from "@/lib/api/service";
import { clock, money, duration } from "@/lib/api/client";
import { Outcome } from "../workspace";
export function Dashboard() {
  const { t, href, locale } = useExperience(),
    p = t.admin,
    { draft: d } = useProduct(),
    { data: c } = useCrm();
  const [selected, setSelected] = useState("");
  const day = selected || klDay(),
    view = d && c ? dashboardData(d, c, day) : null;
  const latest = c?.calls.reduce(
    (date, x) =>
      klDay(new Date(x.started_at)) > date
        ? klDay(new Date(x.started_at))
        : date,
    "",
  );
  return (
    <AppShell active="home">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main home-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.title}</h1>
            <p>{p.intro}</p>
          </div>
          <a className="button secondary-button" href={href("/app/test")}>
            <Headphones size={18} />
            {p.test}
          </a>
        </div>
        <div className="home-day">
          <div>
            <span className="home-live-dot" />
            <strong>{d?.organization.name}</strong>
            <span>{d?.location.timezone}</span>
          </div>
          <div>
            <label className="sr-only" htmlFor="activity-day">
              {p.day}
            </label>
            <input
              id="activity-day"
              type="date"
              value={day}
              onChange={(e) => setSelected(e.target.value)}
            />
            <button onClick={() => setSelected(klDay())}>{p.today}</button>
            {latest && latest !== day && (
              <button onClick={() => setSelected(latest)}>{p.latest}</button>
            )}
          </div>
        </div>
        {view && d && c ? (
          <>
            <section className="home-metrics" aria-label={p.nav}>
              {[
                [PhoneIncoming, p.calls, view.inbound.length],
                [CalendarBlank, p.bookings, view.confirmed],
                [ArrowBendUpRight, p.recovered, view.recovered],
                [Wallet, p.spend, money(view.spend)],
              ].map(([Icon, label, value]) => {
                const Glyph = Icon as typeof Wallet;
                return (
                  <div key={String(label)}>
                    <span>
                      <Glyph size={19} />
                      {String(label)}
                    </span>
                    <strong>{String(value)}</strong>
                  </div>
                );
              })}
            </section>
            <p className="home-metric-note">{p.metricsNote}</p>
            <div className="home-grid">
              <section className="home-chart">
                <header>
                  <div>
                    <h2>{p.hourly}</h2>
                    <p>{p.hourlyHint}</p>
                  </div>
                  <span>
                    {new Intl.DateTimeFormat(
                      locale === "ms" ? "ms-MY" : "en-GB",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Asia/Kuala_Lumpur",
                      },
                    ).format(new Date(day + "T12:00:00+08:00"))}
                  </span>
                </header>
                <div
                  className="hour-chart"
                  role="img"
                  aria-label={view.hours
                    .map((h) => `${h.hour}:00 — ${h.count}`)
                    .join(", ")}
                >
                  {view.hours.map((h) => (
                    <div className="hour-column" key={h.hour}>
                      <span className="hour-count">{h.count || ""}</span>
                      <i
                        style={{
                          height: `${h.count ? Math.max(6, (h.count / Math.max(...view.hours.map((x) => x.count), 1)) * 120) : 2}px`,
                        }}
                      />
                      <small>
                        {h.hour % 4 === 0
                          ? String(h.hour).padStart(2, "0")
                          : ""}
                      </small>
                    </div>
                  ))}
                </div>
                {!view.inbound.length && (
                  <p className="home-empty">{p.noCalls}</p>
                )}
                <div className="home-readiness">
                  <a href={href("/app/phone-numbers")}>
                    <i className={d.phone_line.verified ? "good" : ""} />
                    {d.phone_line.verified ? p.verified : p.unverified}
                    <ArrowUpRight size={15} />
                  </a>
                  <a href={href("/app/whatsapp")}>
                    <i className={channelReady(d) ? "good" : ""} />
                    {channelReady(d) ? p.connected : p.disconnected}
                    <ArrowUpRight size={15} />
                  </a>
                </div>
              </section>
              <section className="home-attention">
                <header>
                  <Bell size={21} />
                  <h2>{p.attention}</h2>
                  <span>{view.alerts.length}</span>
                </header>
                <p>{p.alertHint}</p>
                <div>
                  {view.alerts.map((a) => (
                    <a key={a.kind} href={href(a.href)}>
                      <span className="alert-count">{a.count}</span>
                      <span>{p[a.kind]}</span>
                      <ArrowUpRight size={16} />
                    </a>
                  ))}
                  {!view.alerts.length && (
                    <div className="home-all-clear">
                      <CheckCircle size={30} />
                      <p>{p.clear}</p>
                    </div>
                  )}
                </div>
              </section>
              <section className="home-calls">
                <header>
                  <h2>{p.recent}</h2>
                  <a href={href("/app/calls")}>
                    {p.allCalls}
                    <ArrowUpRight size={15} />
                  </a>
                </header>
                {[...view.calls]
                  .sort((a, b) => b.started_at.localeCompare(a.started_at))
                  .slice(0, 5)
                  .map((call) => (
                    <a
                      className="home-call"
                      href={href(`/app/calls?call=${call.id}`)}
                      key={call.id}
                    >
                      <span className="home-call-icon">
                        <PhoneIncoming size={18} />
                      </span>
                      <span>
                        <strong>
                          {
                            c.contacts.find((x) => x.id === call.contact_id)
                              ?.name
                          }
                        </strong>
                        <small>
                          {clock(call.started_at)} ·{" "}
                          {duration(call.duration_seconds)} · {call.language}
                        </small>
                      </span>
                      <Outcome value={call.outcome} />
                      <ArrowUpRight size={16} />
                    </a>
                  ))}
                {!view.calls.length && (
                  <p className="home-empty">{p.noCalls}</p>
                )}
              </section>
              <section className="home-agenda">
                <header>
                  <h2>{p.agenda}</h2>
                  <a href={href("/app/bookings")}>
                    {p.allBookings}
                    <ArrowUpRight size={15} />
                  </a>
                </header>
                {[...view.bookings]
                  .sort((a, b) => a.start_at.localeCompare(b.start_at))
                  .slice(0, 5)
                  .map((b) => (
                    <a href={href(`/app/bookings?booking=${b.id}`)} key={b.id}>
                      <time>{clock(b.start_at)}</time>
                      <span>
                        <strong>
                          {c.contacts.find((x) => x.id === b.contact_id)?.name}
                        </strong>
                        <small>{b.title}</small>
                        <em>
                          {b.status === "confirmed"
                            ? t.crm.confirmed
                            : p.pending}
                        </em>
                      </span>
                      <ArrowRight size={16} />
                    </a>
                  ))}
                {!view.bookings.length && (
                  <p className="home-empty">{p.noBookings}</p>
                )}
                <a className="home-wallet" href={href("/app/billing")}>
                  <span>{p.balanceLabel}</span>
                  <strong>{money(view.balance)}</strong>
                  <ArrowUpRight size={18} />
                </a>
              </section>
            </div>
            <footer className="home-footer">
              <span>{p.local}</span>
              <a href={href("/app/settings?section=privacy")}>
                {p.recordingPolicy} · {d.admin.retention_days} {p.days}
                <ArrowUpRight size={14} />
              </a>
            </footer>
          </>
        ) : (
          <div className="skeleton" aria-busy="true" />
        )}
      </main>
    </AppShell>
  );
}
