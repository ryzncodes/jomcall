import test from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import {
  sheetToText,
  SHEET_LIMITS,
} from "../../packages/inference/src/sheet-text.ts";

// All fixtures are synthetic and built in memory; no binary files are committed.

async function xlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// A minimal zip writer: stored (0) or deflated (8) entries, no data descriptors.
function zip(entries: { name: string; data: Buffer; deflate?: boolean }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

test("xlsx with merged header cells dumps every non-empty cell with its address", async () => {
  const data = await xlsx((wb) => {
    const ws = wb.addWorksheet("Harga");
    ws.getCell("A1").value = "Senarai Harga Kedai Contoh";
    ws.mergeCells("A1:C1");
    ws.getRow(2).values = ["Servis", "Jenis", "Harga (RM)"];
    ws.getRow(3).values = ["Potong rambut", "Dewasa", 25];
    ws.getRow(4).values = ["Potong rambut", "Kanak-kanak", 15.5];
    ws.getCell("C5").value = {
      formula: "C3*2",
      result: 50,
    } as ExcelJS.CellValue;
    ws.getCell("A5").value = "Pakej berdua";
    ws.getCell("A7").value = {
      richText: [{ text: "Cuci " }, { text: "& blow" }],
    } as ExcelJS.CellValue;
    ws.getCell("B7").value = { formula: "C4+1" } as ExcelJS.CellValue;
  });
  const text = await sheetToText(data, "harga.xlsx");
  assert.deepEqual(text.split("\n"), [
    "Harga!A1: Senarai Harga Kedai Contoh",
    "Harga!A2: Servis",
    "Harga!B2: Jenis",
    "Harga!C2: Harga (RM)",
    "Harga!A3: Potong rambut",
    "Harga!B3: Dewasa",
    "Harga!C3: 25",
    "Harga!A4: Potong rambut",
    "Harga!B4: Kanak-kanak",
    "Harga!C4: 15.5",
    "Harga!A5: Pakej berdua",
    "Harga!C5: 50",
    "Harga!A7: Cuci & blow",
    "Harga!B7: =C4+1",
  ]);
});

test("a zip that is not a workbook is UNREADABLE", async () => {
  const data = zip([
    { name: "notes.txt", data: Buffer.from("bukan buku kerja") },
    { name: "more.txt", data: Buffer.from("x".repeat(500)), deflate: true },
  ]);
  assert.equal(await code(sheetToText(data, "harga.xlsx")), "UNREADABLE");
});

test("a broken zip is UNREADABLE", async () => {
  const good = await xlsx((wb) => {
    wb.addWorksheet("A").getCell("A1").value = "x";
  });
  const cut = good.subarray(0, Math.floor(good.length / 2));
  assert.equal(await code(sheetToText(cut, "a.xlsx")), "UNREADABLE");
});

test("a zip that unpacks past the size cap is TOO_LONG, whatever its headers say", async () => {
  const huge = Buffer.alloc(SHEET_LIMITS.unpackedBytes + 1024 * 1024);
  const data = zip([
    { name: "xl/media/image1.png", data: huge, deflate: true },
  ]);
  // Lie in the central directory: claim the entry unpacks to 10 bytes.
  const dir = data.readUInt32LE(data.length - 22 + 16);
  data.writeUInt32LE(10, dir + 24);
  assert.ok(data.length < 200_000);
  assert.equal(await code(sheetToText(data, "bom.xlsx")), "TOO_LONG");
});

test("XML parts past their own lower cap are TOO_LONG", async () => {
  const sheet = Buffer.alloc(SHEET_LIMITS.unpackedXmlBytes + 1024, 0x20);
  const data = zip([
    { name: "xl/worksheets/sheet1.xml", data: sheet, deflate: true },
  ]);
  assert.equal(await code(sheetToText(data, "a.xlsx")), "TOO_LONG");
});

test("a large embedded image counts only towards the overall cap", async () => {
  const data = await xlsx((wb) => {
    const ws = wb.addWorksheet("Menu");
    ws.getCell("A1").value = "Nasi lemak";
    const image = wb.addImage({
      buffer: Buffer.alloc(12 * 1024 * 1024) as unknown as ExcelJS.Buffer,
      extension: "png",
    });
    ws.addImage(image, "C1:D4");
  });
  assert.equal(await sheetToText(data, "menu.xlsx"), "Menu!A1: Nasi lemak");
});

test("binary that is neither a workbook nor text is UNREADABLE", async () => {
  // Old .xls (compound file) header, and bytes that are not UTF-8.
  const xls = Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
  ]);
  assert.equal(await code(sheetToText(xls, "harga.xls")), "UNREADABLE");
  const latin = Buffer.from([0x48, 0x61, 0x72, 0x67, 0x61, 0xe9, 0xff]);
  assert.equal(await code(sheetToText(latin, "harga.csv")), "UNREADABLE");
  assert.equal(await code(sheetToText(Buffer.alloc(0), "a.csv")), "UNREADABLE");
});

test("xlsx reads at most five worksheets and thirty columns, values only", async () => {
  const data = await xlsx((wb) => {
    for (let s = 1; s <= 7; s++) {
      const ws = wb.addWorksheet(`S${s}`);
      ws.getCell("A1").value = `sheet ${s}`;
      ws.getCell(1, 30).value = "col 30";
      ws.getCell(1, 31).value = "col 31";
    }
  });
  const text = await sheetToText(data, "a.xlsx");
  const lines = text.split("\n");
  assert.equal(lines.length, 10);
  assert.ok(lines.includes("S5!A1: sheet 5"));
  assert.ok(lines.includes("S5!AD1: col 30"));
  assert.ok(!text.includes("S6!"));
  assert.ok(!text.includes("col 31"));
});

test("xlsx stops after 300 non-empty rows across worksheets", async () => {
  const data = await xlsx((wb) => {
    const a = wb.addWorksheet("A");
    for (let r = 1; r <= 250; r++) a.getCell(r * 2, 1).value = `a${r}`;
    const b = wb.addWorksheet("B");
    for (let r = 1; r <= 100; r++) b.getCell(r, 1).value = `b${r}`;
  });
  const lines = (await sheetToText(data, "a.xlsx")).split("\n");
  assert.equal(lines.length, SHEET_LIMITS.rows);
  assert.equal(lines.at(-1), "B!A50: b50");
});

test("CSV keeps quoted commas, quotes and line breaks and skips empty cells", async () => {
  const csv =
    "﻿Item,Harga,Nota\r\n" +
    '"Nasi lemak, telur",5.50,"kata ""best"""\r\n' +
    '"Teh\nais",2.20,\n' +
    ",,\n" +
    "炒饭,8,";
  const text = await sheetToText(Buffer.from(csv, "utf8"), "menu.csv");
  assert.deepEqual(text.split("\n"), [
    "csv!A1: Item",
    "csv!B1: Harga",
    "csv!C1: Nota",
    "csv!A2: Nasi lemak, telur",
    "csv!B2: 5.50",
    'csv!C2: kata "best"',
    "csv!A3: Teh ais",
    "csv!B3: 2.20",
    "csv!A5: 炒饭",
    "csv!B5: 8",
  ]);
});

test("CSV caps rows, columns and total characters while reading", async () => {
  const wide = Array.from({ length: 40 }, (_, i) => `c${i + 1}`).join(",");
  const many = Array.from({ length: 400 }, () => wide).join("\n");
  const lines = (await sheetToText(Buffer.from(many), "a.csv")).split("\n");
  assert.equal(lines.length, SHEET_LIMITS.rows * SHEET_LIMITS.columns);
  assert.equal(lines.at(-1), "csv!AD300: c30");

  const long = Array.from({ length: 300 }, () =>
    Array.from({ length: 30 }, () => "x".repeat(700)).join(","),
  ).join("\n");
  const text = await sheetToText(Buffer.from(long), "a.csv");
  assert.ok(text.length <= SHEET_LIMITS.chars);
  assert.ok(text.length > SHEET_LIMITS.chars - 800);
});

test("a .tsv name splits on tabs", async () => {
  const text = await sheetToText(Buffer.from("a\tb,c\n"), "list.tsv");
  assert.deepEqual(text.split("\n"), ["csv!A1: a", "csv!B1: b,c"]);
});
