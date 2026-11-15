"use client";
// Stage 2, optional: bring what you have. The owner adds photos, PDF or CSV
// files, or pastes text; they are sent in the background, one at a time,
// and read while the owner answers the questions. Continue is always
// available. Sending lives in the flow's store (upload.ts), so it goes on
// after the owner moves on.
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Camera, Info, UploadSimple } from "@phosphor-icons/react";
import { CoreError, failureOf } from "@/lib/core/client";
import type { SetupUpload } from "../../../../packages/contracts/src/setup-upload";
import { useWords } from "../state";
import { useLanding, useSetup } from "./flow";
import {
  ACCEPT,
  noRoomText,
  readingNow,
  refusalText,
  retryOffered,
  sendBrokenText,
  sendFailureText,
  senderShown,
  sendingLabel,
  slotsLeft,
  uploadLabel,
  uploadName,
} from "./rules";
import type { Sender, UploadNotice } from "./upload";

type Row = {
  key: string;
  uploadId: string | null;
  name: string;
  upload: SetupUpload | null;
  sender: Sender | undefined;
};
type Words = (en: string, ms: string) => string;

export function BringStage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const w = useWords(),
    store = useSetup(),
    id = useId();
  const { uploads: manager, view, now, queuedSince } = store;
  const heading = useLanding<HTMLHeadingElement>("bring");
  const photoRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLHeadingElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [pasting, setPasting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [said, setSaid] = useState("");

  const problems = manager.problems;
  const excel = problems.some(
    (p) =>
      p.refusal === "EXCEL" ||
      (p.error instanceof CoreError && p.error.code === "UPLOAD_XLSX"),
  );
  // An Excel file gets the paste box: copying the cells is the way in.
  useEffect(() => {
    if (excel) setPasteOpen(true);
  }, [excel]);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  // The server's uploads, oldest first, then rows this browser has not had
  // listed yet (waiting, being prepared, or failed before creating). Each
  // row keeps one key for its whole life.
  const rows: Row[] = [
    ...view.uploads.map((u) => {
      const s = manager.senders.find((x) => x.uploadId === u.id);
      return {
        key: s?.key ?? manager.rowKey(u.id),
        uploadId: u.id,
        name: uploadName(u, w),
        upload: u,
        sender: s && senderShown(u) ? s : undefined,
      };
    }),
    ...manager.senders
      .filter(
        (s) => !s.uploadId || !view.uploads.some((u) => u.id === s.uploadId),
      )
      .map((s) => ({
        key: s.key,
        uploadId: s.uploadId,
        name: s.name,
        upload: null,
        sender: s,
      })),
  ];
  const left = slotsLeft(rows.length);
  const busy =
    readingNow(view.uploads, now, queuedSince) ||
    manager.senders.some((s) => s.phase !== "failed");
  const labelOf = (r: Row) =>
    r.sender
      ? r.sender.phase === "failed" && r.sender.step === "remove"
        ? w("Not removed", "Belum dibuang")
        : sendingLabel(r.sender, w)
      : r.upload
        ? uploadLabel(r.upload, w, now, queuedSince.get(r.upload.id))
        : "";

  // One status line announces what changed (a file added, read or failed),
  // not every "Sending n of m".
  const kinds = rows.map((r) => [r.key, kindOf(r)] as const);
  const signature = kinds.map((k) => k.join(":")).join("|");
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const next = new Map(kinds);
    let message = "";
    if (seen.current)
      for (const r of rows) {
        const before = seen.current.get(r.key),
          after = next.get(r.key);
        if (before === after) continue;
        if (before === undefined)
          message = w(`${r.name} added`, `${r.name} ditambah`);
        else if (after === "done" || after === "failed")
          message = `${r.name}: ${labelOf(r)}`;
      }
    seen.current = next;
    if (message) setSaid(message);
    // Runs when a row's kind changes, not on every progress step.
  }, [signature]);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    // Lets the same file be picked again after a refusal.
    e.target.value = "";
    if (files.length) void manager.addFiles(files);
  };
  const removeRow = async (r: Row) => {
    setRemoving(true);
    const ok = await manager.remove({ key: r.key, uploadId: r.uploadId });
    setRemoving(false);
    setConfirming(null);
    // After the next paint: the freed place may enable the file inputs.
    requestAnimationFrame(() =>
      ok
        ? photoRef.current?.focus()
        : document.getElementById(`${id}-remove-${r.key}`)?.focus(),
    );
  };
  const keep = (r: Row) => {
    setConfirming(null);
    document.getElementById(`${id}-remove-${r.key}`)?.focus();
  };

  return (
    <div className="setup-flow">
      <header className="setup-head">
        <h1 className="setup-title" ref={heading} tabIndex={-1}>
          {w("Do you have a price list or menu?", "Ada senarai harga atau menu?")}
        </h1>
        <p className="setup-lead">
          {w(
            "Add a photo, PDF or CSV file, or paste text. JomCall reads it and fills in your prices and details for you to check. Or just answer the questions.",
            "Tambah foto, PDF atau fail CSV, atau tampal teks. JomCall membacanya dan mengisi harga dan butiran untuk anda semak. Atau jawab soalan sahaja.",
          )}
        </p>
      </header>
      <div className="setup-body">
        <p className="setup-hint setup-private setup-upload-notice" id={`${id}-notice`}>
          <Info size={16} aria-hidden="true" />
          {w(
            "What you add here is sent to Anthropic, a company outside Malaysia, so its AI can read it. Do not add files or text with your customers' names, phone numbers or other personal details. Files and pasted text are deleted after 30 days. You can also delete one now with the Remove button while setup is open.",
            "Apa yang anda tambah di sini dihantar kepada Anthropic, sebuah syarikat di luar Malaysia, supaya AI mereka boleh membacanya. Jangan tambah fail atau teks yang mengandungi nama, nombor telefon atau butiran peribadi lain pelanggan anda. Fail dan teks yang ditampal dipadam selepas 30 hari. Anda juga boleh memadamnya sekarang dengan butang Buang semasa persediaan masih dibuka.",
          )}
        </p>
        <div className="setup-file-row">
          <label className="button button-dark setup-file" data-disabled={!left}>
            <input
              ref={photoRef}
              type="file"
              className="setup-file-input"
              accept="image/*"
              multiple
              disabled={!left}
              aria-describedby={`${id}-notice ${id}-limits`}
              onChange={pick}
            />
            <Camera size={18} aria-hidden="true" />
            <span>{w("Take or choose a photo", "Ambil atau pilih foto")}</span>
          </label>
          <label
            className="button secondary-button setup-file"
            data-disabled={!left}
          >
            <input
              type="file"
              className="setup-file-input"
              accept={ACCEPT}
              multiple
              disabled={!left}
              aria-describedby={`${id}-notice ${id}-limits`}
              onChange={pick}
            />
            <UploadSimple size={18} aria-hidden="true" />
            <span>{w("Add a file", "Tambah fail")}</span>
          </label>
        </div>
        <p className="setup-hint" id={`${id}-limits`}>
          {left
            ? w(
                "A photo, a PDF or a CSV file, up to 10 MB each. Up to 5 files in each setup and 20 files a day for your workspace. Remove a file to make room for another.",
                "Foto, PDF atau fail CSV, sehingga 10 MB setiap satu. Sehingga 5 fail bagi setiap persediaan dan 20 fail sehari bagi ruang kerja anda. Buang fail untuk memberi ruang kepada fail lain.",
              )
            : w(
                "This setup has 5 files. Remove one to add another.",
                "Persediaan ini sudah ada 5 fail. Buang satu untuk menambah yang lain.",
              )}
        </p>
        {problems.length > 0 && (
          <div className="storage-warning" role="alert">
            <ul className="setup-problems">
              {problems.map((p, i) => (
                <li key={i}>{noticeText(p, w)}</li>
              ))}
            </ul>
          </div>
        )}
        {pasteOpen ? (
          <form
            className="setup-paste"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim() || pasting) return;
              setPasting(true);
              const ok = await manager.paste(text);
              setPasting(false);
              if (ok) {
                setText("");
                setPasteOpen(false);
                listRef.current?.focus();
              }
            }}
          >
            <label htmlFor={`${id}-paste`} className="setup-legend">
              {w("Text to read", "Teks untuk dibaca")}
            </label>
            <textarea
              id={`${id}-paste`}
              className="setup-answer"
              rows={6}
              maxLength={20000}
              value={text}
              aria-describedby={`${id}-paste-hint`}
              onChange={(e) => setText(e.target.value)}
            />
            <small id={`${id}-paste-hint`} className="setup-hint">
              {w(
                "Up to 20,000 characters. Copy the cells from Excel or Google Sheets, or a price list from a chat.",
                "Sehingga 20,000 aksara. Salin sel daripada Excel atau Google Sheets, atau senarai harga daripada sembang.",
              )}
            </small>
            <button
              className="button secondary-button"
              disabled={!text.trim() || pasting || !left}
            >
              {pasting
                ? w("Sending…", "Menghantar…")
                : w("Read this text", "Baca teks ini")}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="setup-link"
            onClick={() => setPasteOpen(true)}
          >
            {w("Paste text instead", "Atau tampal teks")}
          </button>
        )}
        <section className="setup-section" aria-labelledby={`${id}-files`}>
          <h2
            id={`${id}-files`}
            className="setup-legend"
            ref={listRef}
            tabIndex={-1}
          >
            {w("Your files", "Fail anda")}
          </h2>
          <p className="sr-only" role="status" aria-live="polite">
            {said}
          </p>
          {rows.length === 0 && (
            <p className="setup-hint">
              {w("Nothing added yet.", "Belum ada apa-apa ditambah.")}
            </p>
          )}
          <ul className="setup-cards">
            {rows.map((r) => {
              const s = r.sender;
              const failed = s?.phase === "failed";
              const detail = s && failed ? failDetail(s, w) : null;
              const canRetry = !!s && failed && retryAllowed(s);
              // A failed Remove stays stopped; its action removes again,
              // never resends the file.
              const removeAgain = s?.step === "remove";
              const bad =
                failed ||
                (!s &&
                  (r.upload?.state === "failed" ||
                    r.upload?.state === "uploading"));
              return (
                <li key={r.key} className="setup-card setup-upload">
                  <div className="setup-card-row">
                    <div>
                      <p className="setup-card-value setup-upload-name">
                        {r.name}
                      </p>
                      <p
                        className={bad ? "setup-error" : "setup-hint"}
                        data-state={s?.phase ?? r.upload?.state}
                      >
                        {labelOf(r)}
                      </p>
                      {detail && <p className="setup-error">{detail}</p>}
                    </div>
                    <div className="setup-card-actions">
                      {canRetry && (
                        <button
                          type="button"
                          className="button button-small secondary-button"
                          aria-label={
                            removeAgain
                              ? w(
                                  `Try removing ${r.name} again`,
                                  `Cuba buang ${r.name} sekali lagi`,
                                )
                              : w(`Retry ${r.name}`, `Cuba lagi ${r.name}`)
                          }
                          disabled={removing}
                          onClick={() =>
                            removeAgain
                              ? void removeRow(r)
                              : manager.retry(s.key)
                          }
                        >
                          {w("Retry", "Cuba lagi")}
                        </button>
                      )}
                      <button
                        type="button"
                        id={`${id}-remove-${r.key}`}
                        className="button button-small secondary-button"
                        aria-label={w(`Remove ${r.name}`, `Buang ${r.name}`)}
                        aria-expanded={confirming === r.key}
                        disabled={removing}
                        onClick={() => setConfirming(r.key)}
                      >
                        {w("Remove", "Buang")}
                      </button>
                    </div>
                  </div>
                  {confirming === r.key && (
                    <RemoveFileConfirm
                      id={`${id}-confirm`}
                      removing={removing}
                      keepRef={keepRef}
                      onRemove={() => void removeRow(r)}
                      onKeep={() => keep(r)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {busy && (
            <p className="setup-hint">
              {w(
                "Reading carries on while you answer the questions.",
                "Fail terus dibaca semasa anda menjawab soalan.",
              )}
            </p>
          )}
        </section>
      </div>
      <div className="setup-nav">
        <button
          type="button"
          className="button secondary-button"
          onClick={onBack}
        >
          {w("Back", "Kembali")}
        </button>
        <button type="button" className="button button-dark" onClick={onContinue}>
          {rows.length
            ? w("Continue", "Teruskan")
            : w("Answer questions instead", "Jawab soalan sahaja")}
        </button>
      </div>
    </div>
  );
}

// Asks before removing a file; also used by the review page's "Remove
// everything from this file". The caller focuses Keep when it opens.
export function RemoveFileConfirm({
  id,
  removing,
  keepRef,
  onRemove,
  onKeep,
}: {
  id: string;
  removing: boolean;
  keepRef?: React.Ref<HTMLButtonElement>;
  onRemove: () => void;
  onKeep: () => void;
}) {
  const w = useWords();
  return (
    <div className="setup-confirm" role="group" aria-labelledby={id}>
      <p id={id} className="setup-hint">
        {w(
          "Remove this file? Prices and details read from it are removed too, except ones you confirmed. A price you edited counts as confirmed and stays.",
          "Buang fail ini? Harga dan butiran yang dibaca daripadanya turut dibuang, kecuali yang sudah anda sahkan. Harga yang anda ubah dikira sudah disahkan dan kekal.",
        )}
      </p>
      <div className="setup-card-actions">
        <button
          type="button"
          className="button button-small button-dark"
          disabled={removing}
          onClick={onRemove}
        >
          {removing ? w("Removing…", "Membuang…") : w("Remove", "Buang")}
        </button>
        <button
          type="button"
          ref={keepRef}
          className="button button-small secondary-button"
          disabled={removing}
          onClick={onKeep}
        >
          {w("Keep", "Kekalkan")}
        </button>
      </div>
    </div>
  );
}

// What the status line tracks for one row.
function kindOf(r: Row): string {
  if (r.sender) return r.sender.phase === "failed" ? "failed" : "sending";
  return r.upload?.state === "done" || r.upload?.state === "failed"
    ? r.upload.state
    : "waiting";
}

// The sentence for one refusal or failed request, with the file name.
function noticeText(n: UploadNotice, w: Words): string {
  if (n.refusal === "NO_ROOM") return noRoomText(n.names ?? [], w);
  const f = failureOf(n.error);
  const reason = n.refusal
    ? refusalText(n.refusal, w)
    : sendFailureText(f.status, f.code, n.step ?? "create", w);
  return n.name ? `${n.name}: ${reason}` : reason;
}

// Why a send stopped, under "Sending failed". A failure while preparing
// the file (no request step) gets the general sentence.
function failDetail(s: Sender, w: Words): string {
  if (!s.step) return sendBrokenText(w);
  const f = failureOf(s.error);
  return sendFailureText(f.status, f.code, s.step, w);
}

// A failed Remove can always be tried again (unless signed out or refused
// by role); a failed send only when sending the same thing can work.
function retryAllowed(s: Sender) {
  if (!s.step) return false;
  const f = failureOf(s.error);
  if (s.step === "remove")
    return !(f.code !== "PROXY" && (f.status === 401 || f.status === 403));
  return retryOffered(f.status, f.code);
}
