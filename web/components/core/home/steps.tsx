"use client";
// The getting-started list, drawn the same way on Home and on setup's live
// page. The steps come from stepsFrom() in home-rules.
import { CheckCircle, Circle, Clock } from "@phosphor-icons/react";
import type { Step } from "@/lib/core/home-rules";
import { localNumber } from "@/lib/core/phone-format";
import { useExperience } from "../../experience";
import { useWords } from "../state";
import { HINT_WORDS, STEP_WORDS, forwardLine } from "./copy";

export function ChecklistSteps({
  steps,
  manager,
  activeE164,
}: {
  steps: Step[];
  manager: boolean;
  activeE164: string | null;
}) {
  const w = useWords(),
    { href } = useExperience();
  return (
    <ol className="home-steps">
      {steps.map((s) => {
        const t = STEP_WORDS[s.id];
        const Icon = s.state === "done" ? CheckCircle : s.state === "waiting" ? Clock : Circle;
        return (
          <li key={s.id} data-state={s.state}>
            <Icon className="home-step-icon" size={22} weight={s.state === "done" ? "fill" : "regular"} aria-hidden />
            <span className="home-step-label">
              {w(...t.label)}
              {s.state === "waiting" && (
                <small>{w("Waiting for your number", "Menunggu nombor anda")}</small>
              )}
              {s.state === "todo" && !manager && (
                <small>{w("An owner or admin does this step.", "Pemilik atau pentadbir melakukan langkah ini.")}</small>
              )}
              {s.state === "todo" && s.hint && <small>{w(...HINT_WORDS[s.hint])}</small>}
              {s.id === "call" && s.state === "todo" && activeE164 && (
                <small>{forwardLine(localNumber(activeE164), w)}</small>
              )}
              <span className="sr-only">
                {s.state === "done"
                  ? w(" (done)", " (selesai)")
                  : s.state === "waiting"
                    ? ""
                    : w(" (not done)", " (belum selesai)")}
              </span>
            </span>
            {s.state === "todo" && s.href && (
              <a className="button secondary-button" href={href(s.href)}>
                {s.unpaid ? w("Pay fee", "Bayar yuran") : w(...t.button)}
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
