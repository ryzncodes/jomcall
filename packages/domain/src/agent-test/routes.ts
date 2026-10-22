import { getModelReadiness } from "../../../inference/src/ollama.ts";
import { submitTurn, controlTurn } from "./turns.ts";
import { applyBookingProposal } from "./proposals.ts";
import type { PoolClient } from "pg";
import { z } from "zod";
import { uuid, type TenantContext } from "../../../contracts/src/index.ts";
import { manager } from "../authorization.ts";
import {
  startSession,
  loadSession,
  deleteSession,
  sessionDetail,
  publicSession,
} from "./sessions.ts";
import { buildKnowledgeIndex, searchKnowledge } from "./knowledge.ts";
export async function agentTestRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
  query: URLSearchParams,
) {
  if (path === "/agent-tests/readiness" && method === "GET") {
    manager(ctx);
    return getModelReadiness();
  }
  const turn = path.match(
    /^\/agent-tests\/([^/]+)\/turns(?:\/([^/]+)\/(cancel|retry))?$/,
  );
  if (turn && method === "POST") {
    if (!turn[2])
      return submitTurn(
        tx,
        ctx,
        uuid.parse(turn[1]),
        body,
        key,
        await getModelReadiness(),
      );
    return controlTurn(
      tx,
      ctx,
      uuid.parse(turn[1]),
      uuid.parse(turn[2]),
      turn[3] as "cancel" | "retry",
      body,
      key,
      turn[3] === "retry" ? await getModelReadiness() : undefined,
    );
  }
  const apply = path.match(
    /^\/agent-tests\/([^/]+)\/proposals\/([^/]+)\/apply$/,
  );
  if (apply && method === "POST")
    return applyBookingProposal(
      tx,
      ctx,
      uuid.parse(apply[1]),
      uuid.parse(apply[2]),
      body,
      key,
    );
  const m = path.match(/^\/agent-tests(?:\/([^/]+)(?:\/(knowledge))?)?$/);
  if (!m) return;
  manager(ctx);
  const id = m[1] ? uuid.parse(m[1]) : null;
  if (!id && method === "POST") return startSession(tx, ctx, body, key);
  if (!id && method === "GET") {
    z.object({}).strict().parse(Object.fromEntries(query));
    return (
      await tx.query(
        "select * from app.test_session where org_id=$1 and expires_at>now() order by created_at desc,id desc limit 20",
        [ctx.orgId],
      )
    ).rows.map(publicSession);
  }
  if (!id) return;
  if (method === "DELETE") return deleteSession(tx, ctx, id, body, key);
  if (method === "GET" && m[2] === "knowledge") {
    const { query: q } = z
      .object({ query: z.string().min(1).max(200) })
      .strict()
      .parse(Object.fromEntries(query));
    const session = await loadSession(tx, ctx, id);
    return searchKnowledge(buildKnowledgeIndex(session.snapshot), q);
  }
  if (method === "GET") return sessionDetail(tx, ctx, id);
}
