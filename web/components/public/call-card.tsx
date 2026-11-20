"use client";
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import type { HomeCopy, SampleVoice } from "@/content/public/home";
import type { PublicLocale } from "@/lib/site";
import { nextInCycle } from "./call-cycle";

// The hero call card (spec 6.3, item 1) and the hero's "Hear a sample call"
// button. They sit in different columns, so they share one small store.
//
// The card shows BM, Manglish, 中文 and English for 2.6 s each, once, then
// rests on BM. The timing is the progress bar's CSS animation: when it ends
// the next language shows, and pausing the bar (the Pause button, keyboard
// focus on a language, or the card off screen) pauses the cycle with it. A
// tap on a language or on play stops the cycle for good (WCAG 2.2.2). With
// reduced motion, and in the server HTML, there is no bar and no cycle.
//
// Playback reads public/demo-call/<voice>-<line>.m4a for lines 1, 2, 4 and 5.
// Line 0, the greeting, also says the call may be recorded, so it is never
// played; line 3 is the booking check, shown for a moment and not spoken.
// Every clip plays on one reused audio element: the tap starts the first, and
// each next clip starts from the element's own `ended` event. The one wait,
// the booking check, loads the next clip at once and only delays its play();
// Safari keeps an element it has played from a tap unlocked for later play().

type Snap = { voice: number; auto: boolean; paused: boolean; playing: boolean; line: number | null };
const INITIAL: Snap = { voice: 0, auto: true, paused: false, playing: false, line: null };
let snap = INITIAL;
const subs = new Set<() => void>();
function set(patch: Partial<Snap>) {
  snap = { ...snap, ...patch };
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
const useSnap = () => useSyncExternalStore(subscribe, () => snap, () => INITIAL);

// Reduced motion, read live. The server (and hydration) says "still", so the
// cycle only ever starts in the browser.
const MOTION = "(prefers-reduced-motion: reduce)";
function subscribeMotion(f: () => void) {
  const mq = window.matchMedia(MOTION);
  mq.addEventListener("change", f);
  return () => mq.removeEventListener("change", f);
}
const useStill = () =>
  useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION).matches, () => true);

const SEQUENCE = [1, 2, 3, 4, 5] as const;
const CHECK_MS = 900;
const FALLBACK_MS = 1800;
let audio: HTMLAudioElement | null = null;
let run = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function stopSample() {
  run += 1;
  clearTimeout(timer);
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
  }
  if (snap.playing || snap.line !== null) set({ playing: false, line: null });
}

// Starts inside the tap, so the first clip may play on phones.
function playSample(voice: string) {
  stopSample();
  const me = ++run;
  const el = (audio ??= new Audio());
  el.preload = "auto";
  set({ playing: true, auto: false });
  const later = (i: number, ms: number) => {
    if (me === run) timer = setTimeout(() => step(i), ms);
  };
  const clip = (n: number) => `/demo-call/${voice}-${n}.m4a`;
  // `loaded`: the clip is already the element's source (after the check).
  const step = (i: number, loaded = false) => {
    if (me !== run) return;
    if (i >= SEQUENCE.length) {
      set({ playing: false, line: null });
      return;
    }
    const n = SEQUENCE[i];
    set({ line: n });
    if (n === 3) {
      el.onended = null;
      el.onerror = null;
      el.src = clip(SEQUENCE[i + 1]);
      el.load();
      if (me === run) timer = setTimeout(() => step(i + 1, true), CHECK_MS);
      return;
    }
    // Each line moves on once, whichever of ended, error or a refused play()
    // comes first.
    let moved = false;
    const next = (wait: boolean) => {
      if (moved) return;
      moved = true;
      if (wait) later(i + 1, FALLBACK_MS);
      else step(i + 1);
    };
    el.onended = () => next(false);
    // A missing or blocked clip: the transcript still moves on, silently.
    el.onerror = () => next(true);
    if (!loaded) el.src = clip(n);
    el.play().catch(() => next(true));
  };
  step(0);
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="3.5" width="2.75" height="9" rx="1" fill="currentColor" />
      <rect x="9.25" y="3.5" width="2.75" height="9" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {playing ? (
        <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
      ) : (
        <path d="M5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L5.9 3.1a.6.6 0 0 0-.9.5Z" fill="currentColor" />
      )}
    </svg>
  );
}

// The hero's secondary action. Its label says what a tap will do.
export function HearSample({
  voices,
  hear,
  stop,
}: {
  voices: string[];
  hear: string;
  stop: string;
}) {
  const { playing, voice } = useSnap();
  return (
    <button
      type="button"
      className="btn btn-secondary hear-btn"
      onClick={() => (playing ? stopSample() : playSample(voices[voice]))}
    >
      <PlayIcon playing={playing} />
      <span className="cta-label">
        <span>{playing ? stop : hear}</span>
        <span className="cta-reserve" aria-hidden="true">
          {playing ? hear : stop}
        </span>
      </span>
    </button>
  );
}

export function CallCard({
  locale,
  lines,
  labels,
}: {
  locale: PublicLocale;
  lines: SampleVoice[];
  labels: HomeCopy["card"];
}) {
  const { voice, auto, paused, playing, line } = useSnap();
  const still = useStill();
  const card = useRef<HTMLElement>(null);

  // Off screen, the bar (and so the cycle) waits.
  useEffect(() => {
    const el = card.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => {
      el.dataset.away = entry.isIntersecting ? "false" : "true";
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => () => stopSample(), []);

  const cycling = auto && !playing && !still;
  const now = (n: number) => (playing ? (line === n ? "now" : "dim") : undefined);
  const turn = (v: SampleVoice, n: 1 | 2 | 4 | 5, i: number) => {
    const caller = n === 1 || n === 4;
    return (
      <li
        className={`cc-turn ${caller ? "cc-caller" : "cc-agent"}`}
        data-state={now(n)}
        style={{ "--i": i } as CSSProperties}
      >
        <span className="cc-who" lang={locale}>
          {caller ? labels.caller : labels.agent}
        </span>
        <p>{v.lines[n]}</p>
      </li>
    );
  };
  const event = (text: string, n: number | null, i: number, extra = "") => (
    <li
      className={`cc-event${extra}`}
      lang={locale}
      data-state={n === null ? (playing ? "dim" : undefined) : now(n)}
      style={{ "--i": i } as CSSProperties}
    >
      <span className="cc-tick" aria-hidden="true" />
      {text}
    </li>
  );

  return (
    <figure
      ref={card}
      className="call-card"
      data-paused={paused}
      aria-label={`${labels.business}. ${labels.label}`}
    >
      <div className="cc-top">
        <span className="cc-business t-data">{labels.business}</span>
        <span className="cc-label">{labels.label}</span>
        <button
          type="button"
          className="cc-stop"
          hidden={!playing}
          onClick={stopSample}
        >
          <PlayIcon playing />
          {labels.stop}
        </button>
      </div>
      <div className="cc-stack">
        {lines.map((v, i) => (
          <ol
            key={v.id}
            className="cc-lines"
            lang={v.lang}
            data-active={i === voice}
            aria-hidden={i === voice ? undefined : true}
          >
            {event(labels.greeting, null, 0)}
            {turn(v, 1, 1)}
            {turn(v, 2, 2)}
            {event(labels.check, 3, 3)}
            {turn(v, 4, 4)}
            {turn(v, 5, 5)}
            {event(labels.booked, null, 6, " cc-booked")}
          </ol>
        ))}
      </div>
      <div className="cc-foot">
        <div className="cc-chips" role="group" aria-label={labels.languages}>
          {lines.map((v, i) => (
            <button
              key={v.id}
              type="button"
              className="cc-chip"
              lang={v.lang}
              aria-pressed={i === voice}
              onClick={() => {
                if (i !== voice && playing) stopSample();
                set({ voice: i, auto: false });
              }}
            >
              {v.chip}
            </button>
          ))}
        </div>
        <div className="cc-progress">
          <span className="cc-track" aria-hidden="true">
            {cycling && (
              <i key={voice} onAnimationEnd={() => set(nextInCycle(snap.voice, lines.length))} />
            )}
          </span>
          <button
            type="button"
            className="cc-cycle"
            hidden={!cycling}
            onClick={() => set({ paused: !snap.paused })}
          >
            {paused ? <PlayIcon playing={false} /> : <PauseIcon />}
            <span className="cta-label">
              <span>{paused ? labels.resume : labels.pause}</span>
              <span className="cta-reserve" aria-hidden="true">
                {paused ? labels.pause : labels.resume}
              </span>
            </span>
          </button>
        </div>
      </div>
      <p className="sr-only" role="status">
        {playing ? `${labels.playing}: ${lines[voice].chip}` : ""}
      </p>
    </figure>
  );
}
