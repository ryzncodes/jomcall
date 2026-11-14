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
  setupFactPayload,
  setupItemInput,
  setupSchedulePayload,
  setupSettingsPayload,
  setupStart,
  type Setup,
} from "../../../contracts/src/setup.ts";
import { audit, command } from "../../../db/src/receipts.ts";
import { manager } from "../authorization.ts";
import { basePack, packById, packIds } from "../packs/index.ts";
import {
  factKeyOf,
  missingFacts,
  questionById,
  setupQuestions,
  type SetupQuestion,
} from "./questions.ts";

const itemColumns = "id,kind,key,payload,source,needs_check,check_reason,state";
// The staging slot a question fills: a fact key, "schedule" or "settings".
const questionSlot = (q: SetupQuestion) =>
  q.kind === "hours"
    ? "schedule"
    : q.kind === "first_words"
      ? "settings"
      : factKeyOf(q)!;
// An item belongs to a question when it fills the same slot and, for a fact,
// under the same pack. A removed item of a dropped pack does not hide a new
// pack's question on the same key.
type ItemLike = { kind: string; key: string; payload: unknown };
const owns = (q: SetupQuestion, i: ItemLike) =>
  q.kind === "hours"
    ? i.kind === "schedule"
    : q.kind === "first_words"
      ? i.kind === "settings"
      : i.kind === "fact" &&
        i.key === factKeyOf(q) &&
        (i.payload as { packId?: unknown } | null)?.packId ===
          q.id.split(":")[0];
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
          question_ids: string[];
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
    // Missing: only live items count as filled.
    const filled = new Set<string>(confirmed);
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
      // The frozen list, minus every question that has an item in any state
      // (answered, skipped or applied).
      questions: session.question_ids
        .map((id) => questionById(id))
        .filter(
          (q): q is SetupQuestion => !!q && !items.some((i) => owns(q, i)),
        ),
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
        const confirmed = (
          await tx.query(
            "select field_key from app.knowledge_fact where org_id=$1 and agent_id=$2 and status='confirmed' and field_key is not null",
            [ctx.orgId, agentId],
          )
        ).rows.map((r) => r.field_key as string);
        const freeze = () =>
          setupQuestions({
            mainPack: v.mainPack,
            extraPacks: v.extraPacks,
            filled: new Set(confirmed),
          }).map((q) => q.id);
        if (!open) {
          // Freeze the interview once, in order.
          const ids = freeze();
          await tx.query(
            "insert into app.setup_session(org_id,agent_id,main_pack,extra_packs,question_ids,created_by) values($1,$2,$3,$4,$5,$6)",
            [
              ctx.orgId,
              agentId,
              v.mainPack,
              v.extraPacks,
              ids,
              ctx.identity.userId,
            ],
          );
        } else if (
          open.main_pack !== v.mainPack ||
          [...open.extra_packs].sort().join() !==
            [...v.extraPacks].sort().join()
        ) {
          const items = (
            await tx.query(
              "select id,kind,key,payload,state from app.setup_item where org_id=$1 and session_id=$2",
              [ctx.orgId, open.id],
            )
          ).rows;
          const active = [basePack, v.mainPack, ...v.extraPacks];
          // Facts of a pack that is no longer active are dropped.
          const dropped = new Set<string>();
          for (const i of items)
            if (
              i.kind === "fact" &&
              i.state !== "applied" &&
              !active.includes(i.payload?.packId)
            ) {
              dropped.add(i.id);
              await tx.query(
                "update app.setup_item set state='removed',updated_at=now() where id=$1",
                [i.id],
              );
            }
          const filled = new Set<string>(confirmed);
          for (const i of items) {
            if (dropped.has(i.id) || i.kind === "catalogue_row") continue;
            filled.add(i.kind === "fact" ? i.key : i.kind);
          }
          // Keep every id that already has an item, then fill the rest of
          // the 8 slots for the new packs.
          const kept = open.question_ids.filter((id) => {
            const q = questionById(id);
            return q && items.some((i) => owns(q, i));
          });
          const fresh = setupQuestions({
            mainPack: v.mainPack,
            extraPacks: v.extraPacks,
            filled,
          }).filter((q) => !kept.includes(q.id));
          while (kept.length + fresh.length > 8) {
            const at = fresh.map((q) => q.kind).lastIndexOf("fact");
            fresh.splice(at >= 0 ? at : fresh.length - 1, 1);
          }
          await tx.query(
            "update app.setup_session set main_pack=$1,extra_packs=$2,question_ids=$3,revision=revision+1,updated_at=now() where id=$4",
            [
              v.mainPack,
              v.extraPacks,
              [...kept, ...fresh.map((q) => q.id)],
              open.id,
            ],
          );
        } else if (open.question_ids.length === 0) {
          // A session from before the list was stored: freeze it now if
          // nothing has been answered yet.
          const any = await tx.query(
            "select 1 from app.setup_item where org_id=$1 and session_id=$2 limit 1",
            [ctx.orgId, open.id],
          );
          if (!any.rowCount)
            await tx.query(
              "update app.setup_session set question_ids=$1,updated_at=now() where id=$2",
              [freeze(), open.id],
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
        // The question is in the frozen list (answered or not, so an answer
        // can be changed), or is "missing:<pack>:<field>": a required fact
        // of an active pack the review page adds. That one is not counted.
        let question: SetupQuestion | null = session.question_ids.includes(
          questionId,
        )
          ? questionById(questionId)
          : null;
        if (!question && questionId.startsWith("missing:")) {
          const [, packId, ...rest] = questionId.split(":");
          const fieldKey = rest.join(":");
          const active = [basePack, session.main_pack, ...session.extra_packs];
          const field = active.includes(packId!)
            ? packById(packId!)?.facts.find((f) => f.key === fieldKey)
            : undefined;
          const listed =
            field?.required &&
            ((await view()).missing.some(
              (x) => x.pack === packId && x.key === fieldKey,
            ) ||
              (
                await tx.query(
                  "select 1 from app.setup_item where org_id=$1 and session_id=$2 and kind='fact' and key=$3 and payload->>'packId'=$4",
                  [ctx.orgId, session.id, fieldKey, packId],
                )
              ).rowCount);
          if (listed)
            question = {
              id: questionId,
              kind: "fact",
              en: field!.label.en,
              ms: field!.label.ms,
              fills: ["facts." + fieldKey],
            };
        }
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
        if (
          answer.kind === "fact" ||
          (answer.kind === "skip" && itemKind === "fact")
        ) {
          const packId = question.id.startsWith("missing:")
            ? question.id.split(":")[1]!
            : question.id.split(":")[0]!;
          const field = packById(packId)?.facts.find((f) => f.key === itemKey);
          payload = {
            packId,
            fieldKey: itemKey,
            title: field?.label.en ?? itemKey,
            ...(answer.kind === "fact"
              ? { value: answer.text, language: "mixed" }
              : {}),
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
            `insert into app.setup_item(org_id,session_id,kind,key,payload,source,state) values($1,$2,$3,$4,$5,'interview','removed')
             on conflict(session_id,kind,key) do update set payload=case when app.setup_item.payload->>'packId' is not distinct from excluded.payload->>'packId' then app.setup_item.payload else excluded.payload end,state='removed',updated_at=now()`,
            [ctx.orgId, session.id, itemKind, itemKey, JSON.stringify(payload)],
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
      // Validate per kind; merge into the stored payload so packId and
      // fieldKey of a fact stay as stored.
      let merged: unknown = undefined;
      if (v.payload !== undefined) {
        const stored = (item.payload ?? {}) as Record<string, unknown>;
        if (item.kind === "fact")
          merged = { ...stored, ...setupFactPayload.parse(v.payload) };
        else if (item.kind === "schedule")
          merged = { ...stored, ...setupSchedulePayload.parse(v.payload) };
        else if (item.kind === "settings")
          merged = { ...stored, ...setupSettingsPayload.parse(v.payload) };
        else {
          if (
            !v.payload ||
            typeof v.payload !== "object" ||
            Array.isArray(v.payload)
          )
            throw new AppError("INVALID_PAYLOAD", 422);
          merged = { ...stored, ...(v.payload as object) };
        }
        if (bytes(merged) > 8000) throw new AppError("VALUE_TOO_LARGE", 422);
      }
      await tx.query(
        "update app.setup_item set payload=coalesce($1::jsonb,payload),state=coalesce($2,state),updated_at=now() where id=$3",
        [
          merged === undefined ? null : JSON.stringify(merged),
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
