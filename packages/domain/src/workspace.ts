import { guardFutureBookings } from "./booking/guards.ts";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  AppError,
  name,
  uuid,
  type TenantContext,
} from "../../contracts/src/index.ts";
import { scheduleInput } from "../../contracts/src/agent.ts";
import { command, audit } from "../../db/src/receipts.ts";
import { manager } from "./authorization.ts";
const locationFields = {
  name,
  address: z.string().max(500),
  state: z.string().max(100),
  timezone: z.string().refine((x) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: x });
      return true;
    } catch {
      return false;
    }
  }),
};
export async function workspaceRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
) {
  const m = path.match(/^\/locations(?:\/([^/]+)(?:\/(schedule|archive))?)?$/);
  if (!m) return;
  const id = m[1] ? uuid.parse(m[1]) : null,
    action = m[2];
  if (method === "GET" && !id)
    return (
      await tx.query(
        "select * from app.location where org_id=$1 and archived_at is null order by created_at,id",
        [ctx.orgId],
      )
    ).rows;
  const load = async () => {
    const r = (
      await tx.query(
        "select * from app.location where org_id=$1 and id=$2 and archived_at is null",
        [ctx.orgId, id],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", 404);
    return r;
  };
  const schedule = async () => {
    await load();
    return (
      (
        await tx.query(
          "select * from app.location_schedule where org_id=$1 and location_id=$2",
          [ctx.orgId, id],
        )
      ).rows[0] ?? {
        location_id: id,
        timezone: "Asia/Kuala_Lumpur",
        weekdays: [[], [], [], [], [], [], []],
        closures: [],
        revision: 0,
      }
    );
  };
  if (method === "GET" && action === "schedule") return schedule();
  manager(ctx);
  if (action === "schedule" && method === "PUT") {
    const v = scheduleInput.parse(body);
    return command(
      tx,
      ctx,
      key,
      "saveSchedule",
      { id, ...v },
      async () => {
        await tx.query(
          "select id from app.location where org_id=$1 and id=$2 for update",
          [ctx.orgId, id],
        );
        const prior = await schedule();
        if (prior.revision !== v.expectedRevision)
          throw new AppError("CONFLICT", 409);
        await guardFutureBookings(tx, ctx, id!, undefined, v);
        await tx.query(
          "insert into app.location_schedule(org_id,location_id,timezone,weekdays,closures)values($1,$2,$3,$4,$5)on conflict(org_id,location_id)do update set timezone=excluded.timezone,weekdays=excluded.weekdays,closures=excluded.closures,revision=app.location_schedule.revision+1",
          [
            ctx.orgId,
            id,
            v.timezone,
            JSON.stringify(v.weekdays),
            JSON.stringify(v.closures),
          ],
        );
        await audit(tx, ctx, "schedule.updated", "location", id!);
        return { ref: { id }, data: await schedule() };
      },
      schedule,
    );
  }
  if (!id && method === "POST") {
    const v = z.object(locationFields).strict().parse(body);
    return command(
      tx,
      ctx,
      key,
      "createLocation",
      v,
      async () => {
        const r = (
          await tx.query(
            "insert into app.location(org_id,name,address,state,timezone)values($1,$2,$3,$4,$5)returning *",
            [ctx.orgId, v.name, v.address, v.state, v.timezone],
          )
        ).rows[0];
        await audit(tx, ctx, "location.created", "location", r.id);
        return { ref: { id: r.id }, data: r };
      },
      async (ref) =>
        (
          await tx.query(
            "select * from app.location where org_id=$1 and id=$2",
            [ctx.orgId, ref.id],
          )
        ).rows[0],
    );
  }
  if (
    id &&
    ((method === "PATCH" && !action) ||
      (method === "POST" && action === "archive"))
  ) {
    const v = (
      action
        ? z.object({ expectedRevision: z.number().int().positive() }).strict()
        : z
            .object({
              ...locationFields,
              expectedRevision: z.number().int().positive(),
            })
            .strict()
    ).parse(body);
    return command(
      tx,
      ctx,
      key,
      "location." + (action ?? "update"),
      { id, ...v },
      async () => {
        await tx.query(
          "select id from app.location where org_id=$1 and id=$2 for update",
          [ctx.orgId, id],
        );
        const prior = await load();
        if (prior.revision !== v.expectedRevision)
          throw new AppError("CONFLICT", 409);
        if (action || ("timezone" in v && v.timezone !== prior.timezone))
          await guardFutureBookings(tx, ctx, id);
        let result;
        if (action) {
          if (
            prior.primary_location ||
            (
              await tx.query(
                "select id from app.agent where org_id=$1 and location_id=$2",
                [ctx.orgId, id],
              )
            ).rowCount
          )
            throw new AppError("LOCATION_IN_USE", 409);
          result = (
            await tx.query(
              "update app.location set archived_at=now(),revision=revision+1 where id=$1 returning *",
              [id],
            )
          ).rows[0];
        } else {
          const f = z.object(locationFields).parse(v);
          result = (
            await tx.query(
              "update app.location set name=$1,address=$2,state=$3,timezone=$4,revision=revision+1 where id=$5 returning *",
              [f.name, f.address, f.state, f.timezone, id],
            )
          ).rows[0];
        }
        await audit(
          tx,
          ctx,
          "location." + (action ?? "updated"),
          "location",
          id,
        );
        return { ref: { id }, data: result };
      },
      async () =>
        (await tx.query("select * from app.location where id=$1", [id]))
          .rows[0],
    );
  }
}
