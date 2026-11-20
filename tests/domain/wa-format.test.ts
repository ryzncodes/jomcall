import test from "node:test";
import assert from "node:assert/strict";
import { waPieces } from "../../web/lib/core/wa-format.ts";

const bold = (t: string) =>
  waPieces(t)
    .filter((p) => p.bold)
    .map((p) => p.text);
const joined = (t: string) =>
  waPieces(t)
    .map((p) => p.text)
    .join("");

test("item names between asterisks become bold pieces, the rest stays as typed", () => {
  const text =
    "We have three packages.\n-*Landing page*: from RM1,500 one-off.\n-*Care Plan*: RM200 to RM500 per month.\nWhich one interests you?";
  assert.deepEqual(bold(text), ["Landing page", "Care Plan"]);
  assert.equal(joined(text), text.replaceAll("*", ""));
  assert.deepEqual(waPieces("*Hi* there"), [
    { text: "Hi", bold: true },
    { text: " there", bold: false },
  ]);
});

test("stars that are not WhatsApp bold are left alone", () => {
  for (const t of [
    "2*3*4",
    "a * b * c",
    "file*name*",
    "*open only",
    "* spaced *",
    "line one*\n*line two",
    "",
    "****",
  ])
    assert.deepEqual(waPieces(t), t ? [{ text: t, bold: false }] : [], t);
});

test("markup inside a message stays text", () => {
  const pieces = waPieces("*<b>x</b>* <script>");
  assert.deepEqual(pieces, [
    { text: "<b>x</b>", bold: true },
    { text: " <script>", bold: false },
  ]);
});
