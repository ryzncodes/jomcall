// Signed-in commands for the WhatsApp channel and the shared inbox. These run
// as jomcall_app under row-level security. Nothing here calls a provider:
// sends are queued and the agent process applies the send rules.
import type { PoolClient } from "pg";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../../contracts/src/index.ts";
import {
  channelRevision,
  channelSave,
  conversationList,
  staffReply,
  templateCreate,
  templateStatus,
} from "../../../contracts/src/whatsapp.ts";
import { command, audit } from "../../../db/src/receipts.ts";
import { manager, namespace } from "../authorization.ts";
import {
  sealCredentials,
  whatsappReadiness,
} from "../../../whatsapp/src/index.ts";
import { windowOpen } from "./policy.ts";

type Env = Record<string, string | undefined>;
const channelColumns =
  "id,state,state_reason,phone_number_id,waba_id,display_phone_e164,credentials_set_at,agent_enabled,revision";

async function loadChannel(tx: PoolClient, orgId: string, lock = false) {
  return (
    (
      await tx.query(
        `select ${channelColumns} from app.whatsapp_channel where org_id=$1${lock ? " for update" : ""}`,
        [orgId],
      )
    ).rows[0] ?? null
  );
}

async function overview(tx: PoolClient, ctx: TenantContext, env: Env) {
  const channel = await loadChannel(tx, ctx.orgId);
  return {
    readiness: whatsappReadiness(env),
    channel,
    templates: channel
      ? (
          await tx.query(
            "select id,name,language,category,purpose,status,body,variables,revision from app.whatsapp_template where org_id=$1 order by name,language",
            [ctx.orgId],
          )
        ).rows
      : [],
  };
}

const summarySql = `select c.id,c.contact_id,k.name as contact_name,c.wa_id,c.state,c.owner,c.needs_attention,c.attention_reason,c.last_message_at,c.last_inbound_at,c.revision,
 (select m.body from app.message m where m.org_id=c.org_id and m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) as last_body
 from app.conversation c join app.contact k on(k.org_id=c.org_id and k.id=c.contact_id)`;

async function loadConversation(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
  lock = false,
) {
  if (lock)
    await tx.query(
      "select id from app.conversation where org_id=$1 and id=$2 for update",
      [ctx.orgId, id],
    );
  const row = (
    await tx.query(summarySql + " where c.org_id=$1 and c.id=$2", [
      ctx.orgId,
      id,
    ])
  ).rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404);
  return row;
}

async function conversationDetail(
  tx: PoolClient,
  ctx: TenantContext,
  id: string,
) {
  const row = await loadConversation(tx, ctx, id);
  const { last_inbound_at } = row;
  return {
    ...row,
    window_open: windowOpen(
      last_inbound_at ? new Date(last_inbound_at).toISOString() : null,
      new Date().toISOString(),
    ),
    messages: (
      await tx.query(
        "select * from (select id,direction,author,kind,body,status,error_code,created_at from app.message where org_id=$1 and conversation_id=$2 order by created_at desc,id desc limit 200) recent order by created_at,id",
        [ctx.orgId, id],
      )
    ).rows,
    proposals: (
      await tx.query(
        "select id,kind,details,state,created_at from app.conversation_proposal where org_id=$1 and conversation_id=$2 order by created_at,id",
        [ctx.orgId, id],
      )
    ).rows,
  };
}

export async function whatsappRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
  env: Env = process.env,
) {
  if (path === "/channels/whatsapp" && method === "GET")
    return overview(tx, ctx, env);

  if (path === "/channels/whatsapp" && method === "PUT") {
    manager(ctx);
    const v = channelSave.parse(body);
    const ready = whatsappReadiness(env);
    if (!ready.configured) throw new AppError("WHATSAPP_NOT_CONFIGURED", 503);
    if (
      ready.provider === "cloud" &&
      !v.accessToken &&
      !(await loadChannel(tx, ctx.orgId))?.credentials_set_at
    )
      throw new AppError("ACCESS_TOKEN_REQUIRED", 422);
    const { accessToken, ...logged } = v;
    // The receipt hash covers the token's presence only, never its value.
    return command(
      tx,
      ctx,
      key,
      "saveWhatsAppChannel",
      { ...logged, token: !!accessToken },
      async () => {
        const existing = await loadChannel(tx, ctx.orgId, true);
        if (existing && existing.revision !== v.expectedRevision)
          throw new AppError("CONFLICT", 409);
        const sealed = accessToken
          ? sealCredentials(
              { accessToken },
              env.WHATSAPP_CREDENTIALS_KEY,
              ctx.orgId,
            )
          : null;
        const agent = (
          await tx.query(
            "select id,location_id from app.agent where org_id=$1 order by created_at,id limit 1",
            [ctx.orgId],
          )
        ).rows[0];
        if (!agent) throw new AppError("NOT_FOUND", 404);
        let row;
        if (!existing)
          row = (
            await tx.query(
              `insert into app.whatsapp_channel(org_id,namespace,location_id,agent_id,state,phone_number_id,waba_id,credentials,credentials_set_at,agent_enabled)
             values($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9) returning ${channelColumns}`,
              [
                ctx.orgId,
                namespace(),
                agent.location_id,
                agent.id,
                v.phoneNumberId,
                v.wabaId,
                sealed,
                sealed ? new Date() : null,
                v.agentEnabled,
              ],
            )
          ).rows[0];
        else
          row = (
            await tx.query(
              // The web role cannot read the credentials column, so a kept
              // token is simply left untouched.
              `update app.whatsapp_channel set state='pending',state_reason=null,phone_number_id=$2,waba_id=$3,
             agent_enabled=$4,revision=revision+1,updated_at=now()${sealed ? ",credentials=$5,credentials_set_at=now()" : ""} where org_id=$1 returning ${channelColumns}`,
              [
                ctx.orgId,
                v.phoneNumberId,
                v.wabaId,
                v.agentEnabled,
                ...(sealed ? [sealed] : []),
              ],
            )
          ).rows[0];
        await audit(
          tx,
          ctx,
          "whatsapp.channel_saved",
          "whatsapp_channel",
          row.id,
          { tokenReplaced: !!sealed },
        );
        return { ref: { id: row.id }, data: row };
      },
      async () => loadChannel(tx, ctx.orgId),
    );
  }

  if (path === "/channels/whatsapp/disconnect" && method === "POST") {
    manager(ctx);
    const v = channelRevision.parse(body);
    return command(
      tx,
      ctx,
      key,
      "disconnectWhatsApp",
      v,
      async () => {
        const existing = await loadChannel(tx, ctx.orgId, true);
        if (!existing) throw new AppError("NOT_FOUND", 404);
        if (existing.revision !== v.expectedRevision)
          throw new AppError("CONFLICT", 409);
        const row = (
          await tx.query(
            `update app.whatsapp_channel set state='not_connected',state_reason=null,credentials=null,credentials_set_at=null,revision=revision+1,updated_at=now() where org_id=$1 returning ${channelColumns}`,
            [ctx.orgId],
          )
        ).rows[0];
        await audit(
          tx,
          ctx,
          "whatsapp.channel_disconnected",
          "whatsapp_channel",
          row.id,
        );
        return { ref: { id: row.id }, data: row };
      },
      async () => loadChannel(tx, ctx.orgId),
    );
  }

  if (path === "/channels/whatsapp/templates" && method === "POST") {
    manager(ctx);
    const v = templateCreate.parse(body);
    return command(
      tx,
      ctx,
      key,
      "createWhatsAppTemplate",
      v,
      async () => {
        const channel = await loadChannel(tx, ctx.orgId);
        if (!channel) throw new AppError("WHATSAPP_NOT_CONFIGURED", 409);
        const row = (
          await tx.query(
            "insert into app.whatsapp_template(org_id,channel_id,name,language,category,purpose,body,variables)values($1,$2,$3,$4,$5,$6,$7,$8) returning id,name,language,category,purpose,status,body,variables,revision",
            [
              ctx.orgId,
              channel.id,
              v.name,
              v.language,
              v.category,
              v.purpose,
              v.body,
              v.variables,
            ],
          )
        ).rows[0];
        await audit(
          tx,
          ctx,
          "whatsapp.template_created",
          "whatsapp_template",
          row.id,
        );
        return { ref: { id: row.id }, data: row };
      },
      async (ref) =>
        (
          await tx.query(
            "select id,name,language,category,purpose,status,body,variables,revision from app.whatsapp_template where org_id=$1 and id=$2",
            [ctx.orgId, ref.id],
          )
        ).rows[0],
    );
  }

  const tpl = path.match(/^\/channels\/whatsapp\/templates\/([^/]+)$/);
  if (tpl && method === "PATCH") {
    manager(ctx);
    const id = uuid.parse(tpl[1]);
    const v = templateStatus.parse(body);
    return command(
      tx,
      ctx,
      key,
      "updateWhatsAppTemplate",
      { id, ...v },
      async () => {
        const row = (
          await tx.query(
            "update app.whatsapp_template set status=$3,revision=revision+1,updated_at=now() where org_id=$1 and id=$2 and revision=$4 returning id,name,language,category,purpose,status,body,variables,revision",
            [ctx.orgId, id, v.status, v.expectedRevision],
          )
        ).rows[0];
        if (!row) throw new AppError("CONFLICT", 409);
        await audit(
          tx,
          ctx,
          "whatsapp.template_status",
          "whatsapp_template",
          id,
          { status: v.status },
        );
        return { ref: { id }, data: row };
      },
      async () =>
        (
          await tx.query(
            "select id,name,language,category,purpose,status,body,variables,revision from app.whatsapp_template where org_id=$1 and id=$2",
            [ctx.orgId, id],
          )
        ).rows[0],
    );
  }

  if (path === "/conversations" && method === "GET") {
    const v = conversationList.parse(Object.fromEntries(query));
    return (
      await tx.query(
        summarySql +
          ` where c.org_id=$1 ${v.attention === "needs" ? "and c.needs_attention" : ""} order by c.needs_attention desc,c.last_message_at desc,c.id desc limit 100`,
        [ctx.orgId],
      )
    ).rows;
  }

  const conv = path.match(
    /^\/conversations\/([^/]+)(?:\/(messages|takeover|handback|resolve))?$/,
  );
  if (!conv) return;
  const id = uuid.parse(conv[1]);
  const action = conv[2];
  if (!action && method === "GET") return conversationDetail(tx, ctx, id);
  if (!action || method !== "POST") return;

  if (action === "messages") {
    const v = staffReply.parse(body);
    return command(
      tx,
      ctx,
      key,
      "staffWhatsAppReply",
      { id, ...v },
      async () => {
        const row = await loadConversation(tx, ctx, id, true);
        if (row.revision !== v.expectedRevision)
          throw new AppError("CONFLICT", 409);
        if (row.state !== "open")
          throw new AppError("CONVERSATION_CLOSED", 409);
        // A person replying takes the conversation from the agent.
        await tx.query(
          "insert into app.message(org_id,conversation_id,direction,author,kind,body,status,actor_id)values($1,$2,'outbound','staff','text',$3,'queued',$4)",
          [ctx.orgId, id, v.text, ctx.identity.userId],
        );
        await tx.query(
          "update app.conversation set owner='staff',needs_attention=false,attention_reason=null,revision=revision+1 where org_id=$1 and id=$2",
          [ctx.orgId, id],
        );
        await audit(tx, ctx, "conversation.staff_replied", "conversation", id);
        return { ref: { id }, data: await conversationDetail(tx, ctx, id) };
      },
      () => conversationDetail(tx, ctx, id),
    );
  }

  const v = channelRevision.parse(body);
  return command(
    tx,
    ctx,
    key,
    "conversation." + action,
    { id, ...v },
    async () => {
      const row = await loadConversation(tx, ctx, id, true);
      if (row.revision !== v.expectedRevision)
        throw new AppError("CONFLICT", 409);
      if (row.state !== "open") throw new AppError("CONVERSATION_CLOSED", 409);
      const set =
        action === "takeover"
          ? "owner='staff',needs_attention=false,attention_reason=null"
          : action === "handback"
            ? "owner='agent',handoff_turn_id=null,needs_attention=false,attention_reason=null"
            : "state='closed',closed_at=now(),needs_attention=false,attention_reason=null";
      await tx.query(
        `update app.conversation set ${set},revision=revision+1 where org_id=$1 and id=$2`,
        [ctx.orgId, id],
      );
      await audit(tx, ctx, "conversation." + action, "conversation", id);
      return { ref: { id }, data: await conversationDetail(tx, ctx, id) };
    },
    () => conversationDetail(tx, ctx, id),
  );
}
