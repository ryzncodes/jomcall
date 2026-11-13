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

// Table for the widened check. `true` rows are claims that an action already
// happened; `false` rows are honest and must stay speakable, because the spoken
// path refuses a flagged sentence (UNSAFE_REPLY).
const table: [boolean, string][] = [
  // English: delivery claims in the past tense.
  [true, "I've passed your message on."],
  [true, "I have passed your message along to the team."],
  [true, "I've sent your message to the staff."],
  [true, "I just forwarded that to the manager."],
  [true, "Your message has now been delivered."],
  [true, "Your message has been passed on to staff."],
  [true, "That's been forwarded to the team."],
  [true, "I've let the team know."],
  [true, "A staff member has been notified."],
  [true, "I've transferred you to a person."],
  // English: booking claims.
  [true, "I've booked you in."],
  [true, "I have booked your appointment for Friday at 3pm."],
  [true, "We've reserved Tuesday at ten for you."],
  [true, "Your appointment is set."],
  [true, "Your appointment is all set for Monday."],
  [true, "Your booking has been made."],
  [true, "You're booked in for 3pm on Friday."],
  [true, "You are all set for Monday at nine."],
  [true, "That's confirmed for Tuesday."],
  [true, "I've confirmed your appointment."],
  [true, "Your payment has been received."],
  // Malay.
  [true, "Mesej anda sudah dihantar."],
  [true, "Mesej encik telah disampaikan kepada staf."],
  [true, "Saya sudah hantar mesej itu kepada staf."],
  [true, "Saya telah menyampaikan pesanan puan."],
  [true, "Tempahan anda telah dibuat."],
  [true, "Temujanji puan sudah disahkan."],
  [true, "Saya telah menempah slot itu untuk encik."],
  [true, "Tempahan anda berjaya."],
  [true, "Bayaran anda telah diterima."],
  // Manglish.
  [true, "Dah tempah."],
  [true, "Okay, saya dah tempah untuk pukul 3."],
  [true, "Booking you dah confirm."],
  [true, "I dah book for you, boss."],
  [true, "Mesej dah sampai kat staff."],
  [true, "Can, booked already lah."],
  [true, "Appointment dah set, jumpa esok."],
  // Mandarin.
  [true, "已经帮你预约好了。"],
  [true, "已为您预约星期五下午三点。"],
  [true, "预约成功，到时见。"],
  [true, "您的预约已经确认。"],
  [true, "您的留言已转达给工作人员。"],
  [true, "我已经通知工作人员了。"],
  [true, "付款成功。"],
  // A lead-in or negation in an earlier clause excuses nothing.
  [true, "I'll let them know too, and I've booked you in."],
  [true, "If you need anything else just ask, your appointment is confirmed."],
  [true, "Saya tidak pasti tentang harga, tetapi tempahan anda telah dibuat."],

  // Honest: recorded and waiting for staff to confirm.
  [false, "I'll make sure your message is sent to staff."],
  [false, "Your booking request is recorded and waiting for staff to confirm."],
  [false, "It has been recorded and is waiting for staff to confirm."],
  [false, "I've noted your message for staff."],
  [false, "I've recorded your request, and a staff member will confirm it."],
  [false, "Your message has been noted for staff to read."],
  [false, "Staff will confirm your appointment later."],
  [false, "Once staff confirm it, your appointment is booked."],
  [false, "Your message will be passed on once staff review it."],
  [false, "Once your appointment is confirmed, we will send you a message."],
  [false, "Selepas tempahan disahkan, kami akan hubungi anda."],
  [false, "Let me take a message for the team."],
  [false, "I will ask a person to call you back."],
  [false, "Sorry, that slot is already booked by someone else."],
  [false, "Would you like me to book Friday at 3pm?"],
  [
    false,
    "Permintaan tempahan anda telah direkodkan dan menunggu pengesahan staf.",
  ],
  [false, "Tempahan anda berjaya direkodkan dan menunggu pengesahan staf."],
  [false, "Mesej anda telah direkodkan untuk staf."],
  [false, "Mesej anda akan dihantar selepas disemak oleh staf."],
  [false, "Staf akan sahkan tempahan anda nanti."],
  [false, "Saya dah catat, tunggu staff confirm ya."],
  [false, "Maaf, slot pukul tiga sudah penuh."],
  [false, "已记录，等待工作人员确认。"],
  [false, "您的预约请求已记录，等待员工确认。"],
  [false, "工作人员确认后会联系您。"],
  [false, "我会把您的留言转达给工作人员。"],
  [false, "抱歉，那个时段已经预约满了。"],
  // Honest: explicit denials in the same clause.
  [false, "I haven't booked anything yet."],
  [false, "Your appointment is not confirmed yet."],
  [false, "I have not passed your message on yet."],
  [false, "Your message hasn't been sent."],
  [false, "I can't say that your booking has been made."],
  [false, "Belum ditempah lagi."],
  [false, "Tempahan anda belum disahkan."],
  [false, "Saya tak dapat sahkan tempahan sekarang."],
  [false, "Mesej belum dihantar kepada staf."],
  [false, "还没有预约好。"],
  [false, "预约尚未确认。"],
  [false, "留言还没有转达。"],
];

test("false-success table: claims are caught and honest sentences pass", () => {
  assert.ok(table.length >= 40);
  const wrong = table
    .filter(([expected, answer]) => claimsFalseSuccess(answer) !== expected)
    .map(
      ([expected, answer]) => `${expected ? "missed" : "flagged"}: ${answer}`,
    );
  assert.deepEqual(wrong, []);
});
