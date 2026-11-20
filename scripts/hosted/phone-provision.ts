// Operator command: find, buy and wire a phone number for one customer.
// Run inside the agent container, which holds the LiveKit values; the
// Twilio values are passed for this run only (see infra/hosted/RUNBOOK.md
// step 11). Nothing is bought without --buy.
//
//   ... phone-provision.ts --search [--contains +603]
//   ... phone-provision.ts --list
//   ... phone-provision.ts --buy +60312345678 --label "Kedai Contoh" --allowed <ranges>
//   ... phone-provision.ts --release +60312345678
//
// --buy spends money every month until the number is released. --release
// gives the number up for good. Neither changes JomCall's database: add or
// switch off the number on the customer's Phone numbers screen.
import {
  RoomAgentDispatch,
  RoomConfiguration,
  SipClient,
} from "livekit-server-sdk";
import {
  provisionNumber,
  type SipTrunkApi,
} from "../../packages/domain/src/phone/provision.ts";
import {
  twilioNumbers,
  twilioSettings,
} from "../../packages/domain/src/phone/twilio.ts";

const args = process.argv.slice(2);
const has = (name: string) => args.includes("--" + name);
const value = (name: string) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const settings = twilioSettings();
const twilio = twilioNumbers(settings);

if (has("search")) {
  const found = await twilio.available({
    contains: value("contains"),
    limit: 10,
  });
  if (!found.length) console.log("No numbers available for that search.");
  for (const n of found) console.log(`${n.e164}  ${n.locality ?? ""}`);
} else if (has("list")) {
  const held = await twilio.owned();
  console.log(`${held.length} of ${settings.maxNumbers} numbers held.`);
  for (const n of held)
    console.log(
      `${n.e164}  ${n.trunkSid === settings.trunkSid ? "on this trunk" : "NOT on this trunk"}`,
    );
} else if (has("buy")) {
  for (const name of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"])
    if (!process.env[name]) throw Error("MISSING: " + name);
  const sip = new SipClient(
    process.env.LIVEKIT_URL!.replace(/^ws/, "http"),
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );
  const result = await provisionNumber(
    {
      twilio,
      sip: sip as unknown as SipTrunkApi,
      trunkSid: settings.trunkSid,
      maxNumbers: settings.maxNumbers,
      allowedAddresses: (value("allowed") ?? "").split(",").filter(Boolean),
      roomConfig: (agentName, metadata) =>
        new RoomConfiguration({
          agents: [new RoomAgentDispatch({ agentName, metadata })],
        }),
    },
    { e164: value("buy") ?? "", label: value("label") ?? "JomCall" },
  );
  console.log(
    `${result.e164}: ${result.bought ? "bought" : "already held"}, ` +
      `${result.addedToTrunk ? "added to" : "already on"} LiveKit trunk ${result.trunkId}.`,
  );
  console.log("Next: add this number on the customer's Phone numbers screen.");
} else if (has("release")) {
  const target = (await twilio.owned()).find(
    (n) => n.e164 === value("release"),
  );
  if (!target) throw Error("NUMBER_NOT_HELD");
  await twilio.release(target.sid);
  console.log(
    `${target.e164} released. Switch it off on the customer's Phone numbers screen.`,
  );
} else {
  console.log("Use --search, --list, --buy <number> or --release <number>.");
  process.exitCode = 1;
}
