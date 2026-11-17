"use client";
import { useWords, errorText } from "../state";
import { useExperience } from "../../experience";
import { useAgentPage } from "./store";
import { saveLineOf } from "./rules";

// The line under the page title on every view. A polite live region, so a
// change from "Saving…" to "Saved" is announced.
export function SaveLine() {
  const w = useWords(),
    { locale } = useExperience(),
    p = useAgentPage();
  const line = saveLineOf({ ...p, unsaved: p.dirty });
  const text =
    line === "error"
      ? errorText(p.error, locale === "ms")
      : line === "notSaved"
        ? w("Not saved yet", "Belum disimpan")
        : line === "saving"
          ? w("Saving…", "Menyimpan…")
          : line === "saved"
            ? w("Saved", "Disimpan")
            : "";
  return (
    <p className="agent-save" role="status" aria-live="polite">
      {text}
    </p>
  );
}
