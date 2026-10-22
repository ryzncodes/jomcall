import test from "node:test";
import assert from "node:assert/strict";
import {
  commands,
  capabilitiesFor,
} from "../../packages/contracts/src/core.ts";
test("phase2 keeps local booking capability separate from external calendar and voice", () => {
  assert.equal(capabilitiesFor("local").bookingLocal, true);
  assert.equal(capabilitiesFor("local").calendarWrite, false);
  assert.equal(capabilitiesFor("local").voiceCall, false);
  assert.equal(capabilitiesFor("mock").calendarWrite, true);
  for (const key of [
    "bookings",
    "requestBooking",
    "confirmBooking",
    "startAgentTest",
    "submitTestTurn",
    "applyBookingProposal",
  ] as const) {
    assert.ok(commands[key].path);
    assert.ok(commands[key].input);
  }
});
