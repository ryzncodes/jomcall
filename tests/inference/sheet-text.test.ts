import test from "node:test";
import assert from "node:assert/strict";
import {
  sheetToText,
  SHEET_LIMITS,
} from "../../packages/inference/src/sheet-text.ts";

// Delimited text only: .xlsx is not read in this release. All fixtures are
// synthetic strings built here.

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
const read = (text: string, name = "harga.csv") =>
  sheetToText(Buffer.from(text, "utf8"), name);
const lines = async (text: string, name?: string) =>
  (await read(text, name)).split("\n");

test("a comma file dumps every non-empty cell with its address", async () => {
  assert.deepEqual(
    await lines("Item,Harga\nPotong rambut,25\n,\nCuci,12.50\n"),
    [
      "csv!A1: Item",
      "csv!B1: Harga",
      "csv!A2: Potong rambut",
      "csv!B2: 25",
      "csv!A4: Cuci",
      "csv!B4: 12.50",
    ],
  );
});

test("cells pasted from a spreadsheet arrive tab-separated and are split on tabs", async () => {
  const pasted =
    "Servis\tHarga (RM)\tNota\nPotong, dewasa\t25\t\nCuci\t12,50\tpromo\n";
  assert.deepEqual(await lines(pasted, "Pasted text"), [
    "csv!A1: Servis",
    "csv!B1: Harga (RM)",
    "csv!C1: Nota",
    "csv!A2: Potong, dewasa",
    "csv!B2: 25",
    "csv!A3: Cuci",
    "csv!B3: 12,50",
    "csv!C3: promo",
  ]);
});

test("a semicolon file is split on semicolons, with quotes honoured", async () => {
  assert.deepEqual(await lines('Item;Harga\n"Teh; ais";2,20\nKopi;1,80\n'), [
    "csv!A1: Item",
    "csv!B1: Harga",
    "csv!A2: Teh; ais",
    "csv!B2: 2,20",
    "csv!A3: Kopi",
    "csv!B3: 1,80",
  ]);
});

test("the delimiter is picked by consistent column count, not by the name", async () => {
  // Commas appear inside the values, but only tabs split every line evenly.
  const text = "a, b\tRM 1,000\nc, d\tRM 2,500\ne\tRM 3\n";
  assert.deepEqual(await lines(text, "list.csv"), [
    "csv!A1: a, b",
    "csv!B1: RM 1,000",
    "csv!A2: c, d",
    "csv!B2: RM 2,500",
    "csv!A3: e",
    "csv!B3: RM 3",
  ]);
});

test("quoted fields keep embedded delimiters, quotes and line breaks; a BOM is dropped", async () => {
  const csv =
    "﻿Item,Harga,Nota\r\n" +
    '"Nasi lemak, telur",5.50,"kata ""best"""\r\n' +
    '"Teh\nais",2.20,\n' +
    "炒饭,8,";
  assert.deepEqual(await lines(csv), [
    "csv!A1: Item",
    "csv!B1: Harga",
    "csv!C1: Nota",
    "csv!A2: Nasi lemak, telur",
    "csv!B2: 5.50",
    'csv!C2: kata "best"',
    "csv!A3: Teh ais",
    "csv!B3: 2.20",
    "csv!A4: 炒饭",
    "csv!B4: 8",
  ]);
});

test("a zip (an .xlsx), invalid UTF-8, a NUL byte or nothing is UNREADABLE", async () => {
  const zip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("a,b\n"),
  ]);
  assert.equal(await code(sheetToText(zip, "harga.xlsx")), "UNREADABLE");
  const latin = Buffer.from([0x48, 0x61, 0x72, 0x67, 0x61, 0xe9, 0x2c, 0x31]);
  assert.equal(await code(sheetToText(latin, "harga.csv")), "UNREADABLE");
  assert.equal(
    await code(sheetToText(Buffer.from("a,b\n\0c"), "a.csv")),
    "UNREADABLE",
  );
  assert.equal(await code(sheetToText(Buffer.alloc(0), "a.csv")), "UNREADABLE");
});

test("300 non-empty rows are read; a 301st makes it TOO_LONG, never a silent cut", async () => {
  const row = (i: number) => `Item ${i},${i}`;
  const ok = Array.from({ length: 300 }, (_, i) => row(i + 1)).join("\n");
  // Empty rows in between do not count.
  const withGaps = ok.replace(/\n/g, "\n,\n");
  const got = await lines(withGaps);
  assert.equal(got.length, 600);
  assert.equal(got.at(-1), "csv!B599: 300");
  assert.equal(await code(read(`${ok}\n${row(301)}`)), "TOO_LONG");
});

test("columns past 30 are skipped, in plain and in quoted cells", async () => {
  const cells = Array.from({ length: 40 }, (_, i) => `c${i + 1}`);
  const plain = await lines(cells.join(","));
  assert.equal(plain.length, SHEET_LIMITS.columns);
  assert.equal(plain.at(-1), "csv!AD1: c30");
  const quoted = await lines(
    cells.map((c) => `"${c}, x"`).join(",") + "\nend,1",
  );
  assert.equal(quoted.length, SHEET_LIMITS.columns + 2);
  assert.ok(!quoted.some((l) => l.includes("c31")));
  assert.deepEqual(quoted.slice(-2), ["csv!A2: end", "csv!B2: 1"]);
});

test("a 5,000-character cell is cut to 1,000, and reading goes on", async () => {
  const got = await lines(
    `${"x".repeat(5000)},25\nKopi,"${"y".repeat(5000)}"\nTeh,2`,
  );
  assert.equal(got[0], `csv!A1: ${"x".repeat(1000)}`);
  assert.equal(got[1], "csv!B1: 25");
  assert.equal(got[3], `csv!B2: ${"y".repeat(1000)}`);
  assert.deepEqual(got.slice(-2), ["csv!A3: Teh", "csv!B3: 2"]);
  // A cut never leaves half of a surrogate pair.
  const emoji = await lines(`${"a".repeat(999)}😀b,1`);
  assert.equal(emoji[0], `csv!A1: ${"a".repeat(999)}`);
});

test("a dump over 200,000 characters is TOO_LONG", async () => {
  const long = Array.from({ length: 300 }, () =>
    Array.from({ length: 30 }, () => "x".repeat(30)).join(","),
  ).join("\n");
  assert.equal(await code(read(long)), "TOO_LONG");
});

test("a quote that opens a field and never closes is UNREADABLE, not one swallowed cell", async () => {
  const csv =
    'Item,Price\nNasi lemak,500\n"Teh tarik,200\nRoti canai,150\nMee goreng,700\n';
  assert.equal(await code(read(csv)), "UNREADABLE");
  // A stray quote followed by 400 rows cannot hide them from the row cap.
  const rows = Array.from({ length: 400 }, (_, i) => `Item ${i},${i}`).join(
    "\n",
  );
  assert.equal(
    await code(read(`Item,Price\n"oops,1\n${rows}\n`)),
    "UNREADABLE",
  );
  // A closed quote spanning lines is still one valid cell.
  assert.deepEqual(await lines('Item,Nota\nTeh,"baris satu\nbaris dua"\n'), [
    "csv!A1: Item",
    "csv!B1: Nota",
    "csv!A2: Teh",
    "csv!B2: baris satu baris dua",
  ]);
  // Tab-separated text takes quotes as written, so a lone quote is fine there.
  assert.deepEqual(await lines('Item\tNota\n"Teh\t2\nKopi\t3\n'), [
    "csv!A1: Item",
    "csv!B1: Nota",
    'csv!A2: "Teh',
    "csv!B2: 2",
    "csv!A3: Kopi",
    "csv!B3: 3",
  ]);
});

test("delimited text over 1 MiB is TOO_LONG before any parsing", async () => {
  const over = Buffer.alloc(SHEET_LIMITS.bytes + 1, 0x61);
  assert.equal(SHEET_LIMITS.bytes, 1_048_576);
  assert.equal(await code(sheetToText(over, "a.csv")), "TOO_LONG");
  // Even bytes that would otherwise be refused as unreadable.
  const zipped = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), over]);
  assert.equal(await code(sheetToText(zipped, "a.xlsx")), "TOO_LONG");
  // At the limit it is parsed: one long cell, cut to 1,000 characters.
  const at = Buffer.alloc(SHEET_LIMITS.bytes, 0x61);
  assert.equal(await read(at.toString()), `csv!A1: ${"a".repeat(1000)}`);
});
