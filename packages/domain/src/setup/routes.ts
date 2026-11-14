// Guided setup commands: staged answers in app.setup_session / app.setup_item.
// Nothing here touches facts, schedules or settings the agent reads; a later
// task applies the staged items. Owners and admins only.
import type { PoolClient } from "pg";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../../contracts/src/index.ts";
import {
  setupAnswerInput,
  setupItemInput,
  setupStart,
  type Setup,
} from "../../../contracts/src/setup.ts";
import { audit, command } from "../../../db/src/receipts.ts";
import { manager } from "../authorization.ts";
import { packById, packIds } from "../packs/index.ts";
import {
  factKeyOf,
  missingFacts,
  setupQuestions,
  type SetupQuestion,
} from "./questions.ts";

const itemColumns = "id,kind,key,payload,source,needs_check,check_reason,state";
const bytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).length;

export async function setupRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
) {
  const m = path.match(
    /^\/agents\/([^/]+)\/setup(?:\/(answers|items)\/([^/]+))?$/,
  );
  if (!m) return;
  const isRoot = !m[2];
  const ok =
    (isRoot && ["GET", "POST"].includes(method)) ||
    (!isRoot && method === "PUT");
  if (!ok) return;
  manager(ctx);
  const agentId = uuid.parse(m[1]);
  const child =
    m[2] === "items"
      ? uuid.parse(m[3])
      : m[3]
        ? decodeURIComponent(m[3])
        : null;

  const agent = async () => {
    const row = (
      await tx.query(
        "select id,draft from app.agent where org_id=$1 and id=$2 for update",
        [ctx.orgId, agentId],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    return row;
  };
  const openSession = async (lock = false) =>
    (
      await tx.query(
        `select * from app.setup_session where org_id=$1 and agent_id=$2 and state='open'${lock ? " for update" : ""}`,
        [ctx.orgId, agentId],
      )
    ).rows[0] as
      | {
          id: string;
          main_pack: string;
          extra_packs: string[];
          state: "open" | "applied";
          revision: number;
        }
      | undefined;

  // The one state the whole interview reads: items, the questions still to
  // ask, required facts still missing, and staged values that would replace
  // something already confirmed on the agent.
  const view = async (): Promise<Setup> => {
    const session = await openSession();
    if (!session)
      return {
        session: null,
        items: [],
        questions: [],
        missing: [],
        conflicts: [],
      };
    const rows = (
      await tx.query(
        `select ${itemColumns} from app.setup_item where org_id=$1 and session_id=$2 order by created_at,id`,
        [ctx.orgId, session.id],
      )
    ).rows;
    const items = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      key: r.key,
      payload: r.payload,
      source: r.source,
      needsCheck: r.needs_check,
      checkReason: r.check_reason,
      state: r.state,
    }));
    const live = items.filter((i) => i.state !== "removed");
    const confirmed = (
      await tx.query(
        "select field_key from app.knowledge_fact where org_id=$1 and agent_id=$2 and status='confirmed' and field_key is not null",
        [ctx.orgId, agentId],
      )
    ).rows.map((r) => r.field_key as string);
    const slot = (i: { kind: string; key: string }) =>
      i.kind === "fact" ? i.key : i.kind === "catalogue_row" ? null : i.kind;
    // Questions: a skipped (removed) item still keeps its question out of
    // the list for this session. Missing: only live items count as filled.
    const asked = new Set<string>(confirmed);
    const filled = new Set<string>(confirmed);
    for (const i of items) if (slot(i)) asked.add(slot(i)!);
    for (const i of live) if (slot(i)) filled.add(slot(i)!);
    const input = {
      mainPack: session.main_pack,
      extraPacks: session.extra_packs,
      filled,
    };

    const conflicts: Setup["conflicts"] = [];
    const pending = items.filter((i) =>
      ["pending", "confirmed"].includes(i.state),
    );
    for (const i of pending) {
      if (i.kind === "fact") {
        const packId = (i.payload as { packId?: unknown } | null)?.packId;
        const hit = (
          await tx.query(
            "select value from app.knowledge_fact where org_id=$1 and agent_id=$2 and status='confirmed' and field_key=$3 and ($4::text is null or pack_id=$4) limit 1",
            [
              ctx.orgId,
              agentId,
              i.key,
              typeof packId === "string" ? packId : null,
            ],
          )
        ).rows[0];
        if (hit) conflicts.push({ itemId: i.id, current: hit.value });
      } else if (i.kind === "schedule") {
        // The agent's own location, as saved by the schedule screen. A fresh
        // workspace has no row, or seven empty days: no conflict.
        const hit = (
          await tx.query(
            `select s.timezone,s.weekdays from app.agent a join app.location_schedule s on s.org_id=a.org_id and s.location_id=a.location_id
             where a.org_id=$1 and a.id=$2`,
            [ctx.orgId, agentId],
          )
        ).rows[0];
        if (hit && (hit.weekdays as unknown[][]).some((d) => d.length))
          conflicts.push({
            itemId: i.id,
            current: { timezone: hit.timezone, weekdays: hit.weekdays },
          });
      } else if (i.kind === "settings") {
        const draft = (
          await tx.query(
            "select draft from app.agent where org_id=$1 and id=$2",
            [ctx.orgId, agentId],
          )
        ).rows[0]?.draft as
          | { greeting?: string; aiDisclosure?: string }
          | undefined;
        if (draft?.greeting?.trim() || draft?.aiDisclosure?.trim())
          conflicts.push({
            itemId: i.id,
            current: {
              greeting: draft.greeting ?? "",
              aiDisclosure: draft.aiDisclosure ?? "",
            },
          });
      }
    }
    return {
      session: {
        id: session.id,
        mainPack: session.main_pack,
        extraPacks: session.extra_packs,
        state: session.state,
        revision: session.revision,
      },
      items,
      questions: setupQuestions({ ...input, filled: asked }),
      missing: missingFacts(input),
      conflicts,
    };
  };
  const bump = async (sessionId: string) => {
    await tx.query(
      "update app.setup_session set revision=revision+1,updated_at=now() where id=$1",
      [sessionId],
    );
  };
  const lockedSession = async (expected: number) => {
    const s = await openSession(true);
    if (!s) throw new AppError("NOT_FOUND", 404);
    if (s.revision !== expected) throw new AppError("CONFLICT", 409);
    return s;
  };

  if (method === "GET") {
    const known = await tx.query(
      "select 1 from app.agent where org_id=$1 and id=$2",
      [ctx.orgId, agentId],
    );
    if (!known.rowCount) throw new AppError("NOT_FOUND", 404);
    return view();
  }

  if (isRoot) {
    const v = setupStart.parse(body);
    for (const p of [v.mainPack, ...v.extraPacks])
      if (!packIds.includes(p)) throw new AppError("UNKNOWN_PACK", 422);
    if (
      new Set(v.extraPacks).size !== v.extraPacks.length ||
      v.extraPacks.includes(v.mainPack)
    )
      throw new AppError("DUPLICATE_PACK", 422);
    return command(
      tx,
      ctx,
      key,
      "setup.start",
      { agentId, ...v },
      async () => {
        await agent();
        const open = await openSession(true);
        if (open) {
          await tx.query(
            "update app.setup_session set main_pack=$1,extra_packs=$2,revision=revision+1,updated_at=now() where id=$3",
            [v.mainPack, v.extraPacks, open.id],
          );
        } else {
          await tx.query(
            "insert into app.setup_session(org_id,agent_id,main_pack,extra_packs,created_by) values($1,$2,$3,$4,$5)",
            [ctx.orgId, agentId, v.mainPack, v.extraPacks, ctx.identity.userId],
          );
        }
        // Trial credit, once. A savepoint keeps the transaction usable when
        // it was already claimed; any other failure propagates.
        await tx.query("savepoint setup_trial");
        try {
          await tx.query("select app_private.claim_trial($1)", [ctx.orgId]);
          await tx.query("release savepoint setup_trial");
        } catch (e) {
          await tx.query("rollback to savepoint setup_trial");
          if ((e as Error).message !== "TRIAL_USED") throw e;
        }
        await audit(tx, ctx, "setup.start", "agent", agentId);
        return { ref: { id: agentId }, data: await view() };
      },
      async () => view(),
    );
  }

  if (m[2] === "answers") {
    const questionId = child as string;
    const v = setupAnswerInput.parse(body);
    return command(
      tx,
      ctx,
      key,
      "setup.answer",
      { agentId, questionId, ...v },
      async () => {
        await agent();
        const session = await lockedSession(v.expectedRevision);
        const base = {
          mainPack: session.main_pack,
          extraPacks: session.extra_packs,
        };
        // The question must be one the interview offers. One the owner has
        // already answered has left the list; look at the full list too so
        // an answer can be changed later.
        const current = (await view()).questions;
        const question: SetupQuestion | undefined =
          current.find((q) => q.id === questionId) ??
          setupQuestions({ ...base, filled: new Set() }).find(
            (q) => q.id === questionId,
          );
        if (!question) throw new AppError("NOT_FOUND", 404);

        let answer = v.answer;
        if (answer.kind === "fact" && !answer.text) answer = { kind: "skip" };
        if (answer.kind !== "skip" && answer.kind !== question.kind)
          throw new AppError("ANSWER_KIND_MISMATCH", 422);

        const itemKind =
          question.kind === "hours"
            ? "schedule"
            : question.kind === "first_words"
              ? "settings"
              : "fact";
        const itemKey = itemKind === "fact" ? factKeyOf(question)! : itemKind;
        let payload: Record<string, unknown> = {};
        if (answer.kind === "fact") {
          const packId = question.id.split(":")[0]!;
          const field = packById(packId)?.facts.find((f) => f.key === itemKey);
          payload = {
            packId,
            fieldKey: itemKey,
            title: field?.label.en ?? itemKey,
            value: answer.text,
            language: "mixed",
          };
        } else if (answer.kind === "hours")
          payload = { timezone: answer.timezone, weekdays: answer.weekdays };
        else if (answer.kind === "first_words")
          payload = {
            greeting: answer.greeting,
            aiDisclosure: answer.aiDisclosure,
          };
        // One row per (session, kind, key): a repeat answer, or an answer
        // after a skip, updates that row.
        if (answer.kind === "skip")
          await tx.query(
            `insert into app.setup_item(org_id,session_id,kind,key,payload,source,state) values($1,$2,$3,$4,'{}','interview','removed')
             on conflict(session_id,kind,key) do update set state='removed',updated_at=now()`,
            [ctx.orgId, session.id, itemKind, itemKey],
          );
        else
          await tx.query(
            `insert into app.setup_item(org_id,session_id,kind,key,payload,source) values($1,$2,$3,$4,$5,'interview')
             on conflict(session_id,kind,key) do update set payload=excluded.payload,source='interview',needs_check=false,check_reason=null,state='pending',updated_at=now()`,
            [ctx.orgId, session.id, itemKind, itemKey, JSON.stringify(payload)],
          );
        await bump(session.id);
        await audit(tx, ctx, "setup.answer", "agent", agentId, {
          kind: answer.kind,
        });
        return { ref: { id: agentId }, data: await view() };
      },
      async () => view(),
    );
  }

  // items
  const v = setupItemInput.parse(body);
  return command(
    tx,
    ctx,
    key,
    "setup.item",
    { agentId, itemId: child, ...v },
    async () => {
      await agent();
      const session = await lockedSession(v.expectedRevision);
      const item = (
        await tx.query(
          `select ${itemColumns} from app.setup_item where org_id=$1 and session_id=$2 and id=$3 for update`,
          [ctx.orgId, session.id, child],
        )
      ).rows[0];
      if (!item) throw new AppError("NOT_FOUND", 404);
      if (item.state === "applied") throw new AppError("CONFLICT", 409);
      if (v.payload === undefined && v.state === undefined)
        throw new AppError("EMPTY_UPDATE", 422);
      if (v.payload !== undefined && item.kind === "fact") {
        const p = v.payload as { value?: unknown } | null;
        if (!p || typeof p !== "object" || Array.isArray(p))
          throw new AppError("INVALID_PAYLOAD", 422);
        if (p.value !== undefined && bytes(p.value) > 4000)
          throw new AppError("VALUE_TOO_LARGE", 422);
      }
      await tx.query(
        "update app.setup_item set payload=coalesce($1::jsonb,payload),state=coalesce($2,state),updated_at=now() where id=$3",
        [
          v.payload === undefined ? null : JSON.stringify(v.payload),
          v.state ?? null,
          item.id,
        ],
      );
      await bump(session.id);
      await audit(tx, ctx, "setup.item", "agent", agentId, { itemId: item.id });
      return { ref: { id: agentId }, data: await view() };
    },
    async () => view(),
  );
}
