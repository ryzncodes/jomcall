// Operator view of bills that have not landed (billing design section 13).
// Maintenance retries an owed call or WhatsApp window up to 20 times; after
// that it stays 'pending' until an operator looks. Used by
//   npm run billing:admin -- usage-pending
//   npm run billing:admin -- usage-retry <call id or WhatsApp window id>
// Also lists, for the last 7 days, calls and WhatsApp turns answered after a
// failed billing check (kind *_check_failed), so they can be looked into.
// Prints ids, organization, namespace, kind, attempts and times only: never a
// phone number, WhatsApp id or anything that was said.
import type pg from "pg";

type Db = Pick<pg.Client | pg.PoolClient, "query">;
export const RETRY_CAP = 20;

export type PendingUsage = {
  kind: "call" | "whatsapp_window" | "call_check_failed" | "whatsapp_check_failed";
  id: string;
  orgId: string;
  namespace: string;
  attempts: number;
  since: string;
  stuck: boolean;
};

export async function listPendingUsage(db: Db, limit = 200): Promise<PendingUsage[]> {
  const rows = (
    await db.query(
      `select * from(
        select 'call' kind,c.id,c.org_id,c.namespace,c.usage_attempts attempts,c.ended_at since from app.call c where c.usage_state='pending'
        union all
        select 'whatsapp_window',w.id,w.org_id,h.namespace,w.usage_attempts,w.starts_at
        from app.whatsapp_usage_window w join app.whatsapp_channel h on(h.org_id=w.org_id and h.id=w.channel_id) where w.usage_state='pending'
        union all
        select 'call_check_failed',c.id,c.org_id,c.namespace,0,c.started_at from app.call c
        where c.billing_check is not null and c.started_at>now()-interval '7 days'
        union all
        select 'whatsapp_check_failed',t.id,t.org_id,h.namespace,0,t.created_at from app.conversation_turn t
        join app.conversation x on(x.org_id=t.org_id and x.id=t.conversation_id) join app.whatsapp_channel h on(h.org_id=x.org_id and h.id=x.channel_id)
        where t.billing_check is not null and t.created_at>now()-interval '7 days'
       )p order by attempts desc,since,id limit $1`,
      [limit],
    )
  ).rows;
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    orgId: r.org_id,
    namespace: r.namespace,
    attempts: r.attempts,
    since: new Date(r.since).toISOString(),
    stuck: r.kind.endsWith("_check_failed") ? false : r.attempts >= RETRY_CAP,
  }));
}

// One attempt now, past the cap. A failure is counted like maintenance's and
// reported by its code; the row stays owed.
export async function retryUsage(
  db: Db,
  id: string,
): Promise<{ kind: "call" | "whatsapp_window"; state: string; error?: string }> {
  const kind = (
    await db.query(
      `select case when exists(select 1 from app.call where id=$1 and usage_state='pending')then 'call'
        when exists(select 1 from app.whatsapp_usage_window where id=$1 and usage_state='pending')then 'whatsapp_window' end k`,
      [id],
    )
  ).rows[0].k as "call" | "whatsapp_window" | null;
  if (!kind) throw Error("NOT_PENDING");
  const [fn, table] = kind === "call" ? ["call_bill", "app.call"] : ["whatsapp_window_bill", "app.whatsapp_usage_window"];
  await db.query("begin");
  try {
    await db.query("savepoint bill");
    try {
      const state = (await db.query(`select app_private.${fn}($1) s`, [id])).rows[0].s;
      await db.query("commit");
      return { kind, state };
    } catch (e) {
      await db.query("rollback to savepoint bill");
      await db.query(`update ${table} set usage_attempts=usage_attempts+1 where id=$1`, [id]);
      await db.query("commit");
      const m = e instanceof Error ? e.message : "";
      return { kind, state: "pending", error: /^[A-Z_]{1,60}$/.test(m) ? m : "BILLING_FAILED" };
    }
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  }
}
