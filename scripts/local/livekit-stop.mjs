import { stopLivekit } from "./livekit-common.mjs";
try {
  console.log(
    (await stopLivekit())
      ? "Owned LiveKit container removed."
      : "No LiveKit container recorded.",
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
