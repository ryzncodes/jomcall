"use client";
import { useId } from "react";
import type { AgentSettings } from "../../../../packages/contracts/src/core";
import { Field } from "../field";
import { GreetingField } from "../agent-fields";
import { VoicePicker } from "../voice-picker";
import { useWords } from "../state";
import { useAgentPage } from "./store";

// Focus handlers for a text field. The edit is sent when the field loses
// focus; the store forgets the focus only after that send settles, so a
// conflict on it still keeps the text just typed.
export function useFieldEvents(field: keyof AgentSettings) {
  const { setFocused, blur } = useAgentPage();
  return { onFocus: () => setFocused(field), onBlur: () => blur(field) };
}

const LANGS = ["ms", "en", "zh"] as const;

// Name, greeting, AI introduction, recording, languages and voice. Every
// field saves by itself through the page's queue; there is no Save button.
export function Greeting() {
  const w = useWords(),
    p = useAgentPage(),
    s = p.settings,
    bad = (f: keyof AgentSettings) => p.invalid.includes(f);
  const recId = useId();
  const name = useFieldEvents("name"),
    greeting = useFieldEvents("greeting"),
    intro = useFieldEvents("aiDisclosure"),
    rec = useFieldEvents("recordingDisclosure");
  // A switch or a choice has no typing to wait for: it is sent at once.
  const choose = (partial: Partial<AgentSettings>) => {
    p.change(partial);
    p.flush();
  };
  const langLabel = {
    ms: w("Malay", "Bahasa Melayu"),
    en: w("English", "Inggeris"),
    zh: w("Mandarin", "Mandarin"),
  };
  return (
    <section className="agent-view" aria-labelledby="agent-greeting-h">
      <h2 id="agent-greeting-h">{w("Greeting and voice", "Salam dan suara")}</h2>
      <fieldset className="builder-fields agent-lock" disabled={p.locked}>
        <Field label={w("Agent name", "Nama ejen")}>
          <input
            maxLength={120}
            value={s.name}
            aria-invalid={bad("name") || undefined}
            onChange={(e) => p.change({ name: e.target.value })}
            {...name}
          />
        </Field>
        {bad("name") && (
          <p className="agent-field-error" role="alert">
            {w("Give your agent a name.", "Berikan nama kepada ejen anda.")}
          </p>
        )}
        <GreetingField
          value={s.greeting}
          onChange={(greeting) => p.change({ greeting })}
          {...greeting}
        />
        <Field
          label={w("AI introduction", "Pengenalan AI")}
          hint={w(
            "Required before publishing. Clearly identify this as an AI assistant.",
            "Wajib sebelum diterbitkan. Nyatakan dengan jelas bahawa ini pembantu AI.",
          )}
        >
          <textarea
            rows={2}
            maxLength={2000}
            value={s.aiDisclosure}
            onChange={(e) => p.change({ aiDisclosure: e.target.value })}
            {...intro}
          />
        </Field>
        <label className="product-check" htmlFor={recId}>
          <input
            id={recId}
            type="checkbox"
            checked={s.recordingEnabled}
            onChange={(e) => choose({ recordingEnabled: e.target.checked })}
          />
          <span>
            {w(
              "Record calls when calling is available",
              "Rakam panggilan apabila panggilan tersedia",
            )}
          </span>
        </label>
        {s.recordingEnabled && (
          <Field
            label={w("Recording disclosure", "Pendedahan rakaman")}
            hint={
              s.recordingDisclosure.trim()
                ? undefined
                : w(
                    "Required before publishing while recording is on.",
                    "Wajib sebelum diterbitkan selagi rakaman dihidupkan.",
                  )
            }
          >
            <textarea
              rows={2}
              maxLength={2000}
              value={s.recordingDisclosure}
              onChange={(e) => p.change({ recordingDisclosure: e.target.value })}
              {...rec}
            />
          </Field>
        )}
        <fieldset className="builder-languages">
          <legend>{w("Languages", "Bahasa")}</legend>
          {LANGS.map((lang) => (
            <label key={lang} className="product-check">
              <input
                type="checkbox"
                checked={s.languages.includes(lang)}
                onChange={(e) =>
                  choose({
                    languages: LANGS.filter((l) =>
                      l === lang ? e.target.checked : s.languages.includes(l),
                    ),
                  })
                }
              />
              {langLabel[lang]}
            </label>
          ))}
          <label className="product-check">
            <input
              type="checkbox"
              checked={s.manglish}
              onChange={(e) => choose({ manglish: e.target.checked })}
            />
            Manglish
          </label>
          {bad("languages") && (
            <p className="agent-field-error" role="alert">
              {w(
                "Pick at least one language.",
                "Pilih sekurang-kurangnya satu bahasa.",
              )}
            </p>
          )}
        </fieldset>
        <VoicePicker
          value={s.voicePreference}
          onChange={(voicePreference) => choose({ voicePreference })}
        />
      </fieldset>
    </section>
  );
}
