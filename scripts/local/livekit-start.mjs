import { readFileSync, existsSync } from "node:fs";
import { startLivekit } from "./livekit-common.mjs";
// Keys come from the root .env.local written by local:start; never printed.
const env = { ...process.env };
if (existsSync(".env.local"))
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && line.startsWith("LIVEKIT_API_"))
      env[line.slice(0, i)] ??= line.slice(i + 1);
  }
try {
  console.log("Local LiveKit container:", await startLivekit({ env }));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
