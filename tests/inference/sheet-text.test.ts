import test from "node:test";
import assert from "node:assert/strict";
import {
  sheetToText,
  SHEET_LIMITS,
} from "../../packages/inference/src/sheet-text.ts";

// Delimited text is passed through, not parsed. All fixtures are synthetic
// strings built here.

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

test("comma, tab and semicolon text pass through unchanged", async () => {
  for (const text of [
    'Item,Harga\n"Nasi lemak, telur",5.50\nTeh ais,2.20',
    "Servis\tHarga (RM)\tNota\nPotong, dewasa\t25\t\nCuci\t12,50\tpromo",
    'Item;Harga\n"Teh; ais";2,20\nKopi;1,80',
  ])
    assert.equal(await read(text), text);
});

test("a BOM is dropped, CRLF and CR become LF, empty lines go, other control characters are stripped", async () => {
  assert.equal(
    await read("﻿Item,Harga\r\nKopi,1.80\r\n\r\n  \rTeh\u0007,2\u0085\r\n"),
    "Item,Harga\nKopi,1.80\nTeh,2",
  );
  // Tabs survive.
  assert.equal(await read("a\tb\n\n"), "a\tb");
});

test("stray or leading quotes and mixed delimiters pass through and are not errors", async () => {
  const mixed = 'Item,Price\n"Roti,1200\nNasi\tlemak,500\n';
  assert.equal(await read(mixed), 'Item,Price\n"Roti,1200\nNasi\tlemak,500');
  const pizza = 'Item,Price\n"12 inch pizza,1200\nGarlic bread,600\n';
  assert.equal(
    await read(pizza),
    'Item,Price\n"12 inch pizza,1200\nGarlic bread,600',
  );
});

test("a stray quote followed by 400 rows is TOO_LONG, not a partial read", async () => {
  const rows = Array.from({ length: 400 }, (_, i) => `Item ${i},${i}`).join(
    "\n",
  );
  assert.equal(await code(read(`Item,Price\n"oops,1\n${rows}\n`)), "TOO_LONG");
});

test("301 non-empty lines (a header plus 300 rows) pass; 302 are TOO_LONG", async () => {
  const lines = (n: number) =>
    Array.from({ length: n }, (_, i) => `Item ${i},${i}`).join("\n\n");
  const ok = await read(lines(301));
  assert.equal(ok.split("\n").length, SHEET_LIMITS.lines);
  assert.equal(await code(read(lines(302))), "TOO_LONG");
});

test("a 5,000-character line is cut to 4,000 without splitting a character", async () => {
  const got = await read(`${"x".repeat(5000)}\nKopi,1.80`);
  assert.deepEqual(got.split("\n"), ["x".repeat(4000), "Kopi,1.80"]);
  const emoji = await read(`${"a".repeat(3999)}😀b`);
  assert.equal(emoji, "a".repeat(3999));
});

test("a zip, a NUL byte, invalid UTF-8 or nothing but whitespace is UNREADABLE", async () => {
  const zip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("a,b\n"),
  ]);
  assert.equal(await code(sheetToText(zip, "harga.xlsx")), "UNREADABLE");
  assert.equal(
    await code(sheetToText(Buffer.from("a,b\n\0c"), "a.csv")),
    "UNREADABLE",
  );
  const latin = Buffer.from([0x48, 0x61, 0x72, 0x67, 0x61, 0xe9, 0x2c, 0x31]);
  assert.equal(await code(sheetToText(latin, "harga.csv")), "UNREADABLE");
  assert.equal(await code(sheetToText(Buffer.alloc(0), "a.csv")), "UNREADABLE");
  assert.equal(await code(read(" \r\n\t\n﻿")), "UNREADABLE");
});

test("text over 1 MiB is TOO_LONG before anything else", async () => {
  assert.equal(SHEET_LIMITS.bytes, 1_048_576);
  const over = Buffer.alloc(SHEET_LIMITS.bytes + 1, 0x61);
  assert.equal(await code(sheetToText(over, "a.csv")), "TOO_LONG");
  const zipped = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), over]);
  assert.equal(await code(sheetToText(zipped, "a.xlsx")), "TOO_LONG");
  // At the limit it is read: one line, cut to 4,000 characters.
  const at = Buffer.alloc(SHEET_LIMITS.bytes, 0x61);
  assert.equal(await sheetToText(at, "a.csv"), "a".repeat(4000));
});
