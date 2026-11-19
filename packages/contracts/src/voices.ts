// The only spoken voices a business may pick (Google Gemini text-to-speech
// voice names). These five passed the owner's listening test; the first is
// the default. Anything else falls back to it.
//
// Imported by the web app's voice picker, the browser voice test and the
// phone line. The Python voice worker keeps its own copy (PRESETS in
// voice/jomcall_voice/worker.py); tests/local/voice-picker.test.mjs keeps the
// two equal. No server-only imports here: this file ships to the browser.
export const VOICE_PRESETS = [
  "Kore",
  "Sulafat",
  "Leda",
  "Achird",
  "Charon",
] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];
export const DEFAULT_VOICE: VoicePreset = VOICE_PRESETS[0];

// Google's own one-word description of each voice (Gemini API speech
// generation, "Voice options") and the gender Google lists for it (Cloud
// Text-to-Speech, Gemini-TTS "Voice options"). Checked 2026-11-15.
export const VOICE_DETAILS: Record<VoicePreset, { en: string; ms: string }> = {
  Kore: { en: "Firm, female", ms: "Tegas, perempuan" },
  Sulafat: { en: "Warm, female", ms: "Mesra, perempuan" },
  Leda: { en: "Youthful, female", ms: "Muda, perempuan" },
  Achird: { en: "Friendly, male", ms: "Ramah, lelaki" },
  Charon: { en: "Informative, male", ms: "Informatif, lelaki" },
};

// The saved preference when it names a preset exactly, else null (old free
// text, empty, or a removed voice).
export function presetVoice(preference: unknown): VoicePreset | null {
  return VOICE_PRESETS.find((p) => p === preference) ?? null;
}

// The voice a call actually uses for this saved preference.
export function voiceFor(preference: unknown): VoicePreset {
  return presetVoice(preference) ?? DEFAULT_VOICE;
}

// Pre-recorded sample languages, matching the web app's two page languages.
export const VOICE_SAMPLE_LANGUAGES = ["en", "ms"] as const;
export type VoiceSampleLanguage = (typeof VOICE_SAMPLE_LANGUAGES)[number];
