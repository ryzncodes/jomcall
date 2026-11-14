import { AgentRunner } from "./runner.ts";
import { AgentRepository } from "./repository.ts";
import { startVoiceServer } from "./voice-server.ts";
import { agentVoiceProvider } from "../../../packages/inference/src/provider.ts";
import { streamVoiceModel } from "../../../packages/inference/src/anthropic-voice.ts";
import { WhatsAppWorker } from "../whatsapp/worker.ts";
import { whatsappMode } from "../../../packages/whatsapp/src/provider.ts";
import { createCloudProvider } from "../../../packages/whatsapp/src/cloud.ts";
import { createFakeProvider } from "../../../packages/whatsapp/src/fake.ts";

const VOICE_PORT = 54633;
// Checked before anything is opened: VOICE_PROVIDER_INVALID for an unknown
// value, VOICE_MODEL_KEY_MISSING for hosted voice without ANTHROPIC_API_KEY.
const provider = agentVoiceProvider();
const runner = await AgentRunner.create();
// WhatsApp work runs only when the switch is on. The Cloud API client is
// created here, in the agent process, and nowhere else.
const whatsapp = await startWhatsApp();
async function startWhatsApp() {
  const mode = whatsappMode();
  if (mode === "disabled") return undefined;
  const provider =
    mode === "cloud" ? createCloudProvider() : createFakeProvider();
  return new WhatsAppWorker("local", { provider });
}
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
  await whatsapp?.close();
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
  try {
    await whatsapp?.tick();
  } catch {
    console.error("WHATSAPP_TICK_FAILED");
  }
  if (!stopping) await new Promise((r) => setTimeout(r, 1000));
}
