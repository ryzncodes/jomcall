"use client";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_VOICE,
  VOICE_DETAILS,
  VOICE_PRESETS,
  presetVoice,
  type VoicePreset,
} from "../../../packages/contracts/src/voices";
import samples from "@/lib/voice-samples.json";
import { useExperience } from "../experience";
import { useWords } from "./state";

// Sample files that exist, keyed "<voice>-<lang>". Written by
// `npm run voice:samples`; a voice without a file for the page's language
// shows no Play button.
const files = samples as Record<string, string>;

export function VoicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (voice: VoicePreset) => void;
}) {
  const w = useWords(),
    { locale } = useExperience();
  const saved = presetVoice(value);
  const selected = saved ?? DEFAULT_VOICE;
  const [playing, setPlaying] = useState<VoicePreset | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  // Stop on leaving the page or switching language (the sample would be the
  // other language's).
  useEffect(() => stop, [locale]);
  const play = (voice: VoicePreset, file: string) => {
    stop();
    const clip = new Audio("/voice-samples/" + file);
    audio.current = clip;
    clip.onended = () => {
      if (audio.current === clip) stop();
    };
    setPlaying(voice);
    clip.play().catch(() => {
      if (audio.current === clip) stop();
    });
  };
  return (
    <fieldset className="agent-voice">
      <legend>{w("Voice", "Suara")}</legend>
      <p className="agent-voice-hint">
        {VOICE_PRESETS.some((v) => files[v + "-" + locale])
          ? w(
              "The voice callers hear on voice calls. Play a short sample before you choose.",
              "Suara yang didengar pemanggil dalam panggilan suara. Main sampel pendek sebelum memilih.",
            )
          : w(
              "The voice callers hear on voice calls. Voice samples are not available yet.",
              "Suara yang didengar pemanggil dalam panggilan suara. Sampel suara belum tersedia.",
            )}
      </p>
      {!saved && (
        <p className="agent-voice-note" role="note">
          {w(
            `No voice chosen yet, so calls use the default voice, ${DEFAULT_VOICE}. Saving the draft stores the voice selected below.`,
            `Tiada suara dipilih lagi, jadi panggilan menggunakan suara lalai, ${DEFAULT_VOICE}. Menyimpan draf akan menyimpan suara yang dipilih di bawah.`,
          )}
        </p>
      )}
      <div className="agent-voice-options">
        {VOICE_PRESETS.map((voice) => {
          const file = files[voice + "-" + locale];
          const detail = VOICE_DETAILS[voice];
          return (
            <div
              key={voice}
              className="agent-voice-option"
              data-checked={voice === selected || undefined}
            >
              <label>
                <input
                  type="radio"
                  name="voicePreference"
                  value={voice}
                  checked={voice === selected}
                  onChange={() => onChange(voice)}
                />
                <span>
                  <strong>
                    {voice}
                    {voice === DEFAULT_VOICE && (
                      <em>{w("Default", "Lalai")}</em>
                    )}
                  </strong>
                  <small>{locale === "ms" ? detail.ms : detail.en}</small>
                </span>
              </label>
              {file && (
                <button
                  type="button"
                  className="agent-voice-play"
                  aria-pressed={playing === voice}
                  aria-label={
                    playing === voice
                      ? w(`Stop ${voice} sample`, `Henti sampel ${voice}`)
                      : w(`Play ${voice} sample`, `Main sampel ${voice}`)
                  }
                  onClick={() => (playing === voice ? stop() : play(voice, file))}
                >
                  {playing === voice ? w("Stop", "Henti") : w("Play", "Main")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
