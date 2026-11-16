import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPT,
  IMAGE_BYTES,
  SHRINK_STEPS,
  TEXT_FILE_BYTES,
  bringFirst,
  failText,
  fileKind,
  fitSize,
  isExcel,
  jpegName,
  mergeUploads,
  namePrefill,
  needsSniff,
  noRoomText,
  onlyReadProgress,
  retryOffered,
  sendFailureText,
  senderShown,
  sniffKind,
  stalled,
  queuedBusy,
  firstSeenQueued,
  quietRetry,
  tooLong,
  pollDelay,
  readingNow,
  refusalText,
  replaceIds,
  requestErrorText,
  retryable,
  safeName,
  sendingLabel,
  sizeProblem,
  slotsLeft,
  splitPlan,
  unlocksPublish,
  uploadLabel,
  uploadName,
} from "../../web/components/core/setup/rules.ts";
import {
  APPLY_ROW_LIMIT,
  amountText,
  applyButtonText,
  applyConfirmText,
  applySummary,
  askAgain,
  askAgainWhy,
  reasonParts,
  bulkRemovable,
  bulkSlot,
  bulkText,
  checkReason,
  choiceKey,
  chooseRow,
  conflictText,
  duplicateText,
  factFlagged,
  factKnown,
  filesNotIn,
  groupRows,
  layoutOf,
  leftOutText,
  sendsOnUnmount,
  sendsWhenHidden,
  stableLayout,
  SETTLE_MS,
  createSettle,
  layoutKey,
  settleReady,
  skippedText,
  useThisText,
  needCheckIds,
  overLimit,
  overLimitText,
  parsePrice,
  priceReplace,
  priceText,
  readPrice,
  rowActions,
  rowChanges,
  rowName,
  rowOrder,
  rowPayload,
  rowSection,
  rowStatusText,
  useThisSteps,
} from "../../web/components/core/setup/rules.ts";
import { planFromView } from "../../packages/domain/src/setup/rows.ts";
import { sendChunks, untilAborted, within } from "../../web/components/core/setup/upload.ts";
import type { SetupUploadState } from "../../packages/contracts/src/setup-upload.ts";
import type { Setup, SetupItem } from "../../packages/contracts/src/setup.ts";
import type { KnownUpload } from "../../web/components/core/setup/rules.ts";
import { CoreError, ProxyError, failureOf } from "../../web/lib/core/client.ts";

const done = [{ state: "completed" }];

test("publish unlocks only from a draft test created after the finish stage opened", () => {
  const baseline = new Set(["old"]);
  assert.equal(
    unlocksPublish(baseline, { id: "new", source: "draft", turns: done }),
    true,
  );
  // A session listed when the stage opened never counts, even with new answers.
  assert.equal(
    unlocksPublish(baseline, { id: "old", source: "draft", turns: done }),
    false,
  );
  // No baseline (it could not be loaded): no unlock.
  assert.equal(
    unlocksPublish(null, { id: "new", source: "draft", turns: done }),
    false,
  );
  assert.equal(
    unlocksPublish(baseline, { id: "new", source: "published", turns: done }),
    false,
  );
  assert.equal(
    unlocksPublish(baseline, {
      id: "new",
      source: "draft",
      turns: [{ state: "running" }, { state: "failed" }],
    }),
    false,
  );
  assert.equal(unlocksPublish(baseline, null), false);
});

test("polling is every 3 s for a minute, then every 10 s", () => {
  assert.equal(pollDelay(0), 3000);
  assert.equal(pollDelay(59_999), 3000);
  assert.equal(pollDelay(60_000), 10_000);
});

test("only a question that fills business_name alone is prefilled with the name", () => {
  assert.equal(
    namePrefill(["facts.business_name"], undefined, "Kedai Contoh"),
    "Kedai Contoh",
  );
  assert.equal(
    namePrefill(["facts.business_name", "rules.x"], undefined, "Kedai Contoh"),
    "Kedai Contoh",
  );
  assert.equal(
    namePrefill(
      ["facts.business_name", "facts.what_we_do"],
      undefined,
      "Kedai Contoh",
    ),
    "",
  );
  assert.equal(
    namePrefill(["facts.business_name"], { state: "pending" }, "Kedai Contoh"),
    "",
  );
  // A skipped (removed) answer is not an answer: the name comes back.
  assert.equal(
    namePrefill(["facts.business_name"], { state: "removed" }, "Kedai Contoh"),
    "Kedai Contoh",
  );
  assert.equal(namePrefill(["facts.address"], undefined, "Kedai Contoh"), "");
});

test("only live items chosen as Use new are sent in replace", () => {
  const conflicts = [{ itemId: "a" }, { itemId: "b" }, { itemId: "c" }];
  const items = [
    { id: "a", state: "pending" },
    { id: "b", state: "removed" },
    { id: "c", state: "pending" },
  ];
  assert.deepEqual(
    replaceIds(conflicts, items, { a: "new", b: "new", c: "keep" }),
    ["a"],
  );
});

const MiB = 1024 * 1024;
const en = (a: string) => a;
const ms = (_: string, b: string) => b;

test("a file is split into chunks of at most 3 MiB, at most 10 MiB in all", () => {
  assert.deepEqual(splitPlan(0), []);
  assert.deepEqual(splitPlan(-1), []);
  assert.deepEqual(splitPlan(1.5), []);
  assert.deepEqual(splitPlan(1), [1]);
  assert.deepEqual(splitPlan(3 * MiB), [3 * MiB]);
  assert.deepEqual(splitPlan(3 * MiB + 1), [3 * MiB, 1]);
  assert.deepEqual(splitPlan(10_485_760), [3 * MiB, 3 * MiB, 3 * MiB, MiB]);
  assert.deepEqual(splitPlan(10_485_761), []);
  for (const n of [1, 3 * MiB + 1, 7_000_000, 10_485_760]) {
    const plan = splitPlan(n);
    assert.equal(plan.reduce((a, b) => a + b, 0), n);
    assert.ok(plan.length <= 10 && plan.every((c) => c > 0 && c <= 3 * MiB));
  }
});

test("file kind comes from the name first, then the type", () => {
  assert.equal(fileKind("menu.jpg", ""), "image");
  assert.equal(fileKind("IMG_0001.HEIC", ""), "image");
  assert.equal(fileKind("scan", "image/png"), "image");
  assert.equal(fileKind("Harga.PDF", ""), "pdf");
  assert.equal(fileKind("doc", "application/pdf"), "pdf");
  assert.equal(fileKind("prices.csv", ""), "sheet");
  assert.equal(fileKind("prices.tsv", ""), "sheet");
  assert.equal(fileKind("notes.txt", ""), "sheet");
  assert.equal(fileKind("list", "text/csv"), "sheet");
  assert.equal(fileKind("list", "text/plain"), "sheet");
  assert.equal(fileKind("list", "text/tab-separated-values"), "sheet");
  assert.equal(fileKind("book.xlsx", ""), "excel");
  assert.equal(fileKind("letter.docx", ""), null);
  assert.equal(fileKind("archive.zip", "application/zip"), null);
  assert.equal(fileKind("noname", ""), null);
});

test("Excel is detected by extension and by type, but a .csv name wins", () => {
  for (const name of ["a.xlsx", "a.XLS", "a.xlsm", "a.xlsb"])
    assert.equal(isExcel(name, ""), true, name);
  assert.equal(isExcel("a", "application/vnd.ms-excel"), true);
  assert.equal(
    isExcel(
      "a",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    true,
  );
  // Windows browsers report CSV files as Excel.
  assert.equal(isExcel("prices.csv", "application/vnd.ms-excel"), false);
  assert.equal(fileKind("prices.csv", "application/vnd.ms-excel"), "sheet");
  assert.equal(isExcel("menu.pdf", "application/pdf"), false);
  assert.equal(isExcel("photo.jpg", "image/jpeg"), false);
});

test("size checks: empty, a text list over 1 MiB, a PDF over 10 MiB", () => {
  assert.equal(sizeProblem("image", 0), "EMPTY");
  assert.equal(sizeProblem("pdf", 0), "EMPTY");
  assert.equal(sizeProblem("sheet", TEXT_FILE_BYTES), null);
  assert.equal(sizeProblem("sheet", TEXT_FILE_BYTES + 1), "LIST_TOO_LONG");
  assert.equal(sizeProblem("pdf", 10_485_760), null);
  assert.equal(sizeProblem("pdf", 10_485_761), "SPLIT");
  // Photos are shrunk before they are sent.
  assert.equal(sizeProblem("image", 40 * MiB), null);
  assert.equal(TEXT_FILE_BYTES, 1_048_576);
  assert.equal(IMAGE_BYTES, 3_600_000);
});

test("photos shrink to 2,400 px at 0.85, then lower quality, then 1,600 px", () => {
  assert.deepEqual(
    SHRINK_STEPS.map((s) => [s.side, s.quality]),
    [
      [2400, 0.85],
      [2400, 0.7],
      [2400, 0.5],
      [1600, 0.5],
    ],
  );
  assert.deepEqual(fitSize(4032, 3024, 2400), [2400, 1800]);
  assert.deepEqual(fitSize(3024, 4032, 2400), [1800, 2400]);
  assert.deepEqual(fitSize(1200, 800, 2400), [1200, 800]);
  assert.deepEqual(fitSize(10000, 1, 1600), [1600, 1]);
  assert.match(ACCEPT, /image\/\*/);
  for (const t of [".pdf", ".csv", ".tsv", ".txt"]) assert.ok(ACCEPT.includes(t));
  assert.doesNotMatch(ACCEPT, /xls/);
});

test("file names are cleaned for the server, and a shrunk photo is named .jpg", () => {
  assert.equal(safeName("  menu.pdf "), "menu.pdf");
  assert.equal(safeName("a\u202eb\u0007c.csv"), "abc.csv");
  assert.equal(safeName("\u0001"), "file");
  assert.equal(safeName("x".repeat(300)).length, 200);
  // Never half a surrogate pair at the cut.
  const cut = safeName("x".repeat(199) + "😀");
  assert.equal(cut, "x".repeat(199));
  assert.equal(jpegName("IMG_1.HEIC"), "IMG_1.jpg");
  assert.equal(jpegName("menu"), "menu.jpg");
  assert.equal(jpegName(".png"), "photo.jpg");
  assert.ok(jpegName("y".repeat(300) + ".png").length <= 200);
});

const upload = {
  state: "done" as const,
  failCode: null,
  rowCount: 12,
  factCount: 3,
  droppedCount: 0,
};

test("upload labels for every state in both languages", () => {
  const cases: [Parameters<typeof uploadLabel>[0], string, string][] = [
    [
      { ...upload, state: "uploading" },
      "Sending this file was interrupted. Remove it and add the file again.",
      "Muat naik fail ini terputus. Buang, kemudian tambah fail itu semula.",
    ],
    [{ ...upload, state: "queued" }, "Waiting to be read", "Menunggu untuk dibaca"],
    [{ ...upload, state: "reading" }, "Reading…", "Sedang dibaca…"],
    [upload, "12 prices and 3 details found", "12 harga dan 3 butiran ditemui"],
    [
      { ...upload, rowCount: 1, factCount: 1 },
      "1 price and 1 detail found",
      "1 harga dan 1 butiran ditemui",
    ],
    [{ ...upload, factCount: 0 }, "12 prices found", "12 harga ditemui"],
    [{ ...upload, rowCount: 0 }, "3 details found", "3 butiran ditemui"],
    [
      { ...upload, droppedCount: 2 },
      "12 prices and 3 details found · 2 rows could not be read",
      "12 harga dan 3 butiran ditemui · 2 baris tidak dapat dibaca",
    ],
    [
      { ...upload, rowCount: 0, factCount: 0 },
      "Nothing found in this file. Try a clearer photo, or answer the questions instead.",
      "Tiada apa-apa ditemui dalam fail ini. Cuba foto yang lebih jelas, atau jawab soalan sahaja.",
    ],
    [{ ...upload, state: "removed" }, "Removed", "Dibuang"],
  ];
  for (const [u, e, m] of cases) {
    assert.equal(uploadLabel(u, en), e);
    assert.equal(uploadLabel(u, ms), m);
  }
});

test("on the review page, file lines drop the bring stage's offers; a CSV or text file is not a photo", () => {
  // The 24-hour limit, when a create still in flight is refused after the
  // owner left the bring stage.
  assert.match(sendFailureText(429, "UPLOAD_RATE", "create", en), /or answer the questions instead\.$/);
  assert.equal(
    sendFailureText(429, "UPLOAD_RATE", "create", en, true),
    "Your workspace has added 10 files in the last 24 hours, the most allowed. Try again later.",
  );
  assert.equal(
    sendFailureText(429, "UPLOAD_RATE", "create", ms, true),
    "Ruang kerja anda sudah menambah 10 fail dalam 24 jam yang lalu, iaitu had maksimum. Cuba lagi kemudian.",
  );
  const t = Date.UTC(2026, 10, 15, 9);
  const queued = { ...upload, state: "queued" as const };
  assert.equal(uploadLabel(queued, en, t + 11 * 60_000, t, true), "Still waiting to be read.");
  assert.equal(uploadLabel(queued, ms, t + 11 * 60_000, t, true), "Masih menunggu untuk dibaca.");
  const none = { ...upload, rowCount: 0, factCount: 0 };
  assert.equal(
    uploadLabel(none, en, undefined, undefined, true),
    "Nothing found in this file. Try a clearer photo.",
  );
  assert.equal(
    uploadLabel(none, ms, undefined, undefined, true),
    "Tiada apa-apa ditemui dalam fail ini. Cuba foto yang lebih jelas.",
  );
  for (const kind of ["sheet", "text"] as const)
    for (const review of [false, true]) {
      assert.equal(
        uploadLabel({ ...none, kind }, en, undefined, undefined, review),
        "Nothing found in this file. Check the file and add it again, or paste the text.",
      );
      assert.equal(
        uploadLabel({ ...none, kind }, ms, undefined, undefined, review),
        "Tiada apa-apa ditemui dalam fail ini. Semak fail itu dan tambah semula, atau tampal teksnya.",
      );
      assert.equal(
        failText("UNREADABLE", en, { kind, review }),
        "Could not read this file. Check the file and add it again, or paste the text.",
      );
      assert.equal(
        failText("UNREADABLE", ms, { kind, review }),
        "Fail ini tidak dapat dibaca. Semak fail itu dan tambah semula, atau tampal teksnya.",
      );
    }
  const failed = { ...upload, state: "failed" as const, failCode: "READ_FAILED" };
  assert.equal(
    uploadLabel(failed, en, undefined, undefined, true),
    "Could not read this file. Remove it and try again.",
  );
  assert.equal(
    uploadLabel(failed, ms, undefined, undefined, true),
    "Fail ini tidak dapat dibaca. Buang dan cuba lagi.",
  );
  // A photo keeps the photo advice on review.
  assert.equal(
    failText("UNREADABLE", en, { kind: "image", review: true }),
    "Could not read this file. Try a clearer photo, or paste the text.",
  );
});

test("a failed read has one plain sentence per fail code, in both languages", () => {
  const codes: [string | null, string, string][] = [
    ["TOO_LONG", "Too long to read. Split it into smaller files.", "Terlalu panjang untuk dibaca. Pecahkan kepada beberapa fail yang lebih kecil."],
    ["UNREADABLE", "Could not read this file. Try a clearer photo, or paste the text.", "Fail ini tidak dapat dibaca. Cuba foto yang lebih jelas, atau tampal teksnya."],
    ["REFUSED", "Could not read this file. Remove it and try again, or answer the questions instead.", "Fail ini tidak dapat dibaca. Buang dan cuba lagi, atau jawab soalan sahaja."],
    ["READ_FAILED", "Could not read this file. Remove it and try again, or answer the questions instead.", "Fail ini tidak dapat dibaca. Buang dan cuba lagi, atau jawab soalan sahaja."],
    ["READER_OFF", "Document reading is not available right now.", "Pembacaan dokumen tidak tersedia buat masa ini."],
    ["ABANDONED", "Sending this file was interrupted. Remove it and add the file again.", "Muat naik fail ini terputus. Buang, kemudian tambah fail itu semula."],
    [
      "SESSION_CLOSED",
      "Setup was saved before this file finished reading, so nothing from it was added.",
      "Persediaan disimpan sebelum fail ini habis dibaca, jadi tiada apa-apa daripadanya ditambah.",
    ],
    ["UPLOAD_TOO_LONG", refusalText("LIST_TOO_LONG", en), refusalText("LIST_TOO_LONG", ms)],
    ["UPLOAD_TYPE", "This kind of file is not supported. Use a photo, a PDF or a CSV file.", "Jenis fail ini tidak disokong. Gunakan foto, PDF atau fail CSV."],
    ["UPLOAD_XLSX", refusalText("EXCEL", en), refusalText("EXCEL", ms)],
    [null, "Could not read this file.", "Fail ini tidak dapat dibaca."],
    ["SOMETHING_NEW", "Could not read this file.", "Fail ini tidak dapat dibaca."],
  ];
  for (const [code, e, m] of codes) {
    assert.equal(uploadLabel({ ...upload, state: "failed", failCode: code }, en), e);
    assert.equal(uploadLabel({ ...upload, state: "failed", failCode: code }, ms), m);
    assert.equal(failText(code, en), e);
  }
});

test("the Excel refusal says to paste the cells or save as CSV or PDF", () => {
  assert.equal(
    refusalText("EXCEL", en),
    "Excel files are not supported yet. Copy the cells in Excel and paste them here, or save the file as CSV or PDF.",
  );
  assert.equal(
    refusalText("EXCEL", ms),
    "Fail Excel belum disokong. Salin sel dalam Excel dan tampal di sini, atau simpan fail itu sebagai CSV atau PDF.",
  );
  assert.equal(requestErrorText("UPLOAD_XLSX", "finish", en), refusalText("EXCEL", en));
  assert.equal(
    refusalText("PHOTO_FORMAT", en),
    "This photo format is not supported. Take a screenshot of it, or save it as JPEG.",
  );
  assert.equal(
    refusalText("LIST_TOO_LONG", en),
    "This list is too long. Paste only the price columns, or split it into smaller files.",
  );
  for (const r of ["TYPE", "EMPTY", "SPLIT", "PHOTO_TOO_BIG"] as const) {
    assert.ok(refusalText(r, en).length > 0);
    assert.notEqual(refusalText(r, en), refusalText(r, ms));
  }
});

test("request errors: UPLOAD_RATE means the daily cap at create, the write cap at a chunk", () => {
  assert.match(requestErrorText("UPLOAD_RATE", "create", en)!, /10 files/);
  assert.match(requestErrorText("UPLOAD_RATE", "paste", ms)!, /10 fail/);
  assert.match(requestErrorText("UPLOAD_RATE", "chunk", en)!, /sent too many times/);
  assert.match(requestErrorText("UPLOAD_LIMIT", "create", en)!, /up to 5 files/);
  assert.equal(requestErrorText("UPLOAD_TYPE", "finish", en), refusalText("TYPE", en));
  assert.equal(requestErrorText("UPLOAD_TOO_LARGE", "create", en), refusalText("SPLIT", en));
  assert.equal(requestErrorText("READER_OFF", "create", en), failText("READER_OFF", en));
  assert.equal(requestErrorText("NOT_FOUND", "remove", en), null);
});

test("sending labels count chunks from 1", () => {
  assert.equal(sendingLabel({ phase: "sending", seq: 1, total: 4 }, en), "Sending 2 of 4");
  assert.equal(sendingLabel({ phase: "sending", seq: 1, total: 4 }, ms), "Menghantar 2 daripada 4");
  assert.equal(sendingLabel({ phase: "preparing", seq: 0, total: 0 }, en), "Preparing…");
  assert.equal(sendingLabel({ phase: "failed", seq: 2, total: 4 }, en), "Sending failed");
  assert.equal(sendingLabel({ phase: "failed", seq: 2, total: 4 }, ms), "Gagal dihantar");
  assert.equal(sendingLabel({ phase: "sent", seq: 3, total: 4 }, en), "Waiting to be read");
});

test("pasted text is named on screen; other uploads keep their file name", () => {
  assert.equal(uploadName({ kind: "text", name: "Pasted text" }, ms), "Teks yang ditampal");
  assert.equal(uploadName({ kind: "text", name: "Pasted text" }, en), "Pasted text");
  assert.equal(uploadName({ kind: "pdf", name: "menu.pdf" }, ms), "menu.pdf");
});

test("five places per setup; polling only while a read is waiting or running", () => {
  assert.equal(slotsLeft(0), 5);
  assert.equal(slotsLeft(4), 1);
  assert.equal(slotsLeft(5), 0);
  assert.equal(slotsLeft(7), 0);
  const now = Date.parse("2026-11-15T00:05:00Z");
  const seen = new Map([["q", now - 60_000]]);
  assert.equal(readingNow([{ id: "d", state: "done" }, { id: "f", state: "failed" }], now, seen), false);
  assert.equal(readingNow([{ id: "u", state: "uploading" }], now, seen), false);
  assert.equal(readingNow([{ id: "d", state: "done" }, { id: "q", state: "queued" }], now, seen), true);
  assert.equal(readingNow([{ id: "r", state: "reading" }], now, seen), true);
  // A queued upload not yet noted is polled for.
  assert.equal(readingNow([{ id: "new", state: "queued" }], now, new Map()), true);
});

test("an upload queued for more than 10 minutes, by this browser's clock, is not polled for", () => {
  const t = Date.parse("2026-11-15T00:00:00Z");
  const queued = { ...upload, id: "q1", state: "queued" as const };
  assert.equal(stalled(queued, t + 10 * 60_000, t), false);
  assert.equal(stalled(queued, t + 10 * 60_000 + 1, t), true);
  assert.equal(stalled(queued, t + 3_600_000, undefined), false);
  assert.equal(stalled({ ...queued, state: "reading" }, t + 3_600_000, t), false);
  const seen = new Map([[queued.id, t]]);
  assert.equal(readingNow([queued], t + 11 * 60_000, seen), false);
  // Still being read: polled for however long it takes.
  assert.equal(readingNow([{ ...queued, state: "reading" }], t + 11 * 60_000, seen), true);
  assert.equal(uploadLabel(queued, en, t + 60_000, t), "Waiting to be read");
  assert.equal(
    uploadLabel(queued, en, t + 11 * 60_000, t),
    "Still waiting to be read. You can go on and come back later.",
  );
  assert.equal(
    uploadLabel(queued, ms, t + 11 * 60_000, t),
    "Masih menunggu untuk dibaca. Anda boleh teruskan dan kembali kemudian.",
  );
});

test("after 2 minutes queued, by this browser's clock, the line says reading is busy and the file is still polled for", () => {
  const t = Date.parse("2026-11-16T00:00:00Z");
  const queued = { ...upload, id: "q1", state: "queued" as const };
  assert.equal(queuedBusy(queued, t + 2 * 60_000, t), false);
  assert.equal(queuedBusy(queued, t + 2 * 60_000 + 1, t), true);
  assert.equal(queuedBusy(queued, t + 3_600_000, undefined), false);
  assert.equal(queuedBusy({ ...queued, state: "reading" }, t + 3_600_000, t), false);
  assert.equal(uploadLabel(queued, en, t + 2 * 60_000, t), "Waiting to be read");
  assert.equal(
    uploadLabel(queued, en, t + 3 * 60_000, t),
    "Lots of files are being read right now. Your file is waiting its turn; you can answer the questions meanwhile.",
  );
  assert.equal(
    uploadLabel(queued, ms, t + 3 * 60_000, t),
    "Banyak fail sedang dibaca sekarang. Fail anda sedang menunggu giliran; sementara itu, anda boleh jawab soalan.",
  );
  // On the review page the offer of the questions is dropped.
  assert.equal(
    uploadLabel(queued, en, t + 3 * 60_000, t, true),
    "Lots of files are being read right now. Your file is waiting its turn.",
  );
  assert.equal(
    uploadLabel(queued, ms, t + 3 * 60_000, t, true),
    "Banyak fail sedang dibaca sekarang. Fail anda sedang menunggu giliran.",
  );
  // Still polled for until the 10-minute limit; then the stalled line wins.
  const seen = new Map([[queued.id, t]]);
  assert.equal(readingNow([queued], t + 3 * 60_000, seen), true);
  assert.match(uploadLabel(queued, en, t + 11 * 60_000, t), /^Still waiting to be read\./);
  // No time is promised in any queued line.
  for (const at of [t + 60_000, t + 3 * 60_000, t + 11 * 60_000])
    for (const words of [en, ms])
      assert.doesNotMatch(uploadLabel(queued, words, at, t), /\d|second|minute|saat|minit/);
});

test("a phone clock 15 minutes fast does not stop polling for a fresh upload", () => {
  // The server created it at 00:00; the phone reads 00:15 when it first
  // sees it queued. Only the phone's own clock is compared.
  const server = Date.parse("2026-11-15T00:00:00Z");
  const phone = server + 15 * 60_000;
  const queued = { ...upload, id: "q1", state: "queued" as const, createdAt: new Date(server).toISOString() };
  let seen = firstSeenQueued(new Map(), [queued], phone);
  assert.equal(seen.get(queued.id), phone);
  assert.equal(readingNow([queued], phone + 1000, seen), true);
  assert.equal(uploadLabel(queued, en, phone + 1000, seen.get(queued.id)), "Waiting to be read");
  // Seeing it again later keeps the first time.
  seen = firstSeenQueued(seen, [queued], phone + 5 * 60_000);
  assert.equal(seen.get(queued.id), phone);
  assert.equal(readingNow([queued], phone + 10 * 60_000 + 1, seen), false);
  // Only queued uploads are noted.
  assert.equal(firstSeenQueued(new Map(), [{ id: "r", state: "reading" }], phone).size, 0);
});

test("the bring stage opens by itself only for an untouched session with reading on", () => {
  const base = { reader: "ready" as const, session: {}, uploads: [], items: [] };
  assert.equal(bringFirst(base), true);
  assert.equal(bringFirst({ ...base, reader: "off" }), false);
  assert.equal(bringFirst({ ...base, session: null }), false);
  assert.equal(bringFirst({ ...base, uploads: [{}] }), false);
  assert.equal(bringFirst({ ...base, items: [{}] }), false);
});

test("only no answer, a timeout or a server error is retried", () => {
  assert.equal(retryable(null), true);
  assert.equal(retryable(500), true);
  assert.equal(retryable(503), true);
  assert.equal(retryable(408), true);
  assert.equal(retryable(409), false);
  assert.equal(retryable(422), false);
  assert.equal(retryable(429), false);
});

test("Retry is offered only for a failure that sending again can fix", () => {
  assert.equal(retryOffered(null, null), true);
  assert.equal(retryOffered(502, "REQUEST_FAILED"), true);
  assert.equal(retryOffered(500, "INTERNAL"), true);
  assert.equal(retryOffered(429, "UPLOAD_RATE"), false);
  for (const code of [
    "CONFLICT",
    "UPLOAD_INCOMPLETE",
    "UPLOAD_SIZE_MISMATCH",
    "EMPTY_CHUNK",
    "OCTET_STREAM_REQUIRED",
  ])
    assert.equal(retryOffered(code === "CONFLICT" ? 409 : 422, code), false, code);
  assert.equal(retryOffered(413, "PAYLOAD_TOO_LARGE"), false);
  assert.equal(retryOffered(413, "REQUEST_FAILED"), false);
  // A proxy's page (not JSON): only when a later try may pass.
  assert.equal(retryOffered(502, "PROXY"), true);
  assert.equal(retryOffered(429, "PROXY"), true);
  assert.equal(retryOffered(408, "PROXY"), true);
  assert.equal(retryOffered(413, "PROXY"), false);
  assert.equal(retryOffered(403, "PROXY"), false);
});

test("every send failure has a plain sentence, never a raw code", () => {
  const broken = "Something went wrong sending this file. Remove it and add it again.";
  for (const [status, code] of [
    [409, "CONFLICT"],
    [409, "UPLOAD_INCOMPLETE"],
    [422, "UPLOAD_SIZE_MISMATCH"],
    [422, "EMPTY_CHUNK"],
    [413, "PAYLOAD_TOO_LARGE"],
    [415, "OCTET_STREAM_REQUIRED"],
    [404, "NOT_FOUND"],
    [413, "REQUEST_FAILED"],
    [422, "SOMETHING_NEW"],
  ] as const) {
    assert.equal(sendFailureText(status, code, "chunk", en), broken, code);
    assert.equal(
      sendFailureText(status, code, "finish", ms),
      "Ada masalah semasa menghantar fail ini. Buang dan tambah semula.",
    );
  }
  const offline = "Sending stopped. Check your connection, then try again.";
  assert.equal(sendFailureText(null, null, "chunk", en), offline);
  assert.equal(sendFailureText(502, "REQUEST_FAILED", "chunk", en), offline);
  assert.equal(
    sendFailureText(null, null, "chunk", ms),
    "Muat naik terhenti. Semak sambungan internet anda, kemudian cuba lagi.",
  );
  assert.equal(sendFailureText(429, "UPLOAD_RATE", "chunk", en), requestErrorText("UPLOAD_RATE", "chunk", en));
  // Delimited text over 1 MiB, refused at finish: the list's own sentence.
  assert.equal(sendFailureText(422, "UPLOAD_TOO_LONG", "finish", en), refusalText("LIST_TOO_LONG", en));
  assert.equal(
    refusalText("LIST_TOO_LONG", ms),
    "Senarai ini terlalu panjang. Tampal lajur harga sahaja, atau pecahkan kepada beberapa fail yang lebih kecil.",
  );
  assert.equal(sendFailureText(422, "UPLOAD_XLSX", "finish", en), refusalText("EXCEL", en));
  // Signed out or not allowed, from the app itself.
  assert.equal(
    sendFailureText(401, "UNAUTHORIZED", "create", en),
    "You are signed out. Sign in again, then add the file.",
  );
  assert.equal(
    sendFailureText(401, "UNAUTHORIZED", "chunk", ms),
    "Anda sudah log keluar. Log masuk semula, kemudian tambah fail itu.",
  );
  assert.equal(sendFailureText(403, "FORBIDDEN", "finish", en), "Only an owner or admin can add documents.");
  assert.equal(sendFailureText(403, "FORBIDDEN", "create", ms), "Hanya pemilik atau pentadbir boleh menambah dokumen.");
  // A proxy's page: 413 is "too large", a server error the connection
  // sentence, any other 4xx (also 401/403) the general one.
  assert.equal(sendFailureText(413, "PROXY", "chunk", en), "This file could not be sent because it is too large for the connection. Try a smaller file.");
  assert.equal(sendFailureText(413, "PROXY", "create", ms), "Fail ini tidak dapat dihantar kerana terlalu besar untuk sambungan ini. Cuba fail yang lebih kecil.");
  assert.equal(sendFailureText(502, "PROXY", "chunk", en), offline);
  assert.equal(sendFailureText(429, "PROXY", "finish", en), offline);
  assert.equal(sendFailureText(403, "PROXY", "chunk", en), broken);
  assert.equal(sendFailureText(401, "PROXY", "create", en), broken);
});

test("a failed Remove and a failed paste have their own sentences, never the sending ones", () => {
  const removeEn = "Could not remove this file. Try again.";
  const removeMs = "Fail ini tidak dapat dibuang. Cuba lagi.";
  for (const [status, code] of [[null, null], [502, "PROXY"], [500, "INTERNAL"], [409, "CONFLICT"]] as const) {
    assert.equal(sendFailureText(status, code, "remove", en), removeEn);
    assert.equal(sendFailureText(status, code, "remove", ms), removeMs);
  }
  assert.equal(
    sendFailureText(401, "UNAUTHORIZED", "remove", en),
    "You are signed out. Sign in again, then remove the file.",
  );
  assert.equal(sendFailureText(403, "FORBIDDEN", "remove", en), "Only an owner or admin can remove documents.");
  const pasteEn = "Could not add the pasted text. Try again.";
  for (const [status, code] of [[null, null], [502, "PROXY"], [413, "PROXY"], [500, "INTERNAL"]] as const)
    assert.equal(sendFailureText(status, code, "paste", en), pasteEn);
  assert.equal(sendFailureText(null, null, "paste", ms), "Teks yang ditampal tidak dapat ditambah. Cuba lagi.");
  // The paste's own refusals keep their sentences.
  assert.equal(sendFailureText(409, "UPLOAD_LIMIT", "paste", en), requestErrorText("UPLOAD_LIMIT", "paste", en));
  assert.equal(
    sendFailureText(401, "UNAUTHORIZED", "paste", en),
    "You are signed out. Sign in again, then paste the text again.",
  );
});

test("files beyond the places left are named in one sentence", () => {
  assert.equal(
    noRoomText(["a.jpg", "b.pdf"], en),
    "Not added: a.jpg, b.pdf. A setup holds up to 5 files; remove one to make room.",
  );
  assert.equal(
    noRoomText(["a.jpg"], ms),
    "Tidak ditambah: a.jpg. Satu persediaan boleh ada sehingga 5 fail; buang satu untuk memberi ruang.",
  );
});

test("a file with no type and no extension is judged by its first bytes, as on the server", () => {
  assert.equal(needsSniff("IMG_20261115", ""), true);
  assert.equal(needsSniff("menu.jpg", ""), false);
  assert.equal(needsSniff("menu", "image/jpeg"), false);
  const b = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16).fill(0)].slice(0, 16));
  const a = (s: string) => [...s].map((c) => c.charCodeAt(0));
  assert.equal(sniffKind(b(0xff, 0xd8, 0xff, 0xe0)), "image");
  assert.equal(sniffKind(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), "image");
  assert.equal(sniffKind(b(...a("RIFF"), 1, 2, 3, 4, ...a("WEBP"))), "image");
  assert.equal(sniffKind(b(...a("GIF89a"))), "image");
  assert.equal(sniffKind(b(0, 0, 0, 24, ...a("ftypheic"))), "image");
  assert.equal(sniffKind(b(0, 0, 0, 24, ...a("ftypmp42"))), null);
  assert.equal(sniffKind(b(...a("%PDF-1.7"))), "pdf");
  assert.equal(sniffKind(b(0x50, 0x4b, 0x03, 0x04)), "excel");
  assert.equal(sniffKind(b(...a("item,price"))), null);
  assert.equal(sniffKind(new Uint8Array(0)), null);
});

test("a very long picture (more than 4 to 1) is not uploaded", () => {
  assert.equal(tooLong(1080, 4320), false);
  assert.equal(tooLong(1080, 4321), true);
  assert.equal(tooLong(5000, 1000), true);
  assert.equal(tooLong(4000, 3000), false);
  assert.equal(
    refusalText("PHOTO_TOO_LONG", en),
    "This photo is very long. Crop it into shorter parts and add each part.",
  );
  assert.equal(
    refusalText("PHOTO_TOO_LONG", ms),
    "Gambar ini terlalu panjang. Potong kepada beberapa bahagian yang lebih pendek dan tambah setiap bahagian.",
  );
});

test("once the server lists an upload past uploading, its label wins over the local one", () => {
  assert.equal(senderShown(undefined), true);
  assert.equal(senderShown({ state: "uploading" }), true);
  for (const state of ["queued", "reading", "done", "failed", "removed"] as const)
    assert.equal(senderShown({ state }), false, state);
  assert.equal(sendingLabel({ phase: "waiting", seq: 0, total: 0 }, en), "Waiting to send");
  assert.equal(sendingLabel({ phase: "waiting", seq: 0, total: 0 }, ms), "Menunggu untuk dihantar");
});

const blobOf = (n: number) => new Blob([new Uint8Array(n)]);
const noWait = async () => {};

test("chunks go one after another, each retried twice with waits of 1 s then 4 s, then the send stops", async () => {
  const calls: [number, number][] = [];
  const waits: number[] = [];
  let failures = 3;
  const r = await sendChunks({
    blob: blobOf(10),
    sizes: [4, 4, 2],
    from: 0,
    writes: 0,
    put: async (seq, bytes) => {
      calls.push([seq, bytes.size]);
      if (seq === 1 && failures-- > 0) throw Error("offline");
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  // Chunk 1 tried three times (once plus two retries), then given up.
  assert.deepEqual(calls, [
    [0, 4],
    [1, 4],
    [1, 4],
    [1, 4],
  ]);
  assert.deepEqual(waits, [1000, 4000]);
  assert.equal(r.next, 1);
  assert.equal(r.writes, 4);
  assert.match(String(r.error), /offline/);
  // Retry resumes from the failed chunk with the same bytes.
  calls.length = 0;
  const again = await sendChunks({
    blob: blobOf(10),
    sizes: [4, 4, 2],
    from: r.next,
    writes: r.writes,
    put: async (seq, bytes) => {
      calls.push([seq, bytes.size]);
    },
    wait: noWait,
  });
  assert.deepEqual(calls, [
    [1, 4],
    [2, 2],
  ]);
  assert.deepEqual(again, { next: 3, writes: 6 });
});

test("a refusal is not retried, and an upload never gets more than 30 writes", async () => {
  let calls = 0;
  const refused = await sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 0,
    put: async () => {
      calls++;
      throw new CoreError("UPLOAD_SIZE_MISMATCH", 422);
    },
    wait: noWait,
  });
  assert.equal(calls, 1);
  assert.equal((refused.error as CoreError).code, "UPLOAD_SIZE_MISMATCH");
  calls = 0;
  const capped = await sendChunks({
    blob: blobOf(8),
    sizes: [4, 4],
    from: 0,
    writes: 29,
    put: async () => {
      calls++;
    },
    wait: noWait,
  });
  assert.equal(calls, 1);
  assert.equal(capped.next, 1);
  assert.equal(capped.writes, 30);
  assert.equal((capped.error as CoreError).code, "UPLOAD_RATE");
  // A server error counts each try towards the cap.
  calls = 0;
  const flaky = await sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 28,
    put: async () => {
      calls++;
      throw new CoreError("INTERNAL", 500);
    },
    wait: noWait,
  });
  assert.equal(calls, 2);
  assert.equal(flaky.writes, 30);
  assert.equal((flaky.error as CoreError).code, "UPLOAD_RATE");
});

test("a try that hangs times out, is aborted and retried; the last timeout fails the send", async () => {
  const signals: AbortSignal[] = [];
  let tries = 0;
  const r = await sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 0,
    // Never answers.
    put: (_seq, _bytes, signal) => {
      tries++;
      signals.push(signal);
      return new Promise(() => {});
    },
    attemptMs: 5,
    wait: noWait,
  });
  assert.equal(tries, 3);
  assert.ok(signals.every((s) => s.aborted), "each hung try is aborted");
  assert.match(String(r.error), /TIMEOUT/);
  assert.equal(r.next, 0);
  assert.equal(r.writes, 3);
  // A timeout then an answer: sent.
  let n = 0;
  const ok = await sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 0,
    put: () => (n++ === 0 ? new Promise(() => {}) : Promise.resolve()),
    attemptMs: 5,
    wait: noWait,
  });
  assert.deepEqual(ok, { next: 1, writes: 2 });
});

test("removing an upload stops its send at once: during a try, during a wait, or before the next chunk", async () => {
  // During a hung try.
  const during = new AbortController();
  let tryAborted = false;
  const p = sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 0,
    put: (_s, _b, signal) =>
      new Promise((_, fail) =>
        signal.addEventListener("abort", () => {
          tryAborted = true;
          fail(new Error("aborted"));
        }),
      ),
    signal: during.signal,
  });
  during.abort();
  const r1 = await p;
  assert.equal(r1.stopped, true);
  assert.equal(tryAborted, true);
  // During the wait before a retry (the real wait is used).
  const waiting = new AbortController();
  const started = Date.now();
  const p2 = sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 0,
    put: async () => {
      setTimeout(() => waiting.abort(), 10);
      throw Error("offline");
    },
    signal: waiting.signal,
  });
  const r2 = await p2;
  assert.equal(r2.stopped, true);
  assert.ok(Date.now() - started < 900, "did not sit out the 1 s wait");
  // Before the next chunk.
  const between = new AbortController();
  const seen: number[] = [];
  const r3 = await sendChunks({
    blob: blobOf(8),
    sizes: [4, 4],
    from: 0,
    writes: 0,
    put: async (seq) => {
      seen.push(seq);
      between.abort();
    },
    signal: between.signal,
  });
  assert.deepEqual(seen, [0]);
  assert.equal(r3.stopped, true);
  assert.equal(r3.next, 1);
});

const up = (id: string, state: SetupUploadState) => ({
  id,
  kind: "pdf" as const,
  name: id + ".pdf",
  bytes: 10,
  state,
  failCode: null,
  rowCount: 0,
  factCount: 0,
  droppedCount: 0,
  bytesDeletedAt: null,
  createdAt: "2026-11-15T00:00:00Z",
});
const knownOf = (entries: [string, KnownUpload][]) => new Map(entries);

test("an older view never moves an upload this browser just changed backwards", () => {
  // Finished here at request 5 (queued); a save's answer requested at 3
  // still says uploading.
  let r = mergeUploads([up("a", "uploading")], 3, knownOf([["a", { upload: up("a", "queued"), at: 5 }]]));
  assert.deepEqual(r.uploads.map((u) => u.state), ["queued"]);
  // The server catches up (or goes further): its copy wins.
  r = mergeUploads([up("a", "reading")], 6, r.known);
  assert.deepEqual(r.uploads.map((u) => u.state), ["reading"]);
  assert.equal((r.known.get("a")!.upload as { state: string }).state, "reading");
});

test("an out-of-order answer cannot move any row from done back to reading", () => {
  // Learned "done" from a view requested at 8; a slower view requested at 7
  // arrives later and still says reading.
  let r = mergeUploads([up("a", "done")], 8, new Map());
  r = mergeUploads([up("a", "reading")], 7, r.known);
  assert.deepEqual(r.uploads.map((u) => u.state), ["done"]);
});

test("a just-pasted upload missing from a view requested before it stays; after it, it goes", () => {
  const held = knownOf([["p", { upload: up("p", "queued"), at: 5 }]]);
  const older = mergeUploads([up("a", "done")], 4, held);
  assert.deepEqual(older.uploads.map((u) => u.id), ["a", "p"]);
  // A view requested after the paste no longer lists it: it is gone on the
  // server, so no phantom row is polled for ever.
  const newer = mergeUploads([up("a", "done")], 6, older.known);
  assert.deepEqual(newer.uploads.map((u) => u.id), ["a"]);
  assert.equal(newer.known.has("p"), false);
});

test("a removed upload does not come back from an older view", () => {
  const held = knownOf([["b", { upload: "removed", at: 5 }]]);
  let r = mergeUploads([up("a", "done"), up("b", "queued")], 4, held);
  assert.deepEqual(r.uploads.map((u) => u.id), ["a"]);
  assert.equal(r.known.has("b"), true);
  // Once a view requested after the removal no longer lists it, nothing is held.
  r = mergeUploads([up("a", "done")], 6, r.known);
  assert.deepEqual(r.uploads.map((u) => u.id), ["a"]);
  assert.equal(r.known.has("b"), false);
  // Nothing known: the server's list is shown as it is.
  assert.deepEqual(mergeUploads([up("a", "failed")], 1, new Map()).uploads, [up("a", "failed")]);
});

const item = (id: string, over: Partial<SetupItem> = {}): SetupItem => ({
  id,
  kind: "fact",
  key: "address",
  payload: { value: "Jalan Contoh 1" },
  source: "interview",
  needsCheck: false,
  checkReason: null,
  state: "pending",
  ...over,
});
const session = {
  id: "s1",
  mainPack: "appointment",
  extraPacks: [],
  state: "open" as const,
  revision: 4,
};
const viewOf = (over: Partial<Pick<Setup, "session" | "uploads" | "items">> = {}) => ({
  session,
  uploads: [up("u", "reading")],
  items: [item("i1")],
  ...over,
});

test("a file this window removed is not another window's change", () => {
  const row = (id: string, uploadId: string, state: SetupItem["state"] = "pending") =>
    item(id, { kind: "catalogue_row", key: `${uploadId}:${id}`, source: "import", state, payload: { uploadId, item: id } });
  const before = viewOf({
    uploads: [up("u", "done"), up("v", "done")],
    items: [item("i1"), row("r1", "u"), row("r2", "u", "removed"), row("r3", "u", "confirmed"), row("r4", "v")],
  });
  // Removing u deleted its pending and removed rows and its upload row.
  const after = viewOf({
    session: { ...session, revision: 5 },
    uploads: [up("v", "done")],
    items: [item("i1"), row("r3", "u", "confirmed"), row("r4", "v")],
  });
  assert.equal(onlyReadProgress(before, after, new Set(["u"])), true);
  assert.equal(quietRetry(before, 4, after, new Set(["u"])), true);
  // Not removed here: another window's change.
  assert.equal(onlyReadProgress(before, after), false);
  assert.equal(quietRetry(before, 4, after), false);
  // The view had already dropped the removed upload (held as removed).
  assert.equal(onlyReadProgress({ ...before, uploads: [up("v", "done")] }, after, new Set(["u"])), true);
  // A confirmed row of the removed file, or a row of another file, gone: not ours.
  assert.equal(
    onlyReadProgress(before, { ...after, items: [item("i1"), row("r4", "v")] }, new Set(["u"])),
    false,
  );
  assert.equal(
    onlyReadProgress(before, { ...after, items: [item("i1"), row("r3", "u", "confirmed")] }, new Set(["u"])),
    false,
  );
});

test("Retry is never offered while reading is switched off", () => {
  assert.equal(retryOffered(503, "READER_OFF"), false);
  assert.equal(retryOffered(503, "INTERNAL"), true);
});

test("stored uploads at the ceiling: its own sentence, the review page drops the questions offer, no Retry", () => {
  for (const step of ["create", "paste"] as const) {
    assert.equal(
      sendFailureText(503, "UPLOAD_STORE_FULL", step, en),
      "JomCall cannot take new files right now. Answer the questions instead, or try again tomorrow.",
    );
    assert.equal(
      sendFailureText(503, "UPLOAD_STORE_FULL", step, ms),
      "JomCall tidak dapat menerima fail baharu buat masa ini. Jawab soalan sahaja, atau cuba lagi esok.",
    );
    assert.equal(
      sendFailureText(503, "UPLOAD_STORE_FULL", step, en, true),
      "JomCall cannot take new files right now. Try again tomorrow.",
    );
    assert.equal(
      sendFailureText(503, "UPLOAD_STORE_FULL", step, ms, true),
      "JomCall tidak dapat menerima fail baharu buat masa ini. Cuba lagi esok.",
    );
  }
  assert.equal(retryOffered(503, "UPLOAD_STORE_FULL"), false);
});

test("our own reason sentences are said in Bahasa Melayu; the reader's words stay English", () => {
  const say = (r: string, w = ms) => reasonParts(r, w);
  assert.deepEqual(say("Only one of two readings found this row. Please check."), [
    { text: "Hanya satu daripada dua bacaan menemui baris ini. Sila semak.", own: true },
  ]);
  // Amounts kept; "no price" translated.
  assert.deepEqual(
    say("Two readings of this document gave different prices (RM 5.00 and no price). Please check."),
    [{ text: "Dua bacaan dokumen ini memberi harga yang berbeza (RM 5.00 dan tiada harga). Sila semak.", own: true }],
  );
  // The comparison's sentence, then the model's own words.
  assert.deepEqual(
    say("Two readings of this document gave different prices (RM 1,200.00 and RM 12.00). Please check. the 0 is smudged"),
    [
      { text: "Dua bacaan dokumen ini memberi harga yang berbeza (RM 1,200.00 dan RM 12.00). Sila semak.", own: true },
      { text: " ", own: true },
      { text: "the 0 is smudged", own: false },
    ],
  );
  assert.deepEqual(
    say("Two readings of this document gave different units for this price (per kg and per pack). Please check."),
    [{ text: "Dua bacaan dokumen ini memberi unit yang berbeza bagi harga ini (per kg dan per pack). Sila semak.", own: true }],
  );
  assert.deepEqual(say("The two readings named this row differently. Please check the name."), [
    { text: "Dua bacaan menamakan baris ini secara berbeza. Sila semak nama.", own: true },
  ]);
  assert.deepEqual(say("This document could only be read once. Please check every price."), [
    { text: "Dokumen ini hanya dapat dibaca sekali. Sila semak setiap harga.", own: true },
  ]);
  // The normaliser joins with "; ", setup_read adds "; listed twice".
  assert.deepEqual(say("price faded; No price was found for this item.; listed twice"), [
    { text: "price faded", own: false },
    { text: "; ", own: true },
    { text: "Tiada harga ditemui bagi item ini.", own: true },
    { text: "; ", own: true },
    { text: "disenaraikan dua kali", own: true },
  ]);
  assert.deepEqual(say("listed twice"), [{ text: "disenaraikan dua kali", own: true }]);
  assert.deepEqual(say("The price is outside the allowed range."), [
    { text: "Harga ini di luar julat yang dibenarkan.", own: true },
  ]);
  assert.deepEqual(say("JomCall was not sure about this row."), [
    { text: "JomCall kurang pasti tentang baris ini.", own: true },
  ]);
  assert.deepEqual(say("The reader was not sure about this value."), [
    { text: "JomCall kurang pasti tentang jawapan ini.", own: true },
  ]);
  // The model's words alone stay as they are.
  assert.deepEqual(say("menu photo is blurry"), [{ text: "menu photo is blurry", own: false }]);
  // English: our sentences unchanged.
  const r = "Two readings of this document gave different prices (RM 5.00 and RM 6.00). Please check.; listed twice";
  assert.equal(say(r, en).map((x) => x.text).join(""), r);
});

test("a save conflict is retried quietly only when a document's read is all that changed", () => {
  const before = viewOf();
  // The read finished: upload done, import rows added, revision raised.
  const read = viewOf({
    session: { ...session, revision: 5 },
    uploads: [{ ...up("u", "done"), rowCount: 2 }],
    items: [
      item("i1"),
      item("r1", { kind: "catalogue_row", key: "row", source: "import", outcome: "write" }),
    ],
  });
  assert.equal(onlyReadProgress(before, read), true);
  // Derived fields (outcome, duplicateOf, current) may change: still a read.
  assert.equal(
    onlyReadProgress(viewOf({ items: [item("i1", { outcome: "write" })] }), viewOf({ items: [item("i1", { outcome: "duplicate", duplicateOf: "x" })] })),
    true,
  );
  // Queued to reading, or to failed, is read progress too.
  assert.equal(onlyReadProgress(viewOf({ uploads: [up("u", "queued")] }), viewOf({ uploads: [up("u", "failed")] })), true);
  // Anything else is not.
  assert.equal(onlyReadProgress(before, viewOf({ items: [item("i1", { payload: { value: "Jalan Lain 2" } })] })), false, "edited item");
  assert.equal(onlyReadProgress(before, viewOf({ items: [item("i1", { state: "confirmed" })] })), false, "confirmed item");
  assert.equal(onlyReadProgress(before, viewOf({ items: [] })), false, "item gone");
  assert.equal(onlyReadProgress(before, viewOf({ items: [item("i1"), item("i2")] })), false, "interview item added");
  assert.equal(onlyReadProgress(before, viewOf({ uploads: [up("u", "reading"), up("v", "queued")] })), false, "upload added");
  assert.equal(onlyReadProgress(before, viewOf({ uploads: [] })), false, "upload gone");
  assert.equal(onlyReadProgress(viewOf({ uploads: [up("u", "done")] }), viewOf({ uploads: [up("u", "reading")] })), false, "backwards");
  assert.equal(onlyReadProgress(before, viewOf({ session: { ...session, id: "s2" } })), false, "other session");
  assert.equal(onlyReadProgress(before, viewOf({ session: { ...session, extraPacks: ["retail"] } })), false, "packs changed");
  assert.equal(onlyReadProgress(before, viewOf({ session: { ...session, state: "applied" } })), false, "applied");
  assert.equal(onlyReadProgress(before, viewOf({ session: null })), false, "no session");
});

test("a quiet retry compares with the save's own baseline, so a poll landing mid-write cannot hide another tab's edit", () => {
  // The save was built on revision 4 and sent with 4.
  const base = viewOf();
  // While it was in flight, a poll landed showing another tab's edit (and a
  // read finishing): revision 6. The save is refused; the reload shows the
  // same.
  const otherTab = viewOf({
    session: { ...session, revision: 6 },
    uploads: [up("u", "done")],
    items: [item("i1", { payload: { value: "Jalan Tab Lain 9" } })],
  });
  // The old check compared the poll's view with the reload: no difference.
  assert.equal(onlyReadProgress(otherTab, otherTab), true);
  // Against the save's own baseline, the other tab's edit shows: no retry.
  assert.equal(quietRetry(base, 4, otherTab), false);
  // Only a read finished since the baseline: retried once, quietly.
  const read = viewOf({
    session: { ...session, revision: 5 },
    uploads: [up("u", "done")],
    items: [item("i1"), item("r1", { kind: "catalogue_row", key: "row", source: "import" })],
  });
  assert.equal(quietRetry(base, 4, read), true);
  // A baseline that does not match the revision sent is never trusted.
  assert.equal(quietRetry(base, 3, read), false);
  assert.equal(quietRetry(viewOf({ session: null }), 4, read), false);
});

test("a create or finish that hangs times out as no answer; the job's abort stops it at once", async () => {
  let seen: AbortSignal | undefined;
  await assert.rejects(
    within(5, undefined, (signal) => {
      seen = signal;
      return new Promise(() => {});
    }),
    /TIMEOUT/,
  );
  assert.equal(seen?.aborted, true, "the hung request is aborted");
  assert.equal(failureOf(new Error("TIMEOUT")).status, null);
  assert.equal(retryOffered(null, null), true, "a timeout offers Retry");
  const job = new AbortController();
  const p = within(60_000, job.signal, () => new Promise(() => {}));
  job.abort();
  await assert.rejects(p, /ABORTED/);
  await assert.rejects(within(10, job.signal, async () => 1), /ABORTED/);
  assert.equal(await within(1000, undefined, async () => 7), 7);
});

test("a create still in flight when the row is removed stops the wait, and a late success is handed back to delete", async () => {
  const job = new AbortController();
  let land!: (v: { id: string }) => void;
  const request = new Promise<{ id: string }>((done) => (land = done));
  const late: string[] = [];
  const waiting = untilAborted(request, job.signal, (u) => late.push(u.id));
  job.abort();
  await assert.rejects(waiting, /ABORTED/);
  land({ id: "orphan-1" });
  await request;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(late, ["orphan-1"]);
  // Not aborted: the answer passes through and nothing is deleted.
  const fine = new AbortController();
  assert.deepEqual(await untilAborted(Promise.resolve({ id: "u" }), fine.signal, (u) => late.push(u.id)), { id: "u" });
  assert.deepEqual(late, ["orphan-1"]);
});

test("a proxy's 502 page is retried like a server error; its 413 page is not", async () => {
  let calls = 0;
  const r = await sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 0,
    put: async () => {
      calls++;
      throw new ProxyError(502);
    },
    wait: noWait,
  });
  assert.equal(calls, 3);
  assert.ok(r.error instanceof ProxyError);
  calls = 0;
  const big = await sendChunks({
    blob: blobOf(4),
    sizes: [4],
    from: 0,
    writes: 0,
    put: async () => {
      calls++;
      throw new ProxyError(413);
    },
    wait: noWait,
  });
  assert.equal(calls, 1);
  const f = failureOf(big.error);
  assert.equal(sendFailureText(f.status, f.code, "chunk", en), "This file could not be sent because it is too large for the connection. Try a smaller file.");
});

// ---- Review: price rows -----------------------------------------------------

const FILE_A = "00000000-0000-4000-8000-00000000000a";
const FILE_B = "00000000-0000-4000-8000-00000000000b";
const FILE_C = "00000000-0000-4000-8000-00000000000c";
let rowN = 0;
const priceRow = (
  item: string,
  o: {
    id?: string;
    priceSen?: number | null;
    state?: SetupItem["state"];
    flag?: boolean;
    reason?: string | null;
    outcome?: SetupItem["outcome"];
    position?: number;
    current?: { id: string; item: string; priceSen: number | null };
    upload?: string;
    variant?: string;
  } = {},
): SetupItem => {
  const n = ++rowN;
  return {
    id: o.id ?? `r${n}`,
    kind: "catalogue_row",
    key: `row:${n}`,
    payload: {
      uploadId: o.upload ?? FILE_A,
      item,
      variant: o.variant ?? "",
      priceSen: o.priceSen === undefined ? 8000 : o.priceSen,
      unit: "",
      notes: "",
    },
    source: "import",
    needsCheck: !!o.flag,
    checkReason: o.reason ?? (o.flag ? "the price is partly covered" : null),
    state: o.state ?? "pending",
    outcome: o.outcome ?? "write",
    position: o.position ?? n,
    ...(o.current ? { current: o.current } : {}),
  };
};
const factItem = (
  id: string,
  o: { state?: SetupItem["state"]; flag?: boolean; source?: SetupItem["source"]; kind?: SetupItem["kind"] } = {},
): SetupItem => ({
  id,
  kind: o.kind ?? "fact",
  key: id,
  payload: { packId: "every-business", fieldKey: id, value: "x" },
  source: o.source ?? "interview",
  needsCheck: !!o.flag,
  checkReason: null,
  state: o.state ?? "pending",
});

test("priceText shows RM with two decimals and groups thousands; amountText is the field's text", () => {
  assert.equal(priceText(8000), "RM 80.00");
  assert.equal(priceText(8050), "RM 80.50");
  assert.equal(priceText(5), "RM 0.05");
  assert.equal(priceText(0), "RM 0.00");
  assert.equal(priceText(120000), "RM 1,200.00");
  assert.equal(priceText(123456789), "RM 1,234,567.89");
  assert.equal(priceText(null), "");
  assert.equal(amountText(8000), "80.00");
  assert.equal(amountText(120000), "1200.00");
  assert.equal(amountText(null), "");
  // The field's text reads back as the same price.
  for (const sen of [0, 5, 8050, 120000, 99999999999])
    assert.equal(parsePrice(amountText(sen)), sen);
});

test("parsePrice accepts plain and RM prices and refuses anything else", () => {
  assert.equal(parsePrice("80"), 8000);
  assert.equal(parsePrice("80.5"), 8050);
  assert.equal(parsePrice("80.50"), 8050);
  assert.equal(parsePrice("RM 80.50"), 8050);
  assert.equal(parsePrice("rm80"), 8000);
  assert.equal(parsePrice("Rm 0.05"), 5);
  assert.equal(parsePrice("  12  "), 1200);
  assert.equal(parsePrice("1,200.50"), 120050);
  assert.equal(parsePrice("0"), 0);
  for (const bad of ["-5", "-0.50", "80.505", "1.234", "abc", "80,5", "12,34", ".5", "80.", "RM", "1 200", "8o", "1e3", "$80"])
    assert.equal(parsePrice(bad), null, bad);
  // Above the server's ceiling.
  assert.equal(parsePrice("1000000001"), null);
  assert.equal(parsePrice("1000000000"), 100000000000);
  // readPrice tells an empty field from text that is not a price.
  assert.equal(readPrice(""), null);
  assert.equal(readPrice("   "), null);
  assert.equal(readPrice("abc"), "invalid");
  assert.equal(readPrice("80"), 8000);
});

test("rowOrder puts flagged pending rows first, then document order", () => {
  const a = priceRow("A", { position: 0 });
  const b = priceRow("B", { position: 1, flag: true });
  const c = priceRow("C", { position: 2, flag: true, state: "confirmed" });
  const d = priceRow("D", { position: 3, flag: true });
  assert.deepEqual(rowOrder([a, b, c, d]).map((i) => i.payload && (i.payload as { item: string }).item), ["B", "D", "A", "C"]);
});

test("rows are grouped: need checking, then conflicts, then duplicates, then by file in document order", () => {
  const saved = { id: "cat1", item: "Kopi O", priceSen: 7000 };
  const items = [
    priceRow("Teh", { id: "t", position: 4, upload: FILE_B }),
    priceRow("Kopi O", { id: "k1", position: 0, outcome: "conflict", current: saved }),
    priceRow("Milo", { id: "m", position: 1, flag: true, outcome: "unconfirmed" }),
    priceRow("Roti", { id: "r", position: 2, priceSen: null, outcome: "no_price" }),
    priceRow("Teh", { id: "t2", position: 5, upload: FILE_B, outcome: "duplicate" }),
    priceRow("Nasi", { id: "n", position: 3 }),
    priceRow("Mee", { id: "gone", position: 6, upload: "00000000-0000-4000-8000-0000000000ff", state: "confirmed" }),
    { ...priceRow("Old", { id: "x", position: 7 }), state: "removed" as const, outcome: undefined },
    factItem("f1"),
  ];
  const { plans } = planFromView(items, []);
  const g = groupRows(items, plans, [FILE_A, FILE_B]);
  assert.deepEqual(g.check.map((i) => i.id), ["m", "r"]);
  assert.deepEqual(g.conflict.map((i) => i.id), ["k1"]);
  assert.deepEqual(g.duplicate.map((i) => i.id), ["t2"]);
  assert.deepEqual(
    g.files.map((f) => [f.uploadId, f.rows.map((i) => i.id)]),
    [
      [FILE_A, ["n"]],
      [FILE_B, ["t"]],
      // A confirmed row whose file was removed.
      [null, ["gone"]],
    ],
  );
  // "Use new" on the conflict keeps it in the conflict section.
  const live = planFromView(items, ["k1"]).plans;
  assert.equal(live.find((p) => p.id === "k1")?.outcome, "update");
  assert.deepEqual(groupRows(items, live, [FILE_A, FILE_B]).conflict.map((i) => i.id), ["k1"]);
  // A fresh grouping moves a confirmed row out of "check" (stableLayout is
  // what keeps it in place for the visit).
  const confirmed = items.map((i) => (i.id === "m" ? { ...i, state: "confirmed" as const, needsCheck: false } : i));
  const after = planFromView(confirmed, []).plans;
  assert.deepEqual(groupRows(confirmed, after, [FILE_A, FILE_B]).check.map((i) => i.id), ["r"]);
  assert.equal(rowSection("conflict", "update"), "conflict");
  assert.equal(rowSection("write", "duplicate"), "duplicate");
  assert.equal(rowSection("unconfirmed", undefined), "check");
  assert.equal(rowSection("write", "update"), "ready");
});

test("rows keep their section and place for the whole visit; later rows are added in their place", () => {
  const saved = { id: "cat1", item: "Kopi O", priceSen: 7000 };
  const items = [
    priceRow("Kopi O", { id: "k1", position: 0, outcome: "conflict", current: saved }),
    priceRow("Milo", { id: "m", position: 1, flag: true, outcome: "unconfirmed" }),
    priceRow("Roti", { id: "r", position: 3, priceSen: null, outcome: "no_price" }),
    priceRow("Nasi", { id: "n", position: 4 }),
    priceRow("Teh", { id: "t", position: 6, upload: FILE_B }),
  ];
  const fresh = (list: SetupItem[], uploads = [FILE_A, FILE_B], replace: string[] = []) =>
    layoutOf(groupRows(list, planFromView(list, replace).plans, uploads));
  const pos = (list: SetupItem[]) => new Map(list.map((i) => [i.id, i.position ?? 0]));
  // Entering the page: the fresh layout.
  const first = stableLayout(null, fresh(items), pos(items));
  assert.deepEqual(first, fresh(items));
  assert.deepEqual(first.check, ["m", "r"]);
  // Confirming, pricing, choosing "Use new" and removing move nothing.
  const changed = items
    .map((i) => (i.id === "m" ? { ...i, state: "confirmed" as const, needsCheck: false } : i))
    .map((i) => (i.id === "r" ? { ...i, payload: { ...(i.payload as object), priceSen: 500 } } : i))
    .map((i) => (i.id === "n" ? { ...i, state: "removed" as const, outcome: undefined } : i));
  const kept = stableLayout(first, fresh(changed, [FILE_A, FILE_B], ["k1"]), pos(changed));
  assert.deepEqual(kept, first);
  // A document finishes reading: its rows join the section the fresh layout
  // gives them, in document order among the rows already there; nothing
  // already listed moves.
  const more = [
    ...changed,
    priceRow("Ais", { id: "a", position: 2, flag: true, outcome: "unconfirmed" }),
    priceRow("Mee", { id: "e", position: 5 }),
    priceRow("Kek", { id: "c", position: 9, upload: FILE_C }),
  ];
  const grown = stableLayout(kept, fresh(more, [FILE_A, FILE_B, FILE_C], ["k1"]), pos(more));
  assert.deepEqual(grown.check, ["m", "a", "r"]);
  assert.deepEqual(grown.conflict, ["k1"]);
  assert.deepEqual(
    grown.files.map((f) => [f.uploadId, f.ids]),
    [
      [FILE_A, ["n", "e"]],
      [FILE_B, ["t"]],
      [FILE_C, ["c"]],
    ],
  );
  // A new file's heading shows at once, before its rows are read; the
  // removed-file group stays last.
  const orphan = priceRow("Lama", { id: "o", position: 7, upload: "00000000-0000-4000-8000-0000000000ff", state: "confirmed" });
  const withOrphan = stableLayout(null, fresh([...items, orphan]), pos([...items, orphan]));
  const newFile = stableLayout(withOrphan, fresh([...items, orphan], [FILE_A, FILE_B, FILE_C]), pos(items));
  assert.deepEqual(newFile.files.map((f) => f.uploadId), [FILE_A, FILE_B, FILE_C, null]);
  // No removed-file group appears without rows.
  assert.equal(stableLayout(first, fresh(items), pos(items)).files.some((f) => f.uploadId === null), false);
});

test("what a row offers follows its outcome and state", () => {
  assert.deepEqual(rowActions("unconfirmed", "unconfirmed", "pending"), {
    status: "check", confirm: true, choice: false, useThis: false, confirmed: false,
  });
  assert.deepEqual(rowActions("no_price", "no_price", "pending"), {
    status: "no_price", confirm: false, choice: false, useThis: false, confirmed: false,
  });
  // A confirmed row whose price was cleared: no price, still marked.
  assert.equal(rowActions("no_price", "no_price", "confirmed").confirmed, true);
  assert.deepEqual(rowActions("conflict", "conflict", "pending"), {
    status: "conflict", confirm: false, choice: true, useThis: false, confirmed: false,
  });
  // The choice stays after "Use new" (the live plan says update).
  assert.equal(rowActions("conflict", "update", "pending").choice, true);
  assert.deepEqual(rowActions("write", "duplicate", "pending"), {
    status: "duplicate", confirm: false, choice: false, useThis: true, confirmed: false,
  });
  assert.deepEqual(rowActions("write", "write", "confirmed"), {
    status: "ready", confirm: false, choice: false, useThis: false, confirmed: true,
  });
  assert.equal(rowActions("write", "update", "pending").status, "update");
  // The server refuses to confirm a row without a name: no Confirm.
  assert.equal(rowActions("unconfirmed", "unconfirmed", "pending", false).confirm, false);
  assert.equal(rowActions("unconfirmed", "unconfirmed", "pending", true).confirm, true);
});

test("a row edit sends only the fields that changed", () => {
  const stored = rowPayload({ uploadId: FILE_A, item: "Kopi O", variant: "Ais", priceSen: 8000, unit: "cawan", notes: "" });
  assert.equal(rowChanges(stored, "pending", {}), null);
  assert.equal(rowChanges(stored, "pending", { item: " Kopi O ", priceSen: 8000 }), null);
  assert.deepEqual(rowChanges(stored, "pending", { priceSen: 9000 }), { payload: { priceSen: 9000 } });
  assert.deepEqual(rowChanges(stored, "pending", { item: "Kopi O", variant: "Panas", unit: "cawan", notes: "" }), {
    payload: { variant: "Panas" },
  });
  assert.deepEqual(rowChanges(stored, "pending", { notes: "  kurang manis " }), { payload: { notes: "kurang manis" } });
  // Clearing the price: a confirmed row goes back to pending in the same request.
  assert.deepEqual(rowChanges(stored, "confirmed", { priceSen: null }), {
    payload: { priceSen: null },
    state: "pending",
  });
  assert.deepEqual(rowChanges(stored, "pending", { priceSen: null }), { payload: { priceSen: null } });
  assert.equal(rowChanges(stored, "pending", { item: "   " }), "NAME_REQUIRED");
});

test("Use new is exclusive among rows matching the same saved price", () => {
  const saved = { id: "cat1", item: "Kopi O", priceSen: 7000 };
  const items = [
    priceRow("Kopi O", { id: "a", outcome: "conflict", current: saved }),
    priceRow("kopi-o", { id: "b", outcome: "conflict", current: saved }),
    priceRow("Teh", { id: "c", outcome: "conflict", current: { id: "cat2", item: "Teh", priceSen: 300 } }),
  ];
  assert.deepEqual(chooseRow(items, "a", "new"), [["a@cat1", "new"], ["b@cat1", "keep"]]);
  assert.deepEqual(chooseRow(items, "b", "keep"), [["b@cat1", "keep"]]);
  assert.deepEqual(chooseRow(items, "c", "new"), [["c@cat2", "new"]]);
  // A choice belongs to the row and the saved price it matched.
  assert.equal(choiceKey(items[0]), "a@cat1");
  assert.equal(choiceKey(priceRow("X", { id: "x" })), "x@");
  // Only conflicts set to new are replaced; others, and rows no longer in
  // conflict, are not.
  const more = [...items, priceRow("Milo", { id: "d", outcome: "no_price", priceSen: null, current: { id: "cat3", item: "Milo", priceSen: 1 } })];
  assert.deepEqual(
    priceReplace(more, { "a@cat1": "new", "b@cat1": "keep", "c@cat2": "new", "d@cat3": "new" }),
    ["a", "c"],
  );
  // A "Use new" given while the row matched another saved price does not
  // carry over.
  assert.deepEqual(priceReplace(items, { "a@cat9": "new" }), []);
  assert.deepEqual(priceReplace(items, { a: "new" }), []);
  // With both set to new (an older choice), the planner lets one win.
  const plan = planFromView(items, ["a", "b"]).plans;
  assert.deepEqual(plan.map((p) => p.outcome), ["update", "duplicate", "conflict"]);
});

test("Use this one instead confirms a pending duplicate, or removes the row that wins", () => {
  // Two untouched rows: confirming the later one is enough.
  const a = priceRow("Nasi Lemak", { id: "a", position: 0 });
  const b = priceRow("nasi lemak", { id: "b", position: 1, outcome: "duplicate" });
  assert.deepEqual(useThisSteps([a, b], [], "b"), [{ id: "b", state: "confirmed" }]);
  // Both confirmed: the earlier one wins, so it is removed.
  const ca = { ...a, state: "confirmed" as const };
  const cb = { ...b, state: "confirmed" as const };
  assert.deepEqual(useThisSteps([ca, cb], [], "b"), [{ id: "a", state: "removed" }]);
  // The winner confirmed, this one pending: confirming does not beat it.
  assert.deepEqual(useThisSteps([ca, b], [], "b"), [{ id: "a", state: "removed" }]);
  // Not a duplicate: nothing to do.
  assert.deepEqual(useThisSteps([ca, cb], [], "a"), []);
});

test("rows still needing the owner are flagged pending rows and rows with no price", () => {
  const items = [
    priceRow("A", { id: "a", flag: true, outcome: "unconfirmed" }),
    priceRow("B", { id: "b", priceSen: null, outcome: "no_price" }),
    priceRow("C", { id: "c" }),
    priceRow("D", { id: "d", flag: true, state: "confirmed" }),
  ];
  assert.deepEqual(needCheckIds(planFromView(items, []).plans), ["a", "b"]);
});

test("the apply summary counts what apply will write and what is left out", () => {
  const saved = { id: "cat1", item: "Kopi O", priceSen: 7000 };
  const items = [
    priceRow("Kopi O", { id: "k", outcome: "conflict", current: saved }),
    priceRow("Teh", { id: "t" }),
    priceRow("teh", { id: "t2", outcome: "duplicate" }),
    priceRow("Milo", { id: "m", flag: true, outcome: "unconfirmed" }),
    priceRow("Roti", { id: "r", priceSen: null, outcome: "no_price" }),
    factItem("hours", { kind: "schedule" }),
    factItem("f1"),
    factItem("f2", { flag: true, source: "import" }),
    factItem("f3", { flag: true, state: "confirmed", source: "import" }),
    factItem("f4", { state: "removed" }),
    factItem("f5"),
  ];
  const uploads = [
    { id: FILE_A, kind: "image", name: "menu.jpg", bytes: 1, state: "done", failCode: null, rowCount: 5, factCount: 2, droppedCount: 0, bytesDeletedAt: null, createdAt: "" },
    { id: FILE_B, kind: "pdf", name: "prices.pdf", bytes: 1, state: "reading", failCode: null, rowCount: 0, factCount: 0, droppedCount: 0, bytesDeletedAt: null, createdAt: "" },
  ] as Setup["uploads"];
  const view = { items, conflicts: [{ itemId: "f5", current: "old" }], uploads };
  const keep = applySummary(view, {}, en);
  assert.deepEqual(keep.replace, []);
  assert.deepEqual(keep.counts, {
    prices: 1,
    answers: 3,
    checkPrices: 2,
    checkAnswers: 1,
    duplicates: 1,
    reading: ["prices.pdf"],
    sending: [],
  });
  const fresh = applySummary(view, { "k@cat1": "new", f5: "new" }, en);
  assert.deepEqual(fresh.replace.sort(), ["f5", "k"]);
  assert.equal(fresh.counts.prices, 2);
  assert.equal(fresh.counts.answers, 4);
  // Each id is sent once, even when a price row is also listed as a
  // conflict and chosen both ways.
  const both = applySummary(
    { ...view, conflicts: [...view.conflicts, { itemId: "k", current: saved }] },
    { k: "new", "k@cat1": "new" },
    en,
  );
  assert.equal(both.replace.filter((id) => id === "k").length, 1);
  // With the packs given, a fact whose field is not in its pack is not
  // counted (apply skips it as unknown_field); hours always count.
  const packs = [{ id: "every-business", facts: [{ key: "f1" }, { key: "f2" }] }];
  const known = applySummary(view, {}, en, { packs });
  assert.equal(known.counts.answers, 2);
  assert.equal(known.counts.checkAnswers, 1);
  assert.equal(applySummary(view, {}, en, { packs: [] }).counts.checkAnswers, 0);
  // Files this browser is still sending are named.
  const sending = applySummary(view, {}, en, {
    senders: [{ uploadId: null, name: "list.pdf", phase: "sending" as const }],
  });
  assert.deepEqual(sending.counts.sending, ["list.pdf"]);
  assert.equal(overLimit(fresh.totals), false);
  assert.equal(overLimit({ willWrite: APPLY_ROW_LIMIT }), false);
  assert.equal(overLimit({ willWrite: APPLY_ROW_LIMIT + 1 }), true);
  assert.equal(APPLY_ROW_LIMIT, 500);
});

test("the apply button and the left-out line say what will happen, in both languages", () => {
  const c = { prices: 14, answers: 6, checkPrices: 3, checkAnswers: 0, duplicates: 2, reading: [] as string[], sending: [] as string[] };
  assert.equal(applyButtonText(c, en), "Save 14 prices and 6 answers, try a call");
  // Without a price section the button keeps its old words.
  assert.equal(applyButtonText(c, en, false), "Looks right, try a call");
  assert.equal(applyButtonText(c, ms, false), "Semua betul, cuba buat panggilan");
  assert.equal(applyButtonText(c, ms), "Simpan 14 harga dan 6 jawapan, cuba buat panggilan");
  assert.equal(applyButtonText({ ...c, prices: 1, answers: 1 }, en), "Save 1 price and 1 answer, try a call");
  assert.equal(applyButtonText({ ...c, answers: 0 }, en), "Save 14 prices, try a call");
  assert.equal(applyButtonText({ ...c, answers: 0 }, ms), "Simpan 14 harga, cuba buat panggilan");
  assert.equal(applyButtonText({ ...c, prices: 0 }, en), "Save 6 answers, try a call");
  assert.equal(applyButtonText({ ...c, prices: 0, answers: 0 }, en), "Looks right, try a call");
  assert.equal(applyButtonText({ ...c, prices: 0, answers: 0 }, ms), "Semua betul, cuba buat panggilan");
  assert.equal(
    leftOutText(c, en),
    "3 prices still need checking and will not be saved. 2 duplicates are left out.",
  );
  assert.equal(
    leftOutText(c, ms),
    "3 harga masih perlu disemak dan tidak akan disimpan. 2 pendua tidak dimasukkan.",
  );
  assert.equal(
    leftOutText({ ...c, checkPrices: 1, checkAnswers: 1, duplicates: 1 }, en),
    "1 price still needs checking and will not be saved. 1 answer still needs checking and will not be saved. 1 duplicate is left out.",
  );
  assert.equal(leftOutText({ ...c, checkPrices: 0, duplicates: 0 }, en), "");
});

test("apply asks once before leaving rows out or while a file is still being read", () => {
  const c = { prices: 14, answers: 6, checkPrices: 3, checkAnswers: 0, duplicates: 2, reading: [] as string[], sending: [] as string[] };
  assert.equal(
    applyConfirmText(c, en),
    "3 prices will not be saved. You cannot come back to them after this. Save the rest?",
  );
  assert.equal(
    applyConfirmText(c, ms),
    "3 harga tidak akan disimpan. Anda tidak boleh menyemaknya semula selepas ini. Simpan selebihnya?",
  );
  // Exactly one left out: "it".
  assert.equal(
    applyConfirmText({ ...c, checkPrices: 1 }, en),
    "1 price will not be saved. You cannot come back to it after this. Save the rest?",
  );
  assert.equal(
    applyConfirmText({ ...c, checkPrices: 0, checkAnswers: 1 }, en),
    "1 answer will not be saved. You cannot come back to it after this. Save the rest?",
  );
  assert.equal(
    applyConfirmText({ ...c, checkPrices: 0, reading: ["menu.jpg"] }, en),
    "menu.jpg is still being read. Prices from it will not be included if you save now. Save now?",
  );
  assert.equal(
    applyConfirmText({ ...c, checkPrices: 0, reading: ["menu.jpg"] }, ms),
    "menu.jpg masih dibaca. Harga dalam fail itu tidak akan dimasukkan jika anda simpan sekarang. Simpan sekarang?",
  );
  assert.equal(
    applyConfirmText({ ...c, checkPrices: 0, sending: ["list.pdf"] }, en),
    "list.pdf is still being sent. Prices from it will not be included if you save now. Save now?",
  );
  assert.equal(
    applyConfirmText({ ...c, checkPrices: 0, sending: ["list.pdf"] }, ms),
    "list.pdf masih dihantar. Harga dalam fail itu tidak akan dimasukkan jika anda simpan sekarang. Simpan sekarang?",
  );
  assert.equal(
    applyConfirmText({ ...c, checkPrices: 1, checkAnswers: 2 }, en),
    "1 price will not be saved. 2 answers will not be saved. You cannot come back to them after this. Save the rest?",
  );
  // Duplicates alone do not ask: the same item is saved.
  assert.equal(applyConfirmText({ ...c, checkPrices: 0 }, en), null);
  assert.match(overLimitText(en), /More than 500 prices/);
  assert.match(overLimitText(ms), /^Lebih daripada 500 harga akan disimpan serentak\. Had bagi satu persediaan ialah 500\./);
});

test("apply asks again when more would be left out than the question said", () => {
  const c = { prices: 14, answers: 6, checkPrices: 3, checkAnswers: 0, duplicates: 2, reading: ["a.pdf"], sending: [] as string[] };
  assert.equal(askAgain(c, c), false);
  // Fewer left out: no need to ask again.
  assert.equal(askAgain(c, { ...c, checkPrices: 1 }), false);
  assert.equal(askAgainWhy(c, { ...c, checkPrices: 1, prices: 13 }), null);
  // More prices would be saved: asked again, said as "new prices came in".
  assert.equal(askAgainWhy(c, { ...c, reading: [], prices: 16 }), "arrived");
  assert.equal(askAgainWhy(c, { ...c, prices: 15 }), "arrived");
  // A file named as still being read is no longer being read but brought no
  // new price (it failed, was removed, or found nothing): asked again, but
  // never said as new prices.
  assert.equal(askAgainWhy(c, { ...c, reading: [] }), "changed");
  assert.equal(askAgainWhy({ ...c, reading: ["a.pdf", "gone.pdf"] }, c), "changed");
  assert.equal(askAgainWhy(c, { ...c, checkPrices: 4, reading: [] }), "left_out");
  assert.equal(askAgain(c, { ...c, checkPrices: 4 }), true);
  assert.equal(askAgain(c, { ...c, checkAnswers: 1 }), true);
  assert.equal(askAgain(c, { ...c, reading: ["a.pdf", "b.pdf"] }), true);
  assert.equal(askAgain(c, { ...c, sending: ["c.jpg"] }), true);
  // A file named while sending, now being read, was already named.
  assert.equal(askAgain({ ...c, sending: ["b.pdf"] }, { ...c, reading: ["a.pdf", "b.pdf"] }), false);
});

test("files not in yet: read by the server, or still being sent by this browser", () => {
  const up = (id: string, state: SetupUploadState, name: string) => ({ id, state, kind: "pdf" as const, name });
  const uploads = [up(FILE_A, "reading", "a.pdf"), up(FILE_B, "uploading", "b.pdf"), up(FILE_C, "done", "c.pdf")];
  const senders = [
    { uploadId: null, name: "new.pdf", phase: "preparing" as const },
    { uploadId: FILE_B, name: "b.pdf", phase: "sending" as const },
    { uploadId: FILE_C, name: "c.pdf", phase: "sending" as const },
    { uploadId: null, name: "bad.pdf", phase: "failed" as const },
    { uploadId: null, name: "done.pdf", phase: "sent" as const },
    { uploadId: "00000000-0000-4000-8000-0000000000dd", name: "unlisted.pdf", phase: "waiting" as const },
  ];
  assert.deepEqual(filesNotIn(uploads, senders, en), {
    reading: ["a.pdf"],
    sending: ["new.pdf", "b.pdf", "unlisted.pdf"],
  });
  // An interrupted upload (no sender) is not "still sending".
  assert.deepEqual(filesNotIn(uploads, [], en).sending, []);
});

test("a fact counts only when its field is in its pack", () => {
  const packs = [{ id: "every-business", facts: [{ key: "phone" }] }];
  assert.equal(factKnown(packs, factItem("phone")), true);
  assert.equal(factKnown(packs, factItem("parking")), false);
  assert.equal(factKnown(packs, factItem("hours", { kind: "schedule" })), true);
  assert.equal(factKnown([], factItem("phone")), false);
});

test("Remove all re-checks each row from the latest view", () => {
  const items = [
    priceRow("A", { id: "a", flag: true, outcome: "unconfirmed" }),
    priceRow("B", { id: "b", priceSen: null, outcome: "no_price" }),
    priceRow("C", { id: "c", flag: true, outcome: "unconfirmed", state: "confirmed" }),
    priceRow("D", { id: "d" }),
  ];
  assert.equal(bulkRemovable(items, [], "a"), true);
  assert.equal(bulkRemovable(items, [], "b"), true);
  // Confirmed meanwhile, ready, gone, or not a price row: kept.
  assert.equal(bulkRemovable(items, [], "c"), false);
  assert.equal(bulkRemovable(items, [], "d"), false);
  assert.equal(bulkRemovable(items, [], "zz"), false);
  assert.equal(bulkRemovable([...items, factItem("f", { flag: true })], [], "f"), false);
  // Priced meanwhile: its live outcome no longer needs the owner.
  const priced = items.map((i) =>
    i.id === "b" ? { ...i, payload: { ...(i.payload as object), priceSen: 500 } } : i,
  );
  assert.equal(bulkRemovable(priced, [], "b"), false);
  // The words, with singulars.
  assert.equal(bulkText("ask", { done: 0, total: 1 }, en), "Remove 1 price that still needs checking? It will not be saved.");
  assert.equal(bulkText("ask", { done: 0, total: 3 }, ms), "Buang 3 harga yang masih perlu disemak? Harga itu tidak akan disimpan.");
  assert.equal(bulkText("progress", { done: 3, total: 12 }, en), "Removing 3 of 12…");
  assert.equal(bulkText("done", { done: 1, total: 2 }, en), "1 price removed");
  assert.equal(bulkText("done", { done: 2, total: 2 }, en), "2 prices removed");
  assert.equal(bulkText("stopped", { done: 2, total: 5 }, en), "Stopped after removing 2 of 5. Try again.");
  assert.equal(bulkText("stopped", { done: 2, total: 5 }, ms), "Terhenti selepas membuang 2 daripada 5. Cuba lagi.");
  // Never a sentence with a zero count.
  assert.equal(bulkText("stopped", { done: 0, total: 5 }, en), "Could not remove them. Try again.");
  assert.equal(bulkText("stopped", { done: 0, total: 5 }, ms), "Harga tidak dapat dibuang. Cuba lagi.");
  // Nothing removed and nothing failed: said plainly.
  assert.equal(bulkText("none", { done: 0, total: 3 }, en), "No prices were removed. They no longer need checking.");
  assert.equal(bulkText("none", { done: 0, total: 3 }, ms), "Tiada harga dibuang. Harga itu tidak lagi perlu disemak.");
  // The slot keeps its place: never a zero or one count in the button.
  assert.deepEqual(bulkSlot(3, en), {
    label: "Remove all 3 that still need checking",
    hint: "Prices removed here are not saved.",
    enabled: true,
  });
  assert.equal(bulkSlot(3, ms).label, "Buang semua 3 yang masih perlu disemak");
  assert.deepEqual(bulkSlot(1, en), {
    label: "Remove all that still need checking",
    hint: "Only 1 price still needs checking. Use Remove on its row.",
    enabled: false,
  });
  assert.equal(bulkSlot(0, en).hint, "No prices need checking now.");
  assert.equal(bulkSlot(0, ms).hint, "Tiada harga yang perlu disemak sekarang.");
  assert.equal(bulkSlot(1, ms).hint, "Hanya 1 harga yang masih perlu disemak. Tekan Buang pada barisnya.");
  for (const n of [0, 1]) assert.doesNotMatch(bulkSlot(n, en).label, /\d/);
});

test("only blur, Enter and explicit flushes send a price: hiding the tab or unmounting does not", () => {
  assert.equal(sendsWhenHidden({ debounce: false }), false);
  assert.equal(sendsWhenHidden({ debounce: true }), true);
  // A price field's value is dropped on unmount; a debounced field is sent.
  assert.equal(sendsOnUnmount({ debounce: false }), false);
  assert.equal(sendsOnUnmount({ debounce: true }), true);
});

test("the review page ignores taps for 500 ms after the last touch", () => {
  assert.equal(SETTLE_MS, 500);
  assert.equal(settleReady(1000, 1000), false);
  assert.equal(settleReady(1000, 1499), false);
  assert.equal(settleReady(1000, 1500), true);
  assert.equal(settleReady(-Infinity, 0), true);
  const g = createSettle();
  // Never touched: ready.
  assert.equal(g.ready(0), true);
  g.touch(100);
  assert.equal(g.ready(599), false);
  assert.equal(g.ready(600), true);
  // Each touch restarts the wait; an older timestamp never shortens it.
  g.touch(550);
  assert.equal(g.ready(1000), false);
  g.touch(200);
  assert.equal(g.ready(1049), false);
  assert.equal(g.ready(1050), true);
});

test("the layout key changes when rows or files change state, not otherwise", () => {
  const items = [
    priceRow("A", { id: "a", flag: true, outcome: "unconfirmed" }),
    priceRow("B", { id: "b" }),
  ];
  const uploads = [{ id: FILE_A, state: "reading" as const }];
  const k = layoutKey({ items, uploads });
  assert.equal(layoutKey({ items: [...items], uploads: [...uploads] }), k);
  // A different payload (a price typed) does not move anything.
  assert.equal(
    layoutKey({ items: items.map((i) => ({ ...i, payload: {} })), uploads }),
    k,
  );
  for (const changed of [
    { items: items.map((i) => (i.id === "a" ? { ...i, state: "removed" as const } : i)), uploads },
    { items: items.map((i) => (i.id === "a" ? { ...i, needsCheck: false } : i)), uploads },
    { items: items.map((i) => (i.id === "b" ? { ...i, outcome: "duplicate" as const } : i)), uploads },
    { items: [...items, priceRow("C", { id: "c" })], uploads },
    { items, uploads: [{ id: FILE_A, state: "done" as const }] },
  ])
    assert.notEqual(layoutKey(changed), k);
  assert.equal(skippedText("Kopi", en), "Kopi was not removed: it changed meanwhile.");
  assert.equal(skippedText("Kopi", ms), "Kopi tidak dibuang kerana telah berubah.");
});

test("prices typed with full-width digits are read; the decimal comma is still refused", () => {
  assert.equal(parsePrice("８０"), 8000);
  assert.equal(parsePrice("８０．５０"), 8050);
  assert.equal(parsePrice("ＲＭ８０"), 8000);
  assert.equal(parsePrice("１，２００．５０"), 120050);
  assert.equal(parsePrice("８０，５"), null);
  assert.equal(parsePrice("80,50"), null);
  assert.equal(readPrice("８０．５"), 8050);
  assert.equal(readPrice("８ｏ"), "invalid");
  // The ideographic full stop is a decimal point too.
  assert.equal(parsePrice("80。50"), 8050);
  assert.equal(parsePrice("８０。５"), 8050);
  assert.equal(parsePrice("1,200。50"), 120050);
  assert.equal(parsePrice("80。505"), null);
  assert.equal(readPrice("。5"), "invalid");
});

test("row words: status, reason, now-and-new, duplicate, in both languages", () => {
  assert.equal(rowStatusText({ status: "check" }, en), "Please check");
  assert.equal(rowStatusText({ status: "check" }, ms), "Sila semak");
  assert.equal(rowStatusText({ status: "no_price" }, en), "No price found");
  assert.equal(rowStatusText({ status: "no_price" }, ms), "Harga tidak ditemui");
  assert.equal(rowStatusText({ status: "ready" }, en), "Will be saved");
  assert.equal(rowStatusText({ status: "ready" }, ms), "Akan disimpan");
  assert.equal(rowStatusText({ status: "conflict" }, ms), "Sama dengan harga sedia ada");
  assert.equal(rowStatusText({ status: "update" }, ms), "Akan menggantikan harga sedia ada");
  // The reader's words (English) after "Reason:"; ours when it gave none.
  assert.deepEqual(checkReason("the price is partly covered", ms), {
    label: "Sebab:", text: "the price is partly covered", reader: true,
  });
  assert.deepEqual(checkReason(null, en), {
    label: "Reason:", text: "JomCall was not sure about this one.", reader: false,
  });
  assert.deepEqual(checkReason("  ", ms), {
    label: "Sebab:", text: "JomCall kurang pasti tentang harga ini.", reader: false,
  });
  // On an answer card the BM fallback names an answer, not a price.
  assert.equal(checkReason(null, ms, false).text, "JomCall kurang pasti tentang jawapan ini.");
  const cur = { item: "Kopi-O", priceSen: 7000 };
  assert.equal(conflictText(cur, 8000, en), "Now: Kopi-O RM 70.00. New: RM 80.00");
  assert.equal(conflictText(cur, 8000, ms), "Sedia ada: Kopi-O RM 70.00. Baharu: RM 80.00");
  assert.equal(useThisText(true, en), "Use this one instead and remove the other copy");
  assert.equal(useThisText(true, ms), "Guna yang ini dan buang pendua yang satu lagi");
  assert.equal(useThisText(false, en), "Use this one instead");
  assert.equal(conflictText({ item: "Kopi-O", priceSen: null }, 8000, en), "Now: Kopi-O no price. New: RM 80.00");
  const win = rowPayload({ item: "Nasi Lemak", variant: "Biasa", priceSen: 650 });
  assert.equal(duplicateText(win, en), "Same as Nasi Lemak Biasa RM 6.50; this one will not be saved.");
  assert.equal(duplicateText(win, ms), "Sama seperti Nasi Lemak Biasa RM 6.50; yang ini tidak akan disimpan.");
  assert.equal(rowName({ item: " Kopi ", variant: "" }), "Kopi");
  assert.equal(factFlagged({ needsCheck: true, state: "pending" }), true);
  assert.equal(factFlagged({ needsCheck: true, state: "confirmed" }), false);
});
