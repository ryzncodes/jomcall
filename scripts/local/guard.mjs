export function validateCapacity({ freeGiB, needsPull }) {
  if (freeGiB < (needsPull ? 10 : 5))
    throw Error("DISK_SPACE: free more local storage");
}
export function validatePorts({ occupied }) {
  if (occupied.length) throw Error(`PORT_IN_USE: ${occupied.join(",")}`);
}
export function validateBindings(bindings) {
  if (
    bindings.some((b) => !b.startsWith("127.0.0.1:") && !b.startsWith("[::1]:"))
  )
    throw Error("NON_LOOPBACK");
}
export function stopArguments(projectId) {
  if (projectId !== "jomcall-local") throw Error("PROJECT");
  return ["stop", "--project-id", projectId];
}
export function parseMode(mode = "mock") {
  if (!["mock", "local"].includes(mode)) throw Error("INVALID_MODE");
  return mode;
}
