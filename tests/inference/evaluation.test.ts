import test from "node:test";
import assert from "node:assert/strict";
import { fixtureOpen, messageOrHandoffTask } from "../helpers/evaluation.ts";

const noon = new Date("2026-11-16T12:00:00+08:00");
const midnight = new Date("2026-11-16T00:05:00+08:00");
const closing = new Date("2026-11-16T18:00:00+08:00");

test("the fixture business is open 09:00 to 18:00 Kuala Lumpur time", () => {
  assert.equal(fixtureOpen(noon), true);
  assert.equal(fixtureOpen(midnight), false);
  assert.equal(fixtureOpen(closing), false);
  assert.equal(fixtureOpen(new Date("2026-11-16T09:00:00+08:00")), true);
});

test("a message case passes when recorded or when the agent asks for details", () => {
  assert.equal(
    messageOrHandoffTask("message", [{ kind: "message" }], ""),
    true,
  );
  for (const answer of [
    "I can take that message. Please give me your name and a callback number.",
    "Baik. Sila berikan nama anda dan nombor untuk dihubungi semula.",
    "好的，请提供您的姓名和回电号码。",
  ])
    assert.equal(messageOrHandoffTask("message", [], answer), true, answer);
  assert.equal(
    messageOrHandoffTask("message", [], "Sorry, I cannot help with that."),
    false,
  );
});

test("a handoff case needs a handoff in opening hours", () => {
  assert.equal(
    messageOrHandoffTask("handoff", [{ kind: "handoff" }], "", noon),
    true,
  );
  assert.equal(
    messageOrHandoffTask(
      "handoff",
      [],
      "I can take a message for staff.",
      noon,
    ),
    false,
  );
});

test("outside opening hours a handoff case needs a message offer and no handoff", () => {
  assert.equal(
    messageOrHandoffTask(
      "handoff",
      [],
      "We are closed now. I can take a message for staff.",
      midnight,
    ),
    true,
  );
  assert.equal(
    messageOrHandoffTask(
      "handoff",
      [],
      "我们现在已关门，我可以为您留言。",
      midnight,
    ),
    true,
  );
  assert.equal(
    messageOrHandoffTask(
      "handoff",
      [{ kind: "handoff" }],
      "Transferring you.",
      midnight,
    ),
    false,
  );
  assert.equal(
    messageOrHandoffTask("handoff", [], "We are closed.", midnight),
    false,
  );
});

test("an after-hours offer to record the caller's details counts as a message offer", () => {
  assert.equal(
    messageOrHandoffTask(
      "handoff",
      [],
      "现在是非营业时间。您可以留下姓名和回电号码，我会记录下来交给同事。",
      midnight,
    ),
    true,
  );
});
