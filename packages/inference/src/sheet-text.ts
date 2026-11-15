// Turns an uploaded delimited text file (CSV, tab-separated cells pasted out
// of a spreadsheet, or semicolon-separated) into a plain cell dump for the
// setup reader: one line per non-empty cell as `csv!<address>: <value>`, with
// A1-style addresses. Excel workbooks (.xlsx) are not read in this release
// (owner decision, 2026-11-15): owners paste the cells or save as CSV or PDF.
//
// Throws an Error whose `code` is UNREADABLE (a zip, not UTF-8, or a NUL
// byte) or TOO_LONG (more than 300 non-empty rows, or a dump over 200,000
// characters, so a long list is never half-read). No other error escapes.

export const SHEET_LIMITS = {
  rows: 300,
  columns: 30,
  cellChars: 1000,
  chars: 200_000,
  // Lines looked at to pick the delimiter.
  sampleLines: 20,
} as const;

export type SheetTextCode = "UNREADABLE" | "TOO_LONG";
type Delimiter = "," | "\t" | ";";

function fail(code: SheetTextCode): Error {
  return Object.assign(new Error(code), { code });
}

function column(n: number): string {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26))
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function decode(data: Buffer): string {
  if (data.length === 0) throw fail("UNREADABLE");
  if (data.length >= 4 && data.readUInt32LE(0) === 0x04034b50)
    throw fail("UNREADABLE");
  if (data.includes(0)) throw fail("UNREADABLE");
  try {
    // The default decoder drops a leading byte-order mark.
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw fail("UNREADABLE");
  }
}

// Walks records, calling `cell` for each field (at most `columns` per record,
// each at most `cellChars` long) and `row` at the end of each record. Either
// callback returns false to stop. Quotes are honoured for comma and semicolon
// only; a pasted tab-separated block is taken as written.
function walk(
  text: string,
  delimiter: Delimiter,
  cell: (row: number, col: number, value: string) => boolean,
  row: (row: number) => boolean,
): void {
  const quotes = delimiter !== "\t";
  let r = 1;
  let c = 1;
  let field = "";
  let quoted = false;
  let started = false;
  let stop = false;
  const push = (ch: string) => {
    if (c <= SHEET_LIMITS.columns && field.length < SHEET_LIMITS.cellChars)
      field += ch;
  };
  const endField = () => {
    if (c <= SHEET_LIMITS.columns) {
      // A cut that ends on half a surrogate pair drops that half.
      const last = field.charCodeAt(field.length - 1);
      const value =
        field.length >= SHEET_LIMITS.cellChars &&
        last >= 0xd800 &&
        last <= 0xdbff
          ? field.slice(0, -1)
          : field;
      if (!cell(r, c, value)) stop = true;
    }
    field = "";
    started = false;
    c += 1;
  };
  const endRow = () => {
    endField();
    if (!stop && !row(r)) stop = true;
    r += 1;
    c = 1;
  };
  for (let i = 0; i < text.length && !stop; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          push('"');
          i++;
        } else quoted = false;
      } else push(ch);
      continue;
    }
    if (quotes && ch === '"' && !started) {
      quoted = true;
      started = true;
    } else if (ch === delimiter) endField();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      push(ch);
      started = true;
    }
  }
  if (!stop && (field || started || c > 1)) endRow();
}

// Picks the delimiter whose column count is most consistent over the first
// lines: the score is how many sampled records have the most common count,
// and a count of one column scores nothing. Tab wins a tie when present.
function detect(text: string): Delimiter {
  const order: Delimiter[] = ["\t", ",", ";"];
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const d of order) {
    if (!text.includes(d)) continue;
    const counts: number[] = [];
    let cols = 0;
    walk(
      text,
      d,
      (_r, col) => {
        cols = col;
        return true;
      },
      () => {
        counts.push(cols);
        cols = 0;
        return counts.length < SHEET_LIMITS.sampleLines;
      },
    );
    const tally = new Map<number, number>();
    for (const n of counts) tally.set(n, (tally.get(n) ?? 0) + 1);
    let score = 0;
    for (const [n, times] of tally) if (n > 1 && times > score) score = times;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function dump(text: string, delimiter: Delimiter): string {
  const lines: string[] = [];
  let chars = 0;
  let rows = 0;
  let rowHasLine = false;
  walk(
    text,
    delimiter,
    (r, c, raw) => {
      const value = raw.replace(/[\r\n]+/g, " ").trim();
      if (!value) return true;
      const line = `csv!${column(c)}${r}: ${value}`;
      chars += line.length + (lines.length ? 1 : 0);
      if (chars > SHEET_LIMITS.chars) throw fail("TOO_LONG");
      lines.push(line);
      rowHasLine = true;
      return true;
    },
    () => {
      if (rowHasLine) rows += 1;
      rowHasLine = false;
      if (rows > SHEET_LIMITS.rows) throw fail("TOO_LONG");
      return true;
    },
  );
  return lines.join("\n");
}

export async function sheetToText(data: Buffer, name: string): Promise<string> {
  void name; // the delimiter comes from the content, not the file name
  try {
    const text = decode(data);
    return dump(text, detect(text));
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "TOO_LONG" || code === "UNREADABLE") throw error;
    throw fail("UNREADABLE");
  }
}
