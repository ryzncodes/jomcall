import { namespace } from "../../packages/domain/src/authorization.ts";
import { Engine } from "./engine.ts";
if (process.env.JOMCALL_MODE !== "local") throw Error("LOCAL_ONLY");
const engine = await Engine.create(namespace());
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log("Local engine ready");
try {
  while (!stopping) {
    try {
      await engine.tick();
    } catch {
      console.error("ENGINE_TICK_FAILED");
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  await engine.close();
  console.log("Local engine stopped");
}
