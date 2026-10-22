"use client";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Phone,
  PhoneIncoming,
  Robot,
  MapPin,
  CheckCircle,
  ShieldCheck,
  Headphones,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { AppShell } from "./shell";
import { branchesFor } from "@/lib/api/admin";
import { forwardingReady, serviceApi } from "@/lib/api/service";
import { productApi, template } from "@/lib/api/product";
import { forwardingHelp } from "@/lib/api/forwarding";
import type { SetupDraft } from "@/lib/api/product-types";
export function PhoneNumbers() {
  const { t, href } = useExperience(),
    p = t.services,
    { draft: d, update } = useProduct();
  const [busy, setBusy] = useState(false),
    [fail, setFail] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const latest = useRef(d);
  latest.current = d;
  const route = (patch: Partial<SetupDraft["phone_line"]>) => {
    update((v) => serviceApi.route(v, patch));
    setNotice("");
    setError("");
  };
  const verify = async () => {
    if (!d || !forwardingReady(d)) return;
    setBusy(true);
    setError("");
    setNotice("");
    const before = JSON.stringify({ ...d.phone_line, verified: false });
    update((v) => serviceApi.route(v, {}));
    try {
      await productApi.simulate(fail);
      if (
        !latest.current ||
        JSON.stringify(latest.current.phone_line) !== before ||
        !forwardingReady(latest.current)
      )
        throw Error("changed");
      update((v) => ({
        ...v,
        phone_line: {
          ...v.phone_line,
          verified:
            forwardingReady(v) && JSON.stringify(v.phone_line) === before,
        },
      }));
      setNotice(p.verified);
    } catch {
      setError(p.verifyFailed);
    } finally {
      setBusy(false);
      setFail(false);
    }
  };
  return (
    <AppShell active="phones">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main service-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.phoneTitle}</h1>
            <p>{p.phoneIntro}</p>
          </div>
          <a className="button secondary-button" href={href("/app/test")}>
            <Headphones size={18} />
            {p.testAgent}
          </a>
        </div>
        {d ? (
          <>
            <div className="service-summary">
              <span>
                <strong>{d.phone_line.reserved ? 1 : 0}</strong>
                {p.reservedCount}
              </span>
              <span
                className={`service-status ${d.phone_line.verified ? "good" : ""}`}
              >
                <i />
                {d.phone_line.verified ? p.verified : p.unverified}
              </span>
              <span>{d.location.timezone}</span>
            </div>
            <div className="service-grid">
              <div className="service-stack">
                <section className="service-panel">
                  <header className="service-panel-head">
                    <h2>{p.lines}</h2>
                    <span className="service-panel-icon">
                      <PhoneIncoming size={24} />
                    </span>
                  </header>
                  <div className="line-identity">
                    <span className="line-icon">
                      <Phone size={28} />
                    </span>
                    <div>
                      <small>{p.line}</small>
                      <h3>
                        {d.phone_line.reserved
                          ? t.product.numberValue
                          : p.notReserved}
                      </h3>
                      <p>
                        {d.organization.name} ·{" "}
                        {branchesFor(d).find(
                          (b) => b.id === d.phone_line.location_id,
                        )?.name ?? p.unassigned}
                      </p>
                    </div>
                  </div>
                  <p className="service-note">{p.numberNote}</p>
                  {!d.phone_line.reserved && (
                    <div className="service-panel-body">
                      <button
                        className="button button-dark"
                        onClick={() => route({ reserved: true })}
                      >
                        {p.reserve}
                        <ArrowRight size={17} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="service-panel">
                  <header className="service-panel-head">
                    <div>
                      <h2>{p.routing}</h2>
                      <p>{p.routeHint}</p>
                    </div>
                  </header>
                  <div className="route-map">
                    <div>
                      <Phone size={21} />
                      <span>{p.yourLine}</span>
                      <strong>{d.phone_line.telco}</strong>
                    </div>
                    <ArrowRight size={18} />
                    <div>
                      <PhoneIncoming size={21} />
                      <span>{p.forwarding}</span>
                      <strong>
                        {t.product.modes[d.phone_line.forwarding_mode]}
                      </strong>
                    </div>
                    <ArrowRight size={18} />
                    <div>
                      <Robot size={21} />
                      <span>{p.agent}</span>
                      <strong>
                        {d.phone_line.agent_id
                          ? d.settings.persona
                          : p.unassigned}
                      </strong>
                    </div>
                  </div>
                  <div className="service-panel-body">
                    <fieldset className="service-choice">
                      <legend>{t.product.forwardingMode}</legend>
                      {(["missed", "always"] as const).map((mode) => (
                        <label
                          key={mode}
                          className={
                            d.phone_line.forwarding_mode === mode
                              ? "selected"
                              : ""
                          }
                        >
                          <input
                            type="radio"
                            name="phone-mode"
                            checked={d.phone_line.forwarding_mode === mode}
                            disabled={busy}
                            onChange={() => route({ forwarding_mode: mode })}
                          />
                          <span>
                            <strong>{t.product.modes[mode]}</strong>
                            <small>{t.product.modeDescriptions[mode]}</small>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="field-pair">
                      <label className="product-field">
                        {p.agent}
                        <select
                          aria-label={p.agent}
                          value={d.phone_line.agent_id}
                          disabled={busy}
                          onChange={(e) => route({ agent_id: e.target.value })}
                        >
                          <option value="">{p.unassigned}</option>
                          <option value={d.agent.id}>
                            {d.settings.persona}
                          </option>
                        </select>
                      </label>
                      <label className="product-field">
                        {p.branch}
                        <select
                          aria-label={p.branch}
                          value={d.phone_line.location_id}
                          disabled={busy}
                          onChange={(e) =>
                            route({ location_id: e.target.value })
                          }
                        >
                          <option value="">{p.unassigned}</option>
                          {branchesFor(d)
                            .filter((b) => !b.archived)
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <label className="product-field">
                      {t.product.carrier}
                      <select
                        aria-label={t.product.carrier}
                        value={d.phone_line.telco}
                        disabled={busy}
                        onChange={(e) =>
                          route({
                            telco: e.target
                              .value as SetupDraft["phone_line"]["telco"],
                          })
                        }
                      >
                        {Object.keys(forwardingHelp).map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="service-actions">
                      <button
                        className="button button-dark"
                        disabled={busy || !forwardingReady(d)}
                        onClick={verify}
                      >
                        <CheckCircle size={18} />
                        {busy ? p.checking : p.verify}
                      </button>
                      <a
                        href={forwardingHelp[d.phone_line.telco]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="crm-text-button"
                      >
                        {t.product.providerHelp}
                        <ArrowUpRight size={15} />
                      </a>
                    </div>
                    {!forwardingReady(d) && (
                      <p className="service-note">{p.verifyNeeds}</p>
                    )}
                    <p className="service-note">
                      {template(t.product.guideWarning, {
                        telco: d.phone_line.telco,
                      })}
                    </p>
                    {error && (
                      <p className="crm-form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <p className="crm-notice" role="status">
                      {notice}
                    </p>
                    <details className="service-recovery">
                      <summary>{p.previewControls}</summary>
                      <label className="product-check">
                        <input
                          type="checkbox"
                          checked={fail}
                          disabled={busy}
                          onChange={(e) => setFail(e.target.checked)}
                        />
                        {p.simulateFailure}
                      </label>
                    </details>
                  </div>
                </section>
              </div>
              <aside className="service-aside">
                <div className="service-aside-symbol">
                  <ShieldCheck size={32} weight="light" />
                </div>
                <h2>{p.disclosure}</h2>
                <p>{p.disclosureNote}</p>
                <blockquote>
                  {template(d.agent.greeting, { name: d.organization.name })}
                </blockquote>
                <div className="disclosure-state">
                  <CheckCircle size={16} />
                  <span>{t.product.disclosureAlways}</span>
                </div>
                <div className="disclosure-state">
                  <span className="connection-dot" />
                  <span>
                    {d.agent.recording_enabled
                      ? t.enabled
                      : t.product.recordingOff}
                  </span>
                </div>
                {d.agent.recording_enabled && (
                  <p className="service-quote">
                    {d.agent.recording_disclosure}
                  </p>
                )}
                <a className="crm-text-button" href={href("/app/agent")}>
                  {p.manageAgent}
                  <ArrowUpRight size={15} />
                </a>
                <div className="service-aside-rule" />
                <MapPin size={20} />
                <h3>
                  {branchesFor(d).find((b) => b.id === d.phone_line.location_id)
                    ?.name ?? p.unassigned}
                </h3>
                <p>{d.location.hours}</p>
              </aside>
            </div>
            <footer className="service-footer">{p.localNote}</footer>
          </>
        ) : (
          <div className="skeleton" aria-busy="true" />
        )}
      </main>
    </AppShell>
  );
}
