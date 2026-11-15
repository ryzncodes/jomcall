import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";
import ExcelJS from "exceljs";

// Turns an uploaded spreadsheet (.xlsx or CSV) into a plain cell dump for the
// setup reader: one line per non-empty cell as `<sheet>!<address>: <value>`.
// Values only: formulas are never evaluated (the cached result is used, else
// the formula text). Nothing is written to disk. Throws an Error whose `code`
// is UNREADABLE (not a workbook and not text) or TOO_LONG (the workbook
// unpacks to more than the size cap); the caller maps both.

export const SHEET_LIMITS = {
  rows: 300,
  columns: 30,
  worksheets: 5,
  chars: 200_000,
  // Unpacked size of an .xlsx, checked before it is parsed: every entry, and
  // the XML parts alone. A 300 x 30 price list unpacks to well under 1 MiB.
  unpackedBytes: 64 * 1024 * 1024,
  unpackedXmlBytes: 8 * 1024 * 1024,
  entries: 5_000,
} as const;

export type SheetTextCode = "UNREADABLE" | "TOO_LONG";

const inflate = promisify(inflateRaw);

function fail(code: SheetTextCode): Error {
  return Object.assign(new Error(code), { code });
}

function column(n: number): string {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26))
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

// Collects lines until a cap is hit; `full` tells the readers to stop.
class Dump {
  lines: string[] = [];
  chars = 0;
  rows = 0;
  full = false;
  add(sheet: string, address: string, value: string): void {
    const text = value.replace(/[\r\n]+/g, " ").trim();
    if (!text || this.full) return;
    const line = `${sheet}!${address}: ${text}`;
    if (this.chars + line.length + 1 > SHEET_LIMITS.chars) {
      this.full = true;
      return;
    }
    this.lines.push(line);
    this.chars += line.length + 1;
  }
  // Called after each source row that produced at least one line.
  endRow(): void {
    this.rows += 1;
    if (this.rows >= SHEET_LIMITS.rows) this.full = true;
  }
  text(): string {
    return this.lines.join("\n");
  }
}

// ---- xlsx ------------------------------------------------------------------

// Walks the zip's central directory and inflates every entry with a running
// output cap, so a small file that unpacks to too much is refused before
// exceljs parses it. The sizes written in the zip headers are not trusted.
// XML parts (sheets, shared strings, styles) have their own, lower budget:
// exceljs builds an object per cell, and measured on this machine a sheet
// part of 59 MB took 2.2 s and 1.1 GB of memory; 3.9 MB took 0.18 s. Media
// (logos, photos) only count towards the overall cap.
async function checkZip(data: Buffer): Promise<void> {
  const tail = Math.max(0, data.length - 65_557);
  let end = -1;
  for (let i = data.length - 22; i >= tail; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw fail("UNREADABLE");
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw fail("TOO_LONG");
  if (count > SHEET_LIMITS.entries) throw fail("TOO_LONG");
  let total: number = SHEET_LIMITS.unpackedBytes;
  let xml: number = SHEET_LIMITS.unpackedXmlBytes;
  for (let n = 0; n < count; n++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50)
      throw fail("UNREADABLE");
    const method = data.readUInt16LE(at + 10);
    const packed = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString("latin1", at + 46, at + 46 + nameLength);
    const next =
      at +
      46 +
      nameLength +
      data.readUInt16LE(at + 30) +
      data.readUInt16LE(at + 32);
    if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50)
      throw fail("UNREADABLE");
    const start =
      local +
      30 +
      data.readUInt16LE(local + 26) +
      data.readUInt16LE(local + 28);
    if (start + packed > data.length) throw fail("UNREADABLE");
    const isXml = /\.(xml|rels)$/i.test(name);
    let size: number;
    if (method === 0) {
      size = packed;
    } else if (method === 8) {
      const limit = Math.max(1, isXml ? Math.min(total, xml) : total);
      try {
        size = (
          await inflate(data.subarray(start, start + packed), {
            maxOutputLength: limit,
          })
        ).length;
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
          throw fail("TOO_LONG");
        throw fail("UNREADABLE");
      }
    } else {
      throw fail("UNREADABLE");
    }
    total -= size;
    if (isXml) xml -= size;
    if (total < 0 || xml < 0) throw fail("TOO_LONG");
    at = next;
  }
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText))
      return v.richText
        .map((part) => String((part as { text?: unknown }).text ?? ""))
        .join("");
    if ("formula" in v || "sharedFormula" in v) {
      if (v.result !== undefined && v.result !== null)
        return cellText(v.result as ExcelJS.CellValue);
      const formula = v.formula ?? v.sharedFormula;
      return typeof formula === "string" ? `=${formula}` : "";
    }
    if ("hyperlink" in v) return cellText(v.text as ExcelJS.CellValue);
    if ("error" in v) return String(v.error);
  }
  return "";
}

async function workbookText(data: Buffer): Promise<string> {
  await checkZip(data);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  } catch {
    throw fail("UNREADABLE");
  }
  const sheets = workbook.worksheets;
  if (sheets.length === 0) throw fail("UNREADABLE");
  const dump = new Dump();
  for (const sheet of sheets.slice(0, SHEET_LIMITS.worksheets)) {
    const last = sheet.rowCount;
    for (let r = 1; r <= last && !dump.full; r++) {
      const row = sheet.findRow(r);
      if (!row) continue;
      const before = dump.lines.length;
      for (let c = 1; c <= SHEET_LIMITS.columns && !dump.full; c++) {
        const cell = row.findCell(c);
        if (!cell) continue;
        // A merged range keeps its value on the top-left cell only.
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        dump.add(sheet.name, cell.address, cellText(cell.value));
      }
      if (dump.lines.length > before) dump.endRow();
    }
    if (dump.full) break;
  }
  return dump.text();
}

// ---- CSV -------------------------------------------------------------------

function decodeText(data: Buffer): string {
  if (data.includes(0)) throw fail("UNREADABLE");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      data,
    );
  } catch {
    throw fail("UNREADABLE");
  }
}

function csvText(text: string, separator: string): string {
  const dump = new Dump();
  let row = 1;
  let col = 1;
  let field = "";
  let quoted = false;
  let started = false;
  let rowHasLine = false;
  const endField = () => {
    if (col <= SHEET_LIMITS.columns) {
      const before = dump.lines.length;
      dump.add("csv", `${column(col)}${row}`, field);
      if (dump.lines.length > before) rowHasLine = true;
    }
    field = "";
    started = false;
    col += 1;
  };
  const endRow = () => {
    endField();
    if (rowHasLine) dump.endRow();
    rowHasLine = false;
    row += 1;
    col = 1;
  };
  for (let i = 0; i < text.length && !dump.full; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && !started) {
      quoted = true;
      started = true;
    } else if (ch === separator) endField();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      // Fields past the column cap are skipped, not collected.
      if (col <= SHEET_LIMITS.columns) field += ch;
      started = true;
    }
  }
  if (!dump.full && (field || started || col > 1)) endRow();
  return dump.text();
}

function isZip(data: Buffer): boolean {
  return data.length >= 4 && data.readUInt32LE(0) === 0x04034b50;
}

export async function sheetToText(data: Buffer, name: string): Promise<string> {
  if (data.length === 0) throw fail("UNREADABLE");
  if (isZip(data)) return workbookText(data);
  const text = decodeText(data);
  return csvText(text, /\.tsv$/i.test(name.trim()) ? "\t" : ",");
}
