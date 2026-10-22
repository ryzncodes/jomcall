"use client";
import { forwardingReady, serviceApi } from "@/lib/api/service";
import {
  useEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  type ReactElement,
} from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle,
  Scissors,
  FirstAidKit,
  Wrench,
  Globe,
  Phone,
  WhatsappLogo,
  CalendarBlank,
  ShieldCheck,
  Play,
  Stop,
  Wallet,
  CaretDown,
  Headphones,
  FloppyDisk,
  WarningCircle,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { AppShell } from "./shell";
import { useProduct } from "./provider";
import { CallTest } from "./call-test";
import { productApi, stepReady, template } from "@/lib/api/product";
import { money } from "@/lib/api/client";
import { businessTypes } from "@/lib/api/builder-types";
import { forwardingHelp } from "@/lib/api/forwarding";
import type {
  BusinessType,
  VoiceStyle,
  SetupDraft,
} from "@/lib/api/product-types";
export { Field } from "../core/field";
import { Field } from "../core/field";
function Recovery({
  label,
  failed,
  onChange,
  disabled,
}: {
  label: string;
  failed: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useExperience(),
    p = t.product;
  return (
    <details className="recovery-controls">
      <summary>{p.recovery}</summary>
      <p>{p.recoveryNote}</p>
      <label className="product-check">
        <input
          type="checkbox"
          checked={failed}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
    </details>
  );
}
export function VoicePreview({ draft }: { draft: SetupDraft }) {
  const { t } = useExperience(),
    p = t.product;
  const [playing, setPlaying] = useState(false),
    [unavailable, setUnavailable] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    utterance = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => {
    setPlaying(false);
    setUnavailable(false);
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
    return () => {
      clearTimeout(timeout.current);
      utterance.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [draft.agent.voice, draft.agent.languages.join(",")]);
  const play = () => {
    if (!("speechSynthesis" in window)) {
      setUnavailable(true);
      return;
    }
    const synth = window.speechSynthesis;
    if (playing) {
      utterance.current = null;
      synth.cancel();
      clearTimeout(timeout.current);
      setPlaying(false);
      return;
    }
    const language =
      draft.agent.languages[0] === "mixed" ? "ms" : draft.agent.languages[0];
    const voice = synth
      .getVoices()
      .find((v) => v.localService && v.lang.toLowerCase().startsWith(language));
    if (!voice) {
      setUnavailable(true);
      return;
    }
    const u = new SpeechSynthesisUtterance(
      language === "ms"
        ? p.voiceSampleMs
        : language === "zh"
          ? t.turnsMandarin[0]
          : p.voiceSample,
    );
    u.voice = voice;
    u.lang = voice.lang;
    u.rate =
      draft.agent.voice === "measured"
        ? 0.85
        : draft.agent.voice === "warm"
          ? 0.95
          : 1.05;
    utterance.current = u;
    setUnavailable(false);
    setPlaying(true);
    const stop = () => {
      if (utterance.current === u) {
        setPlaying(false);
        clearTimeout(timeout.current);
        utterance.current = null;
      }
    };
    u.onstart = () => clearTimeout(timeout.current);
    u.onend = stop;
    u.onerror = () => {
      if (utterance.current !== u) return;
      stop();
      setUnavailable(true);
    };
    timeout.current = setTimeout(() => {
      if (utterance.current === u) {
        utterance.current = null;
        synth.cancel();
        setPlaying(false);
        setUnavailable(true);
      }
    }, 5000);
    synth.speak(u);
  };
  return (
    <div className="voice-audition">
      <button type="button" className="button secondary-button" onClick={play}>
        {playing ? <Stop size={17} /> : <Play size={17} />}{" "}
        {playing ? p.stopVoice : p.previewVoice}
      </button>
      <p>{p.voiceNote}</p>
      {(unavailable || playing) && (
        <p className="inline-notice" role="status">
          {unavailable ? p.voiceUnavailable : p.voicePlaying}
        </p>
      )}
    </div>
  );
}
export function GuidedSetup() {
  const { t, href, locale } = useExperience(),
    p = t.product,
    { draft, update, storage } = useProduct();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [invalid, setInvalid] = useState(false),
    [fail, setFail] = useState(false),
    [showSteps, setShowSteps] = useState(false),
    [amount, setAmount] = useState(2500);
  const heading = useRef<HTMLHeadingElement>(null),
    previous = useRef<number | null>(null),
    request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (!draft) return;
    if (previous.current !== null && previous.current !== draft.step) {
      setError("");
      setNotice("");
      setInvalid(false);
      setFail(false);
      heading.current?.focus();
      setShowSteps(false);
    }
    previous.current = draft.step;
  }, [draft?.step]);
  const run = async (work: () => Promise<void>, message: string) => {
    if (busy) return;
    const id = ++request.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch {
      if (id === request.current) setError(message);
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  if (!draft)
    return (
      <AppShell active="setup">
        <main
          tabIndex={-1}
          className="workspace-main product-main"
          id="workspace-content"
        >
          <p role="status">{p.loading}</p>
        </main>
      </AppShell>
    );
  const d = draft,
    step = d.step;
  const edit = (fn: (v: SetupDraft) => SetupDraft) => {
    setInvalid(false);
    setError("");
    update(fn, true);
  };
  const navigate = (next: number) => update((v) => ({ ...v, step: next }));
  const visit = (n: number) =>
    n <= step ||
    (d.completedSteps.includes(n) &&
      Array.from({ length: n }, (_, i) => stepReady(d, i)).every(Boolean));
  const advance = () => {
    if (busy) return;
    if (!stepReady(d, step)) {
      setInvalid(true);
      setError(p.required[step]);
      return;
    }
    setError("");
    update((v) => ({
      ...v,
      completedSteps: [...new Set([...v.completedSteps, step])],
      step: Math.min(8, step + 1),
      completed: step === 8,
    }));
  };
  const op = async (success: (v: SetupDraft) => SetupDraft) => {
    const failed = fail;
    setFail(false);
    await productApi.simulate(failed);
    update(success, true);
  };
  const icons = [
      Scissors,
      Globe,
      Headphones,
      Phone,
      WhatsappLogo,
      CalendarBlank,
      Headphones,
      Phone,
      Wallet,
    ],
    StepIcon = icons[step];
  const balance = d.wallet_ledger.reduce((n, r) => n + r.amount_sen, 0);
  return (
    <AppShell active="setup">
      <main
        tabIndex={-1}
        className="workspace-main product-main setup-main"
        id="workspace-content"
      >
        <div className="product-page-heading">
          <div>
            <p className="eyebrow">{p.setup}</p>
            <h1>{p.setupTitle}</h1>
            <p>{p.setupIntro}</p>
          </div>
          <a className="save-leave" href={href("/app")}>
            <FloppyDisk size={18} />
            {p.saveLeave}
          </a>
        </div>
        <div className="setup-status-bar">
          <span>
            <span className="status-dot" />
            {d.completed
              ? p.progressComplete
              : template(p.stepOf, { step: String(step + 1) })}
          </span>
          <span>
            {storage === "saving"
              ? p.saving
              : storage === "saved"
                ? p.saved
                : p.storageWarning}
          </span>
        </div>
        <div className="setup-track" aria-hidden="true">
          {p.steps.map((_, i) => (
            <i
              className={
                stepReady(d, i) && d.completedSteps.includes(i)
                  ? "complete"
                  : i === step
                    ? "current"
                    : ""
              }
              key={i}
            />
          ))}
        </div>
        {d.completed ? (
          <section className="setup-complete">
            <span className="complete-seal">
              <Check size={40} />
            </span>
            <p className="eyebrow">{p.sampleOnly}</p>
            <h2>{p.completeTitle}</h2>
            <p>{p.completeBody}</p>
            <div className="completion-facts">
              <span>
                <Phone size={20} />
                {p.numberValue}
              </span>
              <span>
                <Wallet size={20} />
                {money(balance)}
              </span>
              <span>
                <ShieldCheck size={20} />
                {p.disclosureAlways}
              </span>
            </div>
            <div className="completion-actions">
              <a className="button button-dark" href={href("/app/test")}>
                {p.openTests}
                <ArrowUpRight size={18} />
              </a>
              <a className="button secondary-button" href={href("/app/calls")}>
                {p.openCalls}
              </a>
            </div>
            <button
              className="text-button"
              onClick={() =>
                update((v) => ({ ...v, completed: false, step: 0 }))
              }
            >
              {p.reviewSetup}
            </button>
          </section>
        ) : (
          <div className="setup-grid">
            <form
              className="setup-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                advance();
              }}
            >
              <header className="setup-step-heading">
                <span className="step-icon">
                  <StepIcon size={25} />
                </span>
                <span className="step-counter">
                  {String(step + 1).padStart(2, "0")} / 09
                </span>
                <h2 ref={heading} tabIndex={-1}>
                  {p.stepTitles[step]}
                </h2>
                <p>{p.stepDescriptions[step]}</p>
              </header>
              <div className="setup-step-body">
                <fieldset
                  className="busy-fields"
                  disabled={busy}
                  aria-label={p.steps[step]}
                >
                  {step === 0 && (
                    <>
                      <Field
                        label={p.businessType}
                        hint={t.builder.businessHint}
                      >
                        <select
                          value={d.organization.business_type}
                          onChange={(e) =>
                            edit((v) => ({
                              ...v,
                              organization: {
                                ...v.organization,
                                business_type: e.target.value as BusinessType,
                              },
                            }))
                          }
                        >
                          {businessTypes.map((type) => (
                            <option key={type} value={type}>
                              {p.types[type]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <p className="category-note">
                        {p.typeDescriptions[d.organization.business_type]}
                      </p>
                      <Field label={p.businessName}>
                        <input
                          maxLength={90}
                          value={d.organization.name}
                          aria-invalid={invalid && !d.organization.name.trim()}
                          onChange={(e) =>
                            edit((v) => ({
                              ...v,
                              organization: {
                                ...v.organization,
                                name: e.target.value,
                              },
                            }))
                          }
                        />
                      </Field>
                      <Field label={p.branchName}>
                        <input
                          maxLength={90}
                          value={d.location.name}
                          aria-invalid={invalid && !d.location.name.trim()}
                          onChange={(e) =>
                            edit((v) => ({
                              ...v,
                              location: { ...v.location, name: e.target.value },
                            }))
                          }
                        />
                      </Field>
                      <p className="form-caption">
                        <ShieldCheck size={16} />
                        {p.previewNote}
                      </p>
                    </>
                  )}
                  {step === 1 && (
                    <>
                      <div className="knowledge-import">
                        <Field label={p.source} hint={p.sourceHint}>
                          <input
                            type="url"
                            placeholder={p.sourcePlaceholder}
                            value={d.source_url}
                            maxLength={500}
                            onChange={(e) =>
                              update((v) => ({
                                ...v,
                                source_url: e.target.value,
                              }))
                            }
                          />
                        </Field>
                        <button
                          type="button"
                          className="button secondary-button"
                          disabled={busy}
                          onClick={() => {
                            try {
                              const url = new URL(d.source_url);
                              if (!["http:", "https:"].includes(url.protocol))
                                throw new Error();
                            } catch {
                              setError(p.sourceError);
                              return;
                            }
                            void run(async () => {
                              if (fail) {
                                setFail(false);
                                await productApi.simulate(true);
                              }
                              const result =
                                await productApi.importKnowledge(locale);
                              edit((v) => ({
                                ...v,
                                location: {
                                  ...v.location,
                                  hours: result.hours,
                                },
                                knowledge_items: v.knowledge_items.map((k) => ({
                                  ...k,
                                  content:
                                    k.kind === "faq"
                                      ? result.faq
                                      : result.services,
                                })),
                              }));
                              setNotice(p.imported);
                            }, p.importError);
                          }}
                        >
                          <Globe size={17} />
                          {busy ? p.importing : p.import}
                        </button>
                        <Recovery
                          label={p.importFail}
                          failed={fail}
                          onChange={setFail}
                          disabled={busy}
                        />
                      </div>
                      <p className="form-caption">{p.manual}</p>
                      <Field label={p.hours}>
                        <textarea
                          rows={2}
                          value={d.location.hours}
                          maxLength={500}
                          aria-invalid={invalid && !d.location.hours.trim()}
                          onChange={(e) =>
                            edit((v) => ({
                              ...v,
                              location: {
                                ...v.location,
                                hours: e.target.value,
                              },
                            }))
                          }
                        />
                      </Field>
                      {d.knowledge_items.map((item, i) => (
                        <Field
                          key={item.id}
                          label={item.kind === "services" ? p.services : p.faq}
                        >
                          <textarea
                            rows={3}
                            maxLength={1500}
                            aria-invalid={invalid && !item.content.trim()}
                            value={item.content}
                            onChange={(e) =>
                              edit((v) => ({
                                ...v,
                                knowledge_items: v.knowledge_items.map(
                                  (k, n) =>
                                    n === i
                                      ? { ...k, content: e.target.value }
                                      : k,
                                ),
                              }))
                            }
                          />
                        </Field>
                      ))}
                      <p className="form-caption">{p.reviewNote}</p>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <fieldset className="language-picker">
                        <legend>{p.languages}</legend>
                        {Object.entries(p.languageNames).map(([key, label]) => (
                          <label
                            key={key}
                            className={
                              d.agent.languages.includes(key) ? "selected" : ""
                            }
                          >
                            <input
                              type="checkbox"
                              checked={d.agent.languages.includes(key)}
                              onChange={(e) =>
                                edit((v) => ({
                                  ...v,
                                  agent: {
                                    ...v.agent,
                                    languages: e.target.checked
                                      ? [...v.agent.languages, key]
                                      : v.agent.languages.filter(
                                          (l) => l !== key,
                                        ),
                                  },
                                }))
                              }
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </fieldset>
                      <fieldset className="voice-picker">
                        <legend>{p.voice}</legend>
                        {Object.entries(p.voices).map(([key, label]) => (
                          <label
                            key={key}
                            className={d.agent.voice === key ? "selected" : ""}
                          >
                            <input
                              type="radio"
                              name="voice"
                              checked={d.agent.voice === key}
                              onChange={() =>
                                edit((v) => ({
                                  ...v,
                                  agent: {
                                    ...v.agent,
                                    voice: key as VoiceStyle,
                                  },
                                }))
                              }
                            />
                            <span>
                              <strong>{label}</strong>
                              <small>
                                {p.voiceDescriptions[key as VoiceStyle]}
                              </small>
                            </span>
                            <span className="voice-bars" aria-hidden="true">
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                            </span>
                          </label>
                        ))}
                      </fieldset>
                      <VoicePreview draft={d} />
                      <Field label={p.greeting} hint={p.greetingHint}>
                        <textarea
                          rows={2}
                          maxLength={500}
                          value={d.agent.greeting}
                          aria-invalid={invalid && !d.agent.greeting.trim()}
                          onChange={(e) =>
                            edit((v) => ({
                              ...v,
                              agent: { ...v.agent, greeting: e.target.value },
                            }))
                          }
                        />
                      </Field>
                      <div className="disclosure-settings">
                        <p>
                          <ShieldCheck size={18} />
                          {p.disclosureAlways}
                        </p>
                        <label className="product-check">
                          <input
                            type="checkbox"
                            checked={d.agent.recording_enabled}
                            onChange={(e) =>
                              edit((v) => ({
                                ...v,
                                agent: {
                                  ...v.agent,
                                  recording_enabled: e.target.checked,
                                },
                              }))
                            }
                          />
                          <span>{p.recording}</span>
                        </label>
                        <small>{p.recordingHint}</small>
                        {d.agent.recording_enabled && (
                          <Field label={p.recordingNotice}>
                            <textarea
                              rows={3}
                              maxLength={500}
                              value={d.agent.recording_disclosure}
                              aria-invalid={
                                invalid && !d.agent.recording_disclosure.trim()
                              }
                              onChange={(e) =>
                                edit((v) => ({
                                  ...v,
                                  agent: {
                                    ...v.agent,
                                    recording_disclosure: e.target.value,
                                  },
                                }))
                              }
                            />
                          </Field>
                        )}
                      </div>
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <div className="number-ticket">
                        <span className="ticket-icon">
                          <Phone size={25} />
                        </span>
                        <span>{p.numberLabel}</span>
                        <strong>{p.numberValue}</strong>
                        <small>{p.numberHint}</small>
                        <dl>
                          <div>
                            <dt>{p.assignedBranch}</dt>
                            <dd>{d.location.name}</dd>
                          </div>
                          <div>
                            <dt>{p.assignedAgent}</dt>
                            <dd>{d.organization.name}</dd>
                          </div>
                        </dl>
                      </div>
                      {d.phone_line.reserved ? (
                        <p className="product-success">
                          <CheckCircle size={20} />
                          {p.reserved}
                        </p>
                      ) : (
                        <button
                          className="button button-dark"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                op((v) => ({
                                  ...v,
                                  phone_line: {
                                    ...v.phone_line,
                                    reserved: true,
                                  },
                                })),
                              p.numberError,
                            )
                          }
                        >
                          {busy ? p.working : p.reserve}
                          <ArrowRight size={18} />
                        </button>
                      )}
                      <Recovery
                        label={p.numberFailure}
                        failed={fail}
                        onChange={setFail}
                        disabled={busy}
                      />
                    </>
                  )}
                  {(step === 4 || step === 5) && (
                    <>
                      <div
                        className="connection-illustration"
                        aria-hidden="true"
                      >
                        <span>
                          {step === 4 ? (
                            <WhatsappLogo size={32} />
                          ) : (
                            <CalendarBlank size={32} />
                          )}
                        </span>
                        <i />
                        <span className="connection-brand">
                          <span className="brand-symbol">
                            <i />
                            <i />
                            <i />
                          </span>
                        </span>
                      </div>
                      <h3 className="connection-title">
                        {step === 4 ? p.whatsappTitle : p.calendarTitle}
                      </h3>
                      <p className="connection-description">
                        {step === 4 ? p.whatsappBody : p.calendarBody}
                      </p>
                      {step === 5 && (
                        <Field label={p.calendarProvider}>
                          <select
                            disabled={busy}
                            value={d.calendar.provider}
                            onChange={(e) =>
                              edit((v) => ({
                                ...v,
                                calendar: {
                                  provider: e.target.value as "google" | "cal",
                                  status: "disconnected",
                                },
                              }))
                            }
                          >
                            {Object.entries(p.calendarNames).map(
                              ([key, label]) => (
                                <option value={key} key={key}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </Field>
                      )}
                      {(step === 4
                        ? d.whatsapp_channel.status
                        : d.calendar.status) === "connected" ? (
                        <div className="connection-result">
                          <p className="product-success">
                            <CheckCircle size={20} />
                            {p.connected}
                          </p>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              edit((v) =>
                                step === 4
                                  ? {
                                      ...v,
                                      whatsapp_channel: {
                                        ...v.whatsapp_channel,
                                        status: "disconnected",
                                      },
                                    }
                                  : {
                                      ...v,
                                      calendar: {
                                        ...v.calendar,
                                        status: "disconnected",
                                      },
                                    },
                              )
                            }
                          >
                            {p.disconnect}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="button button-dark"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                op((v) =>
                                  step === 4
                                    ? {
                                        ...v,
                                        whatsapp_channel: {
                                          ...v.whatsapp_channel,
                                          status: "connected",
                                        },
                                      }
                                    : {
                                        ...v,
                                        calendar: {
                                          ...v.calendar,
                                          status: "connected",
                                        },
                                      },
                                ),
                              p.operationError,
                            )
                          }
                        >
                          {busy
                            ? p.working
                            : step === 4
                              ? p.connectWhatsApp
                              : p.connectCalendar}
                          <ArrowUpRight size={18} />
                        </button>
                      )}
                      <p className="form-caption">
                        <ShieldCheck size={16} />
                        {p.connectionSafe}
                      </p>
                      {step === 5 && (
                        <p className="form-caption">{p.calendarSkip}</p>
                      )}
                      <Recovery
                        label={p.fail}
                        failed={fail}
                        onChange={setFail}
                        disabled={busy}
                      />
                    </>
                  )}
                  {step === 6 && (
                    <>
                      <CallTest
                        draft={d}
                        onStart={() =>
                          update((v) => ({
                            ...v,
                            test_passed: false,
                            completed: false,
                            phone_line: { ...v.phone_line, verified: false },
                          }))
                        }
                        onComplete={(passed) =>
                          update((v) => ({ ...v, test_passed: passed }))
                        }
                      />
                      <p className="form-caption">{p.setupChanged}</p>
                    </>
                  )}
                  {step === 7 && (
                    <>
                      <Field label={p.carrier}>
                        <select
                          value={d.phone_line.telco}
                          disabled={busy}
                          onChange={(e) =>
                            update((v) => ({
                              ...v,
                              phone_line: {
                                ...v.phone_line,
                                telco: e.target
                                  .value as SetupDraft["phone_line"]["telco"],
                                verified: false,
                              },
                              completed: false,
                            }))
                          }
                        >
                          {["Maxis", "CelcomDigi", "U Mobile", "Unifi"].map(
                            (name) => (
                              <option key={name}>{name}</option>
                            ),
                          )}
                        </select>
                      </Field>
                      <fieldset className="forwarding-picker">
                        <legend>{p.forwardingMode}</legend>
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
                              name="forwarding-mode"
                              disabled={busy}
                              checked={d.phone_line.forwarding_mode === mode}
                              onChange={() =>
                                update((v) => ({
                                  ...v,
                                  phone_line: {
                                    ...v.phone_line,
                                    forwarding_mode: mode,
                                    verified: false,
                                  },
                                  completed: false,
                                }))
                              }
                            />
                            <span>
                              <strong>{p.modes[mode]}</strong>
                              <small>{p.modeDescriptions[mode]}</small>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                      <div className="forwarding-guide">
                        <h3>{p.guide}</h3>
                        <p>
                          {template(p.guideWarning, {
                            telco: d.phone_line.telco,
                          })}
                        </p>
                        <div className="carrier-note">
                          <p>{p.carrierNotes[d.phone_line.telco]}</p>
                          <a
                            href={forwardingHelp[d.phone_line.telco]}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {p.providerHelp}
                            <ArrowUpRight size={15} />
                          </a>
                        </div>
                        <ol>
                          {p.guideSteps.map((text) => (
                            <li key={text}>{text}</li>
                          ))}
                        </ol>
                        <span className="forward-target">
                          <Phone size={18} />
                          {p.numberValue}
                          <small>{p.sampleOnly}</small>
                        </span>
                      </div>
                      {d.phone_line.verified ? (
                        <p className="product-success">
                          <CheckCircle size={20} />
                          {p.verified}
                        </p>
                      ) : (
                        <button
                          className="button button-dark"
                          type="button"
                          disabled={busy || !forwardingReady(d)}
                          onClick={() =>
                            void run(async () => {
                              const shouldFail = fail;
                              setFail(false);
                              update((v) => serviceApi.route(v, {}));
                              await productApi.simulate(shouldFail);
                              update((v) => ({
                                ...v,
                                phone_line: {
                                  ...v.phone_line,
                                  verified: forwardingReady(v),
                                },
                              }));
                            }, p.verifyError)
                          }
                        >
                          {busy ? p.verifying : p.verify}
                          <ArrowRight size={18} />
                        </button>
                      )}
                      <p className="form-caption">{p.modeChanged}</p>
                      <Recovery
                        label={p.verifyFail}
                        failed={fail}
                        onChange={setFail}
                        disabled={busy}
                      />
                    </>
                  )}
                  {step === 8 && (
                    <>
                      <div className="wallet-preview">
                        <span>{p.balance}</span>
                        <strong>{money(balance)}</strong>
                        <small>{p.sampleOnly}</small>
                      </div>
                      <h3>{p.trialTitle}</h3>
                      <p className="connection-description">{p.trialBody}</p>
                      {d.wallet_ledger.some((l) => l.reason === "trial") ? (
                        <p className="product-success">
                          <CheckCircle size={20} />
                          {p.trialAdded}
                        </p>
                      ) : (
                        <button
                          type="button"
                          className="button button-dark"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await productApi.simulate();
                              update((v) =>
                                v.wallet_ledger.some(
                                  (l) => l.reason === "trial",
                                )
                                  ? v
                                  : {
                                      ...v,
                                      wallet_ledger: [
                                        ...v.wallet_ledger,
                                        {
                                          id: "sample-trial",
                                          org_id: v.organization.id,
                                          amount_sen: 2000,
                                          reason: "trial",
                                          created_at: new Date().toISOString(),
                                        },
                                      ],
                                    },
                              );
                            }, p.operationError)
                          }
                        >
                          {busy ? p.working : p.addTrial}
                          <ArrowRight size={18} />
                        </button>
                      )}
                      <details className="sample-topup">
                        <summary>{p.topup}</summary>
                        <Field label={p.topupAmount}>
                          <select
                            value={amount}
                            onChange={(e) => setAmount(Number(e.target.value))}
                          >
                            {[2500, 5000, 10000].map((a) => (
                              <option value={a} key={a}>
                                {money(a)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <button
                          type="button"
                          className="button secondary-button"
                          disabled={
                            busy ||
                            d.services.payments.some(
                              (x) => x.status === "unknown",
                            )
                          }
                          onClick={() =>
                            void run(async () => {
                              await productApi.simulate();
                              update((v) => ({
                                ...v,
                                wallet_ledger: [
                                  ...v.wallet_ledger,
                                  {
                                    id: `sample-topup-${v.wallet_ledger.length}`,
                                    org_id: v.organization.id,
                                    amount_sen: amount,
                                    reason: "topup",
                                    created_at: new Date().toISOString(),
                                    method: "mock",
                                  },
                                ],
                              }));
                              setNotice(p.topupDone);
                            }, p.operationError)
                          }
                        >
                          {busy ? p.working : p.addTopup}
                        </button>

                        {d.services.payments.some(
                          (x) => x.status === "unknown",
                        ) && (
                          <p className="service-note">
                            <a href={href("/app/billing")}>
                              {t.services.paymentUnknown}
                            </a>
                          </p>
                        )}
                      </details>
                      <section className="wallet-ledger">
                        <h3>{p.ledger}</h3>
                        {d.wallet_ledger.length ? (
                          d.wallet_ledger.map((entry) => (
                            <div key={entry.id}>
                              <span>
                                {entry.reason === "trial"
                                  ? p.trialEntry
                                  : entry.reason === "usage"
                                    ? t.services.usageDebit
                                    : p.topupEntry}
                              </span>
                              <strong>
                                {entry.amount_sen >= 0 ? "+" : ""}
                                {money(entry.amount_sen)}
                              </strong>
                            </div>
                          ))
                        ) : (
                          <p>{p.noLedger}</p>
                        )}
                      </section>
                    </>
                  )}
                  {notice && (
                    <p className="product-success" role="status">
                      <CheckCircle size={18} />
                      {notice}
                    </p>
                  )}
                  {error && (
                    <p className="product-error" role="alert">
                      <WarningCircle size={18} />
                      {error}
                    </p>
                  )}
                </fieldset>
              </div>
              <footer className="setup-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={step === 0 || busy}
                  onClick={() => navigate(step - 1)}
                >
                  <ArrowLeft size={17} />
                  {p.back}
                </button>
                <div>
                  {(step === 4 || step === 5) && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        update(
                          (v) => ({
                            ...v,
                            ...(step === 4
                              ? {
                                  whatsapp_channel: {
                                    ...v.whatsapp_channel,
                                    status: "skipped" as const,
                                  },
                                }
                              : {
                                  calendar: {
                                    ...v.calendar,
                                    status: "skipped" as const,
                                  },
                                }),
                            step: step + 1,
                            completedSteps: [
                              ...new Set([...v.completedSteps, step]),
                            ],
                          }),
                          true,
                        );
                      }}
                    >
                      {p.skip}
                    </button>
                  )}
                  <button
                    type="submit"
                    className="button button-dark"
                    disabled={busy}
                  >
                    {step === 8 ? p.finish : p.continue}
                    <ArrowRight size={18} />
                  </button>
                </div>
              </footer>
            </form>
            <aside
              className={`setup-overview ${showSteps ? "steps-expanded" : ""}`}
            >
              <div className="setup-desk-image">
                <Image src="/images/front-desk.png" alt="" fill sizes="300px" />
              </div>
              <div className="setup-overview-title">
                <span>{p.yourDesk}</span>
                <strong>{d.organization.name || p.businessName}</strong>
                <p>{p.readyNote}</p>
              </div>
              <button
                type="button"
                className="progress-toggle"
                aria-expanded={showSteps}
                onClick={() => setShowSteps((v) => !v)}
              >
                {p.showProgress}
                <CaretDown size={18} />
              </button>
              <nav aria-label={p.stepNav}>
                <ol>
                  {p.steps.map((label, i) => {
                    const checked =
                      d.completedSteps.includes(i) && stepReady(d, i);
                    return (
                      <li key={label}>
                        <button
                          type="button"
                          aria-current={i === step ? "step" : undefined}
                          disabled={busy || !visit(i)}
                          onClick={() => navigate(i)}
                          className={
                            i === step ? "current" : checked ? "done" : ""
                          }
                        >
                          <span>
                            {checked ? (
                              <Check size={14} />
                            ) : (
                              String(i + 1).padStart(2, "0")
                            )}
                          </span>
                          <strong>{label}</strong>
                          {i === step && <span className="current-mark" />}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </nav>
              <p className="setup-overview-note">
                <ShieldCheck size={17} />
                {p.previewNote}
              </p>
            </aside>
          </div>
        )}
      </main>
    </AppShell>
  );
}
