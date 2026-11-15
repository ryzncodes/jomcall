// Pure decisions of the guided setup screens, kept apart so they can be
// tested without a browser.

import {
  UPLOAD_LIMITS,
  type SetupUpload,
} from "../../../../packages/contracts/src/setup-upload";
import type { Setup, SetupItem } from "../../../../packages/contracts/src/setup";
import { LIMITS } from "../../../../packages/contracts/src/knowledge";
// The one domain module the setup screens use: the price-row planner, which
// has no server imports (tests/api/setup-rows.test.ts guards that).
import {
  planFromView,
  type RowPlan,
  type RowTotals,
} from "../../../../packages/domain/src/setup/rows.ts";
import { proxyRetryable } from "../error-copy";

type TestLike = {
  id: string;
  source: "draft" | "published";
  turns: { state: string }[];
};

// Publish unlocks only from a draft test session created after the finish
// stage opened (not among the sessions listed then) that has a completed
// answer. No baseline (it could not be loaded) means no unlock.
export function unlocksPublish(
  baseline: ReadonlySet<string> | null,
  session: TestLike | null | undefined,
): boolean {
  return (
    !!baseline &&
    !!session &&
    !baseline.has(session.id) &&
    session.source === "draft" &&
    session.turns.some((t) => t.state === "completed")
  );
}

// Every 3 s for the first minute, then every 10 s.
export const pollDelay = (elapsedMs: number) =>
  elapsedMs < 60_000 ? 3000 : 10_000;

// The workspace name is offered only for a question that fills exactly one
// fact, business_name, and has no answer yet (no item, or a skipped one). A
// question that also asks something else is never prefilled, so Continue
// cannot keep half an answer.
export function namePrefill(
  fills: readonly string[],
  item: { state: string } | null | undefined,
  name: string,
): string {
  const answered = !!item && item.state !== "removed";
  const facts = fills.filter((f) => f.startsWith("facts."));
  return !answered && facts.length === 1 && facts[0] === "facts.business_name"
    ? name
    : "";
}

// "Use new" ids to send with applySetup: only conflicts whose item is still
// live (not removed since the choice was made).
export function replaceIds(
  conflicts: readonly { itemId: string }[],
  items: readonly { id: string; state: string }[],
  choices: Readonly<Record<string, "keep" | "new">>,
): string[] {
  return conflicts
    .filter(
      (c) =>
        choices[c.itemId] === "new" &&
        items.some((i) => i.id === c.itemId && i.state !== "removed"),
    )
    .map((c) => c.itemId);
}

// ---- Bring a document: file checks, chunk plan and labels ----------------

type Words = (en: string, ms: string) => string;

// The setup reader's own limits, which the server does not check at upload:
// a delimited text file over 1 MiB is refused as too long, and an image whose
// base64 text is over 5,000,000 characters is refused (3,600,000 raw bytes
// keeps a margin under that).
export const TEXT_FILE_BYTES = 1_048_576;
export const IMAGE_BYTES = 3_600_000;
// Images are shrunk in the browser: each step is tried until the JPEG fits.
export const SHRINK_STEPS = [
  { side: 2400, quality: 0.85 },
  { side: 2400, quality: 0.7 },
  { side: 2400, quality: 0.5 },
  { side: 1600, quality: 0.5 },
] as const;
// A picture whose long side is more than this many times its short side
// (a long screenshot) is unreadable once shrunk to 2,400 px.
export const MAX_ASPECT = 4;
// What the general file picker offers; the photo picker offers image/*.
export const ACCEPT =
  "image/*,application/pdf,.pdf,.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values";
// An upload still queued after this long is no longer polled for.
export const QUEUE_PATIENCE_MS = 10 * 60 * 1000;

// Chunk sizes for a file of `bytes`: pieces of at most 3 MiB, at most 10 of
// them. An empty file or one over 10 MiB gets no plan (refused).
export function splitPlan(bytes: number): number[] {
  if (
    !Number.isInteger(bytes) ||
    bytes <= 0 ||
    bytes > UPLOAD_LIMITS.uploadBytes
  )
    return [];
  const sizes: number[] = [];
  for (let left = bytes; left > 0; left -= UPLOAD_LIMITS.chunkBytes)
    sizes.push(Math.min(left, UPLOAD_LIMITS.chunkBytes));
  return sizes.length <= UPLOAD_LIMITS.chunks ? sizes : [];
}

const extension = (name: string) =>
  /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
const TEXT_EXT = ["csv", "tsv", "txt"];
const EXCEL_EXT = ["xlsx", "xls", "xlsm", "xlsb", "xltx", "xltm"];
const IMAGE_EXT = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "gif",
  "bmp",
  "avif",
];
const EXCEL_MIME =
  /^application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.)/i;

// An Excel workbook, by extension or by type. A .csv, .tsv or .txt name
// wins over the type: Windows often labels CSV files as Excel.
export function isExcel(name: string, type: string): boolean {
  const ext = extension(name);
  if (TEXT_EXT.includes(ext)) return false;
  return EXCEL_EXT.includes(ext) || EXCEL_MIME.test(type.trim());
}

export type FileKind = "image" | "pdf" | "sheet" | "excel";
// What the browser should do with a picked file; null when it is not a kind
// the server accepts. Phones often give no type, so the name is read first.
export function fileKind(name: string, type: string): FileKind | null {
  const ext = extension(name),
    t = type.trim().toLowerCase();
  if (TEXT_EXT.includes(ext)) return "sheet";
  if (isExcel(name, type)) return "excel";
  if (ext === "pdf" || t === "application/pdf") return "pdf";
  if (IMAGE_EXT.includes(ext) || t.startsWith("image/")) return "image";
  if (
    t === "text/csv" ||
    t === "text/plain" ||
    t === "text/tab-separated-values"
  )
    return "sheet";
  return null;
}

// Some Android pickers give a file with no type and no extension; its
// first 16 bytes decide, as on the server.
export const needsSniff = (name: string, type: string) =>
  !extension(name) && !type.trim();

const startsWith = (head: Uint8Array, bytes: number[], at = 0) =>
  bytes.every((b, i) => head[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
// HEIF and AVIF brands; the browser decodes these and sends a JPEG.
const HEIF_BRANDS = ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif"];

// The server's leading-byte rules (JPEG, PNG, WebP, PDF; a zip is an Excel
// workbook), plus picture formats the browser turns into a JPEG first (GIF,
// HEIC/HEIF/AVIF).
export function sniffKind(head: Uint8Array): FileKind | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return "image";
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8))
    return "image";
  if (startsWith(head, ascii("GIF8"))) return "image";
  if (
    startsWith(head, ascii("ftyp"), 4) &&
    HEIF_BRANDS.some((b) => startsWith(head, ascii(b), 8))
  )
    return "image";
  if (startsWith(head, ascii("%PDF-"))) return "pdf";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "excel";
  return null;
}

// A long screenshot: refused, because shrinking makes it unreadable.
export const tooLong = (width: number, height: number) =>
  Math.max(width, height) > MAX_ASPECT * Math.min(width, height);

// Refusals made in the browser, before anything is sent, and the server's
// refusals of a file, each with one plain sentence.
export type Refusal =
  | "EXCEL"
  | "TYPE"
  | "EMPTY"
  | "SPLIT"
  | "LIST_TOO_LONG"
  | "PHOTO_FORMAT"
  | "PHOTO_TOO_BIG"
  | "PHOTO_TOO_LONG";

// Size checks on the file as picked. Photos are shrunk first, so only an
// empty one is refused here.
export function sizeProblem(
  kind: Exclude<FileKind, "excel">,
  bytes: number,
): Refusal | null {
  if (bytes <= 0) return "EMPTY";
  if (kind === "sheet" && bytes > TEXT_FILE_BYTES) return "LIST_TOO_LONG";
  if (kind === "pdf" && bytes > UPLOAD_LIMITS.uploadBytes) return "SPLIT";
  return null;
}

export function refusalText(r: Refusal, w: Words): string {
  switch (r) {
    case "EXCEL":
      return w(
        "Excel files are not supported yet. Copy the cells in Excel and paste them here, or save the file as CSV or PDF.",
        "Fail Excel belum disokong. Salin sel dalam Excel dan tampal di sini, atau simpan fail itu sebagai CSV atau PDF.",
      );
    case "TYPE":
      return w(
        "This kind of file is not supported. Use a photo, a PDF or a CSV file.",
        "Jenis fail ini tidak disokong. Gunakan foto, PDF atau fail CSV.",
      );
    case "EMPTY":
      return w("This file is empty.", "Fail ini kosong.");
    case "SPLIT":
      return w(
        "This file is larger than 10 MB. Split it into smaller files and add them one at a time.",
        "Fail ini lebih besar daripada 10 MB. Bahagikan kepada fail yang lebih kecil dan tambah satu demi satu.",
      );
    case "LIST_TOO_LONG":
      return w(
        "This list is too long. Paste only the price columns, or split it into smaller files.",
        "Senarai ini terlalu panjang. Tampal lajur harga sahaja, atau bahagikan kepada fail yang lebih kecil.",
      );
    case "PHOTO_FORMAT":
      return w(
        "This photo format is not supported. Take a screenshot of it, or save it as JPEG.",
        "Format foto ini tidak disokong. Ambil tangkapan skrin foto itu, atau simpan sebagai JPEG.",
      );
    case "PHOTO_TOO_BIG":
      return w(
        "This photo is still too large after making it smaller. Take a screenshot of it and add that instead.",
        "Foto ini masih terlalu besar walaupun sudah dikecilkan. Ambil tangkapan skrin foto itu, kemudian tambah tangkapan skrin tersebut.",
      );
    case "PHOTO_TOO_LONG":
      return w(
        "This picture is very long. Crop it into shorter parts and add each part.",
        "Gambar ini terlalu panjang. Potong kepada beberapa bahagian yang lebih pendek dan tambah setiap bahagian.",
      );
  }
}

// Files picked beyond the places left in this setup, named in one sentence.
export function noRoomText(names: readonly string[], w: Words): string {
  const list = names.join(", ");
  return w(
    `Not added: ${list}. A setup holds up to 5 files; remove one to make room.`,
    `Tidak ditambah: ${list}. Satu persediaan boleh ada sehingga 5 fail; buang satu untuk memberi ruang.`,
  );
}

export type UploadStep = "create" | "chunk" | "finish" | "paste" | "remove";

// The server's answer to an upload request, when it has its own sentence;
// null for anything the shared error text covers. UPLOAD_RATE means the
// daily cap when creating, and the 30 chunk writes when sending a chunk.
export function requestErrorText(
  code: string,
  step: UploadStep,
  w: Words,
): string | null {
  switch (code) {
    case "UPLOAD_XLSX":
      return refusalText("EXCEL", w);
    case "UPLOAD_TYPE":
      return refusalText("TYPE", w);
    case "UPLOAD_TOO_LARGE":
      return refusalText("SPLIT", w);
    case "UPLOAD_LIMIT":
      return w(
        "You can add up to 5 files to one setup. Remove one to add another.",
        "Anda boleh tambah sehingga 5 fail bagi satu persediaan. Buang satu untuk menambah yang lain.",
      );
    case "UPLOAD_RATE":
      return step === "chunk"
        ? w(
            "This file was sent too many times. Remove it and add it again.",
            "Fail ini sudah dihantar terlalu banyak kali. Buang dan tambah semula.",
          )
        : w(
            "Your workspace has added 20 files in the last 24 hours, the most allowed. Try again later, or answer the questions instead.",
            "Ruang kerja anda sudah menambah 20 fail dalam 24 jam yang lalu, iaitu had maksimum. Cuba lagi kemudian, atau jawab soalan sahaja.",
          );
    case "READER_OFF":
      return failText("READER_OFF", w);
    default:
      return null;
  }
}

// The sentence for a failed upload request; never a raw code. `status` and
// `code` come from failureOf: both null when no answer came (offline,
// timeout), code "PROXY" for an error page that is not JSON from the app.
// - Removing and pasting have their own sentences, never the sending ones.
// - 401 from the app: signed out. 403 with code FORBIDDEN: a role that may
//   not add documents; any other 403 (CSRF_REJECTED) is the general one.
// - A proxy's page: 413 is "too large for the connection" (no size named:
//   a proxy's limit can be lower than ours), a page a later try may pass is
//   the connection sentence, any other the general one.
// - Any other refusal (CONFLICT, UPLOAD_INCOMPLETE, UPLOAD_SIZE_MISMATCH,
//   EMPTY_CHUNK, PAYLOAD_TOO_LARGE, OCTET_STREAM_REQUIRED, NOT_FOUND) means
//   this send cannot be fixed by Retry.
export function sendFailureText(
  status: number | null,
  code: string | null,
  step: UploadStep,
  w: Words,
): string {
  const app = code !== "PROXY";
  if (app && status === 401)
    return step === "remove"
      ? w(
          "You are signed out. Sign in again, then remove the file.",
          "Anda sudah log keluar. Log masuk semula, kemudian buang fail itu.",
        )
      : step === "paste"
        ? w(
            "You are signed out. Sign in again, then paste the text again.",
            "Anda sudah log keluar. Log masuk semula, kemudian tampal teks itu sekali lagi.",
          )
        : w(
            "You are signed out. Sign in again, then add the file.",
            "Anda sudah log keluar. Log masuk semula, kemudian tambah fail itu.",
          );
  if (app && status === 403 && code === "FORBIDDEN")
    return step === "remove"
      ? w(
          "Only an owner or admin can remove documents.",
          "Hanya pemilik atau pentadbir boleh membuang dokumen.",
        )
      : w(
          "Only an owner or admin can add documents.",
          "Hanya pemilik atau pentadbir boleh menambah dokumen.",
        );
  if (step === "remove") return removeFailedText(w);
  const own = code && app ? requestErrorText(code, step, w) : null;
  if (own) return own;
  if (step === "paste")
    return w(
      "Could not add the pasted text. Try again.",
      "Teks yang ditampal tidak dapat ditambah. Cuba lagi.",
    );
  if (!app) {
    if (status === 413)
      return w(
        "This file could not be sent because it is too large for the connection. Try a smaller file.",
        "Fail ini tidak dapat dihantar kerana terlalu besar untuk sambungan ini. Cuba fail yang lebih kecil.",
      );
    return proxyRetryable(status) ? connectionText(w) : sendBrokenText(w);
  }
  return status === null || retryable(status)
    ? connectionText(w)
    : sendBrokenText(w);
}
const connectionText = (w: Words) =>
  w(
    "Sending stopped. Check your connection, then try again.",
    "Penghantaran terhenti. Semak sambungan anda, kemudian cuba lagi.",
  );
export const removeFailedText = (w: Words) =>
  w(
    "Could not remove this file. Try again.",
    "Fail ini tidak dapat dibuang. Cuba lagi.",
  );
export const sendBrokenText = (w: Words) =>
  w(
    "Something went wrong sending this file. Remove it and add it again.",
    "Ada masalah semasa menghantar fail ini. Buang dan tambah semula.",
  );

// Retry is offered only when sending the same thing again can work: no
// answer, a timeout or a server error (or a proxy's page a later try may
// pass), and never after the write cap.
export function retryOffered(status: number | null, code: string | null) {
  if (code === "UPLOAD_RATE") return false;
  if (code === "PROXY") return proxyRetryable(status);
  return retryable(status);
}

// One plain sentence per reason a read failed.
export function failText(code: string | null, w: Words): string {
  switch (code) {
    case "TOO_LONG":
      return w(
        "Too long to read. Split it into smaller files.",
        "Terlalu panjang untuk dibaca. Bahagikan kepada fail yang lebih kecil.",
      );
    case "UNREADABLE":
      return w(
        "Could not read this file. Try a clearer photo, or paste the text.",
        "Fail ini tidak dapat dibaca. Cuba foto yang lebih jelas, atau tampal teksnya.",
      );
    case "REFUSED":
    case "READ_FAILED":
      return w(
        "Could not read this file. Remove it and try again, or answer the questions instead.",
        "Fail ini tidak dapat dibaca. Buang dan cuba lagi, atau jawab soalan sahaja.",
      );
    case "READER_OFF":
      return w(
        "Document reading is not available right now.",
        "Pembacaan dokumen tidak tersedia buat masa ini.",
      );
    case "ABANDONED":
      return w(
        "This upload was interrupted. Add it again.",
        "Muat naik ini terputus. Tambah semula.",
      );
    case "UPLOAD_TYPE":
      return refusalText("TYPE", w);
    case "UPLOAD_XLSX":
      return refusalText("EXCEL", w);
    default:
      return w("Could not read this file.", "Fail ini tidak dapat dibaca.");
  }
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

type UploadView = Pick<
  SetupUpload,
  "state" | "failCode" | "rowCount" | "factCount" | "droppedCount"
>;

// An upload this browser has seen queued for longer than QUEUE_PATIENCE_MS:
// the screen stops polling for it and says the owner can come back later.
// `since` is when this browser first saw it queued, on its own clock (the
// server's createdAt is not compared with a phone clock that may be off).
export const stalled = (
  u: Pick<SetupUpload, "state">,
  now: number,
  since: number | undefined,
) =>
  u.state === "queued" &&
  since !== undefined &&
  now - since > QUEUE_PATIENCE_MS;

// When this browser first saw each upload queued: earlier times are kept,
// newly queued uploads get `now`.
export function firstSeenQueued(
  seen: ReadonlyMap<string, number>,
  uploads: readonly Pick<SetupUpload, "id" | "state">[],
  now: number,
): Map<string, number> {
  const next = new Map(seen);
  for (const u of uploads)
    if (u.state === "queued" && !next.has(u.id)) next.set(u.id, now);
  return next;
}

// The state line under one upload, from the server's record alone. While
// this browser is sending it, the screen shows sendingLabel instead; an
// upload still "uploading" without a sender here was cut off (a reload or a
// closed tab) and cannot be resumed.
export function uploadLabel(
  u: UploadView,
  w: Words,
  now?: number,
  since?: number,
): string {
  switch (u.state) {
    case "uploading":
      return w(
        "This upload was interrupted. Remove it and add the file again.",
        "Muat naik ini terputus. Buang dan tambah fail itu semula.",
      );
    case "queued":
      return now !== undefined && stalled(u, now, since)
        ? w(
            "Still waiting to be read. You can go on and come back later.",
            "Masih menunggu untuk dibaca. Anda boleh teruskan dan kembali kemudian.",
          )
        : w("Waiting to be read", "Menunggu untuk dibaca");
    case "reading":
      return w("Reading…", "Sedang dibaca…");
    case "failed":
      return failText(u.failCode, w);
    case "removed":
      return w("Removed", "Dibuang");
    case "done": {
      const prices = u.rowCount,
        facts = u.factCount;
      const found =
        prices && facts
          ? w(
              `${plural(prices, "price", "prices")} and ${plural(facts, "fact", "facts")} found`,
              `${prices} harga dan ${facts} butiran ditemui`,
            )
          : prices
            ? w(
                `${plural(prices, "price", "prices")} found`,
                `${prices} harga ditemui`,
              )
            : facts
              ? w(
                  `${plural(facts, "fact", "facts")} found`,
                  `${facts} butiran ditemui`,
                )
              : w(
                  "Nothing found in this file. Try a clearer photo, or answer the questions instead.",
                  "Tiada apa-apa ditemui dalam fail ini. Cuba foto yang lebih jelas, atau jawab soalan sahaja.",
                );
      if (!u.droppedCount) return found;
      return (
        found +
        " · " +
        w(
          `${plural(u.droppedCount, "row", "rows")} could not be read`,
          `${u.droppedCount} baris tidak dapat dibaca`,
        )
      );
    }
  }
}

// Progress of a file this browser is sending; `seq` counts from 0.
export type SendPhase = "waiting" | "preparing" | "sending" | "failed" | "sent";
export function sendingLabel(
  s: { phase: SendPhase; seq: number; total: number },
  w: Words,
): string {
  if (s.phase === "waiting")
    return w("Waiting to send", "Menunggu untuk dihantar");
  if (s.phase === "preparing") return w("Preparing…", "Menyediakan…");
  if (s.phase === "failed") return w("Sending failed", "Gagal dihantar");
  if (s.phase === "sent")
    return w("Waiting to be read", "Menunggu untuk dibaca");
  const n = Math.min(s.seq + 1, s.total);
  return w(`Sending ${n} of ${s.total}`, `Menghantar ${n} daripada ${s.total}`);
}

// Which line a row shows: this browser's send progress only while the
// server still lists the upload as uploading (or not yet at all); once the
// server has it queued or further, the server's label wins and the local
// sender is dropped, "Sending failed" included.
export const senderShown = (upload: Pick<SetupUpload, "state"> | undefined) =>
  !upload || upload.state === "uploading";

// The pasted-text upload's stored name is English; the screen names it.
export const uploadName = (u: Pick<SetupUpload, "kind" | "name">, w: Words) =>
  u.kind === "text" ? w("Pasted text", "Teks yang ditampal") : u.name;

// A file name the server accepts: no control or direction-override
// characters, at most 200 UTF-16 units, never empty.
export function safeName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  let cut = clean.slice(0, 200);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trim() || "file";
}

// A shrunk photo is a JPEG; its name says so.
export function jpegName(name: string): string {
  const base = safeName(name).replace(/\.[a-z0-9]{1,5}$/i, "") || "photo";
  return safeName(base.slice(0, 196) + ".jpg");
}

// Width and height that fit inside `side` on the longest edge, never
// enlarged.
export function fitSize(
  width: number,
  height: number,
  side: number,
): [number, number] {
  const long = Math.max(width, height);
  if (long <= side) return [width, height];
  const scale = side / long;
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}

// Places left in this setup: removed uploads free theirs.
export const slotsLeft = (used: number) =>
  Math.max(0, UPLOAD_LIMITS.perSession - used);

// The view is polled while any upload is being read, or waits for the
// reader and has not waited longer than QUEUE_PATIENCE_MS.
export const readingNow = (
  uploads: readonly Pick<SetupUpload, "id" | "state">[],
  now: number,
  seen: ReadonlyMap<string, number>,
) =>
  uploads.some(
    (u) =>
      u.state === "reading" ||
      (u.state === "queued" && !stalled(u, now, seen.get(u.id))),
  );

// Whether the "bring a document" stage opens by itself after the business
// type: reading is on, a session is open, and nothing is in it yet (no
// upload, no answer; a skipped question leaves an item too).
export function bringFirst(view: {
  reader: "ready" | "off";
  session: unknown;
  uploads: readonly unknown[];
  items: readonly unknown[];
}): boolean {
  return (
    view.reader === "ready" &&
    !!view.session &&
    view.uploads.length === 0 &&
    view.items.length === 0
  );
}

// Whether a failed request is worth sending again unchanged: no answer at
// all (offline, lost response, timeout), a server error, or a timeout.
export const retryable = (status: number | null) =>
  status === null || status === 408 || status >= 500;

// How far an upload has got; a view never moves one backwards.
const UPLOAD_RANK: Record<SetupUpload["state"], number> = {
  uploading: 0,
  queued: 1,
  reading: 2,
  done: 3,
  failed: 3,
  removed: 4,
};

// What this browser knows about one upload, and the request counter when it
// learned it: from a view (the counter when that view was requested) or from
// its own create, finish, paste or remove (a counter taken then).
export type KnownUpload = { upload: SetupUpload | "removed"; at: number };

// Merges a view's uploads, requested at counter `at`, with what is known.
// - A removal wins; it is forgotten once a view requested after it no longer
//   lists the upload.
// - A row never moves backwards (uploading < queued < reading < done/failed):
//   a slower, older answer cannot turn "done" back into "reading".
// - A known upload missing from the view is kept when the view was
//   requested before it was learned (create, finish and paste do not raise
//   the session revision), and dropped when the view was requested after
//   (it is gone on the server), so no phantom row is polled for ever.
export function mergeUploads(
  server: readonly SetupUpload[],
  at: number,
  known: ReadonlyMap<string, KnownUpload>,
): { uploads: SetupUpload[]; known: Map<string, KnownUpload> } {
  const next = new Map(known);
  const uploads: SetupUpload[] = [];
  const listed = new Set(server.map((u) => u.id));
  for (const u of server) {
    const k = next.get(u.id);
    if (k?.upload === "removed") continue;
    if (k && UPLOAD_RANK[k.upload.state] > UPLOAD_RANK[u.state]) {
      uploads.push(k.upload);
      continue;
    }
    uploads.push(u);
    if (!k || at >= k.at) next.set(u.id, { upload: u, at });
  }
  for (const [id, k] of known) {
    if (listed.has(id)) continue;
    if (at > k.at) next.delete(id);
    else if (k.upload !== "removed") uploads.push(k.upload);
  }
  return { uploads, known: next };
}

// The parts of an item a person or the reader sets (not the outcome,
// duplicate and current fields the view works out each time).
const itemShape = (i: SetupItem) =>
  JSON.stringify([
    i.kind,
    i.key,
    i.payload,
    i.source,
    i.needsCheck,
    i.checkReason,
    i.state,
  ]);

// After a save is refused as stale: was the only change between the view
// the save was based on and the fresh one a document being read? Same
// session and packs; no upload added or gone; uploads only moved from
// queued or reading on to reading, done or failed; every earlier item
// unchanged; new items only from an import. Then the save is sent once more
// with the fresh revision, quietly.
export function onlyReadProgress(
  before: Pick<Setup, "session" | "uploads" | "items">,
  after: Pick<Setup, "session" | "uploads" | "items">,
): boolean {
  const b = before.session,
    a = after.session;
  if (!b || !a || b.id !== a.id || a.state !== "open") return false;
  if (
    b.mainPack !== a.mainPack ||
    b.extraPacks.join(",") !== a.extraPacks.join(",")
  )
    return false;
  if (before.uploads.length !== after.uploads.length) return false;
  const moved: Record<string, string[]> = {
    queued: ["reading", "done", "failed"],
    reading: ["done", "failed"],
  };
  for (const u of after.uploads) {
    const old = before.uploads.find((x) => x.id === u.id);
    if (!old) return false;
    if (old.state !== u.state && !moved[old.state]?.includes(u.state))
      return false;
  }
  const fresh = new Map(after.items.map((i) => [i.id, i]));
  for (const i of before.items) {
    const now = fresh.get(i.id);
    if (!now || itemShape(now) !== itemShape(i)) return false;
  }
  const old = new Set(before.items.map((i) => i.id));
  return after.items.every((i) => old.has(i.id) || i.source === "import");
}

// After a save is refused as stale: may it go once more, quietly? `base` is
// the view the save was built on, taken just before it was sent, and
// `sentRevision` the revision it carried; `fresh` is the view read after
// the refusal. Only when the base matches what was sent and the only change
// since is a document being read. Comparing with a view that landed while
// the save was in flight (a poll showing another tab's edit) would let the
// retry overwrite that edit.
export function quietRetry(
  base: Pick<Setup, "session" | "uploads" | "items">,
  sentRevision: number,
  fresh: Pick<Setup, "session" | "uploads" | "items">,
): boolean {
  return base.session?.revision === sentRevision && onlyReadProgress(base, fresh);
}


// A field saved only on leave, Enter or an explicit flush (autosave with no
// debounce: the price field) is not sent when the tab is hidden or the page
// goes away: a half-typed price would be sent and confirm its row. A
// debounced field is sent then, so typed text is not lost.
export const sendsWhenHidden = (o: { debounce: boolean }) => o.debounce;
// The same field is not sent when it unmounts either: its value is dropped.
// Blur, Enter and the explicit flush before apply or another stage are the
// only senders. A debounced field is sent on unmount.
export const sendsOnUnmount = (o: { debounce: boolean }) => o.debounce;

// The review page ignores confirming and destructive taps while its layout
// settles: for SETTLE_MS after the last touch (an action starting, or the
// rows or their layout changing), so a tap meant for one control never lands
// on whatever moved under the finger.
export const SETTLE_MS = 500;
export const settleReady = (lastTouch: number, now: number) =>
  now - lastTouch >= SETTLE_MS;
export type Settle = {
  touch: (now: number) => void;
  ready: (now: number) => boolean;
};
// The page's one guard; never touched yet means ready.
export function createSettle(): Settle {
  let last = -Infinity;
  return {
    touch: (now) => {
      last = Math.max(last, now);
    },
    ready: (now) => settleReady(last, now),
  };
}
// What the review page shows that moves its controls: the items with their
// state, outcome and flag, and the files with their state. A change touches
// the guard.
export function layoutKey(
  view: {
    items: readonly Pick<SetupItem, "id" | "state" | "outcome" | "needsCheck">[];
    uploads: readonly Pick<SetupUpload, "id" | "state">[];
  },
): string {
  return [
    ...view.items.map((i) => `${i.id}:${i.state}:${i.outcome ?? ""}:${i.needsCheck ? 1 : 0}`),
    ...view.uploads.map((u) => `${u.id}:${u.state}`),
  ].join("|");
}

// ---- Review: price rows ----------------------------------------------------

// The most a price may be, in sen (the server's own ceiling).
export const MAX_PRICE_SEN = 100_000_000_000;
// One apply writes or updates at most this many price rows; more refuses the
// whole setup (KNOWLEDGE_LIMIT).
export const APPLY_ROW_LIMIT = LIMITS.catalogueBatch;

const grouped = (whole: number) =>
  String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// "RM 80.00" (thousands grouped: "RM 1,200.00"); "" for no price.
export function priceText(sen: number | null): string {
  if (sen === null || !Number.isInteger(sen) || sen < 0) return "";
  return `RM ${grouped(Math.floor(sen / 100))}.${String(sen % 100).padStart(2, "0")}`;
}

// What the price field shows: "80.00", never grouped, so it reads back the
// same; "" for no price.
export function amountText(sen: number | null): string {
  if (sen === null || !Number.isInteger(sen) || sen < 0) return "";
  return `${Math.floor(sen / 100)}.${String(sen % 100).padStart(2, "0")}`;
}

// The price field's text: empty (no price), a price in sen, or "invalid".
// Full-width digits, letters and full stop (a Chinese keyboard) are read as
// their plain forms first (NFKC), and the ideographic full stop as a point. Accepts "80", "80.5", "80.50", "RM 80.50",
// "rm80", "1,200.50" (commas only in groups of three); refuses negatives, a
// decimal comma, more than two decimals, a price above MAX_PRICE_SEN and
// anything else.
export function readPrice(text: string): number | null | "invalid" {
  // The ideographic full stop (U+3002) is a decimal point too.
  const t = text.normalize("NFKC").replace(/\u3002/g, ".").trim();
  if (!t) return null;
  const m = /^(?:rm\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i.exec(t);
  if (!m) return "invalid";
  const whole = Number(m[1]!.replace(/,/g, ""));
  const sen = whole * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(sen) && sen <= MAX_PRICE_SEN ? sen : "invalid";
}

// A price in sen, or null for empty or invalid text.
export function parsePrice(text: string): number | null {
  const v = readPrice(text);
  return v === "invalid" ? null : v;
}

export type RowPayload = {
  item: string;
  variant: string;
  priceSen: number | null;
  unit: string;
  notes: string;
  uploadId: string | null;
};
// A price row's stored payload, read without trusting it.
export function rowPayload(payload: unknown): RowPayload {
  const p = (payload ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    item: text(p.item),
    variant: text(p.variant),
    priceSen:
      typeof p.priceSen === "number" && Number.isInteger(p.priceSen)
        ? p.priceSen
        : null,
    unit: text(p.unit),
    notes: text(p.notes),
    uploadId: typeof p.uploadId === "string" ? p.uploadId : null,
  };
}
// The name a sentence or a label uses: item, then variant.
export const rowName = (p: Pick<RowPayload, "item" | "variant">) =>
  [p.item.trim(), p.variant.trim()].filter(Boolean).join(" ");

// Live price rows of the view (pending or confirmed, with an outcome).
export const liveRows = (items: readonly SetupItem[]) =>
  items.filter(
    (i) =>
      i.kind === "catalogue_row" &&
      i.outcome !== undefined &&
      (i.state === "pending" || i.state === "confirmed"),
  );

// The brief's order: flagged rows first, then document order.
export function rowOrder<T extends Pick<SetupItem, "needsCheck" | "state" | "position">>(
  items: readonly T[],
): T[] {
  const flagged = (i: T) => (i.needsCheck && i.state === "pending" ? 0 : 1);
  return [...items].sort(
    (a, b) => flagged(a) - flagged(b) || (a.position ?? 0) - (b.position ?? 0),
  );
}

// The key of a "Use new" choice on a price row: the row and the saved price
// it matches. A rename that makes the row match another saved price (or
// none) leaves the old choice behind, so it no longer counts.
export const choiceKey = (i: Pick<SetupItem, "id" | "current">) =>
  `${i.id}@${i.current?.id ?? ""}`;

// "Use new" price rows to send with applySetup: live rows that match a saved
// price (a conflict in the view) and that the owner set to "new" for that
// saved price. A row that no longer conflicts (its price was cleared) is
// left out; its choice is kept, so it counts again if the row conflicts
// again with the same saved price.
export function priceReplace(
  items: readonly SetupItem[],
  choices: Readonly<Record<string, "keep" | "new">>,
): string[] {
  return liveRows(items)
    .filter(
      (i) =>
        i.outcome === "conflict" && i.current && choices[choiceKey(i)] === "new",
    )
    .map((i) => i.id);
}

// Choosing for one conflicting price row. "Use new" is exclusive among rows
// that match the same saved price: choosing it on one sets the others back
// to "keep" (only one can replace it). Returns every choice to set, by
// choiceKey.
export function chooseRow(
  items: readonly SetupItem[],
  id: string,
  choice: "keep" | "new",
): [string, "keep" | "new"][] {
  const me = items.find((i) => i.id === id);
  if (!me) return [];
  const out: [string, "keep" | "new"][] = [[choiceKey(me), choice]];
  const target = me.current?.id;
  if (choice !== "new" || !target) return out;
  for (const i of liveRows(items))
    if (i.id !== id && i.current?.id === target) out.push([choiceKey(i), "keep"]);
  return out;
}

export type RowSection = "check" | "conflict" | "duplicate" | "ready";
// Where a row is listed when the page is entered: rows that need the owner
// (flagged, no price), then rows that match a saved price, then duplicates,
// then the rest by file. The view's outcome (nothing replaced) decides the
// conflict section; the live plan decides the rest.
export function rowSection(
  viewOutcome: SetupItem["outcome"],
  live: RowPlan["outcome"] | undefined,
): RowSection {
  if (viewOutcome === "conflict") return "conflict";
  const o = live ?? viewOutcome;
  if (o === "unconfirmed" || o === "no_price") return "check";
  if (o === "duplicate") return "duplicate";
  return "ready";
}

export type RowGroups<T> = {
  check: T[];
  conflict: T[];
  duplicate: T[];
  // One group per upload (oldest first), then rows whose upload is gone
  // (uploadId null): confirmed rows stay after their file is removed.
  files: { uploadId: string | null; rows: T[] }[];
};
// The fresh display grouping, each group in document order.
export function groupRows<T extends SetupItem>(
  items: readonly T[],
  plans: readonly Pick<RowPlan, "id" | "outcome">[],
  uploadIds: readonly string[],
): RowGroups<T> {
  const live = new Map(plans.map((p) => [p.id, p.outcome]));
  const groups: RowGroups<T> = {
    check: [],
    conflict: [],
    duplicate: [],
    files: uploadIds.map((uploadId) => ({ uploadId, rows: [] })),
  };
  const orphans: T[] = [];
  const rows = (liveRows(items) as T[]).sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  );
  for (const i of rows) {
    const s = rowSection(i.outcome, live.get(i.id));
    if (s !== "ready") {
      groups[s].push(i);
      continue;
    }
    const upload = rowPayload(i.payload).uploadId;
    const file = groups.files.find((f) => f.uploadId === upload);
    if (file) file.rows.push(i);
    else orphans.push(i);
  }
  if (orphans.length) groups.files.push({ uploadId: null, rows: orphans });
  return groups;
}

// The list as ids, kept for the whole visit to the review page.
export type RowLayout = {
  check: string[];
  conflict: string[];
  duplicate: string[];
  files: { uploadId: string | null; ids: string[] }[];
};
export const layoutOf = (g: RowGroups<Pick<SetupItem, "id">>): RowLayout => ({
  check: g.check.map((i) => i.id),
  conflict: g.conflict.map((i) => i.id),
  duplicate: g.duplicate.map((i) => i.id),
  files: g.files.map((f) => ({ uploadId: f.uploadId, ids: f.rows.map((i) => i.id) })),
});

// The order is stable for the visit: it is worked out when the page is
// entered (no earlier layout) and then never changes for rows already
// listed, whatever the owner confirms, edits or removes (a row changes its
// look in place; a removed one keeps its place). Rows that appear later
// (a document finished reading) are added to the section the fresh layout
// gives them, in document order among the rows there; groups of new files
// come after the existing ones, before the removed-file group.
export function stableLayout(
  prev: RowLayout | null,
  fresh: RowLayout,
  positions: ReadonlyMap<string, number>,
): RowLayout {
  if (!prev) return fresh;
  const known = new Set([
    ...prev.check,
    ...prev.conflict,
    ...prev.duplicate,
    ...prev.files.flatMap((f) => f.ids),
  ]);
  const insert = (list: string[], id: string) => {
    const p = positions.get(id) ?? Infinity;
    const at = list.findIndex((x) => {
      const q = positions.get(x);
      return q !== undefined && q > p;
    });
    if (at < 0) list.push(id);
    else list.splice(at, 0, id);
  };
  const next: RowLayout = {
    check: [...prev.check],
    conflict: [...prev.conflict],
    duplicate: [...prev.duplicate],
    files: prev.files.map((f) => ({ uploadId: f.uploadId, ids: [...f.ids] })),
  };
  for (const s of ["check", "conflict", "duplicate"] as const)
    for (const id of fresh[s]) if (!known.has(id)) insert(next[s], id);
  for (const f of fresh.files) {
    const added = f.ids.filter((id) => !known.has(id));
    let group = next.files.find((g) => g.uploadId === f.uploadId);
    if (!group) {
      // A new file gets its group (and heading) at once, rows or not.
      if (f.uploadId === null && !added.length) continue;
      group = { uploadId: f.uploadId, ids: [] };
      const orphans = next.files.findIndex((g) => g.uploadId === null);
      if (f.uploadId !== null && orphans >= 0) next.files.splice(orphans, 0, group);
      else next.files.push(group);
    }
    for (const id of added) insert(group.ids, id);
  }
  return next;
}

export type RowStatus = "check" | "no_price" | "conflict" | "duplicate" | "ready" | "update";
export type RowActions = {
  status: RowStatus;
  // Confirm as it is (a flagged, named row with a price, still pending).
  confirm: boolean;
  // Keep current / Use new.
  choice: boolean;
  // "Use this one instead" (a duplicate that does not match a saved price).
  useThis: boolean;
  // The small "Confirmed" mark.
  confirmed: boolean;
};
// What one row offers, from the view's outcome, the live plan's outcome, its
// state and whether it has a name (the server refuses to confirm a row
// without one). Edit (the price field included) and Remove are always
// offered.
export function rowActions(
  viewOutcome: SetupItem["outcome"],
  live: RowPlan["outcome"] | undefined,
  state: SetupItem["state"],
  named = true,
): RowActions {
  const o = live ?? viewOutcome;
  const choice = viewOutcome === "conflict";
  const status: RowStatus = choice
    ? "conflict"
    : o === "unconfirmed"
      ? "check"
      : o === "no_price"
        ? "no_price"
        : o === "duplicate"
          ? "duplicate"
          : o === "update"
            ? "update"
            : "ready";
  return {
    status,
    confirm: status === "check" && state === "pending" && named,
    choice,
    useThis: status === "duplicate",
    confirmed: state === "confirmed",
  };
}

export type RowEditValues = Partial<
  Pick<RowPayload, "item" | "variant" | "unit" | "notes" | "priceSen">
>;
export type RowChange = {
  payload: RowEditValues;
  state?: "pending";
};
// The request for an edit of a price row: only the fields that changed
// (text compared trimmed). Clearing the price of a confirmed row also sends
// state "pending" (a confirmed row must have a price). null when nothing
// changed; "NAME_REQUIRED" when the name would be empty (never sent).
export function rowChanges(
  stored: RowPayload,
  state: SetupItem["state"],
  next: RowEditValues,
): RowChange | null | "NAME_REQUIRED" {
  const payload: RowEditValues = {};
  for (const k of ["item", "variant", "unit", "notes"] as const) {
    const v = next[k];
    if (v === undefined) continue;
    const t = v.trim();
    if (k === "item" && !t) return "NAME_REQUIRED";
    if (t !== stored[k].trim()) payload[k] = t;
  }
  if (next.priceSen !== undefined && next.priceSen !== stored.priceSen)
    payload.priceSen = next.priceSen;
  if (!Object.keys(payload).length) return null;
  return payload.priceSen === null && state === "confirmed"
    ? { payload, state: "pending" }
    : { payload };
}

// "Use this one instead" on a duplicate: the writes that make this row the
// one saved, worked out with the planner. Confirming it is enough when it is
// pending (a confirmed row beats an untouched one); otherwise the row that
// wins is removed, and the next one if that still does not do it.
export function useThisSteps(
  items: readonly SetupItem[],
  replace: readonly string[],
  id: string,
): { id: string; state: "confirmed" | "removed" }[] {
  const outcome = (list: readonly SetupItem[]) =>
    planFromView(list, replace).plans.find((p) => p.id === id);
  const me = items.find((i) => i.id === id);
  if (!me) return [];
  if (me.state === "pending") {
    const confirmed = items.map((i) =>
      i.id === id ? { ...i, state: "confirmed" as const, needsCheck: false } : i,
    );
    if (outcome(confirmed)?.outcome !== "duplicate")
      return [{ id, state: "confirmed" }];
  }
  const steps: { id: string; state: "removed" }[] = [];
  let list = items;
  for (let n = 0; n < items.length; n++) {
    const p = outcome(list);
    if (!p || p.outcome !== "duplicate" || !p.duplicateOf) break;
    const winner = p.duplicateOf;
    steps.push({ id: winner, state: "removed" });
    list = list.map((i) =>
      i.id === winner ? { ...i, state: "removed" as const, outcome: undefined } : i,
    );
  }
  return steps;
}

// Price rows that still need the owner (flagged, or no price): what
// "Remove all N that still need checking" removes.
export const needCheckIds = (plans: readonly Pick<RowPlan, "id" | "outcome">[]) =>
  plans
    .filter((p) => p.outcome === "unconfirmed" || p.outcome === "no_price")
    .map((p) => p.id);

// Checked again from the latest view just before each write of "Remove all
// that still need checking": the row is still pending and still needs the
// owner. A row the owner confirmed or priced meanwhile is kept.
export function bulkRemovable(
  items: readonly SetupItem[],
  replace: readonly string[],
  id: string,
): boolean {
  const it = items.find((i) => i.id === id);
  if (!it || it.kind !== "catalogue_row" || it.state !== "pending") return false;
  const o = planFromView(items, replace).plans.find((p) => p.id === id)?.outcome;
  return o === "unconfirmed" || o === "no_price";
}

// A file this browser is sending (the upload manager's row).
export type SendingFile = {
  uploadId: string | null;
  name: string;
  phase: SendPhase;
};
// Files whose prices are not in yet. `reading`: the server has them waiting
// for the reader or being read. `sending`: this browser is still preparing,
// waiting to send or sending them (not yet created, not yet listed, or
// listed as uploading with this browser's sender alive). A failed or
// finished send counts as neither.
export function filesNotIn(
  uploads: readonly Pick<SetupUpload, "id" | "state" | "kind" | "name">[],
  senders: readonly SendingFile[],
  w: Words,
): { reading: string[]; sending: string[] } {
  const reading = uploads
    .filter((u) => u.state === "queued" || u.state === "reading")
    .map((u) => uploadName(u, w));
  const sending = senders
    .filter((s) => {
      if (s.phase !== "waiting" && s.phase !== "preparing" && s.phase !== "sending")
        return false;
      const u = s.uploadId ? uploads.find((x) => x.id === s.uploadId) : undefined;
      return !u || u.state === "uploading";
    })
    .map((s) => s.name);
  return { reading, sending };
}

// Whether apply would write a fact (apply skips a fact whose field does not
// belong to its pack, as unknown_field). Hours and first words always count.
export function factKnown(
  packs: readonly { id: string; facts: readonly { key: string }[] }[],
  i: Pick<SetupItem, "kind" | "payload">,
): boolean {
  if (i.kind !== "fact") return true;
  const p = (i.payload ?? {}) as { packId?: unknown; fieldKey?: unknown };
  return !!packs
    .find((x) => x.id === p.packId)
    ?.facts.some((f) => f.key === p.fieldKey);
}

export type ApplySummary = {
  // Every id for applySetup's replace, once each: answers and prices set to
  // "Use new".
  replace: string[];
  plans: RowPlan[];
  totals: RowTotals;
  counts: {
    prices: number;
    answers: number;
    checkPrices: number;
    checkAnswers: number;
    duplicates: number;
    // Files whose prices are not in yet, by screen name.
    reading: string[];
    sending: string[];
  };
};
// What the apply button will do with the view as it is and the owner's
// choices, following apply's own skip rules: price rows from the planner;
// answers (facts, hours, first words) unless removed, flagged and pending,
// matching a saved answer the owner keeps, or (when packs are given) a fact
// whose field is not in its pack.
export function applySummary(
  view: Pick<Setup, "items" | "conflicts" | "uploads">,
  choices: Readonly<Record<string, "keep" | "new">>,
  w: Words,
  o: {
    senders?: readonly SendingFile[];
    packs?: readonly { id: string; facts: readonly { key: string }[] }[];
  } = {},
): ApplySummary {
  const answerIds = replaceIds(view.conflicts, view.items, choices);
  const prices = priceReplace(view.items, choices);
  const { plans, totals } = planFromView(view.items, prices);
  const replace = [...new Set([...answerIds, ...prices])];
  const kept = new Set(
    view.conflicts.map((c) => c.itemId).filter((id) => !replace.includes(id)),
  );
  const answers = view.items.filter(
    (i) =>
      i.kind !== "catalogue_row" &&
      (i.state === "pending" || i.state === "confirmed"),
  );
  const flagged = (i: SetupItem) => i.needsCheck && i.state === "pending";
  const known = (i: SetupItem) => !o.packs || factKnown(o.packs, i);
  return {
    replace,
    plans,
    totals,
    counts: {
      prices: totals.willWrite,
      answers: answers.filter((i) => !flagged(i) && !kept.has(i.id) && known(i))
        .length,
      checkPrices: plans.filter(
        (p) => p.outcome === "unconfirmed" || p.outcome === "no_price",
      ).length,
      checkAnswers: answers.filter((i) => flagged(i) && known(i)).length,
      duplicates: totals.duplicates,
      ...filesNotIn(view.uploads, o.senders ?? [], w),
    },
  };
}

// More price rows than one apply may write: the button is disabled.
export const overLimit = (totals: Pick<RowTotals, "willWrite">) =>
  totals.willWrite > APPLY_ROW_LIMIT;
export const overLimitText = (w: Words) =>
  w(
    `More than ${APPLY_ROW_LIMIT} prices would be saved at once, the most one setup allows. Remove a file or some rows first.`,
    `Lebih ${APPLY_ROW_LIMIT} harga akan disimpan serentak. Had bagi satu persediaan ialah ${APPLY_ROW_LIMIT}. Buang satu fail atau beberapa baris dahulu.`,
  );

type Counts = ApplySummary["counts"];

// The apply button. With a price section (price rows or files on the page)
// it says what it will save; without one, or with nothing to save, the old
// text.
export function applyButtonText(c: Counts, w: Words, priced = true): string {
  const prices = w(
    c.prices === 1 ? "1 price" : `${c.prices} prices`,
    `${c.prices} harga`,
  );
  const answers = w(
    c.answers === 1 ? "1 answer" : `${c.answers} answers`,
    `${c.answers} jawapan`,
  );
  if (priced && c.prices && c.answers)
    return w(
      `Save ${prices} and ${answers}, try a call`,
      `Simpan ${prices} dan ${answers}, cuba buat panggilan`,
    );
  if (priced && (c.prices || c.answers)) {
    const what = c.prices ? prices : answers;
    return w(`Save ${what}, try a call`, `Simpan ${what}, cuba buat panggilan`);
  }
  return w("Looks right, try a call", "Semua betul, cuba buat panggilan");
}

// The line under the button: what will be left out. "" when nothing is.
export function leftOutText(c: Counts, w: Words): string {
  const parts: string[] = [];
  if (c.checkPrices)
    parts.push(
      c.checkPrices === 1
        ? w(
            "1 price still needs checking and will not be saved.",
            "1 harga masih perlu disemak dan tidak akan disimpan.",
          )
        : w(
            `${c.checkPrices} prices still need checking and will not be saved.`,
            `${c.checkPrices} harga masih perlu disemak dan tidak akan disimpan.`,
          ),
    );
  if (c.checkAnswers)
    parts.push(
      c.checkAnswers === 1
        ? w(
            "1 answer still needs checking and will not be saved.",
            "1 jawapan masih perlu disemak dan tidak akan disimpan.",
          )
        : w(
            `${c.checkAnswers} answers still need checking and will not be saved.`,
            `${c.checkAnswers} jawapan masih perlu disemak dan tidak akan disimpan.`,
          ),
    );
  if (c.duplicates)
    parts.push(
      c.duplicates === 1
        ? w("1 duplicate is left out.", "1 pendua tidak dimasukkan.")
        : w(
            `${c.duplicates} duplicates are left out.`,
            `${c.duplicates} pendua tidak dimasukkan.`,
          ),
    );
  return parts.join(" ");
}

// The question asked once before applying, when anything that still needs
// checking would be lost or a file's prices are not in yet; null when there
// is nothing to ask. Duplicates alone do not ask: the same item is saved.
export function applyConfirmText(c: Counts, w: Words): string | null {
  const parts: string[] = [];
  if (c.checkPrices)
    parts.push(
      c.checkPrices === 1
        ? w("1 price will not be saved.", "1 harga tidak akan disimpan.")
        : w(
            `${c.checkPrices} prices will not be saved.`,
            `${c.checkPrices} harga tidak akan disimpan.`,
          ),
    );
  if (c.checkAnswers)
    parts.push(
      c.checkAnswers === 1
        ? w("1 answer will not be saved.", "1 jawapan tidak akan disimpan.")
        : w(
            `${c.checkAnswers} answers will not be saved.`,
            `${c.checkAnswers} jawapan tidak akan disimpan.`,
          ),
    );
  const lost = parts.length > 0;
  if (lost)
    parts.push(
      w(
        c.checkPrices + c.checkAnswers === 1
          ? "You cannot come back to it after this."
          : "You cannot come back to them after this.",
        "Anda tidak boleh menyemaknya semula selepas ini.",
      ),
    );
  for (const name of c.sending)
    parts.push(
      w(
        `${name} is still being sent. Prices from it will not be included if you save now.`,
        `${name} masih dihantar. Harga dalam fail itu tidak akan dimasukkan jika anda simpan sekarang.`,
      ),
    );
  for (const name of c.reading)
    parts.push(
      w(
        `${name} is still being read. Prices from it will not be included if you save now.`,
        `${name} masih dibaca. Harga dalam fail itu tidak akan dimasukkan jika anda simpan sekarang.`,
      ),
    );
  if (!parts.length) return null;
  parts.push(lost ? w("Save the rest?", "Simpan selebihnya?") : w("Save now?", "Simpan sekarang?"));
  return parts.join(" ");
}

// After the owner answers the question: ask again (with the new counts)
// when more would now be left out than when it was asked: more prices or
// answers that still need checking, or a file not in yet that was not named.
export function askAgain(asked: Counts, now: Counts): boolean {
  const named = new Set([...asked.reading, ...asked.sending]);
  return (
    now.checkPrices > asked.checkPrices ||
    now.checkAnswers > asked.checkAnswers ||
    [...now.reading, ...now.sending].some((n) => !named.has(n))
  );
}

// The status words of one row.
export function rowStatusText(
  a: Pick<RowActions, "status">,
  w: Words,
): string {
  switch (a.status) {
    case "check":
      return w("Please check", "Sila semak");
    case "no_price":
      return w("No price found", "Harga tidak ditemui");
    case "conflict":
      return w("Matches a saved price", "Sama dengan harga sedia ada");
    case "duplicate":
      return w("Duplicate", "Pendua");
    case "update":
      return w("Will replace the current price", "Akan menggantikan harga sedia ada");
    case "ready":
      return w("Will be saved", "Akan disimpan");
  }
}

// Why a row or fact was flagged: the reader's own words (English, from the
// model) after "Reason:", or a plain sentence of ours when it gave none
// (naming a price for a price row, an answer for a fact).
export function checkReason(
  reason: string | null,
  w: Words,
  price = true,
): { label: string; text: string; reader: boolean } {
  const text = reason?.trim();
  return text
    ? { label: w("Reason:", "Sebab:"), text, reader: true }
    : {
        label: w("Reason:", "Sebab:"),
        text: price
          ? w(
              "JomCall was not sure about this one.",
              "JomCall kurang pasti tentang harga ini.",
            )
          : w(
              "JomCall was not sure about this one.",
              "JomCall kurang pasti tentang jawapan ini.",
            ),
        reader: false,
      };
}

// "Now: Kopi O RM 70.00. New: RM 80.00" for a row matching a saved price.
export function conflictText(
  current: { item: string; priceSen: number | null },
  priceSen: number | null,
  w: Words,
): string {
  const none = w("no price", "tiada harga");
  const now = priceText(current.priceSen) || none;
  const next = priceText(priceSen) || none;
  return w(
    `Now: ${current.item} ${now}. New: ${next}`,
    `Sedia ada: ${current.item} ${now}. Baharu: ${next}`,
  );
}

// "Same as Kopi O RM 80.00; this one will not be saved."
export function duplicateText(
  winner: Pick<RowPayload, "item" | "variant" | "priceSen"> | null,
  w: Words,
): string {
  const name = winner
    ? [rowName(winner), priceText(winner.priceSen)].filter(Boolean).join(" ")
    : w("another row", "baris lain");
  return w(
    `Same as ${name}; this one will not be saved.`,
    `Sama seperti ${name}; yang ini tidak akan disimpan.`,
  );
}

// The "Use this one instead" button, which says when it removes the other
// copy.
export const useThisText = (removes: boolean, w: Words) =>
  removes
    ? w(
        "Use this one instead and remove the other copy",
        "Guna yang ini dan buang pendua yang satu lagi",
      )
    : w("Use this one instead", "Guna yang ini");

// "Remove all N that still need checking": the question, the progress and
// the end, each with its own singular ("none": the run ended with nothing
// removed and nothing failed).
export function bulkText(
  step: "ask" | "progress" | "done" | "stopped" | "none",
  n: { done: number; total: number },
  w: Words,
): string {
  switch (step) {
    case "ask":
      return n.total === 1
        ? w(
            "Remove 1 price that still needs checking? It will not be saved.",
            "Buang 1 harga yang masih perlu disemak? Harga itu tidak akan disimpan.",
          )
        : w(
            `Remove ${n.total} prices that still need checking? They will not be saved.`,
            `Buang ${n.total} harga yang masih perlu disemak? Harga itu tidak akan disimpan.`,
          );
    case "progress":
      return w(
        `Removing ${n.done} of ${n.total}…`,
        `Membuang ${n.done} daripada ${n.total}…`,
      );
    case "done":
      return n.done === 1
        ? w("1 price removed", "1 harga dibuang")
        : w(`${n.done} prices removed`, `${n.done} harga dibuang`);
    case "none":
      return w(
        "No prices were removed. They no longer need checking.",
        "Tiada harga dibuang. Harga itu tidak lagi perlu disemak.",
      );
    case "stopped":
      return n.done
        ? w(
            `Stopped after removing ${n.done} of ${n.total}. Try again.`,
            `Terhenti selepas membuang ${n.done} daripada ${n.total}. Cuba lagi.`,
          )
        : w(
            "Could not remove them. Try again.",
            "Harga tidak dapat dibuang. Cuba lagi.",
          );
  }
}

// Remove tapped on a row or answer that its queued check then skipped: it
// was removed or saved meanwhile.
export const skippedText = (name: string, w: Words) =>
  w(
    `${name} was not removed: it changed meanwhile.`,
    `${name} tidak dibuang kerana telah berubah.`,
  );

// The "Remove all" slot keeps its place once shown: the button's words, and
// the plain line under it (why it is unavailable, or what it does).
export function bulkSlot(
  n: number,
  w: Words,
): { label: string; hint: string; enabled: boolean } {
  if (n >= 2)
    return {
      label: w(
        `Remove all ${n} that still need checking`,
        `Buang semua ${n} yang masih perlu disemak`,
      ),
      hint: w(
        "Prices removed here are not saved.",
        "Harga yang dibuang di sini tidak disimpan.",
      ),
      enabled: true,
    };
  return {
    label: w(
      "Remove all that still need checking",
      "Buang semua yang masih perlu disemak",
    ),
    hint:
      n === 1
        ? w(
            "Only 1 price still needs checking. Use Remove on its row.",
            "Hanya 1 harga yang masih perlu disemak. Tekan Buang pada barisnya.",
          )
        : w(
            "No prices need checking now.",
            "Tiada harga yang perlu disemak sekarang.",
          ),
    enabled: false,
  };
}

// The answer card's mark and check state for a fact read from a document.
export const factFlagged = (i: Pick<SetupItem, "needsCheck" | "state">) =>
  i.needsCheck && i.state === "pending";
