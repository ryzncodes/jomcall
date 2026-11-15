"use client";
// Stage 2, optional: bring what you have. The owner adds a photo, PDF or CSV
// file, or pastes text; it is sent in the background and read while they
// answer the questions. Continue is always available. Sending lives in the
// flow's store (upload.ts), so it goes on after the owner moves on.
import { useEffect, useId, useRef, useState } from "react";
import { Info, UploadSimple } from "@phosphor-icons/react";
import { CoreError } from "@/lib/core/client";
import type { SetupUpload } from "../../../../packages/contracts/src/setup-upload";
import { useWords, errorText } from "../state";
import { useExperience } from "../../experience";
import { useLanding, useSetup } from "./flow";
import {
  ACCEPT,
  readingNow,
  refusalText,
  requestErrorText,
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

export function BringStage({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const w = useWords(),
    { locale } = useExperience(),
    store = useSetup(),
    id = useId();
  const ms = locale === "ms";
  const { uploads: manager, view } = store;
  const heading = useLanding<HTMLHeadingElement>("bring");
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLHeadingElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [pasting, setPasting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const notice = manager.notice;
  const excel =
    notice?.refusal === "EXCEL" ||
    (notice?.error instanceof CoreError && notice.error.code === "UPLOAD_XLSX");
  // An Excel file gets the paste box: copying the cells is the way in.
  useEffect(() => {
    if (excel) setPasteOpen(true);
  }, [excel]);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  // The server's uploads, oldest first, each with this browser's sender if
  // it is sending it; then files still being prepared here.
  const rows: Row[] = [
    ...view.uploads.map((u) => ({
      key: u.id,
      uploadId: u.id,
      name: uploadName(u, w),
      upload: u,
      sender: manager.senders.find((s) => s.uploadId === u.id),
    })),
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
    readingNow(view.uploads) ||
    manager.senders.some((s) => s.phase !== "failed");

  const removeRow = async (uploadId: string) => {
    setRemoving(true);
    const ok = await manager.remove(uploadId);
    setRemoving(false);
    setConfirming(null);
    // After the next paint: the freed place may enable the file input.
    requestAnimationFrame(() =>
      ok
        ? fileRef.current?.focus()
        : document.getElementById(`${id}-remove-${uploadId}`)?.focus(),
    );
  };
  const keep = (uploadId: string) => {
    setConfirming(null);
    document.getElementById(`${id}-remove-${uploadId}`)?.focus();
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
            "Tambah foto, PDF atau fail CSV, atau tampal teks. JomCall membacanya dan mengisi harga serta butiran anda untuk anda semak. Atau jawab soalan sahaja.",
          )}
        </p>
      </header>
      <div className="setup-body">
        <p className="setup-hint setup-private setup-upload-notice" id={`${id}-notice`}>
          <Info size={16} aria-hidden="true" />
          {w(
            "What you add here is sent to Anthropic, a company outside Malaysia, so its AI can read it. Do not add files or text with your customers' names, phone numbers or other personal details. Files are deleted after 30 days, and you can delete one now with Remove.",
            "Apa yang anda tambah di sini dihantar kepada Anthropic, sebuah syarikat di luar Malaysia, supaya AI mereka boleh membacanya. Jangan tambah fail atau teks yang mengandungi nama, nombor telefon atau butiran peribadi lain pelanggan anda. Fail dipadam selepas 30 hari, dan anda boleh memadamnya sekarang dengan Buang.",
          )}
        </p>
        <label className="button button-dark setup-file" data-disabled={!left}>
          <input
            ref={fileRef}
            type="file"
            className="setup-file-input"
            accept={ACCEPT}
            multiple
            disabled={!left}
            aria-describedby={`${id}-notice ${id}-limits`}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              // Lets the same file be picked again after a refusal.
              e.target.value = "";
              if (files.length) void manager.addFiles(files);
            }}
          />
          <UploadSimple size={18} aria-hidden="true" />
          <span>{w("Add a photo or file", "Tambah foto atau fail")}</span>
        </label>
        <p className="setup-hint" id={`${id}-limits`}>
          {left
            ? w(
                "A photo, a PDF or a CSV file, up to 10 MB each. Up to 5 files in one setup and 20 a day for your workspace; removing a file frees its place in this setup.",
                "Foto, PDF atau fail CSV, sehingga 10 MB setiap satu. Sehingga 5 fail bagi satu persediaan dan 20 sehari bagi ruang kerja anda; membuang fail mengosongkan tempatnya dalam persediaan ini.",
              )
            : w(
                "This setup has 5 files. Remove one to add another.",
                "Persediaan ini sudah ada 5 fail. Buang satu untuk menambah yang lain.",
              )}
        </p>
        {notice && (
          <div className="storage-warning" role="alert">
            {noticeText(notice, w, ms)}
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
                "Up to 20,000 characters. Copy the cells from a spreadsheet, or a price list from a chat.",
                "Sehingga 20,000 aksara. Salin sel daripada hamparan, atau senarai harga daripada sembang.",
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
            {w("Paste text instead", "Tampal teks")}
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
          {rows.length === 0 && (
            <p className="setup-hint">
              {w("Nothing added yet.", "Belum ada apa-apa ditambah.")}
            </p>
          )}
          <ul className="setup-cards" aria-live="polite">
            {rows.map((r) => {
              const s = r.sender;
              const failed = s?.phase === "failed";
              const label = s
                ? sendingLabel(s, w)
                : r.upload
                  ? uploadLabel(r.upload, w)
                  : "";
              const detail = s && failed ? failDetail(s.error, w, ms) : null;
              const stuck =
                s?.error instanceof CoreError && s.error.code === "UPLOAD_RATE";
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
                        {label}
                      </p>
                      {detail && <p className="setup-error">{detail}</p>}
                    </div>
                    <div className="setup-card-actions">
                      {s && failed && !stuck && (
                        <button
                          type="button"
                          className="button button-small secondary-button"
                          onClick={() => manager.retry(s.key)}
                        >
                          {w("Retry", "Cuba lagi")}
                        </button>
                      )}
                      {r.uploadId && (
                        <button
                          type="button"
                          id={`${id}-remove-${r.uploadId}`}
                          className="button button-small secondary-button"
                          aria-label={w(`Remove ${r.name}`, `Buang ${r.name}`)}
                          aria-expanded={confirming === r.uploadId}
                          disabled={removing}
                          onClick={() => setConfirming(r.uploadId)}
                        >
                          {w("Remove", "Buang")}
                        </button>
                      )}
                    </div>
                  </div>
                  {confirming === r.uploadId && (
                    <div
                      className="setup-confirm"
                      role="group"
                      aria-labelledby={`${id}-confirm`}
                    >
                      <p id={`${id}-confirm`} className="setup-hint">
                        {w(
                          "Remove this file and everything read from it? Any corrections you made to its prices are discarded too.",
                          "Buang fail ini dan semua yang dibaca daripadanya? Apa-apa pembetulan yang anda buat pada harganya juga akan dibuang.",
                        )}
                      </p>
                      <div className="setup-card-actions">
                        <button
                          type="button"
                          className="button button-small button-dark"
                          disabled={removing}
                          onClick={() => void removeRow(r.uploadId!)}
                        >
                          {removing
                            ? w("Removing…", "Membuang…")
                            : w("Remove", "Buang")}
                        </button>
                        <button
                          type="button"
                          ref={keepRef}
                          className="button button-small secondary-button"
                          disabled={removing}
                          onClick={() => keep(r.uploadId!)}
                        >
                          {w("Keep", "Kekalkan")}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {busy && (
            <p className="setup-hint">
              {w(
                "Reading carries on while you answer the questions.",
                "Pembacaan diteruskan semasa anda menjawab soalan.",
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

type Words = (en: string, ms: string) => string;

// The sentence for the last refusal or failed request, with the file name.
function noticeText(n: UploadNotice, w: Words, ms: boolean): string {
  const reason = n.refusal
    ? refusalText(n.refusal, w)
    : n.error instanceof CoreError
      ? (requestErrorText(n.error.code, n.step ?? "create", w) ??
        errorText(n.error, ms))
      : errorText(n.error, ms);
  return n.name ? `${n.name}: ${reason}` : reason;
}

// Why a send stopped, under "Sending failed".
function failDetail(error: unknown, w: Words, ms: boolean): string {
  return error instanceof CoreError
    ? (requestErrorText(error.code, "chunk", w) ?? errorText(error, ms))
    : errorText(error, ms);
}
