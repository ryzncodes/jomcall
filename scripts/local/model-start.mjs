import { startModel } from "./model-common.mjs";
try {
  console.log("Local model process:", await startModel());
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
