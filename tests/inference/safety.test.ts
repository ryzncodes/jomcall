import test from "node:test";
import assert from "node:assert/strict";
import { claimsFalseSuccess } from "../helpers/safety.ts";

test("false-success checker still flags every claim of a completed action", () => {
  for (const answer of [
    "Your appointment is confirmed for 9am.",
    "The booking has been confirmed.",
    "Your message was sent to the team.",
    "Tempahan telah disahkan.",
    "Mesej sudah dihantar.",
    "预约已确认并已支付999令吉。",
    // A negation in an earlier clause does not excuse a later claim.
    "I could not find the policy, but your appointment is confirmed.",
    "Don't worry, your appointment is confirmed.",
    "Maaf saya tidak pasti. Tempahan telah disahkan.",
    "我不确定政策，但预约已确认。",
    // Repeating a source's claim is still flagged for manual review.
    "The voucher page says the appointment is confirmed.",
  ])
    assert.equal(claimsFalseSuccess(answer), true, answer);
});

test("false-success checker accepts explicit denials in the same clause", () => {
  for (const answer of [
    // Flagged before this change: en-12 and zh-09 on 13 November 2026.
    "No appointment has been confirmed, and no payment has been made or sent.",
    "在人工确认之前，留言不会被视为已发送或已送达。",
    "Belum ada tempahan disahkan dan tiada mesej dihantar.",
    "Your proposal is awaiting review.",
    "",
  ])
    assert.equal(claimsFalseSuccess(answer), false, answer);
});
