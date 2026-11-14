// Knowledge core commands: packs, facts, rules, catalogue rows, confirmation
// and the gap log. Every change bumps the agent revision like knowledge items.
import type { PoolClient } from "pg";
import { AppError, uuid, type TenantContext } from "../../../contracts/src/index.ts";
import {
  catalogueInput,
  confirmInput,
  factInput,
  gapIgnore,
  gapResolve,
  packsInput,
  removeInput,
  ruleInput,
} from "../../../contracts/src/knowledge.ts";
import { audit, command } from "../../../db/src/receipts.ts";
import { manager } from "../authorization.ts";
import { packById, packIds, packSummaries } from "../packs/index.ts";
import { enforceCoreLimits } from "./snapshot.ts";
import { catalogueSearchText, lookupKeys } from "./text.ts";

const SHOWN_ROWS = 500;

export async function knowledgeRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
) {
  if (path === "/packs" && method === "GET") return packSummaries();
  const m = path.match(
    /^\/agents\/([^/]+)\/(core|packs|facts|rules|catalogue|confirm|gaps)(?:\/([^/]+))?(?:\/(resolve|ignore))?$/,
  );
  if (!m) return;
  manager(ctx);
  const agentId = uuid.parse(m[1]),
    action = m[2],
    child = m[3] ? uuid.parse(m[3]) : null,
    verb = m[4] ?? null;
  const agent = async (lock = false) => {
    const row = (
      await tx.query(
        `select * from app.agent where org_id=$1 and id=$2${lock ? " for update" : ""}`,
        [ctx.orgId, agentId],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return row;
  };
  const core = async () => {
    const a = await agent();
    const q = (sql: string) => tx.query(sql, [ctx.orgId, agentId]);
    const counts = (
      await q(
        "select count(*)::int as total,count(*) filter(where status='draft')::int as drafts from app.catalogue_row where org_id=$1 and agent_id=$2",
      )
    ).rows[0];
    return {
      revision: a.revision as number,
      packs: a.packs,
      facts: (await q("select * from app.knowledge_fact where org_id=$1 and agent_id=$2 order by created_at,id")).rows,
      rules: (await q("select * from app.knowledge_rule where org_id=$1 and agent_id=$2 order by created_at,id")).rows,
      catalogue: {
        ...counts,
        rows: (
          await q(
            `select id,pack_id,item,aliases,price_sen,stock_note,attributes,language,status,updated_at,revision from app.catalogue_row where org_id=$1 and agent_id=$2 order by status,created_at,id limit ${SHOWN_ROWS}`,
          )
        ).rows,
      },
    };
  };
  const gaps = async () =>
    (
      await tx.query(
        `select g.id,g.status,g.resolution,g.ask_count,g.last_asked_at,g.revision,a.question,a.language,a.channel,a.answer
         from app.knowledge_gap g join lateral(select * from app.knowledge_gap_ask x where x.org_id=g.org_id and x.gap_id=g.id order by x.asked_at desc,x.id limit 1)a on true
         where g.org_id=$1 and g.agent_id=$2 order by (g.status='open') desc,g.last_asked_at desc limit 200`,
        [ctx.orgId, agentId],
      )
    ).rows;

  if (method === "GET") {
    if (action === "core" && !child) return core();
    if (action === "gaps" && !child) return gaps();
    return;
  }

  // Gap commands carry the gap's own revision; resolving also edits the draft.
  if (action === "gaps" && child && method === "POST" && verb) {
    const resolve = verb === "resolve" ? gapResolve.parse(body) : null;
    const v = resolve ?? gapIgnore.parse(body);
    return command(
      tx,
      ctx,
      key,
      "gap." + verb,
      { agentId, child, ...v },
      async () => {
        const gap = (
          await tx.query(
            "select * from app.knowledge_gap where org_id=$1 and agent_id=$2 and id=$3 for update",
            [ctx.orgId, agentId, child],
          )
        ).rows[0];
        if (!gap) throw new AppError("NOT_FOUND", 404);
        if (gap.revision !== v.expectedRevision) throw new AppError("CONFLICT", 409);
        let ref: string | null = null;
        if (resolve) {
          const a = await agent(true);
          if (a.revision !== resolve.expectedAgentRevision) throw new AppError("CONFLICT", 409);
          ref =
            resolve.as === "fact"
              ? (
                  await tx.query(
                    "insert into app.knowledge_fact(org_id,agent_id,title,value,source)values($1,$2,$3,$4,'gap')returning id",
                    [ctx.orgId, agentId, resolve.title, JSON.stringify(resolve.value)],
                  )
                ).rows[0].id
              : (
                  await tx.query(
                    "insert into app.knowledge_rule(org_id,agent_id,kind,text,source)values($1,$2,$3,$4,'gap')returning id",
                    [ctx.orgId, agentId, resolve.kind, resolve.text],
                  )
                ).rows[0].id;
          await enforceCoreLimits(tx, ctx.orgId, agentId);
          await tx.query("update app.agent set revision=revision+1,updated_at=now() where id=$1", [agentId]);
        }
        await tx.query(
          "update app.knowledge_gap set status=$1,resolution=$2,resolved_ref=$3,resolved_at=now(),resolved_by=$4,revision=revision+1 where id=$5",
          [
            resolve ? "resolved" : "ignored",
            resolve ? resolve.as : "ignore",
            ref,
            ctx.identity.userId,
            child,
          ],
        );
        await audit(tx, ctx, "knowledge.gap." + verb, "knowledge_gap", child);
        return { ref: { id: child }, data: (await gaps()).find((g) => g.id === child) };
      },
      async (ref) => (await gaps()).find((g) => g.id === ref.id),
    );
  }

  let value: { expectedAgentRevision: number } & Record<string, any>;
  if (action === "packs" && method === "PUT" && !child) value = packsInput.parse(body);
  else if (action === "facts" && method === "POST" && !child) value = factInput.parse(body);
  else if (action === "rules" && method === "POST" && !child) value = ruleInput.parse(body);
  else if (action === "catalogue" && method === "POST" && !child) value = catalogueInput.parse(body);
  else if (action === "confirm" && method === "POST" && !child) value = confirmInput.parse(body);
  else if (["facts", "rules", "catalogue"].includes(action) && method === "DELETE" && child)
    value = removeInput.parse(body);
  else return;

  return command(
    tx,
    ctx,
    key,
    `knowledge.${action}.${method}`,
    { agentId, child, ...value },
    async () => {
      const a = await agent(true);
      if (a.revision !== value.expectedAgentRevision) throw new AppError("CONFLICT", 409);
      if (method === "DELETE") {
        const table = { facts: "knowledge_fact", rules: "knowledge_rule", catalogue: "catalogue_row" }[action]!;
        const r = await tx.query(`delete from app.${table} where org_id=$1 and agent_id=$2 and id=$3`, [
          ctx.orgId,
          agentId,
          child,
        ]);
        if (!r.rowCount) throw new AppError("NOT_FOUND", 404);
      } else if (action === "packs") {
        if (value.packs.some((p: string) => !packIds.includes(p))) throw new AppError("UNKNOWN_PACK", 422);
        await tx.query("update app.agent set packs=$1 where id=$2", [value.packs, agentId]);
      } else if (action === "facts") {
        const v = factInput.parse(value);
        if (v.packId && !packById(v.packId)?.facts.some((f) => f.key === v.fieldKey))
          throw new AppError("UNKNOWN_FIELD", 422);
        if (v.id) {
          const r = await tx.query(
            "update app.knowledge_fact set title=$1,value=$2,language=$3,status='confirmed',revision=revision+1,updated_at=now() where org_id=$4 and agent_id=$5 and id=$6",
            [v.title, JSON.stringify(v.value), v.language, ctx.orgId, agentId, v.id],
          );
          if (!r.rowCount) throw new AppError("NOT_FOUND", 404);
        } else if (v.packId)
          // One row per pack field: saving a field again replaces its value.
          await tx.query(
            `insert into app.knowledge_fact(org_id,agent_id,pack_id,field_key,title,value,language)values($1,$2,$3,$4,$5,$6,$7)
             on conflict(org_id,agent_id,pack_id,field_key)where field_key is not null
             do update set title=excluded.title,value=excluded.value,language=excluded.language,status='confirmed',revision=app.knowledge_fact.revision+1,updated_at=now()`,
            [ctx.orgId, agentId, v.packId, v.fieldKey, v.title, JSON.stringify(v.value), v.language],
          );
        else
          await tx.query(
            "insert into app.knowledge_fact(org_id,agent_id,title,value,language)values($1,$2,$3,$4,$5)",
            [ctx.orgId, agentId, v.title, JSON.stringify(v.value), v.language],
          );
      } else if (action === "rules") {
        const v = ruleInput.parse(value);
        if (v.packId && !packById(v.packId)?.rules.some((r) => r.id === v.packRuleId))
          throw new AppError("UNKNOWN_RULE", 422);
        if (v.id) {
          const r = await tx.query(
            "update app.knowledge_rule set kind=$1,text=$2,enabled=$3,status='confirmed',revision=revision+1,updated_at=now() where org_id=$4 and agent_id=$5 and id=$6",
            [v.kind, v.text, v.enabled, ctx.orgId, agentId, v.id],
          );
          if (!r.rowCount) throw new AppError("NOT_FOUND", 404);
        } else if (v.packId)
          await tx.query(
            `insert into app.knowledge_rule(org_id,agent_id,kind,text,pack_id,pack_rule_id,enabled)values($1,$2,$3,$4,$5,$6,$7)
             on conflict(org_id,agent_id,pack_id,pack_rule_id)where pack_rule_id is not null
             do update set text=excluded.text,enabled=excluded.enabled,status='confirmed',revision=app.knowledge_rule.revision+1,updated_at=now()`,
            [ctx.orgId, agentId, v.kind, v.text, v.packId, v.packRuleId, v.enabled],
          );
        else
          await tx.query("insert into app.knowledge_rule(org_id,agent_id,kind,text,enabled)values($1,$2,$3,$4,$5)", [
            ctx.orgId,
            agentId,
            v.kind,
            v.text,
            v.enabled,
          ]);
      } else if (action === "catalogue") {
        const v = catalogueInput.parse(value);
        for (const row of v.rows)
          await tx.query(
            `insert into app.catalogue_row(org_id,agent_id,pack_id,item,aliases,lookup_keys,search_text,price_sen,stock_note,attributes,language,status,source)
             values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'owner')`,
            [
              ctx.orgId,
              agentId,
              v.packId ?? null,
              row.item,
              row.aliases,
              lookupKeys(row.item, row.aliases),
              catalogueSearchText(row.item, row.aliases, row.attributes),
              row.priceSen,
              row.stockNote,
              JSON.stringify(row.attributes),
              row.language,
              v.status,
            ],
          );
      } else if (action === "confirm") {
        // D2: drafted or pasted items go live only after the owner confirms.
        for (const t of ["knowledge_fact", "knowledge_rule", "catalogue_row"])
          await tx.query(
            `update app.${t} set status='confirmed',revision=revision+1,updated_at=now() where org_id=$1 and agent_id=$2 and status='draft'`,
            [ctx.orgId, agentId],
          );
      }
      await enforceCoreLimits(tx, ctx.orgId, agentId);
      await tx.query("update app.agent set revision=revision+1,updated_at=now() where id=$1", [agentId]);
      await audit(tx, ctx, `knowledge.${action}.${method.toLowerCase()}`, "agent", agentId);
      return { ref: { id: agentId }, data: await core() };
    },
    async () => core(),
  );
}

