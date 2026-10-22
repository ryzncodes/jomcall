import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError } from "../../contracts/src/index.ts";
const params = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(200).default(""),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
const cursorShape = z
  .object({
    orgId: z.uuid(),
    scope: z.string(),
    search: z.string(),
    at: z.iso.datetime({ offset: true }),
    id: z.uuid(),
  })
  .strict();
const tables = {
  contacts: "contact",
  notes: "contact_note",
  consents: "consent_record",
  audit: "audit_log",
  versions: "agent_version",
} as const;
export async function page(
  tx: PoolClient,
  orgId: string,
  kind: keyof typeof tables,
  query: URLSearchParams,
  resource?: string,
) {
  const p = params.parse(Object.fromEntries(query));
  const scope = kind + (resource ? ":" + resource : "");
  let after: z.infer<typeof cursorShape> | null = null;
  if (p.cursor) {
    try {
      after = cursorShape.parse(
        JSON.parse(Buffer.from(p.cursor, "base64url").toString()),
      );
    } catch {
      throw new AppError("INVALID_CURSOR", 422);
    }
    if (
      after.orgId !== orgId ||
      after.scope !== scope ||
      after.search !== p.search
    )
      throw new AppError("INVALID_CURSOR", 422);
  }
  const values: unknown[] = [orgId];
  let where = "org_id=$1";
  if (resource) {
    values.push(resource);
    where += ` and ${kind === "versions" ? "agent_id" : "contact_id"}=$${values.length}`;
  }
  if (p.search) {
    if (kind !== "contacts") throw new AppError("INVALID_SEARCH", 422);
    values.push("%" + p.search.replace(/[\\%_]/g, "\\$&") + "%");
    where += ` and (name ilike $${values.length} or phone_e164 ilike $${values.length})`;
  }
  if (after) {
    values.push(after.at, after.id);
    where += ` and (created_at,id)<($${values.length - 1},$${values.length})`;
  }
  values.push(p.limit + 1);
  const rows = (
    await tx.query(
      `select *,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as _cursor_at from app.${tables[kind]} where ${where} order by created_at desc,id desc limit $${values.length}`,
      values,
    )
  ).rows;
  const more = rows.length > p.limit,
    items = rows.slice(0, p.limit),
    last = items.at(-1);
  return {
    items: items.map(({ _cursor_at, ...row }) => row),
    nextCursor: more
      ? Buffer.from(
          JSON.stringify({
            orgId,
            scope,
            search: p.search,
            at: last._cursor_at,
            id: last.id,
          }),
        ).toString("base64url")
      : null,
  };
}
