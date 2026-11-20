"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Play,
  Pause,
  ArrowCounterClockwise,
  Check,
  Phone,
  CalendarBlank,
} from "@phosphor-icons/react";
import { useExperience } from "./experience";
import demoClips from "@/lib/demo-call.json";

// Recorded lines of the sample call (npm run voice:demo). A clip plays only
// while the text it was made from still equals the caption; otherwise that
// line falls back to the silent timer.
type Clip = { file: string; text: string };
const clips = demoClips as Record<string, Record<string, Clip>>;
export function Wave({
  active = false,
  compact = false,
}: {
  active?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`voice-wave ${active ? "is-speaking" : ""} ${compact ? "compact" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: compact ? 22 : 65 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${Math.round(14 + Math.abs(Math.sin(i * 0.51) * Math.cos(i * 0.17)) * 86)}%`,
            animationDelay: `${(i * -0.045).toFixed(3)}s`,
          }}
        />
      ))}
    </div>
  );
}
export function CallDemo() {
  const { t, locale } = useExperience();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [language, setLanguage] = useState(0);
  const transcript = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const loaded = useRef<string | null>(null);
  const turns =
    language === 1
      ? t.turnsEnglish
      : language === 2
        ? t.turnsMandarin
        : [t.turn0, t.turn1, t.turn2, t.turn3, t.turn4, t.turn5];
  const clipSet =
    language === 1
      ? "en"
      : language === 2
        ? "zh"
        : locale === "ms"
          ? "ms"
          : "manglish";
  const clipFor = (line: number) => {
    const clip = clips[clipSet]?.[String(line)];
    return clip && clip.text === turns[line] ? `/demo-call/${clip.file}` : null;
  };
  // Line 3 is the calendar check: shown, not spoken.
  const src = step >= 0 && step !== 3 ? clipFor(step) : null;
  const player = () => (audio.current ??= new Audio());
  useEffect(() => {
    if (!running) return;
    const advance = () => {
      if (step >= 5) setRunning(false);
      else setStep((n) => n + 1);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!src) {
      timer = setTimeout(advance, step === -1 ? 250 : step === 3 ? 1100 : 2500);
      return () => clearTimeout(timer);
    }
    const el = player();
    const ended = () => {
      timer = setTimeout(advance, 350);
    };
    const failed = () => {
      clearTimeout(timer);
      timer = setTimeout(advance, 2500);
    };
    el.addEventListener("ended", ended);
    el.addEventListener("error", failed);
    if (loaded.current !== src) {
      el.src = src;
      loaded.current = src;
    }
    el.play().catch(failed);
    return () => {
      el.removeEventListener("ended", ended);
      el.removeEventListener("error", failed);
      clearTimeout(timer);
      el.pause();
    };
  }, [step, running, src]);
  useEffect(() => {
    if (step >= 0 && transcript.current)
      transcript.current.scrollTo({
        top: transcript.current.scrollHeight,
        behavior: reduced ? "instant" : "smooth",
      });
  }, [step, reduced]);
  const reset = () => {
    audio.current?.pause();
    loaded.current = null;
    setStep(-1);
    setRunning(false);
  };
  const toggle = () => {
    if (step === -1 || step === 5) {
      // Start the first clip inside the tap, so mobile browsers allow sound.
      const first = clipFor(0);
      if (first) {
        const el = player();
        el.src = first;
        loaded.current = first;
        el.play().catch(() => undefined);
      }
      setStep(0);
      setRunning(true);
    } else setRunning((v) => !v);
  };
  return (
    <div className="call-demo">
      <div className="demo-toolbar">
        <span>
          <span className="status-dot" />
          {t.sample}
        </span>
        <label className="demo-language">
          <span className="sr-only">{t.demoLanguage}</span>
          <select
            aria-label={t.demoLanguage}
            value={language}
            onChange={(e) => {
              setLanguage(Number(e.target.value));
              reset();
            }}
          >
            {t.demoLanguages.map((l, i) => (
              <option value={i} key={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="demo-body">
        <div
          className="demo-transcript"
          ref={transcript}
          aria-label={t.fullTranscript}
        >
          <div className="disclosure-turn">
            <span className="tiny-icon">
              <Phone size={15} />
            </span>
            <div>
              <small>{t.disclosure}</small>
              <p>{turns[0]}</p>
            </div>
          </div>
          {step < 1 ? (
            <div className="transcript-preview">
              <span>{t.caller}</span>
              <p>{turns[1]}</p>
              <small>{t.sampleVoiceNotice}</small>
            </div>
          ) : (
            turns.slice(1, step + 1).map((turn, i) => (
              <motion.div
                key={`${language}-${i}`}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className={`transcript-turn ${i === 2 ? "tool-turn" : i === 0 || i === 3 ? "caller-turn" : "agent-turn"}`}
              >
                <small>
                  {i === 2 ? (
                    <>
                      <Check size={14} />
                      {t.toolCheck}
                    </>
                  ) : i === 0 || i === 3 ? (
                    t.caller
                  ) : (
                    t.agent
                  )}
                </small>
                <p
                  lang={
                    language === 2 ? "zh" : language === 1 ? "en" : undefined
                  }
                >
                  {turn}
                </p>
              </motion.div>
            ))
          )}
        </div>
        <div className="demo-instrument">
          <div className="instrument-caption">
            <span>{t.sampleBusiness}</span>
            <span className="mono">
              {step < 0
                ? "00:00"
                : `00:${String((step + 1) * 3).padStart(2, "0")}`}
            </span>
          </div>
          <div className="signal-orbit">
            <div className="orbit-ring r1" />
            <div className="orbit-ring r2" />
            <div className="orbit-ring r3" />
            <div className="signal-core">
              <Wave active={running} />
            </div>
          </div>
          <p className="signal-state" role="status">
            {step === 5
              ? t.complete
              : running
                ? t.speaking
                : step >= 0
                  ? t.paused
                  : t.waiting}
          </p>
          <div
            className={`appointment-ticket ${step === 5 ? "confirmed" : ""}`}
          >
            <CalendarBlank size={25} />
            <div>
              <small>{t.appointment}</small>
              <strong>{t.tomorrow} · 15:00</strong>
              <span>{t.service}</span>
            </div>
            <Check size={22} />
          </div>
        </div>
      </div>
      <div className="demo-actions">
        <div className="demo-action-buttons">
          <button className="button button-lime" onClick={toggle}>
            {running && step < 5 ? (
              <Pause size={17} weight="fill" />
            ) : (
              <Play size={17} weight="fill" />
            )}
            {step === 5
              ? t.replay
              : running
                ? t.pause
                : step >= 0
                  ? t.resume
                  : t.play}
          </button>
          <button className="reset-button" onClick={reset} aria-label={t.reset}>
            <ArrowCounterClockwise size={20} />
          </button>
        </div>
        <small>{step === 5 ? t.demoEnd : t.sampleVoiceNotice}</small>
      </div>
    </div>
  );
}
