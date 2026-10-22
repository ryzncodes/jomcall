"use client";
import { useEffect, useRef, useState } from "react";
import {
  Headphones,
  Phone,
  PhoneDisconnect,
  Microphone,
  MicrophoneSlash,
  ArrowCounterClockwise,
  CheckCircle,
  WarningCircle,
  Wrench,
  ChatCircleDots,
} from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useExperience } from "../experience";
import { Wave } from "../call-demo";
import { productApi, stepReady } from "@/lib/api/product";
import { duration } from "@/lib/api/client";
import type {
  CallScenario,
  CallFault,
  CallState,
  SetupDraft,
  TestTurn,
} from "@/lib/api/product-types";
export function Transcript({
  turns,
  empty,
  chat = false,
}: {
  turns: TestTurn[];
  empty: string;
  chat?: boolean;
}) {
  const { t } = useExperience(),
    p = t.product,
    container = useRef<HTMLDivElement>(null),
    reduced = useReducedMotion();
  useEffect(() => {
    if (turns.length)
      container.current?.scrollTo({
        top: container.current.scrollHeight,
        behavior: reduced ? "instant" : "smooth",
      });
  }, [turns.length, reduced]);
  return (
    <div
      className={`test-transcript ${chat ? "chat-transcript" : ""}`}
      role="log"
      aria-label={chat ? p.chatTitle : p.liveTranscript}
      aria-live="polite"
      aria-relevant="additions"
      ref={container}
      tabIndex={0}
    >
      {turns.length === 0 ? (
        <div className="transcript-empty">
          <ChatCircleDots size={30} />
          <p>{empty}</p>
        </div>
      ) : (
        turns.map((turn) => (
          <div className={`test-turn turn-${turn.role}`} key={turn.id}>
            {turn.role === "tool" ? (
              <>
                <Wrench size={15} />
                <p>{turn.text}</p>
              </>
            ) : (
              <>
                <div>
                  <strong>
                    {turn.role === "agent"
                      ? p.agentSpeaker
                      : chat
                        ? p.chatYou
                        : p.callerSpeaker}
                  </strong>
                  <time>{duration(turn.at_seconds)}</time>
                </div>
                <p>{turn.text}</p>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}
export function CallTest({
  draft,
  onStart,
  onComplete,
}: {
  draft: SetupDraft;
  onStart?: () => void;
  onComplete?: (complete: boolean, scenario: CallScenario) => void;
}) {
  const { t, locale } = useExperience(),
    p = t.product;
  const [state, setState] = useState<CallState>("idle"),
    [fault, setFault] = useState<CallFault>("none"),
    [scenario, setScenario] = useState<CallScenario>("booking"),
    [muted, setMuted] = useState(false),
    [plan, setPlan] = useState<TestTurn[]>([]),
    [count, setCount] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [complete, setComplete] = useState(false);
  const done = useRef(false),
    callback = useRef(onComplete);
  callback.current = onComplete;
  const active =
    state === "permission" || state === "connecting" || state === "live";
  const ready = [0, 1, 2].every((s) => stepReady(draft, s));
  const finish = (passed: boolean) => {
    if (done.current) return;
    done.current = true;
    setState("ended");
    setComplete(passed);
    callback.current?.(passed, scenario);
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (state === "permission")
      timer = setTimeout(
        () => setState(fault === "permission" ? "error" : "connecting"),
        550,
      );
    if (state === "connecting")
      timer = setTimeout(
        () =>
          setState(
            fault === "connection" || fault === "timeout" ? "error" : "live",
          ),
        fault === "timeout" ? 2300 : 850,
      );
    if (state === "live" && !muted)
      timer = setTimeout(
        () => {
          if (count < plan.length) setCount((c) => c + 1);
          else finish(true);
        },
        count === 0 ? 300 : 1400,
      );
    return () => clearTimeout(timer);
    // The plan and scenario are frozen for the active call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, fault, count, plan.length, muted]);
  useEffect(() => {
    if (state !== "live" || muted) return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [state, muted]);
  const start = (retry = false) => {
    onStart?.();
    if (retry) setFault("none");
    done.current = false;
    setPlan(productApi.testTurns(draft, locale, scenario));
    setCount(0);
    setElapsed(0);
    setComplete(false);
    setMuted(false);
    setState("permission");
  };
  const reset = () => {
    setState("idle");
    setCount(0);
    setElapsed(0);
    setComplete(false);
    setMuted(false);
  };
  const turns = plan.slice(0, count),
    toolCount = turns.filter((t) => t.role === "tool").length;
  return (
    <section
      id="test-call"
      className="call-test-panel"
      aria-label={p.browserCall}
    >
      <header className="test-panel-header">
        <span className="panel-icon">
          <Headphones size={21} />
        </span>
        <div>
          <h2>{p.browserCall}</h2>
          <p>{p.callNote}</p>
        </div>
        <span className="connection-dot" aria-hidden="true" />
      </header>
      <div className="call-config">
        <label className="product-field">
          <span>{p.scenario}</span>
          <select
            value={scenario}
            disabled={active}
            onChange={(e) => {
              reset();
              setScenario(e.target.value as CallScenario);
            }}
          >
            {Object.entries(p.scenarios).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={`call-stage state-${state}`}>
        <span className="call-state" role="status">
          {p.states[state]}
        </span>
        <div className="call-signal">
          <div className="call-signal-ring" />
          <Wave active={state === "live" && !muted} />
        </div>
        <strong className="call-clock">{duration(elapsed)}</strong>
        <div className="call-buttons">
          {active ? (
            <>
              <button
                type="button"
                className="button end-call"
                onClick={() => finish(false)}
              >
                <PhoneDisconnect size={19} />
                {p.endCall}
              </button>
              <button
                type="button"
                className="mute-call"
                disabled={state !== "live"}
                aria-label={muted ? p.unmute : p.mute}
                aria-pressed={muted}
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? (
                  <MicrophoneSlash size={20} />
                ) : (
                  <Microphone size={20} />
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button-lime"
              disabled={!ready}
              onClick={() => start(state === "error")}
            >
              <Phone size={18} />
              {state === "error"
                ? p.retryCall
                : state === "ended"
                  ? p.anotherCall
                  : p.startCall}
            </button>
          )}
          {!active && state === "ended" && (
            <button
              type="button"
              className="mute-call"
              onClick={reset}
              aria-label={p.clearCall}
            >
              <ArrowCounterClockwise size={19} />
            </button>
          )}
        </div>
        {muted && <small>{p.mutedHint}</small>}
        {!ready && (
          <p className="call-recovery">
            {p.required[2]} {p.configure}
          </p>
        )}
        {state === "error" && fault !== "none" && (
          <p className="call-recovery" role="alert">
            <WarningCircle size={18} />
            {p.callErrors[fault]}
          </p>
        )}
        {state === "ended" && (
          <p className="call-end-note">
            {complete ? <CheckCircle size={18} /> : <WarningCircle size={18} />}{" "}
            {complete ? p.callComplete : p.callEarly}
          </p>
        )}
      </div>
      <div className="transcript-heading">
        <h3>{p.liveTranscript}</h3>
        <span>
          {count}/{plan.length || 7}
        </span>
      </div>
      <Transcript turns={turns} empty={p.transcriptEmpty} />
      <div className="test-readings">
        <div>
          <span>{p.sampleLatency}</span>
          <strong>{count > 1 ? p.latency : "—"}</strong>
        </div>
        <div>
          <span>{p.toolsUsed}</span>
          <strong>{toolCount}</strong>
        </div>
        <div>
          <span>{p.elapsed}</span>
          <strong>{duration(elapsed)}</strong>
        </div>
      </div>
      <details className="recovery-controls">
        <summary>{p.recovery}</summary>
        <p>{p.recoveryNote}</p>
        <label className="product-field">
          <span>{p.callFault}</span>
          <select
            value={fault}
            disabled={active}
            onChange={(e) => {
              reset();
              setFault(e.target.value as CallFault);
            }}
          >
            {Object.entries(p.faults).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </details>
    </section>
  );
}
