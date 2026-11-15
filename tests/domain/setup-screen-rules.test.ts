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
      "This upload was interrupted. Remove it and add the file again.",
      "Muat naik ini terputus. Buang dan tambah fail itu semula.",
    ],
    [{ ...upload, state: "queued" }, "Waiting to be read", "Menunggu untuk dibaca"],
    [{ ...upload, state: "reading" }, "Reading…", "Sedang dibaca…"],
    [upload, "12 prices and 3 facts found", "12 harga dan 3 butiran ditemui"],
    [
      { ...upload, rowCount: 1, factCount: 1 },
      "1 price and 1 fact found",
      "1 harga dan 1 butiran ditemui",
    ],
    [{ ...upload, factCount: 0 }, "12 prices found", "12 harga ditemui"],
    [{ ...upload, rowCount: 0 }, "3 facts found", "3 butiran ditemui"],
    [
      { ...upload, droppedCount: 2 },
      "12 prices and 3 facts found · 2 rows could not be read",
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

test("a failed read has one plain sentence per fail code, in both languages", () => {
  const codes: [string | null, string, string][] = [
    ["TOO_LONG", "Too long to read. Split it into smaller files.", "Terlalu panjang untuk dibaca. Bahagikan kepada fail yang lebih kecil."],
    ["UNREADABLE", "Could not read this file. Try a clearer photo, or paste the text.", "Fail ini tidak dapat dibaca. Cuba foto yang lebih jelas, atau tampal teksnya."],
    ["REFUSED", "Could not read this file. Remove it and try again, or answer the questions instead.", "Fail ini tidak dapat dibaca. Buang dan cuba lagi, atau jawab soalan sahaja."],
    ["READ_FAILED", "Could not read this file. Remove it and try again, or answer the questions instead.", "Fail ini tidak dapat dibaca. Buang dan cuba lagi, atau jawab soalan sahaja."],
    ["READER_OFF", "Document reading is not available right now.", "Pembacaan dokumen tidak tersedia buat masa ini."],
    ["ABANDONED", "This upload was interrupted. Add it again.", "Muat naik ini terputus. Tambah semula."],
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
  assert.match(requestErrorText("UPLOAD_RATE", "create", en)!, /20 files/);
  assert.match(requestErrorText("UPLOAD_RATE", "paste", ms)!, /20 fail/);
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
    "Penghantaran terhenti. Semak sambungan anda, kemudian cuba lagi.",
  );
  assert.equal(sendFailureText(429, "UPLOAD_RATE", "chunk", en), requestErrorText("UPLOAD_RATE", "chunk", en));
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
  assert.equal(sendFailureText(413, "PROXY", "chunk", en), refusalText("SPLIT", en));
  assert.equal(sendFailureText(413, "PROXY", "create", ms), refusalText("SPLIT", ms));
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
    "This picture is very long. Crop it into shorter parts and add each part.",
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
  assert.equal(sendFailureText(f.status, f.code, "chunk", en), refusalText("SPLIT", en));
});
