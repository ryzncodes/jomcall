import { AgentRunner } from "./runner.ts";
import { AgentRepository } from "./repository.ts";
import { startVoiceServer } from "./voice-server.ts";
import { streamVoiceModel } from "../../../packages/inference/src/anthropic-voice.ts";

const VOICE_PORT = 54633;
const provider = process.env.JOMCALL_VOICE_PROVIDER ?? "disabled";
if (provider !== "disabled" && provider !== "hosted")
  throw Error("VOICE_PROVIDER_INVALID");
const runner = await AgentRunner.create();
// Spoken turns are served only when the owner opted into the hosted model.
let voiceRepository: AgentRepository | undefined;
let voice: Awaited<ReturnType<typeof startVoiceServer>> | undefined;
if (provider === "hosted") {
  try {
    voiceRepository = new AgentRepository("local");
    voice = await startVoiceServer(
      { repository: voiceRepository, model: streamVoiceModel, now: Date.now },
      { host: "127.0.0.1", port: VOICE_PORT },
    );
  } catch (error) {
    await voiceRepository?.close();
    await runner.close();
    throw error;
  }
}
let stopping = false;
async function stop() {
  stopping = true;
  await voice?.close();
  await voiceRepository?.close();
  await runner.close();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
while (!stopping) {
  try {
    await runner.tick();
  } catch {
    console.error("AGENT_TICK_FAILED");
  }
  if (!stopping) await new Promise((r) => setTimeout(r, 1000));
}
