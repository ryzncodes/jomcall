// Creates the LiveKit SIP inbound trunk and dispatch rule on this
// environment's own LiveKit server when they are missing. Run it inside the
// agent container, which already holds LIVEKIT_URL and the key pair:
//
//   docker compose exec -T -w /app agent node --import tsx \
//     scripts/hosted/sip-apply.ts --numbers +60312345678 --allowed 203.0.113.10/30
//
// Run it again after the message bus (Valkey) container restarts. It talks
// to LiveKit only, never to a carrier, and prints ids, never a key.
import {
  RoomAgentDispatch,
  RoomConfiguration,
  SipClient,
} from "livekit-server-sdk";
import {
  ensureSipConfig,
  type SipApi,
} from "../../packages/domain/src/phone/sip-apply.ts";

const args = process.argv.slice(2);
const list = (name: string) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? (args[i + 1] ?? "").split(",").filter(Boolean) : [];
};
for (const name of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"])
  if (!process.env[name]) throw Error("MISSING: " + name);
const sip = new SipClient(
  process.env.LIVEKIT_URL!.replace(/^ws/, "http"),
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);
const result = await ensureSipConfig(
  sip as unknown as SipApi,
  { numbers: list("numbers"), allowedAddresses: list("allowed") },
  (agentName, metadata) =>
    new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName, metadata })],
    }),
);
console.log(
  `trunk ${result.trunkId} (${result.created.trunk ? "created" : "already there"}), ` +
    `dispatch rule ${result.ruleId} (${result.created.rule ? "created" : "already there"})`,
);
