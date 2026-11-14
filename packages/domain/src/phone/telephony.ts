import { RoomServiceClient, SipClient } from "livekit-server-sdk";

// What the phone path needs from a telephony provider, and nothing more.
// LiveKit SIP is the only real implementation; tests and the local simulator
// use the in-memory fake. No telephony account exists yet, so the LiveKit
// implementation has only been checked against its type definitions
// (livekit-server-sdk 2.19.2) and LiveKit's documentation, never a live call.
export type SipParticipant = {
  kind: "sip" | "other";
  identity: string;
  attributes: Record<string, string>;
};
export type TransferOutcome = { ok: boolean; reason: string | null };

export interface Telephony {
  // The participant as LiveKit knows it. The phone server trusts these
  // attributes, never what the worker sends.
  participant(room: string, identity: string): Promise<SipParticipant | null>;
  // Blind (cold) transfer by SIP REFER. On failure the caller stays in the room.
  transfer(
    room: string,
    identity: string,
    to: string,
  ): Promise<TransferOutcome>;
}

export type TelephonyConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
  // Template for the REFER target, with {e164} replaced. Default "tel:{e164}".
  // Plivo needs "sip:{e164}@<trunk-id>.zt.plivo.com".
  transferUri: string;
  maxConcurrent: number;
  capSeconds: number;
};

type Env = Record<string, string | undefined>;

// Opt-in, off by default. Phone calls also need the hosted voice switch,
// because the spoken brain and the speech services are the same ones.
export function telephonyConfig(
  env: Env = process.env,
): { config: TelephonyConfig; reason: null } | { config: null; reason: string } {
  const provider = env.JOMCALL_TELEPHONY_PROVIDER ?? "disabled";
  if (provider !== "disabled" && provider !== "livekit_sip")
    throw Error("TELEPHONY_PROVIDER_INVALID");
  const missing: string[] = [];
  if (provider !== "livekit_sip")
    missing.push("JOMCALL_TELEPHONY_PROVIDER=livekit_sip");
  if (env.JOMCALL_VOICE_PROVIDER !== "hosted")
    missing.push("JOMCALL_VOICE_PROVIDER=hosted");
  for (const name of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"])
    if (!env[name]) missing.push(name);
  if (missing.length)
    return { config: null, reason: "Phone calls need " + missing.join(", ") };
  const transferUri = env.JOMCALL_SIP_TRANSFER_URI || "tel:{e164}";
  if (!transferUri.includes("{e164}")) throw Error("TRANSFER_URI_INVALID");
  const bounded = (raw: string | undefined, fallback: number, lo: number, hi: number) => {
    const n = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isInteger(n) || n < lo || n > hi) throw Error("TELEPHONY_LIMIT_INVALID");
    return n;
  };
  return {
    config: {
      url: env.LIVEKIT_URL!,
      apiKey: env.LIVEKIT_API_KEY!,
      apiSecret: env.LIVEKIT_API_SECRET!,
      transferUri,
      maxConcurrent: bounded(env.JOMCALL_MAX_CONCURRENT_CALLS, 1, 1, 20),
      capSeconds: bounded(env.JOMCALL_CALL_CAP_SECONDS, 600, 60, 3600),
    },
    reason: null,
  };
}

export function telephonyReadiness(env: Env = process.env) {
  try {
    const { config, reason } = telephonyConfig(env);
    return { configured: config !== null, reason };
  } catch (error) {
    return { configured: false, reason: (error as Error).message };
  }
}

// ParticipantInfo.Kind.SIP in @livekit/protocol.
const KIND_SIP = 3;

export function liveKitTelephony(config: TelephonyConfig): Telephony {
  const host = config.url.replace(/^ws/, "http");
  const rooms = new RoomServiceClient(host, config.apiKey, config.apiSecret);
  const sip = new SipClient(host, config.apiKey, config.apiSecret);
  return {
    async participant(room, identity) {
      try {
        const info = await rooms.getParticipant(room, identity);
        return {
          kind: Number(info.kind) === KIND_SIP ? "sip" : "other",
          identity: info.identity,
          attributes: { ...(info.attributes ?? {}) },
        };
      } catch {
        return null;
      }
    },
    async transfer(room, identity, to) {
      try {
        await sip.transferSipParticipant(
          room,
          identity,
          config.transferUri.replace("{e164}", to),
          { playDialtone: false, ringingTimeout: 20 },
        );
        return { ok: true, reason: null };
      } catch (error) {
        const e = error as { metadata?: Record<string, string>; code?: string };
        const reason = e.metadata?.sip_transfer_reason ?? e.code ?? "TRANSFER_FAILED";
        return { ok: false, reason: /^[A-Za-z_]{1,40}$/.test(reason) ? reason : "TRANSFER_FAILED" };
      }
    },
  };
}

// In-memory telephony for tests and the local simulator. Participants are
// added by the test; each transfer takes the next scripted outcome.
export class FakeTelephony implements Telephony {
  participants = new Map<string, SipParticipant>();
  transfers: { room: string; identity: string; to: string }[] = [];
  outcomes: TransferOutcome[] = [];
  addCaller(
    room: string,
    identity: string,
    attributes: Record<string, string>,
    kind: SipParticipant["kind"] = "sip",
  ) {
    this.participants.set(room + "\u0000" + identity, { kind, identity, attributes });
  }
  async participant(room: string, identity: string) {
    return this.participants.get(room + "\u0000" + identity) ?? null;
  }
  async transfer(room: string, identity: string, to: string) {
    this.transfers.push({ room, identity, to });
    return this.outcomes.shift() ?? { ok: false, reason: "STR_RINGING_TIMEOUT" };
  }
}
