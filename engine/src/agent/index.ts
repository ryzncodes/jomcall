import { AgentRunner } from "./runner.ts";
import { AgentRepository } from "./repository.ts";
import { startVoiceServer } from "./voice-server.ts";
import { agentVoiceProvider } from "../../../packages/inference/src/provider.ts";
import {
  queueNamespace,
  voiceListen,
  workerMode,
} from "../../../packages/contracts/src/hosting.ts";
import {
  AGENT_HEALTH_PORT,
  STALE_AFTER_MS,
  startHealthServer,
} from "../health.ts";
import { streamVoiceModel } from "../../../packages/inference/src/anthropic-voice.ts";
import { CallRepository } from "./call-repository.ts";
import { startPhoneServer, PHONE_PORT } from "./phone-server.ts";
import {
  liveKitTelephony,
  telephonyConfig,
} from "../../../packages/domain/src/phone/telephony.ts";

// LOCAL_ONLY unless the mode is `local` or `hosted`. The listen address is
// 127.0.0.1 in local mode; hosted mode reads a private address and the service
// secret from configuration and stops if either is missing.
const mode = workerMode();
const ns = queueNamespace();
// Checked before anything is opened: VOICE_PROVIDER_INVALID for an unknown
// value, VOICE_MODEL_KEY_MISSING for hosted voice without ANTHROPIC_API_KEY.
const provider = agentVoiceProvider();
const listen = provider === "hosted" ? voiceListen() : undefined;
const runner = await AgentRunner.create(ns);
let lastTickAt = 0;
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
    const repository = (voiceRepository = new AgentRepository(ns));
    voice = await startVoiceServer(
      { repository, model: streamVoiceModel, now: Date.now },
      {
        ...listen!,
        health: mode === "hosted" ? () => repository.ping() : undefined,
      },
    );
    if (phoneSettings) {
      callRepository = new CallRepository(ns);
      phone = await startPhoneServer(
        {
          calls: callRepository,
          telephony: liveKitTelephony(phoneSettings),
          maxConcurrent: phoneSettings.maxConcurrent,
          capSeconds: phoneSettings.capSeconds,
          now: Date.now,
          model: streamVoiceModel,
        },
        // Same bind, mode and service secret as the browser voice endpoint.
        { ...listen!, port: PHONE_PORT },
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
// Hosted mode only: a loopback health listener for the container health check.
const health =
  mode === "hosted"
    ? await startHealthServer({
        service: "agent",
        port: AGENT_HEALTH_PORT,
        check: () => Date.now() - lastTickAt < STALE_AFTER_MS,
      })
    : undefined;
let stopping = false;
async function stop() {
  stopping = true;
  await health?.close();
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
    lastTickAt = Date.now();
  } catch {
    console.error("AGENT_TICK_FAILED");
  }
  if (!stopping) await new Promise((r) => setTimeout(r, 1000));
}
