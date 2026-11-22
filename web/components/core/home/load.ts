// Reads everything Home shows, each command on its own. A failed or
// forbidden read leaves its fact undefined; Home hides that step or row.
import type { Booking } from "../../../../packages/contracts/src/booking";
import { klDayRange, type HomeFacts } from "../../../lib/core/home-rules";

type Client = {
  execute(name: string, input: Record<string, unknown>): Promise<unknown>;
};
const DAY = 86_400_000;

export async function loadHomeFacts(
  client: Client,
  ctx: { manager: boolean; published: boolean; agentId: string | null },
  now: Date,
): Promise<HomeFacts> {
  const read = (name: string, input: Record<string, unknown>, when = true) =>
    when ? client.execute(name, input) : Promise.reject(new Error("skipped"));
  const day = klDayRange(now);
  const agent = ctx.agentId;
  const r = await Promise.allSettled([
    read("setup", { id: agent }, !!agent),
    read("agentTests", {}),
    read("plan", {}, ctx.manager),
    read("wallet", {}, ctx.manager),
    read("phoneNumbers", {}, ctx.manager),
    read("channels", {}),
    read("calls", { limit: 100 }),
    read("bookings", { ...day, limit: 100 }),
    read("bookings", {
      status: "requested",
      from: now.toISOString(),
      to: new Date(now.getTime() + 30 * DAY).toISOString(),
      limit: 100,
    }),
    read("conversations", { attention: "needs" }),
    read("knowledgeGaps", { id: agent, status: "open" }, !!agent),
    read("firstRun", {}, ctx.manager),
    read("followUpCount", {}),
  ]);
  const v = <T>(i: number) =>
    r[i].status === "fulfilled" ? (r[i].value as T) : undefined;
  const items = (i: number) => v<{ items: Booking[] }>(i)?.items;
  return {
    manager: ctx.manager,
    published: ctx.published,
    setup: v(0),
    tests: v(1),
    plan: v(2),
    wallet: v(3),
    phones: v(4),
    channels: v(5),
    calls: v<{ items: HomeFacts["calls"] }>(6)?.items,
    bookingsToday: items(7)?.filter((b) => b.status !== "cancelled"),
    toConfirm: items(8),
    chats: v(9),
    gaps: v(10),
    firstRun: v(11),
    followUps: v(12),
  };
}
