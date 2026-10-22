import type { PoolClient } from "pg";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../contracts/src/index.ts";
import {
  contactInput,
  contactUpdate,
  noteInput,
  consentInput,
  dncInput,
} from "../../contracts/src/contacts.ts";
import { command, audit } from "../../db/src/receipts.ts";
import { page } from "../../db/src/pagination.ts";
import { manager } from "./authorization.ts";
export async function contactsRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
) {
  if (path === "/audit" && method === "GET") {
    manager(ctx);
    return page(tx, ctx.orgId, "audit", query);
  }
  if (path === "/contacts" && method === "GET")
    return page(tx, ctx.orgId, "contacts", query);
  const load = async (id: string, lock = false) => {
    const row = (
      await tx.query(
        "select * from app.contact where org_id=$1 and id=$2" +
          (lock ? " for update" : ""),
        [ctx.orgId, id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return row;
  };
  if (path === "/contacts" && method === "POST") {
    const v = contactInput.parse(body);
    return command(
      tx,
      ctx,
      key,
      "createContact",
      v,
      async () => {
        const result = (
          await tx.query(
            "insert into app.contact(org_id,name,phone_e164,preferred_language)values($1,$2,$3,$4)returning *",
            [ctx.orgId, v.name, v.phone, v.preferredLanguage],
          )
        ).rows[0];
        const duplicate = v.phone
          ? !!(
              await tx.query(
                "select id from app.contact where org_id=$1 and phone_e164=$2 and id<>$3 limit 1",
                [ctx.orgId, v.phone, result.id],
              )
            ).rowCount
          : false;
        await audit(tx, ctx, "contact.created", "contact", result.id);
        return {
          ref: { id: result.id },
          data: { ...result, duplicatePhone: duplicate },
        };
      },
      async (ref) => load(String(ref.id)),
    );
  }
  const m = path.match(
    /^\/contacts\/([^/]+)(?:\/(notes|consents|do-not-contact))?$/,
  );
  if (!m) return;
  const id = uuid.parse(m[1]),
    action = m[2];
  if (method === "GET") {
    const row = await load(id);
    if (action === "notes" || action === "consents")
      return page(tx, ctx.orgId, action, query, id);
    if (!action)
      return {
        ...row,
        notes: await page(tx, ctx.orgId, "notes", new URLSearchParams(), id),
        consents: await page(
          tx,
          ctx.orgId,
          "consents",
          new URLSearchParams(),
          id,
        ),
        activityAvailable: false,
      };
    return;
  }
  const v =
    !action && method === "PATCH"
      ? contactUpdate.parse(body)
      : action === "notes" && method === "POST"
        ? noteInput.parse(body)
        : action === "consents" && method === "POST"
          ? consentInput.parse(body)
          : action === "do-not-contact" && method === "PUT"
            ? dncInput.parse(body)
            : null;
  if (!v) return;
  return command(
    tx,
    ctx,
    key,
    "contact." + (action ?? "update"),
    { id, ...v },
    async () => {
      const row = await load(id, true);
      if (row.deletion_pending) throw new AppError("DELETION_PENDING", 409);
      if (row.revision !== v.expectedRevision)
        throw new AppError("CONFLICT", 409);
      let added;
      if ("phone" in v)
        await tx.query(
          "update app.contact set name=$1,phone_e164=$2,preferred_language=$3 where id=$4",
          [v.name, v.phone, v.preferredLanguage, id],
        );
      if ("text" in v)
        added = (
          await tx.query(
            "insert into app.contact_note(org_id,contact_id,text,actor_id)values($1,$2,$3,$4)returning *",
            [ctx.orgId, id, v.text, ctx.identity.userId],
          )
        ).rows[0];
      if ("channel" in v)
        added = (
          await tx.query(
            "insert into app.consent_record(org_id,contact_id,channel,purpose,granted,source,evidence,actor_id)values($1,$2,$3,$4,$5,$6,$7,$8)returning *",
            [
              ctx.orgId,
              id,
              v.channel,
              v.purpose,
              v.granted,
              v.source,
              v.evidence,
              ctx.identity.userId,
            ],
          )
        ).rows[0];
      if ("enabled" in v) {
        await tx.query("update app.contact set do_not_contact=$1 where id=$2", [
          v.enabled,
          id,
        ]);
        await tx.query(
          "insert into app.contact_note(org_id,contact_id,text,actor_id)values($1,$2,$3,$4)",
          [
            ctx.orgId,
            id,
            (v.enabled
              ? "Do not contact enabled: "
              : "Do not contact disabled: ") + v.reason,
            ctx.identity.userId,
          ],
        );
      }
      await tx.query(
        "update app.contact set revision=revision+1,updated_at=now() where id=$1",
        [id],
      );
      await audit(
        tx,
        ctx,
        "contact." + (action ?? "updated"),
        "contact",
        id,
        "enabled" in v ? { enabled: v.enabled } : {},
      );
      return {
        ref: { id, recordId: added?.id },
        data: added ? { ...added, revision: row.revision + 1 } : await load(id),
      };
    },
    async (ref) => {
      const row = await load(id);
      if (ref.recordId) {
        const table = action === "notes" ? "contact_note" : "consent_record";
        const record = (
          await tx.query(
            `select * from app.${table} where org_id=$1 and contact_id=$2 and id=$3`,
            [ctx.orgId, id, ref.recordId],
          )
        ).rows[0];
        if (!record) throw new AppError("NOT_FOUND", 404);
        return { ...record, revision: row.revision };
      }
      return row;
    },
  );
}
