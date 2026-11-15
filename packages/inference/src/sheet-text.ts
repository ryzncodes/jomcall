// Prepares an uploaded delimited text file (CSV, tab-separated cells copied
// from a spreadsheet, or semicolon-separated) for the setup reader. The text
// is passed through, not parsed: the model reads delimited text directly, and
// every parsing rule tried here was a source of wrong reads. Excel workbooks
// (.xlsx) are not read in this release (owner decision, 2026-11-15).
//
// Throws an Error whose `code` is TOO_LONG (over 1 MiB, or more than 301
// non-empty lines: a header plus 300 rows) or UNREADABLE (a zip, a NUL byte,
// invalid UTF-8, or nothing but whitespace). No other error escapes.

export const SHEET_LIMITS = {
  // Larger files are refused before anything else.
  bytes: 1_048_576,
  // A header plus 300 rows. A quoted cell that spans lines counts each line,
  // which errs towards refusing.
  lines: 301,
  lineChars: 4000,
} as const;

export type SheetTextCode = "UNREADABLE" | "TOO_LONG";

function fail(code: SheetTextCode): Error {
  return Object.assign(new Error(code), { code });
}

// Control characters other than tab and newline (C0, DEL and C1).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

// Cuts to at most `max` UTF-16 units without leaving half a surrogate pair.
function cutLine(line: string, max: number): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

function prepare(data: Buffer): string {
  if (data.length > SHEET_LIMITS.bytes) throw fail("TOO_LONG");
  if (data.length >= 4 && data.readUInt32LE(0) === 0x04034b50)
    throw fail("UNREADABLE");
  if (data.includes(0)) throw fail("UNREADABLE");
  let text: string;
  try {
    // The default decoder drops a leading byte-order mark.
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw fail("UNREADABLE");
  }
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) throw fail("UNREADABLE");
  if (lines.length > SHEET_LIMITS.lines) throw fail("TOO_LONG");
  return lines.map((line) => cutLine(line, SHEET_LIMITS.lineChars)).join("\n");
}

export async function sheetToText(data: Buffer, name: string): Promise<string> {
  void name; // the content decides everything, not the file name
  try {
    return prepare(data);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "TOO_LONG" || code === "UNREADABLE") throw error;
    throw fail("UNREADABLE");
  }
}
