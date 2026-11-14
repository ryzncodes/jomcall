import { AgentRunner } from "./runner.ts";
import { AgentRepository } from "./repository.ts";
import { startVoiceServer } from "./voice-server.ts";
import { agentVoiceProvider } from "../../../packages/inference/src/provider.ts";
import { streamVoiceModel } from "../../../packages/inference/src/anthropic-voice.ts";
import { CallRepository } from "./call-repository.ts";
import { startPhoneServer, PHONE_PORT } from "./phone-server.ts";
import {
  liveKitTelephony,
  telephonyConfig,
} from "../../../packages/domain/src/phone/telephony.ts";

const VOICE_PORT = 54633;
// Checked before anything is opened: VOICE_PROVIDER_INVALID for an unknown
// value, VOICE_MODEL_KEY_MISSING for hosted voice without ANTHROPIC_API_KEY.
const provider = agentVoiceProvider();
const runner = await AgentRunner.create();
// Spoken turns are served only when the owner opted into the hosted model.
let voiceRepository: AgentRepository | undefined;
let voice: Awaited<ReturnType<typeof startVoiceServer>> | undefined;
// Real phone calls: only when the owner set JOMCALL_TELEPHONY_PROVIDER=livekit_sip
// (and hosted voice). Off by default; the local app then shows "not connected".
const phoneSettings = telephonyConfig().config;
let callRepository: CallRepository | undefined;
let phone: Awaited<ReturnType<typeof startPhoneServer>> | undefined;
if (provider === "hosted") {
  try {
    voiceRepository = new AgentRepository("local");
    voice = await startVoiceServer(
      { repository: voiceRepository, model: streamVoiceModel, now: Date.now },
      { host: "127.0.0.1", port: VOICE_PORT },
    );
    if (phoneSettings) {
      callRepository = new CallRepository("local");
      phone = await startPhoneServer(
        {
          calls: callRepository,
          telephony: liveKitTelephony(phoneSettings),
          maxConcurrent: phoneSettings.maxConcurrent,
          capSeconds: phoneSettings.capSeconds,
          now: Date.now,
          model: streamVoiceModel,
        },
        { host: "127.0.0.1", port: PHONE_PORT },
      );
    }
  } catch (error) {
    await phone?.close();
    await callRepository?.close();
    await voiceRepository?.close();
    await runner.close();
    throw error;
  }
}
let stopping = false;
async function stop() {
  stopping = true;
  await phone?.close();
  await callRepository?.close();
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
