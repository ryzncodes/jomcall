import { stopModel } from "./model-common.mjs";
try {
  await stopModel();
  console.log("Owned local model process stopped.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
