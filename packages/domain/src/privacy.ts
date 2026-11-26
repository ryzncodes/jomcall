import type { PoolClient } from "pg";
import { z } from "zod";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../contracts/src/index.ts";
import { command, audit } from "../../db/src/receipts.ts";
import { manager, namespace } from "./authorization.ts";
import { cleanMediaFacts, mediaFactsSql } from "./whatsapp/media-sql.ts";
export async function privacyRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
) {
  const create = path.match(/^\/contacts\/([^/]+)\/(export|deletion)$/),
    job = path.match(/^\/jobs\/([^/]+)(?:\/(download|retry))?$/);
  if (!create && !job && path !== "/jobs") return;
  manager(ctx);
  const load = async (id: string) => {
    const row = (
      await tx.query(
        "select * from app.privacy_job where org_id=$1 and id=$2",
        [ctx.orgId, id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return row;
  };
  if (path === "/jobs" && method === "GET")
    return (
      await tx.query(
        "select * from app.privacy_job where org_id=$1 order by created_at desc,id desc limit 100",
        [ctx.orgId],
      )
    ).rows;
  if (create && method === "POST") {
    const id = uuid.parse(create[1]),
      v = z
        .object({ expectedRevision: z.number().int().positive() })
        .strict()
        .parse(body);
    return command(
      tx,
      ctx,
      key,
      "privacy." + create[2],
      { id, ...v },
      async () => {
        const data = (
          await tx.query(
            "select app_private.request_privacy($1,$2,$3,$4,$5) as result",
            [ctx.orgId, id, v.expectedRevision, create[2], namespace()],
          )
        ).rows[0].result;
        await audit(tx, ctx, "privacy.requested", "privacy_job", data.id, {
          kind: create[2],
        });
        return { ref: { id: data.id }, data };
      },
      (ref) => load(String(ref.id)),
    );
  }
  if (!job) return;
  const id = uuid.parse(job[1]);
  if (job[2] === "retry" && method === "POST") {
    z.object({}).strict().parse(body);
    return command(
      tx,
      ctx,
      key,
      "privacy.retry",
      { id },
      async () => {
        const data = (
          await tx.query(
            "select app_private.retry_privacy($1,$2,$3) as result",
            [ctx.orgId, id, namespace()],
          )
        ).rows[0].result;
        await audit(tx, ctx, "privacy.retried", "privacy_job", id);
        return { ref: { id }, data };
      },
      () => load(id),
    );
  }
  if (method !== "GET") return;
  const j = await load(id);
  if (!job[2]) return j;
  if (job[2] !== "download") return;
  if (!j.contact_id) throw new AppError("NOT_FOUND", 404);
  if (j.kind !== "export" || j.state === "pending" || j.state === "failed")
    throw new AppError("NOT_READY", 409);
  if (j.state === "expired" || new Date(j.expires_at).getTime() <= Date.now())
    throw new AppError("EXPORT_EXPIRED", 410);
  // Lock target across all reads so concurrent edits/deletion cannot produce a mixed export.
  const c = (
    await tx.query(
      "select * from app.contact where org_id=$1 and id=$2 for share",
      [ctx.orgId, j.contact_id],
    )
  ).rows[0];
  if (!c || c.deletion_pending) throw new AppError("NOT_FOUND", 404);
  const notes = (
      await tx.query(
        "select * from app.contact_note where org_id=$1 and contact_id=$2 order by created_at,id",
        [ctx.orgId, c.id],
      )
    ).rows,
    consents = (
      await tx.query(
        "select * from app.consent_record where org_id=$1 and contact_id=$2 order by created_at,id",
        [ctx.orgId, c.id],
      )
    ).rows;
  await audit(tx, ctx, "privacy.downloaded", "privacy_job", id);
  return Response.json(
    {
      manifestVersion: j.manifest_version,
      preparedAt: j.completed_at,
      generatedAt: new Date().toISOString(),
      contact: c,
      notes,
      consents,
      agentTests: (
        await tx.query(
          "select s.*,coalesce((select jsonb_agg(t) from app.test_turn t where t.org_id=s.org_id and t.session_id=s.id),'[]')as turns,coalesce((select jsonb_agg(p) from app.test_proposal p where p.org_id=s.org_id and p.session_id=s.id),'[]')as proposals from app.test_session s where s.org_id=$1 and s.contact_id=$2",
          [ctx.orgId, c.id],
        )
      ).rows.map(({ auth_session_id, ...row }) => row),
      bookings: (
        await tx.query(
          "select * from app.booking where org_id=$1 and contact_id=$2 order by start_at,id",
          [ctx.orgId, c.id],
        )
      ).rows,
      // Questions the agent could not answer, asked by this contact in a
      // test session, a phone call or a WhatsApp chat (the gap log stores no
      // caller identity of its own).
      knowledgeGaps: (
        await tx.query(
          "select a.question,a.language,a.channel,a.answer,a.asked_at,g.status from app.knowledge_gap_ask a join app.knowledge_gap g on g.org_id=a.org_id and g.id=a.gap_id where a.org_id=$1 and a.contact_id=$2 order by a.asked_at,a.id",
          [ctx.orgId, c.id],
        )
      ).rows,
      // Follow-up items for this contact, from calls and chats. Not who
      // closed or holds them: staff user ids are not the contact's data.
      followUps: (
        await tx.query(
          "select kind,source,details,state,created_at,closed_at,due_at from app.follow_up where org_id=$1 and contact_id=$2 order by created_at,id",
          [ctx.orgId, c.id],
        )
      ).rows,
      // Real phone calls with what the caller said, what the agent answered
      // and what it left for staff. Columns are named because the web role
      // cannot read the billing columns of app.call. Left out: the agent
      // snapshot (the business's settings, not the caller's data), call
      // tokens and SIP identifiers, turn timings, evidence and usage, and
      // tool steps (internal lookups, as for WhatsApp chats). The AI summary
      // (app.call_summary) is included as one object, or null when the call
      // has no row; its model, attempts and lease are left out.
      calls: (
        await tx.query(
          `select x.id,x.caller_e164,x.dialled_e164,x.state,x.refusal,x.outcome,x.end_reason,x.language,x.after_hours,x.do_not_contact,x.transfer_result,x.disclosure_played_at,x.started_at,x.answered_at,x.ended_at,x.duration_seconds,coalesce((select jsonb_agg(jsonb_build_object('input',t.input,'answer',t.answer,'state',t.state,'created_at',t.created_at,'completed_at',t.completed_at)order by t.created_at,t.id)from app.call_turn t where t.org_id=x.org_id and t.call_id=x.id),'[]')as turns,coalesce((select jsonb_agg(jsonb_build_object('kind',p.kind,'details',p.details,'state',p.state,'created_at',p.created_at)order by p.created_at,p.id)from app.call_proposal p where p.org_id=x.org_id and p.call_id=x.id),'[]')as proposals,(select jsonb_build_object('state',s.state,'reason_en',s.reason_en,'reason_ms',s.reason_ms,'outcome_en',s.outcome_en,'outcome_ms',s.outcome_ms,'next_step_en',s.next_step_en,'next_step_ms',s.next_step_ms,'edited',s.edited,'edited_at',s.edited_at,'created_at',s.created_at,'completed_at',s.completed_at)from app.call_summary s where s.org_id=x.org_id and s.call_id=x.id)as summary from app.call x where x.org_id=$1 and x.contact_id=$2 order by x.started_at,x.id`,
          [ctx.orgId, c.id],
        )
      ).rows,
      // WhatsApp conversations with their messages and staff proposals. A
      // media message says it was a photo, voice note, video, document or
      // sticker (and a document's file name); the file itself was never
      // downloaded, so there is nothing more to give.
      conversations: (
        await tx.query(
          `select c.id,c.wa_id,c.state,c.owner,c.created_at,c.closed_at,coalesce((select jsonb_agg(jsonb_build_object('direction',m.direction,'author',m.author,'kind',m.kind,'body',m.body,'status',m.status,'created_at',m.created_at,'media',${mediaFactsSql("m")})order by m.created_at,m.id)from app.message m where m.org_id=c.org_id and m.conversation_id=c.id),'[]')as messages,coalesce((select jsonb_agg(jsonb_build_object('kind',p.kind,'details',p.details,'state',p.state,'created_at',p.created_at)order by p.created_at,p.id)from app.conversation_proposal p where p.org_id=c.org_id and p.conversation_id=c.id),'[]')as proposals from app.conversation c where c.org_id=$1 and c.contact_id=$2 order by c.created_at,c.id`,
          [ctx.orgId, c.id],
        )
      ).rows.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((m: any) => ({
          ...m,
          media: cleanMediaFacts(m.media),
        })),
      })),
    },
    {
      headers: {
        "content-disposition": `attachment; filename="contact-${c.id}.json"`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
