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
  // Old free text saved before the picker existed (not a voice name).
  const earlier = !saved && typeof value === "string" ? value.trim() : "";
  const [playing, setPlaying] = useState<VoicePreset | null>(null);
  const [failed, setFailed] = useState<VoicePreset | null>(null);
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
    setFailed(null);
    const clip = new Audio("/voice-samples/" + file);
    audio.current = clip;
    clip.onended = () => {
      if (audio.current === clip) stop();
    };
    setPlaying(voice);
    const fail = () => {
      if (audio.current !== clip) return;
      stop();
      setFailed(voice);
    };
    clip.onerror = fail;
    clip.play().catch(fail);
  };
  return (
    <fieldset className="agent-voice">
      <legend>{w("Voice", "Suara")}</legend>
      <p className="agent-voice-hint">
        {VOICE_PRESETS.some((v) => files[v + "-" + locale])
          ? w(
              "The voice callers hear on voice calls. Play a short sample before you choose.",
              "Suara yang didengar pemanggil dalam panggilan suara. Dengar sampel pendek sebelum memilih.",
            )
          : w(
              "The voice callers hear on voice calls. Voice samples are not available yet.",
              "Suara yang didengar pemanggil dalam panggilan suara. Sampel suara belum tersedia.",
            )}
      </p>
      {!saved && (
        <p className="agent-voice-note" role="note">
          {earlier
            ? w(
                `Your earlier note "${earlier}" is not a voice name. Calls use ${DEFAULT_VOICE}. Saving replaces it with the voice selected below.`,
                `Catatan anda sebelum ini, "${earlier}", bukan nama suara. Panggilan menggunakan ${DEFAULT_VOICE}. Apabila anda simpan draf, catatan itu diganti dengan suara yang dipilih di bawah.`,
              )
            : w(
                `No voice chosen yet, so calls use the default voice, ${DEFAULT_VOICE}. Saving the draft stores the voice selected below.`,
                `Belum ada suara dipilih, jadi panggilan menggunakan suara lalai, ${DEFAULT_VOICE}. Apabila anda simpan draf, suara yang dipilih di bawah akan disimpan.`,
              )}
        </p>
      )}
      {failed && (
        <p className="agent-voice-note" role="alert">
          {w(
            `The ${failed} sample could not play. Check your connection and try again.`,
            `Sampel ${failed} tidak dapat dimainkan. Semak sambungan anda dan cuba lagi.`,
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
                  data-playing={playing === voice || undefined}
                  aria-label={
                    playing === voice
                      ? w(`Stop ${voice} sample`, `Henti sampel ${voice}`)
                      : w(`Play ${voice} sample`, `Dengar sampel ${voice}`)
                  }
                  onClick={() => (playing === voice ? stop() : play(voice, file))}
                >
                  {playing === voice ? w("Stop", "Henti") : w("Play", "Dengar")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
