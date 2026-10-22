import { AgentRunner } from "./runner.ts";
const runner = await AgentRunner.create();
let stopping = false;
async function stop() {
  stopping = true;
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
