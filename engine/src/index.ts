import { namespace } from "../../packages/domain/src/authorization.ts";
import { workerMode } from "../../packages/contracts/src/hosting.ts";
import { Engine } from "./engine.ts";
import {
  ENGINE_HEALTH_PORT,
  STALE_AFTER_MS,
  startHealthServer,
} from "./health.ts";
// LOCAL_ONLY unless the mode is `local` or `hosted`. Hosted mode then checks
// every setting it needs and stops with the name of the first one missing.
const mode = workerMode();
const engine = await Engine.create(namespace());
// Hosted mode only: a loopback health listener for the container health check.
const health =
  mode === "hosted"
    ? await startHealthServer({
        service: "engine",
        port: ENGINE_HEALTH_PORT,
        check: () => Date.now() - engine.lastTickAt < STALE_AFTER_MS,
      })
    : undefined;
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log(mode === "hosted" ? "Engine ready" : "Local engine ready");
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
  await health?.close();
  await engine.close();
  console.log(mode === "hosted" ? "Engine stopped" : "Local engine stopped");
}
