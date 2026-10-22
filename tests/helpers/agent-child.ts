import { AgentRunner } from "../../engine/src/agent/runner.ts";
const runner = await AgentRunner.create(
  process.env.JOMCALL_QUEUE_NAMESPACE!,
  {
    generate: async () => {
      console.log("CLAIMED_TURN");
      return new Promise(() => {});
    },
  },
);
await runner.tick();
await runner.close();
