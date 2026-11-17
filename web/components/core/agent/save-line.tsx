"use client";
import { useWords, errorText } from "../state";
import { useExperience } from "../../experience";
import { useAgentPage } from "./store";

// The line under the page title on every view. A polite live region, so a
// change from "Saving…" to "Saved" is announced.
export function SaveLine() {
  const w = useWords(),
    { locale } = useExperience(),
    p = useAgentPage();
  let text = "";
  if (p.status === "error")
    text = errorText(p.error, locale === "ms");
  else if (p.invalid.length || p.dirty)
    text = w("Not saved yet", "Belum disimpan");
  else if (p.status === "saving") text = w("Saving…", "Menyimpan…");
  else if (p.status === "saved") text = w("Saved", "Disimpan");
  return (
    <p className="agent-save" role="status" aria-live="polite">
      {text}
    </p>
  );
}
