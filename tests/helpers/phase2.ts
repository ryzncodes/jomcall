import { createHarness } from "./local.ts";
import { createApiHarness } from "./api.ts";
export async function createPhase2Harness() {
  const h = await createHarness();
  const api = await createApiHarness(h);
  const req = (method: string, path: string, body?: unknown) =>
    api.request(h.alice, h.orgA.id, method, "/api/v1" + path, body);
  const day = new Date(Date.now() + 86400000 + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const slotStart = new Date(day + "T09:00:00+08:00").toISOString();
  const schedule = {
    expectedRevision: 0,
    timezone: "Asia/Kuala_Lumpur",
    weekdays: Array.from({ length: 7 }, () => [
      { start: "09:00", end: "18:00" },
    ]),
    closures: [],
  };
  const saved = await req(
    "PUT",
    `/locations/${h.orgA.locationId}/schedule`,
    schedule,
  );
  if (saved.status !== 200) throw Error("Fixture schedule failed");
  return {
    h,
    api,
    req,
    day,
    slotStart,
    schedule,
    close: async () => {
      await api.close();
      await h.close();
    },
  };
}
