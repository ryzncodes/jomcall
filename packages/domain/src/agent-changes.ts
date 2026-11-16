// What the draft would change if published now: a read-only comparison of the
// draft with the last published version, and a token that moves whenever the
// frozen draft moves (checked by publish).
import type { PoolClient } from "pg";
import { agentSettings } from "../../contracts/src/agent.ts";
import type {
  AgentChange,
  AgentChanges,
  AgentSettings,
  Version,
} from "../../contracts/src/core.ts";
import { AppError } from "../../contracts/src/index.ts";
import { loadHours, type FrozenHours } from "./knowledge/hours.ts";
import {
  catalogueDigest,
  jsonbOrder,
  loadCore,
  type CoreFact,
  type CoreRule,
} from "./knowledge/snapshot.ts";
import { sha256 } from "./knowledge/text.ts";

export type DraftFreeze = {
  settings: AgentSettings;
  knowledge: { kind: string; name: string; content: string }[];
  packs: string[];
  facts: CoreFact[];
  rules: CoreRule[];
  catalogue: { hash: string; rows: number } | null;
  hours: FrozenHours[];
};

// Reads only: no catalogue set or search unit is written.
export async function draftFreeze(
  tx: PoolClient,
  orgId: string,
  agentId: string,
): Promise<DraftFreeze> {
  const agent = (
    await tx.query("select draft from app.agent where org_id=$1 and id=$2", [
      orgId,
      agentId,
    ])
  ).rows[0];
  if (!agent) throw new AppError("NOT_FOUND", 404);
  const knowledge = (
    await tx.query(
      "select kind,name,content from app.knowledge_item where org_id=$1 and agent_id=$2 order by created_at,id",
      [orgId, agentId],
    )
  ).rows;
  const core = await loadCore(tx, orgId, agentId);
  const digest = await catalogueDigest(tx, orgId, agentId);
  return {
    settings: agentSettings.parse(agent.draft),
    knowledge,
    ...core,
    catalogue: digest.rows ? { hash: digest.hash, rows: digest.rows } : null,
    hours: await loadHours(tx, orgId),
  };
}

export const changeToken = (freeze: DraftFreeze): string =>
  sha256(JSON.stringify(jsonbOrder(freeze)));

const json = (v: unknown) => JSON.stringify(jsonbOrder(v ?? null));
const text120 = (s: string) => Array.from(s).slice(0, 120).join("");

function multisetDiff(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const x of a) left.set(x, (left.get(x) ?? 0) + 1);
  let rightOnly = 0;
  for (const x of b) {
    const n = left.get(x) ?? 0;
    if (n) left.set(x, n - 1);
    else rightOnly++;
  }
  let leftOnly = 0;
  for (const n of left.values()) leftOnly += n;
  return leftOnly + rightOnly;
}

function diffSettings(
  pub: Record<string, unknown> | null,
  draft: Record<string, unknown>,
): AgentChange[] {
  const out: AgentChange[] = [];
  const keys = new Set([...Object.keys(pub ?? {}), ...Object.keys(draft)]);
  for (const key of keys) {
    const inPub = !!pub && key in pub;
    const inDraft = key in draft;
    if (inPub && inDraft) {
      if (json(pub![key]) !== json(draft[key]))
        out.push({ kind: "setting", op: "changed", label: key });
    } else
      out.push({
        kind: "setting",
        op: inDraft ? "added" : "removed",
        label: key,
      });
  }
  return out;
}

function diffKnowledge(
  pub: { kind: string; name: string; content: string }[],
  draft: DraftFreeze["knowledge"],
): AgentChange[] {
  const names = (xs: { name: string }[]) =>
    new Set(xs.map((x) => x.name)).size !== xs.length;
  if (names(pub) || names(draft)) {
    const n = multisetDiff(pub.map(json), draft.map(json));
    return n
      ? [{ kind: "knowledge", op: "changed", label: "", count: n }]
      : [];
  }
  const out: AgentChange[] = [];
  const before = new Map(pub.map((x) => [x.name, x]));
  for (const x of draft) {
    const old = before.get(x.name);
    if (!old) out.push({ kind: "knowledge", op: "added", label: x.name });
    else if (json(old) !== json(x))
      out.push({ kind: "knowledge", op: "changed", label: x.name });
  }
  const now = new Set(draft.map((x) => x.name));
  for (const x of pub)
    if (!now.has(x.name))
      out.push({ kind: "knowledge", op: "removed", label: x.name });
  return out;
}

function diffPacks(pub: string[], draft: string[]): AgentChange[] {
  return [
    ...draft
      .filter((p) => !pub.includes(p))
      .map((p) => ({ kind: "pack", op: "added", label: p }) as AgentChange),
    ...pub
      .filter((p) => !draft.includes(p))
      .map((p) => ({ kind: "pack", op: "removed", label: p }) as AgentChange),
  ];
}

const factContent = (f: CoreFact) =>
  json([f.packId ?? null, f.fieldKey ?? null, f.title, f.value, f.language]);

function diffFacts(pub: CoreFact[], draft: CoreFact[]): AgentChange[] {
  // Identical content is unchanged whatever the id (a restore gives new ids).
  const pubLeft = [...pub];
  const draftLeft: CoreFact[] = [];
  for (const f of draft) {
    const i = pubLeft.findIndex((p) => factContent(p) === factContent(f));
    if (i >= 0) pubLeft.splice(i, 1);
    else draftLeft.push(f);
  }
  const out: AgentChange[] = [];
  const byId = new Map(pubLeft.map((f) => [f.id, f]));
  for (const f of draftLeft) {
    if (byId.has(f.id)) {
      byId.delete(f.id);
      out.push({ kind: "fact", op: "changed", label: f.title });
    } else out.push({ kind: "fact", op: "added", label: f.title });
  }
  for (const f of byId.values())
    out.push({ kind: "fact", op: "removed", label: f.title });
  return out;
}

function diffRules(pub: CoreRule[], draft: CoreRule[]): AgentChange[] {
  const out: AgentChange[] = [];
  const packKey = (r: CoreRule) => `${r.packId}\u0000${r.ruleId}`;
  const pubPack = new Map(pub.filter((r) => r.packId).map((r) => [packKey(r), r]));
  const draftPack = new Map(draft.filter((r) => r.packId).map((r) => [packKey(r), r]));
  for (const [k, r] of draftPack) {
    const old = pubPack.get(k);
    if (!old) out.push({ kind: "rule", op: "added", label: text120(r.text) });
    else if (old.text !== r.text || old.kind !== r.kind)
      out.push({ kind: "rule", op: "changed", label: text120(r.text) });
  }
  for (const [k, r] of pubPack)
    if (!draftPack.has(k))
      out.push({ kind: "rule", op: "removed", label: text120(r.text) });
  // Owner rules are keyed on kind and text: a changed kind is a remove plus an add.
  const own = (rs: CoreRule[]) =>
    rs.filter((r) => !r.packId).map((r) => ({ key: `${r.kind}\u0000${r.text}`, text: r.text }));
  const draftOwn = own(draft);
  for (const o of own(pub)) {
    const i = draftOwn.findIndex((x) => x.key === o.key);
    if (i >= 0) draftOwn.splice(i, 1);
    else out.push({ kind: "rule", op: "removed", label: text120(o.text) });
  }
  for (const o of draftOwn)
    out.push({ kind: "rule", op: "added", label: text120(o.text) });
  return out;
}

function diffHours(
  pub: FrozenHours[],
  draft: FrozenHours[],
  today: string,
): AgentChange[] {
  const live = (h: FrozenHours) => ({
    name: h.name,
    weekdays: h.weekdays,
    closures: h.closures.filter((c) => c.date >= today),
  });
  const out: AgentChange[] = [];
  const before = new Map(pub.map((h) => [h.locationId, h]));
  for (const h of draft) {
    const old = before.get(h.locationId);
    if (!old) out.push({ kind: "hours", op: "added", label: h.name });
    else if (json(live(old)) !== json(live(h)))
      out.push({ kind: "hours", op: "changed", label: h.name });
  }
  const now = new Set(draft.map((h) => h.locationId));
  for (const h of pub)
    if (!now.has(h.locationId))
      out.push({ kind: "hours", op: "removed", label: h.name });
  return out;
}

// Pure. Price lines come from catalogueChanges (SQL), not from here.
export function diffSnapshot(
  published: Version["snapshot"] | null,
  draft: DraftFreeze,
  today: string,
): AgentChange[] {
  const p = published as
    | (Partial<Version["snapshot"]> & {
        facts?: CoreFact[];
        rules?: CoreRule[];
      })
    | null;
  return [
    ...diffSettings(
      p ? (p.settings as unknown as Record<string, unknown>) : null,
      draft.settings as unknown as Record<string, unknown>,
    ),
    ...diffKnowledge((p?.knowledge as DraftFreeze["knowledge"]) ?? [], draft.knowledge),
    ...diffPacks(p?.packs ?? [], draft.packs),
    ...diffFacts(p?.facts ?? [], draft.facts),
    ...diffRules(p?.rules ?? [], draft.rules),
    ...diffHours(p?.hours ?? [], draft.hours, today),
  ];
}

const priceCols = "item,aliases,price_sen,stock_note,attributes::text as attributes,language";

// Price lines: skipped when the digests match. Otherwise the confirmed rows
// are compared with the published set's rows.
export async function catalogueChanges(
  tx: PoolClient,
  orgId: string,
  agentId: string,
  draft: DraftFreeze["catalogue"],
  published: { setId?: string; hash: string } | null | undefined,
): Promise<AgentChange[]> {
  if ((draft?.hash ?? null) === (published?.hash ?? null)) return [];
  const setId = published?.setId ?? null;
  const ctes = `with d as (select ${priceCols} from app.catalogue_row where org_id=$1 and agent_id=$2 and status='confirmed'),
    p as (select ${priceCols} from app.catalogue_set_row where org_id=$1 and set_id=$3::uuid)`;
  const args = [orgId, agentId, setId];
  const sum = (
    await tx.query(
      `${ctes} select
        (select count(*) from (select * from d except all select * from p) x)::int as dn,
        (select count(*) from (select * from p except all select * from d) x)::int as pn,
        exists(select 1 from d group by item having count(*)>1)
          or exists(select 1 from p group by item having count(*)>1) as dup`,
      args,
    )
  ).rows[0];
  const total: number = sum.dn + sum.pn;
  if (!total) return [];
  if (sum.dup || total > 200)
    return [{ kind: "price", op: "changed", label: "", count: total }];
  const rows = (
    await tx.query(
      `${ctes} select coalesce(d.item,p.item) as item,
        case when p.item is null then 'added' when d.item is null then 'removed' else 'changed' end as op
       from d full outer join p on p.item=d.item
       where p.item is null or d.item is null
          or (d.aliases,d.price_sen,d.stock_note,d.attributes,d.language) is distinct from (p.aliases,p.price_sen,p.stock_note,p.attributes,p.language)
       order by 1`,
      args,
    )
  ).rows;
  return rows.map((r) => ({ kind: "price", op: r.op, label: r.item }));
}

export async function agentChanges(
  tx: PoolClient,
  orgId: string,
  agentId: string,
): Promise<AgentChanges> {
  const agent = (
    await tx.query(
      "select published_version_id from app.agent where org_id=$1 and id=$2",
      [orgId, agentId],
    )
  ).rows[0];
  if (!agent) throw new AppError("NOT_FOUND", 404);
  const snapshot: Version["snapshot"] | null = agent.published_version_id
    ? ((
        await tx.query(
          "select snapshot from app.agent_version where org_id=$1 and agent_id=$2 and id=$3",
          [orgId, agentId, agent.published_version_id],
        )
      ).rows[0]?.snapshot ?? null)
    : null;
  const freeze = await draftFreeze(tx, orgId, agentId);
  const today = (
    await tx.query(
      "select (now() at time zone 'Asia/Kuala_Lumpur')::date::text as today",
    )
  ).rows[0].today;
  const changes = [
    ...diffSnapshot(snapshot, freeze, today),
    ...(await catalogueChanges(
      tx,
      orgId,
      agentId,
      freeze.catalogue,
      snapshot?.catalogue,
    )),
  ];
  return {
    count: changes.reduce((n, c) => n + (c.count ?? 1), 0),
    token: changeToken(freeze),
    published: !!snapshot,
    changes,
  };
}
