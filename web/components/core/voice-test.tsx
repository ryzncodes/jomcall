"use client";
import { HOSTED } from "@/lib/hosted";
import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Microphone, Stop } from "@phosphor-icons/react";
import { CoreError, isResourceUnavailable } from "@/lib/core/client";
import type { SessionDetail } from "../../../packages/contracts/src/agent-test";
import { useCore, useWords, Notice } from "./state";

// Loaded lazily and only in local mode (see agent-test.tsx), so the mock
// preview never bundles livekit-client or asks for a microphone.
type Phase = "idle" | "starting" | "connecting" | "live";
type Heard = "listening" | "thinking" | "speaking";
type Problem = "mic" | "dropped" | "expired" | "disabled";
const CALL_SECONDS = 300;
const THINKING_GIVE_UP_MS = 20000;
const clock = (s: number) =>
  Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

export default function VoiceTest({
  detail,
  voice,
  onChanged,
  onUnavailable,
  onLive,
}: {
  detail: SessionDetail;
  voice: { configured: boolean; reason: string | null } | undefined;
  onChanged: () => void;
  onUnavailable: (error: unknown) => void;
  onLive: (live: boolean) => void;
}) {
  const { client } = useCore(),
    w = useWords();
  const [phase, setPhase] = useState<Phase>("idle"),
    [heard, setHeard] = useState<Heard>("listening"),
    [remaining, setRemaining] = useState(CALL_SECONDS),
    [problem, setProblem] = useState<Problem>(),
    [error, setError] = useState<unknown>(),
    [announce, setAnnounce] = useState("");
  // The room token is a short-lived secret: it lives in this closure and these
  // refs only. It is never put in storage, the URL or a log.
  const room = useRef<Room | null>(null),
    audio = useRef<HTMLDivElement>(null),
    starting = useRef(false),
    startBtn = useRef<HTMLButtonElement>(null),
    stopBtn = useRef<HTMLButtonElement>(null),
    focusNext = useRef<"start" | "stop" | null>(null),
    generation = useRef(0),
    timers = useRef<{ tick?: number; poll?: number; think?: number }>({}),
    callerSpoke = useRef(false);
  const closed =
    detail.state === "closed" || Date.parse(detail.expires_at) <= Date.now();

  // Everything an attempt may have acquired (local mic tracks, the room) is
  // released here; safe to call repeatedly and on a half-connected room.
  const release = useCallback((r: Room) => {
    r.removeAllListeners();
    try {
      for (const p of r.localParticipant.getTrackPublications())
        p.track?.stop();
    } catch {
      // already disconnected
    }
    void r.disconnect(true).catch(() => undefined);
  }, []);
  // True when this attempt was stopped while an await was pending. Whatever
  // the attempt acquired is released by the callback, so nothing is left open.
  const gone = (mine: number, undo?: () => void) => {
    if (generation.current === mine) return false;
    undo?.();
    return true;
  };

  const teardown = useCallback(() => {
    generation.current++;
    starting.current = false;
    window.clearInterval(timers.current.tick);
    window.clearInterval(timers.current.poll);
    window.clearTimeout(timers.current.think);
    const r = room.current;
    room.current = null;
    callerSpoke.current = false;
    // Handlers are removed first so a deliberate stop is not reported as a drop.
    if (r) release(r);
    audio.current?.replaceChildren();
  }, [release]);

  const finish = useCallback(
    (why?: Problem, message?: string) => {
      teardown();
      setPhase("idle");
      setHeard("listening");
      setRemaining(CALL_SECONDS);
      setAnnounce(message ?? "");
      if (why) setProblem(why);
      onChanged();
    },
    [teardown, onChanged],
  );

  // Stop on unmount (route change, session switch, resource cleared) and when
  // the tab is being closed.
  useEffect(() => {
    window.addEventListener("pagehide", teardown);
    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
    };
  }, [teardown]);
  useEffect(() => {
    onLive(phase !== "idle");
    return () => onLive(false);
  }, [phase, onLive]);

  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    (next === "stop" ? stopBtn : startBtn).current?.focus();
  }, [phase]);

  async function start() {
    if (starting.current || phase !== "idle" || closed) return;
    starting.current = true;
    setPhase("starting");
    setProblem(undefined);
    setError(undefined);
    const mine = ++generation.current;
    let r: Room | undefined;
    try {
      // Ask for the microphone only now, after the button press, and before
      // any server session exists: a refusal must not leave a call open.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        // The probe only proves permission; release it straight away.
        for (const t of probe.getTracks()) t.stop();
      } catch {
        if (!gone(mine)) finish("mic");
        return;
      }
      if (gone(mine)) return;
      let grant;
      try {
        grant = await client.execute(
          "startVoiceTest",
          { id: detail.id, expectedSessionRevision: detail.revision },
          crypto.randomUUID(),
        );
      } catch (e) {
        if (gone(mine)) return;
        setPhase("idle");
        if (e instanceof CoreError && e.code === "VOICE_DISABLED")
          setProblem("disabled");
        else setError(e);
        if (isResourceUnavailable(e)) onUnavailable(e);
        else onChanged();
        return;
      }
      if (gone(mine)) return;
      setPhase("connecting");
      r = new Room({ adaptiveStream: false, dynacast: false });
      room.current = r;
      r.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.autoplay = true;
        audio.current?.appendChild(el);
      });
      r.on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) el.remove();
      });
      // Derived state, best effort: the agent speaking is its remote audio
      // being an active speaker. "Thinking" is the gap after the caller was
      // last heard speaking and before the agent's audio starts; it is not a
      // server signal, and falls back to listening after 20 s.
      r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const agent = speakers.some((p) => !p.isLocal),
          caller = speakers.some((p) => p.isLocal);
        window.clearTimeout(timers.current.think);
        if (agent) {
          callerSpoke.current = false;
          setHeard("speaking");
        } else if (caller) {
          callerSpoke.current = true;
          setHeard("listening");
        } else if (callerSpoke.current) {
          setHeard("thinking");
          timers.current.think = window.setTimeout(() => {
            callerSpoke.current = false;
            setHeard("listening");
          }, THINKING_GIVE_UP_MS);
        } else setHeard("listening");
      });
      r.on(RoomEvent.Disconnected, () => finish("dropped"));
      const mineRoom = r;
      await mineRoom.connect(grant.url, grant.token);
      if (gone(mine, () => release(mineRoom))) return;
      await mineRoom.localParticipant.setMicrophoneEnabled(true);
      // A track created while Stop ran is not in teardown's snapshot.
      if (gone(mine, () => release(mineRoom))) return;
      void mineRoom.startAudio().catch(() => undefined);
      const ends = Math.min(
        Date.parse(grant.expiresAt),
        Date.now() + CALL_SECONDS * 1000,
      );
      const left = () => Math.max(0, Math.round((ends - Date.now()) / 1000));
      setRemaining(left());
      setPhase("live");
      setHeard("listening");
      setAnnounce(
        w(
          "Voice test started. Speak to your agent.",
          "Ujian suara bermula. Bercakap dengan ejen anda.",
        ),
      );
      timers.current.tick = window.setInterval(() => {
        const n = left();
        setRemaining(n);
        if (n === 60) setAnnounce(w("One minute left.", "Tinggal satu minit."));
        if (n <= 0) {
          finish(
            "expired",
            w(
              "Time is up. Voice test ended.",
              "Masa tamat. Ujian suara tamat.",
            ),
          );
        }
      }, 1000);
      // Spoken turns are saved by the voice worker; pull them in while live.
      timers.current.poll = window.setInterval(onChanged, 4000);
    } catch (e) {
      const orphan = r;
      if (gone(mine, () => orphan && release(orphan))) return;
      const denied =
        e instanceof DOMException &&
        ["NotAllowedError", "NotFoundError", "SecurityError"].includes(e.name);
      teardown();
      setPhase("idle");
      if (denied) setProblem("mic");
      else setProblem("dropped");
      onChanged();
    } finally {
      // A newer attempt owns the flag once this one was stopped.
      if (generation.current === mine) starting.current = false;
    }
  }

  const busy = phase !== "idle";
  const reason = !voice
    ? w("Checking voice readiness…", "Menyemak kesediaan suara…")
    : !voice.configured
      ? w(
          HOSTED
            ? "Voice testing is not set up yet."
            : "Voice testing is not set up on this computer.",
          HOSTED
            ? "Ujian suara belum disediakan."
            : "Ujian suara belum disediakan pada komputer ini.",
        ) + (voice.reason ? " (" + voice.reason + ")" : "")
      : closed
        ? w(
            "This test session is closed or expired. Start a new test.",
            "Sesi ujian ini ditutup atau tamat. Mulakan ujian baharu.",
          )
        : "";
  const stateLabel =
    phase === "starting" || phase === "connecting"
      ? w("Connecting…", "Menyambung…")
      : heard === "speaking"
        ? w("Speaking", "Bercakap")
        : heard === "thinking"
          ? w("Thinking", "Berfikir")
          : w("Listening", "Mendengar");
  return (
    <section className="core-voice" aria-label={w("Voice test", "Ujian suara")}>
      <div className="core-voice-head">
        <p className="eyebrow">{w("Voice test", "Ujian suara")}</p>
        {phase === "live" && (
          <span
            className="core-voice-clock mono"
            role="timer"
            aria-live="off"
            aria-label={w("Time left", "Masa berbaki")}
          >
            {clock(remaining)}
          </span>
        )}
      </div>
      {!busy && (
        <p className="core-voice-warning">
          {w(
            "Your microphone audio is sent to Deepgram, and the conversation to Anthropic and Google, outside Malaysia. Do not say real customer details.",
            "Audio mikrofon anda dihantar kepada Deepgram, dan perbualan kepada Anthropic dan Google, di luar Malaysia. Jangan sebut butiran pelanggan sebenar.",
          )}
        </p>
      )}
      {busy && (
        <p className="core-voice-state" role="status">
          <span
            className={"core-voice-dot " + (phase === "live" ? heard : "")}
          />
          {stateLabel}
        </p>
      )}
      <div className="core-actions">
        {busy ? (
          <button
            type="button"
            className="button secondary-button"
            ref={stopBtn}
            onClick={() => {
              focusNext.current = "start";
              finish(undefined, w("Voice test ended.", "Ujian suara tamat."));
            }}
          >
            <Stop size={16} />
            {w("Stop voice test", "Henti ujian suara")}
          </button>
        ) : (
          <button
            type="button"
            className="button button-dark"
            disabled={!!reason}
            aria-describedby={reason ? "voice-reason" : undefined}
            ref={startBtn}
            onClick={() => {
              focusNext.current = "stop";
              void start();
            }}
          >
            <Microphone size={16} />
            {w("Start voice test", "Mulakan ujian suara")}
          </button>
        )}
      </div>
      {reason && (
        <small id="voice-reason" className="core-voice-note">
          {reason}
        </small>
      )}
      {problem === "mic" && (
        <p className="storage-warning" role="alert">
          {w(
            "The microphone is blocked or missing, so no call was started. Allow microphone access for this site in your browser settings, then try again.",
            "Mikrofon disekat atau tiada, jadi tiada panggilan dimulakan. Benarkan akses mikrofon untuk laman ini dalam tetapan pelayar, kemudian cuba lagi.",
          )}
        </p>
      )}
      {problem === "dropped" && (
        <p className="storage-warning" role="alert">
          {w(
            "The call dropped. The saved turns below are up to date. Start again when ready.",
            "Panggilan terputus. Giliran tersimpan di bawah sudah dikemas kini. Mulakan semula apabila bersedia.",
          )}
        </p>
      )}
      {problem === "expired" && (
        <p className="core-voice-note" role="status">
          {w(
            "The five-minute voice test ended. You can start another.",
            "Ujian suara lima minit telah tamat. Anda boleh memulakan yang lain.",
          )}
        </p>
      )}
      {problem === "disabled" && (
        <p className="storage-warning" role="alert">
          {w(
            HOSTED
              ? "Voice testing is turned off."
              : "Voice testing is turned off on this computer.",
            HOSTED
              ? "Ujian suara dimatikan."
              : "Ujian suara dimatikan pada komputer ini.",
          )}
        </p>
      )}
      <Notice error={error} context="voice" />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
      <div ref={audio} hidden />
    </section>
  );
}
