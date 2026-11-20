// Creates the LiveKit SIP inbound trunk and dispatch rule when they are
// missing, with the same shape livekitSipConfig writes to files. For a
// self-hosted LiveKit whose message bus keeps nothing on disk: after that
// container restarts, the trunk and rule are gone and calls are rejected
// until this runs again. It never changes or deletes what it finds.
import {
  PHONE_AGENT_NAME,
  PHONE_DISPATCH_METADATA,
  PHONE_ROOM_PREFIX,
  livekitSipConfig,
} from "./sip-config.ts";

export const SIP_TRUNK_NAME = "jomcall-inbound";

// The part of livekit-server-sdk's SipClient this needs.
export type SipApi = {
  listSipInboundTrunk(): Promise<
    { sipTrunkId: string; name: string; numbers: string[] }[]
  >;
  createSipInboundTrunk(
    name: string,
    numbers: string[],
    opts: { allowedAddresses: string[] },
  ): Promise<{ sipTrunkId: string }>;
  listSipDispatchRule(): Promise<
    { sipDispatchRuleId: string; trunkIds: string[] }[]
  >;
  createSipDispatchRule(
    rule: { type: "callee"; roomPrefix: string; randomize: boolean },
    opts: {
      name: string;
      trunkIds: string[];
      hidePhoneNumber: boolean;
      roomConfig: unknown;
    },
  ): Promise<{ sipDispatchRuleId: string }>;
};

export type SipApplyResult = {
  trunkId: string;
  ruleId: string;
  created: { trunk: boolean; rule: boolean };
};

// roomConfig builds the SDK's RoomConfiguration from the agent name and its
// metadata; it is passed in so this file needs no protocol classes.
export async function ensureSipConfig(
  api: SipApi,
  input: { numbers: string[]; allowedAddresses: string[] },
  roomConfig: (agentName: string, metadata: string) => unknown,
): Promise<SipApplyResult> {
  // Same checks as the file generator: E.164 numbers, at least one address.
  const numbers = livekitSipConfig(input).inboundTrunk.trunk
    .numbers as string[];
  const same = (a: string[]) =>
    a.length === numbers.length &&
    [...a].sort().every((n, i) => n === numbers[i]);
  const trunks = (await api.listSipInboundTrunk()).filter(
    (t) => t.name === SIP_TRUNK_NAME,
  );
  let trunk = trunks.find((t) => same(t.numbers));
  // A trunk of ours with other numbers is left for a person to decide on.
  if (!trunk && trunks.length) throw Error("TRUNK_NUMBERS_DIFFER");
  const createdTrunk = !trunk;
  if (!trunk)
    trunk = {
      ...(await api.createSipInboundTrunk(SIP_TRUNK_NAME, numbers, {
        allowedAddresses: input.allowedAddresses,
      })),
      name: SIP_TRUNK_NAME,
      numbers,
    };
  const trunkId = trunk.sipTrunkId;
  let rule = (await api.listSipDispatchRule()).find((r) =>
    r.trunkIds.includes(trunkId),
  );
  const createdRule = !rule;
  if (!rule)
    rule = {
      ...(await api.createSipDispatchRule(
        { type: "callee", roomPrefix: PHONE_ROOM_PREFIX, randomize: true },
        {
          name: SIP_TRUNK_NAME,
          trunkIds: [trunkId],
          hidePhoneNumber: false,
          roomConfig: roomConfig(PHONE_AGENT_NAME, PHONE_DISPATCH_METADATA),
        },
      )),
      trunkIds: [trunkId],
    };
  return {
    trunkId,
    ruleId: rule.sipDispatchRuleId,
    created: { trunk: createdTrunk, rule: createdRule },
  };
}
