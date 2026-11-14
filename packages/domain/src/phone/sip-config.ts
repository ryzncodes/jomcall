// LiveKit SIP objects an operator applies with `lk sip inbound create` and
// `lk sip dispatch create`. Field names follow LiveKit's documentation
// (telephony/accepting-calls/inbound-trunk.md and dispatch-rule.md, read
// 2026-11-14). Nothing here is ever sent to a provider by JomCall itself.
import { isE164 } from "./numbers.ts";

export const PHONE_AGENT_NAME = "jomcall-voice";
export const PHONE_ROOM_PREFIX = "call-";
export const PHONE_DISPATCH_METADATA = JSON.stringify({ channel: "phone" });

export type SipConfigInput = {
  numbers: string[];
  allowedAddresses?: string[];
  authUsername?: string;
  trunkId?: string;
  krisp?: boolean;
};

export function livekitSipConfig(input: SipConfigInput) {
  const numbers = [...new Set(input.numbers)].sort();
  if (!numbers.length) throw Error("NO_PHONE_NUMBERS");
  if (!numbers.every(isE164)) throw Error("INVALID_PHONE_NUMBER");
  const addresses = input.allowedAddresses ?? [];
  if (!addresses.length && !input.authUsername)
    // LiveKit requires one of the two for a trunk that should only accept its
    // provider; refusing here keeps an open trunk from being generated.
    throw Error("TRUNK_NEEDS_ADDRESSES_OR_USERNAME");
  if (!addresses.every((a) => /^[0-9a-fA-F.:/]{3,64}$/.test(a)))
    throw Error("INVALID_ADDRESS");
  const trunk: Record<string, unknown> = {
    name: "jomcall-inbound",
    numbers,
  };
  if (addresses.length) trunk.allowed_addresses = addresses;
  // The password is never written here: the operator adds auth_password to
  // the file by hand just before applying it, so it never sits on disk in
  // generated output or in git.
  if (input.authUsername) trunk.auth_username = input.authUsername;
  if (input.krisp) trunk.krisp_enabled = true;
  return {
    inboundTrunk: { trunk },
    dispatchRule: {
      dispatch_rule: {
        name: "jomcall-inbound",
        trunk_ids: [input.trunkId || "<trunk ID printed by lk sip inbound create>"],
        // Callee rule: the room is named after the DIALLED number, never the
        // caller's (an individual rule would put the caller's number into
        // room names, which LiveKit keeps in logs). randomize gives each call
        // its own room.
        rule: {
          dispatch_rule_callee: { room_prefix: PHONE_ROOM_PREFIX, randomize: true },
        },
        hide_phone_number: false,
        room_config: {
          agents: [
            { agent_name: PHONE_AGENT_NAME, metadata: PHONE_DISPATCH_METADATA },
          ],
        },
      },
    },
    commands: [
      "lk sip inbound create inbound-trunk.json",
      "lk sip dispatch create dispatch-rule.json",
    ],
  };
}
