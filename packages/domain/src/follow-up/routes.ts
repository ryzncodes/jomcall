import type { PoolClient } from "pg";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../../contracts/src/index.ts";
import {
  followUpList,
  followUpClose,
  followUpReopen,
  followUpAssign,
  type FollowUp,
  type FollowUpPage,
  type FollowUpCount,
} from "../../../contracts/src/follow-up.ts";
import { command, audit } from "../../../db/src/receipts.ts";

const PAGE = 50;

// Items whose contact awaits PDPA deletion are hidden everywhere. Never
// selects from app.call: the web role has no grant on its billing columns.
const SELECT = `select f.id,f.kind,f.source,f.details,f.state,f.revision,f.created_at,f.due_at,f.closed_at,f.closed_by,
  f.booking_id,f.call_id,f.conversation_id,
  case when wm.user_id is not null then jsonb_build_object('userId',wm.user_id,'name',wm.email) end as assignee,
  case when c.id is not null then jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone_e164) end as contact
 from app.follow_up f
 left join app.contact c on c.org_id=f.org_id and c.id=f.contact_id
 left join app_private.workspace_members($1) wm on wm.user_id=f.assignee_user_id and wm.active
 where f.org_id=$1 and (c.id is null or not c.deletion_pending)`;

export async function loadFollowUp(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
): Promise<FollowUp> {
  const row = (await tx.query(`${SELECT} and f.id=$2`, [ctx.orgId, id]))
    .rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404);
  return row;
}

// Database refusals the shared error mapper does not know.
const SQL_REFUSALS: Record<string, number> = {
  BOOKING_CONFIRM_REQUIRED: 409,
  INVALID_ASSIGNEE: 422,
  INVALID_STATE: 422,
};
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (
      e instanceof Error &&
      !(e instanceof AppError) &&
      e.message in SQL_REFUSALS
    )
      throw new AppError(e.message, SQL_REFUSALS[e.message]);
    throw e;
  }
}

// The cursor holds the sort time as it was read from the database (a Date
// would lose microseconds), so the next page starts exactly after it.
function cursorOf(
  row: { sort_at: string; id: string },
  view: string,
): string {
  return Buffer.from(JSON.stringify([view, row.sort_at, row.id])).toString(
    "base64url",
  );
}
function parseCursor(raw: string | undefined, view: string) {
  if (!raw) return null;
  try {
    const [v, at, id] = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (v !== view || typeof at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/.test(at))
      throw new Error("bad");
    return { at, id: uuid.parse(id) };
  } catch {
    throw new AppError("INVALID_CURSOR", 422);
  }
}

export async function followUpRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
): Promise<unknown | undefined> {
  if (path === "/follow-ups" && method === "GET") {
    const p = followUpList.parse(Object.fromEntries(query));
    const after = parseCursor(p.cursor, p.view);
    const values: unknown[] = [ctx.orgId];
    let where =
      p.view === "done" ? " and f.state<>'open'" : " and f.state='open'";
    if (p.view === "mine") {
      values.push(ctx.identity.userId);
      where += ` and f.assignee_user_id=$${values.length}`;
    }
    // done: newest close first (a back-filled row has no close time).
    const at =
      p.view === "done" ? "coalesce(f.closed_at,f.created_at)" : "f.created_at";
    if (after) {
      values.push(after.at, after.id);
      const op = p.view === "done" ? "<" : ">";
      where += ` and (${at},f.id)${op}($${values.length - 1}::timestamptz,$${values.length}::uuid)`;
    }
    const order = p.view === "done" ? `${at} desc,f.id desc` : `${at},f.id`;
    // The pattern cannot rule out every impossible date; the database does.
    const rows = (
      await tx.query(
        `select * from (${SELECT}${where}) x order by ${order.replaceAll("f.", "x.")} limit ${PAGE + 1}`.replace(
          "select f.id,",
          `select ${at}::text as sort_at,f.id,`,
        ),
        values,
      ).catch((e: { code?: string }) => {
        if (after && ["22007", "22008", "22003", "22P02"].includes(e?.code ?? ""))
          throw new AppError("INVALID_CURSOR", 422);
        throw e;
      })
    ).rows as (FollowUp & { sort_at: string })[];
    const items = rows.slice(0, PAGE);
    const next =
      rows.length > PAGE ? cursorOf(items[items.length - 1], p.view) : null;
    return {
      items: items.map(({ sort_at: _drop, ...rest }) => rest),
      next,
    } satisfies FollowUpPage;
  }
  if (path === "/follow-ups/count" && method === "GET") {
    const r = (
      await tx.query(
        `select count(*)::int as open,count(*) filter(where f.assignee_user_id=$2)::int as mine
         from app.follow_up f left join app.contact c on c.org_id=f.org_id and c.id=f.contact_id
         where f.org_id=$1 and f.state='open' and (c.id is null or not c.deletion_pending)`,
        [ctx.orgId, ctx.identity.userId],
      )
    ).rows[0];
    return { open: r.open, mine: r.mine } satisfies FollowUpCount;
  }
  const m = path.match(/^\/follow-ups\/([^/]+)\/(close|reopen|assign)$/);
  if (!m || method !== "POST") return;
  const action = m[2];
  const v = (
    action === "close"
      ? followUpClose
      : action === "reopen"
        ? followUpReopen
        : followUpAssign
  ).parse({ ...(body as object), id: m[1] }) as Record<string, any>;
  return command<FollowUp>(
    tx,
    ctx,
    key,
    `followUp.${action}`,
    v,
    () =>
      guarded(async () => {
        if (action === "close")
          await tx.query("select app_private.follow_up_close($1,$2,$3,null)", [
            v.id,
            v.expectedRevision,
            v.state,
          ]);
        else if (action === "reopen")
          await tx.query("select app_private.follow_up_reopen($1,$2)", [
            v.id,
            v.expectedRevision,
          ]);
        else
          await tx.query("select app_private.follow_up_assign($1,$2,$3,$4)", [
            v.id,
            v.expectedRevision,
            v.assigneeUserId,
            v.dueAt,
          ]);
        await audit(tx, ctx, `follow_up.${action}`, "follow_up", v.id);
        return { ref: { id: v.id }, data: await loadFollowUp(tx, ctx, v.id) };
      }),
    (ref) => loadFollowUp(tx, ctx, String(ref.id)),
  );
}
