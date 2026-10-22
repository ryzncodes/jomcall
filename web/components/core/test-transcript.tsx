"use client";
import { useEffect, useState } from "react";
import type { SessionDetail } from "../../../packages/contracts/src/agent-test";
import { useWords } from "./state";
export function TestTranscript({
  session,
  onCancel,
  onRetry,
  busy,
}: {
  session: SessionDetail;
  onCancel: (id: string, revision: number) => void;
  onRetry: (id: string, revision: number) => void;
  busy: boolean;
}) {
  const w = useWords();
  const [now, setNow] = useState(Date.now());
  const active = session.turns.some((t) =>
    ["queued", "running"].includes(t.state),
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <div className="core-test-transcript" aria-live="polite">
      {!session.turns.length ? (
        <div className="core-empty">
          <h2>
            {w(
              "Try a real customer question.",
              "Cuba soalan sebenar pelanggan.",
            )}
          </h2>
          <p>
            {w(
              "Answers use this session’s frozen business knowledge. Tools create proposals for your review.",
              "Jawapan menggunakan pengetahuan perniagaan yang dibekukan untuk sesi ini. Alat menghasilkan cadangan untuk semakan anda.",
            )}
          </p>
        </div>
      ) : (
        session.turns.map((t) => (
          <article key={t.id} className="core-test-turn">
            <div className="core-test-question">
              <span className="eyebrow">{w("You", "Anda")}</span>
              <p>{t.input}</p>
            </div>
            <div className="core-test-answer">
              <span className="eyebrow">
                {w("Agent · text test", "Ejen · ujian teks")}
              </span>
              {t.answer ? (
                <p>{t.answer}</p>
              ) : (
                <p role="status">
                  {t.state === "queued"
                    ? w(
                        "Waiting for local worker…",
                        "Menunggu pekerja setempat…",
                      )
                    : t.state === "running"
                      ? w(
                          "Thinking with local model…",
                          "Sedang memproses dengan model setempat…",
                        )
                      : t.state === "cancelled"
                        ? w(
                            "Test stopped. No answer applied.",
                            "Ujian dihentikan. Tiada jawapan digunakan.",
                          )
                        : w(
                            "This turn could not finish.",
                            "Giliran ini tidak dapat diselesaikan.",
                          )}
                </p>
              )}
              {["queued", "running"].includes(t.state) && (
                <small>
                  {w("Elapsed", "Berlalu")}:{" "}
                  {Math.max(
                    0,
                    Math.floor((now - Date.parse(t.created_at)) / 1000),
                  )}{" "}
                  s
                </small>
              )}
              {t.state === "completed" && (
                <p className="core-authoritative-status" role="status">
                  {session.proposals.some(
                    (p) => p.turn_id === t.id && p.attempt === t.attempt,
                  )
                    ? w(
                        "Test proposals recorded below. Only your reviewed calendar actions change appointments.",
                        "Cadangan ujian direkodkan di bawah. Hanya tindakan kalendar yang anda semak mengubah janji temu.",
                      )
                    : w(
                        "No action proposal was recorded for this turn.",
                        "Tiada cadangan tindakan direkodkan untuk giliran ini.",
                      )}
                </p>
              )}
              {t.error_code && (
                <small className="core-test-error">
                  {t.error_code.replaceAll("_", " ")}
                </small>
              )}
              {t.citations.length > 0 && (
                <div className="core-citations">
                  {t.citations.map((c) => (
                    <details key={c}>
                      <summary>
                        {session.sources.find((s) => s.sourceId === c)?.title ??
                          w("Source", "Sumber")}
                      </summary>
                      <small>{c}</small>
                      <p>
                        {session.sources.find((s) => s.sourceId === c)?.excerpt}
                      </p>
                    </details>
                  ))}
                </div>
              )}
              <div className="core-actions">
                {["queued", "running"].includes(t.state) && (
                  <button
                    disabled={busy}
                    onClick={() => onCancel(t.id, t.revision)}
                  >
                    {w("Stop test", "Hentikan ujian")}
                  </button>
                )}
                {t.state === "failed" && (
                  <button
                    disabled={busy}
                    onClick={() => onRetry(t.id, t.revision)}
                  >
                    {w("Retry turn", "Cuba semula")}
                  </button>
                )}
              </div>
            </div>
            {session.steps
              .filter((s) => s.turn_id === t.id && s.attempt === t.attempt)
              .map((s) => (
                <details key={s.id} className="core-tool-trace">
                  <summary>
                    {w("Tool trace", "Jejak alat")} ·{" "}
                    {s.tool.replaceAll("_", " ")}
                  </summary>
                  <pre>{JSON.stringify(s.result, null, 2)}</pre>
                </details>
              ))}
          </article>
        ))
      )}
    </div>
  );
}
