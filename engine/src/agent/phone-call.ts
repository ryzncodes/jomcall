import { createHash, randomBytes } from "node:crypto";
import { executeTestTool } from "../../../packages/domain/src/agent-test/tools.ts";
import { toolCallSchema } from "../../../packages/contracts/src/agent-test.ts";
import { VOICE_PRESETS } from "../../../packages/domain/src/agent-test/voice-session.ts";
import { toE164 } from "../../../packages/domain/src/phone/numbers.ts";
import type { Telephony } from "../../../packages/domain/src/phone/telephony.ts";
import type { CallRepository } from "./call-repository.ts";
import type { VoiceTurnPolicy } from "./voice-turn.ts";

export type PhoneDeps = {
  calls: CallRepository;
  telephony: Telephony;
  maxConcurrent: number;
  capSeconds: number;
  now(): number;
};

export class PhoneError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export type PhoneStart =
  | {
      callId: string;
      token: string;
      voice: string;
      greeting: string;
      disclosure: string;
      recordingDisclosure: string;
      afterHours: boolean;
      capSeconds: number;
      refusal: null;
    }
  | { callId: string | null; refusal: string; busyLine: boolean };

// Refusals the caller hears the busy line for; the others end the call silently.
const BUSY_LINE = new Set(["LINES_BUSY", "CALLER_LIMIT"]);

// The server-side call start. The worker supplies only the room and the
// participant identity; every fact about the call comes from LiveKit.
export async function startPhoneCall(
  deps: PhoneDeps,
  request: { room: string; identity: string },
): Promise<PhoneStart> {
  const participant = await deps.telephony.participant(request.room, request.identity);
  if (!participant || participant.kind !== "sip") throw new PhoneError("NOT_SIP", 403);
  const a = participant.attributes;
  const dialled = toE164(a["sip.trunkPhoneNumber"]);
  const sipCallId = a["sip.callID"] ?? "";
  if (!dialled || !sipCallId) throw new PhoneError("NOT_SIP", 403);
  // A withheld or malformed caller ID is allowed: the call has no contact.
  const caller = toE164(a["sip.phoneNumber"]);
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let result: any;
  try {
    result = await deps.calls.start({
      dialled,
      caller,
      sipCallId,
      room: request.room,
      identity: request.identity,
      tokenHash,
      maxConcurrent: deps.maxConcurrent,
      capSeconds: deps.capSeconds,
      at: new Date(deps.now()).toISOString(),
    });
  } catch (error) {
    const code = (error as Error).message;
    if (code === "UNKNOWN_NUMBER")
      return { callId: null, refusal: code, busyLine: false };
    if (code === "DUPLICATE_CALL") throw new PhoneError(code, 409);
    throw new PhoneError("CALL_START_FAILED", 500);
  }
  if (result.refusal)
    return { callId: result.callId, refusal: result.refusal, busyLine: BUSY_LINE.has(result.refusal) };
  const settings = result.settings ?? {};
  const text = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const voice = VOICE_PRESETS.find((p) => p === settings.voicePreference) ?? VOICE_PRESETS[0];
  return {
    callId: result.callId,
    token,
    voice,
    greeting: text(settings.greeting),
    disclosure: text(settings.aiDisclosure),
    recordingDisclosure: result.recordingEnabled ? text(settings.recordingDisclosure) : "",
    afterHours: !!result.afterHours,
    capSeconds: result.capSeconds,
    refusal: null,
  };
}

// Rules added to the shared spoken rules on a real call.
export const phoneRules = [
  "This is a real phone call from a customer, not a test.",
  "Booking read-back is checked by the system. The first time you call book_slot for a time, nothing is recorded: the result has kind readback_required. Then read the service, the day and the time back to the caller in one short sentence and ask them to say yes. Call book_slot again with exactly the same details only after the caller's latest message says yes. If the caller changes anything, read the new details back and wait again.",
  "handoff_to_human tries to transfer the call to staff when the business is open. If the result says the transfer did not go through, say sorry and offer to take a message. Never promise a call back at a particular time.",
].join(" ");

export function phonePolicy(deps: PhoneDeps): VoiceTurnPolicy {
  return {
    fastLane: false,
    rules(envelope) {
      const call = envelope.call ?? {};
      const notes: string[] = [];
      if (call.afterHours)
        notes.push(
          "The business is closed right now. Say so, offer to take a message or to propose a booking during opening hours. Do not offer a transfer to staff.",
        );
      if (call.doNotContact)
        notes.push(
          "This caller asked not to be contacted. Do not offer a WhatsApp message, a follow-up or a call back.",
        );
      return { stable: phoneRules, volatile: notes.join(" ") };
    },
    async runTool(access, step, call, envelope) {
      const info = envelope.call ?? {};
      if (call.name === "handoff_to_human" && info.transferTo && !info.afterHours) {
        const parsed = toolCallSchema.parse(call);
        const outcome = await deps.telephony.transfer(info.room, info.identity, info.transferTo);
        await deps.calls.recordTransfer(envelope, step, parsed.args, outcome);
        return { kind: "transfer", ok: outcome.ok, reason: outcome.reason };
      }
      // After hours, no staff number, or any other tool: the test-path executor
      // with call-backed storage (bookings pass the read-back check in SQL).
      return executeTestTool(access, step, call);
    },
  };
}
