// Buys one phone number and wires it to this deployment: Twilio number on
// the SIP trunk, then the number on LiveKit's inbound trunk. Run by an
// operator for one customer at a time. It never releases a number by itself
// and never touches JomCall's database: the number is added to a workspace
// on the Phone numbers screen afterwards.
//
// Safe to run again for the same number: a number the account already holds
// is not bought twice, and a number already on the LiveKit trunk is left.
import { isE164 } from "./numbers.ts";
import { SIP_TRUNK_NAME, ensureSipConfig, type SipApi } from "./sip-apply.ts";
import type { TwilioNumbers } from "./twilio.ts";

// The part of SipClient needed to add a number to an existing trunk.
export type SipTrunkApi = SipApi & {
  updateSipInboundTrunkFields(
    sipTrunkId: string,
    fields: { numbers: { add: string[] } },
  ): Promise<unknown>;
};

export type ProvisionResult = {
  e164: string;
  numberSid: string;
  bought: boolean; // false when the account already held it
  trunkId: string;
  addedToTrunk: boolean;
};

export async function wireNumber(
  sip: SipTrunkApi,
  e164: string,
  allowedAddresses: string[],
  roomConfig: (agentName: string, metadata: string) => unknown,
): Promise<{ trunkId: string; added: boolean }> {
  const trunk = (await sip.listSipInboundTrunk()).find(
    (t) => t.name === SIP_TRUNK_NAME,
  );
  if (!trunk) {
    // No trunk yet (first number, or the message bus lost it): create the
    // trunk and the dispatch rule for this number.
    const made = await ensureSipConfig(
      sip,
      { numbers: [e164], allowedAddresses },
      roomConfig,
    );
    return { trunkId: made.trunkId, added: true };
  }
  if (trunk.numbers.includes(e164))
    return { trunkId: trunk.sipTrunkId, added: false };
  await sip.updateSipInboundTrunkFields(trunk.sipTrunkId, {
    numbers: { add: [e164] },
  });
  return { trunkId: trunk.sipTrunkId, added: true };
}

export async function provisionNumber(
  deps: {
    twilio: TwilioNumbers;
    sip: SipTrunkApi;
    trunkSid: string;
    maxNumbers: number;
    allowedAddresses: string[];
    roomConfig: (agentName: string, metadata: string) => unknown;
  },
  input: { e164: string; label: string },
): Promise<ProvisionResult> {
  if (!isE164(input.e164)) throw Error("INVALID_PHONE_NUMBER");
  if (!deps.allowedAddresses.length)
    throw Error("TRUNK_NEEDS_ADDRESSES_OR_USERNAME");
  const held = await deps.twilio.owned();
  let number = held.find((n) => n.e164 === input.e164);
  const bought = !number;
  if (!number) {
    // The cap is checked before any money is spent.
    if (held.length >= deps.maxNumbers) throw Error("NUMBER_LIMIT_REACHED");
    number = await deps.twilio.buy(input.e164, input.label);
  }
  // A number held from before but not on this deployment's trunk is not
  // moved: a person decides what it was for.
  if (number.trunkSid !== deps.trunkSid) throw Error("NUMBER_ON_ANOTHER_TRUNK");
  const wired = await wireNumber(
    deps.sip,
    input.e164,
    deps.allowedAddresses,
    deps.roomConfig,
  );
  return {
    e164: input.e164,
    numberSid: number.sid,
    bought,
    trunkId: wired.trunkId,
    addedToTrunk: wired.added,
  };
}
