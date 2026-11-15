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
  namePrefill,
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
import { sendChunks } from "../../web/components/core/setup/upload.ts";
import { CoreError } from "../../web/lib/core/client.ts";

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
      "Muat naik ini terganggu. Buang dan tambah fail itu semula.",
    ],
    [{ ...upload, state: "queued" }, "Waiting to be read", "Menunggu untuk dibaca"],
    [{ ...upload, state: "reading" }, "Reading…", "Sedang membaca…"],
    [upload, "12 prices and 3 facts found", "12 harga dan 3 fakta ditemui"],
    [
      { ...upload, rowCount: 1, factCount: 1 },
      "1 price and 1 fact found",
      "1 harga dan 1 fakta ditemui",
    ],
    [{ ...upload, factCount: 0 }, "12 prices found", "12 harga ditemui"],
    [{ ...upload, rowCount: 0 }, "3 facts found", "3 fakta ditemui"],
    [
      { ...upload, droppedCount: 2 },
      "12 prices and 3 facts found · 2 rows could not be read",
      "12 harga dan 3 fakta ditemui · 2 baris tidak dapat dibaca",
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
    ["TOO_LONG", "Too long to read. Split it into smaller files.", "Terlalu panjang untuk dibaca. Pecahkan kepada fail yang lebih kecil."],
    ["UNREADABLE", "Could not read this file. Try a clearer photo, or paste the text.", "Fail ini tidak dapat dibaca. Cuba foto yang lebih jelas, atau tampal teksnya."],
    ["REFUSED", "Could not read this file. Remove it and try again, or answer the questions instead.", "Fail ini tidak dapat dibaca. Buang dan cuba lagi, atau jawab soalan sahaja."],
    ["READ_FAILED", "Could not read this file. Remove it and try again, or answer the questions instead.", "Fail ini tidak dapat dibaca. Buang dan cuba lagi, atau jawab soalan sahaja."],
    ["READER_OFF", "Document reading is not available right now.", "Pembacaan dokumen tidak tersedia buat masa ini."],
    ["ABANDONED", "This upload was interrupted. Add it again.", "Muat naik ini terganggu. Tambah semula."],
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
  assert.equal(sendingLabel({ phase: "failed", seq: 2, total: 4 }, ms), "Penghantaran gagal");
  assert.equal(sendingLabel({ phase: "sent", seq: 3, total: 4 }, en), "Waiting to be read");
});

test("pasted text is named on screen; other uploads keep their file name", () => {
  assert.equal(uploadName({ kind: "text", name: "Pasted text" }, ms), "Teks ditampal");
  assert.equal(uploadName({ kind: "text", name: "Pasted text" }, en), "Pasted text");
  assert.equal(uploadName({ kind: "pdf", name: "menu.pdf" }, ms), "menu.pdf");
});

test("five places per setup; polling only while a read is waiting or running", () => {
  assert.equal(slotsLeft(0), 5);
  assert.equal(slotsLeft(4), 1);
  assert.equal(slotsLeft(5), 0);
  assert.equal(slotsLeft(7), 0);
  assert.equal(readingNow([{ state: "done" }, { state: "failed" }]), false);
  assert.equal(readingNow([{ state: "uploading" }]), false);
  assert.equal(readingNow([{ state: "done" }, { state: "queued" }]), true);
  assert.equal(readingNow([{ state: "reading" }]), true);
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

const blobOf = (n: number) => new Blob([new Uint8Array(n)]);

test("chunks go one after another, each retried twice, then the send stops at that chunk", async () => {
  const calls: [number, number][] = [];
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
  });
  // Chunk 1 tried three times (once plus two retries), then given up.
  assert.deepEqual(calls, [
    [0, 4],
    [1, 4],
    [1, 4],
    [1, 4],
  ]);
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
  });
  assert.equal(calls, 2);
  assert.equal(flaky.writes, 30);
  assert.equal((flaky.error as CoreError).code, "UPLOAD_RATE");
});

test("a removed upload stops sending before the next chunk", async () => {
  let stop = false;
  const seen: number[] = [];
  const r = await sendChunks({
    blob: blobOf(8),
    sizes: [4, 4],
    from: 0,
    writes: 0,
    put: async (seq) => {
      seen.push(seq);
      stop = true;
    },
    stopped: () => stop,
  });
  assert.deepEqual(seen, [0]);
  assert.equal(r.stopped, true);
  assert.equal(r.next, 1);
});
