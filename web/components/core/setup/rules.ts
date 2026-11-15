// Pure decisions of the guided setup screens, kept apart so they can be
// tested without a browser.

import {
  UPLOAD_LIMITS,
  type SetupUpload,
} from "../../../../packages/contracts/src/setup-upload";

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
// What the file picker offers. Images include the camera on phones.
export const ACCEPT =
  "image/*,application/pdf,.pdf,.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values";

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

// Refusals made in the browser, before anything is sent, and the server's
// refusals of a file, each with one plain sentence.
export type Refusal =
  | "EXCEL"
  | "TYPE"
  | "EMPTY"
  | "SPLIT"
  | "LIST_TOO_LONG"
  | "PHOTO_FORMAT"
  | "PHOTO_TOO_BIG";

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
        "Fail ini lebih besar daripada 10 MB. Pecahkan kepada fail yang lebih kecil dan tambah satu demi satu.",
      );
    case "LIST_TOO_LONG":
      return w(
        "This list is too long. Paste only the price columns, or split it into smaller files.",
        "Senarai ini terlalu panjang. Tampal lajur harga sahaja, atau pecahkan kepada fail yang lebih kecil.",
      );
    case "PHOTO_FORMAT":
      return w(
        "This photo format is not supported. Take a screenshot of it, or save it as JPEG.",
        "Format foto ini tidak disokong. Ambil tangkapan skrin foto itu, atau simpan sebagai JPEG.",
      );
    case "PHOTO_TOO_BIG":
      return w(
        "This photo is still too large after making it smaller. Take a screenshot of it and add that instead.",
        "Foto ini masih terlalu besar walaupun sudah dikecilkan. Ambil tangkapan skrin foto itu dan tambah yang itu.",
      );
  }
}

// The server's answer to an upload request, when it has its own sentence;
// null for anything the shared error text covers. UPLOAD_RATE means the
// daily cap when creating, and the 30 chunk writes when sending a chunk.
export function requestErrorText(
  code: string,
  step: "create" | "chunk" | "finish" | "paste" | "remove",
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
            "Fail ini telah dihantar terlalu banyak kali. Buang dan tambah semula.",
          )
        : w(
            "Your workspace has added 20 files in the last 24 hours, the most allowed. Try again later, or answer the questions instead.",
            "Ruang kerja anda telah menambah 20 fail dalam 24 jam lalu, iaitu had maksimum. Cuba lagi kemudian, atau jawab soalan sahaja.",
          );
    case "READER_OFF":
      return failText("READER_OFF", w);
    default:
      return null;
  }
}

// One plain sentence per reason a read failed.
export function failText(code: string | null, w: Words): string {
  switch (code) {
    case "TOO_LONG":
      return w(
        "Too long to read. Split it into smaller files.",
        "Terlalu panjang untuk dibaca. Pecahkan kepada fail yang lebih kecil.",
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
        "Muat naik ini terganggu. Tambah semula.",
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

// The state line under one upload, from the server's record alone. While
// this browser is sending it, the screen shows sendingLabel instead; an
// upload still "uploading" without a sender here was cut off (a reload or a
// closed tab) and cannot be resumed.
export function uploadLabel(u: UploadView, w: Words): string {
  switch (u.state) {
    case "uploading":
      return w(
        "This upload was interrupted. Remove it and add the file again.",
        "Muat naik ini terganggu. Buang dan tambah fail itu semula.",
      );
    case "queued":
      return w("Waiting to be read", "Menunggu untuk dibaca");
    case "reading":
      return w("Reading…", "Sedang membaca…");
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
              `${prices} harga dan ${facts} fakta ditemui`,
            )
          : prices
            ? w(
                `${plural(prices, "price", "prices")} found`,
                `${prices} harga ditemui`,
              )
            : facts
              ? w(
                  `${plural(facts, "fact", "facts")} found`,
                  `${facts} fakta ditemui`,
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
export type SendPhase = "preparing" | "sending" | "failed" | "sent";
export function sendingLabel(
  s: { phase: SendPhase; seq: number; total: number },
  w: Words,
): string {
  if (s.phase === "preparing") return w("Preparing…", "Menyediakan…");
  if (s.phase === "failed") return w("Sending failed", "Penghantaran gagal");
  if (s.phase === "sent")
    return w("Waiting to be read", "Menunggu untuk dibaca");
  const n = Math.min(s.seq + 1, s.total);
  return w(`Sending ${n} of ${s.total}`, `Menghantar ${n} daripada ${s.total}`);
}

// The pasted-text upload's stored name is English; the screen names it.
export const uploadName = (u: Pick<SetupUpload, "kind" | "name">, w: Words) =>
  u.kind === "text" ? w("Pasted text", "Teks ditampal") : u.name;

// A file name the server accepts: no control or direction-override
// characters, at most 200 UTF-16 units, never empty.
export function safeName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "")
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

// The view is polled while any upload waits for the reader or is being read.
export const readingNow = (uploads: readonly Pick<SetupUpload, "state">[]) =>
  uploads.some((u) => u.state === "queued" || u.state === "reading");

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
// all (offline, lost response), a server error, or a timeout.
export const retryable = (status: number | null) =>
  status === null || status === 408 || status >= 500;
