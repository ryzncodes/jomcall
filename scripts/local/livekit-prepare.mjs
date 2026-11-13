import { prepareLivekit } from "./livekit-common.mjs";
try {
  await prepareLivekit({ download: process.argv.includes("--download") });
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
