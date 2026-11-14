// Freezing the knowledge core into a snapshot (publish, draft test start) and
// copying it back (restore). Runs inside a tenant transaction as the web role.
import type { PoolClient } from "pg";
import { AppError } from "../../../contracts/src/index.ts";
import { LIMITS } from "../../../contracts/src/knowledge.ts";
import { activePacks, packIds, type RuleKind } from "../packs/index.ts";
import { sha256 } from "./text.ts";

export type CoreFact = {
  id: string;
  packId: string | null;
  fieldKey: string | null;
  title: string;
  value: unknown;
  language: string;
};
export type CoreRule = {
  kind: RuleKind;
  text: string;
  packId: string | null;
  ruleId: string | null;
};
export type CoreSnapshot = {
  packs?: string[];
  facts?: CoreFact[];
  rules?: CoreRule[];
  catalogue?: { setId: string; hash: string; rows: number } | null;
  context?: SessionContext;
  // Snapshots also hold settings and free-text knowledge.
  [key: string]: unknown;
};
export type SessionContext = {
  business: { name: string; type: string };
  location: { name: string };
  schedule: {
    timezone: string;
    weekdays: { start: string; end: string }[][];
    closures: { date: string; reason: string }[];
  } | null;
};

type OverrideRow = {
  kind: RuleKind;
  text: string;
  pack_id: string | null;
  pack_rule_id: string | null;
  enabled: boolean;
};
// Pack defaults (English text, the prompt language) minus those the owner
// switched off, with the owner's edits, then the owner's own rules.
export function resolveRules(
  packs: string[],
  rows: OverrideRow[],
): CoreRule[] {
  const out: CoreRule[] = [];
  for (const pack of activePacks(packs))
    for (const rule of pack.rules) {
      const o = rows.find(
        (r) => r.pack_id === pack.id && r.pack_rule_id === rule.id,
      );
      if (o && !o.enabled) continue;
      out.push({
        kind: rule.kind,
        text: o ? o.text : rule.text.en,
        packId: pack.id,
        ruleId: rule.id,
      });
    }
  for (const r of rows)
    if (!r.pack_id && r.enabled)
      out.push({ kind: r.kind, text: r.text, packId: null, ruleId: null });
  return out;
}

export async function loadCore(tx: PoolClient, orgId: string, agentId: string) {
  const agent = (
    await tx.query("select packs from app.agent where org_id=$1 and id=$2", [
      orgId,
      agentId,
    ])
  ).rows[0];
  const packs: string[] = (agent?.packs ?? []).filter((p: string) =>
    packIds.includes(p),
  );
  const facts: CoreFact[] = (
    await tx.query(
      "select id,pack_id,field_key,title,value,language from app.knowledge_fact where org_id=$1 and agent_id=$2 and status='confirmed' order by pack_id nulls last,created_at,id",
      [orgId, agentId],
    )
  ).rows
    // Facts for a pack that is switched off stay stored but are not live.
    .filter((f) => !f.pack_id || [...packs, "every-business"].includes(f.pack_id))
    .map((f) => ({
      id: f.id,
      packId: f.pack_id,
      fieldKey: f.field_key,
      title: f.title,
      value: f.value,
      language: f.language,
    }));
  const ruleRows = (
    await tx.query(
      "select kind,text,pack_id,pack_rule_id,enabled from app.knowledge_rule where org_id=$1 and agent_id=$2 and status='confirmed' order by created_at,id",
      [orgId, agentId],
    )
  ).rows;
  return { packs, facts, rules: resolveRules(packs, ruleRows) };
}

// Hash the confirmed rows; reuse the set with that hash or copy them into a
// new immutable set in one statement. Returns null for an empty catalogue.
export async function freezeCatalogue(
  tx: PoolClient,
  orgId: string,
  agentId: string,
): Promise<NonNullable<CoreSnapshot["catalogue"]> | null> {
  const digest = (
    await tx.query(
      "select count(*)::int as rows,encode(sha256(convert_to(coalesce(string_agg(concat_ws(chr(31),item,array_to_string(aliases,chr(30)),coalesce(price_sen::text,''),stock_note,attributes::text,language,updated_at::text),chr(29) order by created_at,id),''),'UTF8')),'hex')as hash from app.catalogue_row where org_id=$1 and agent_id=$2 and status='confirmed'",
      [orgId, agentId],
    )
  ).rows[0];
  if (!digest.rows) return null;
  const found = (
    await tx.query(
      "select id from app.catalogue_set where org_id=$1 and agent_id=$2 and hash=$3",
      [orgId, agentId, digest.hash],
    )
  ).rows[0];
  if (found) return { setId: found.id, hash: digest.hash, rows: digest.rows };
  const set = (
    await tx.query(
      "insert into app.catalogue_set(org_id,agent_id,hash,row_count)values($1,$2,$3,$4)returning id",
      [orgId, agentId, digest.hash, digest.rows],
    )
  ).rows[0];
  await tx.query(
    `insert into app.catalogue_set_row(org_id,set_id,ordinal,item,aliases,lookup_keys,search_text,price_sen,stock_note,attributes,language,updated_at,unit_hash)
     select org_id,$3,(row_number() over(order by created_at,id))-1,item,aliases,lookup_keys,search_text,price_sen,stock_note,attributes,language,updated_at,
      encode(sha256(convert_to(item||chr(10)||search_text,'UTF8')),'hex')
     from app.catalogue_row where org_id=$1 and agent_id=$2 and status='confirmed'`,
    [orgId, agentId, set.id],
  );
  // Searchable units for the rows; embeddings are filled later, if enabled.
  await tx.query(
    `insert into app.knowledge_unit(org_id,hash,source,language,title,text)
     select org_id,unit_hash,'catalogue',language,left(item,200),left(search_text,8000) from app.catalogue_set_row where org_id=$1 and set_id=$2
     on conflict do nothing`,
    [orgId, set.id],
  );
  return { setId: set.id, hash: digest.hash, rows: digest.rows };
}

export const factText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(factText).join("; ")
      : value && typeof value === "object"
        ? Object.entries(value as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${factText(v)}`)
            .join(", ")
        : String(value ?? "");

export const unitHash = (title: string, text: string) =>
  sha256(title + "\n" + text);

export async function ensureFactUnits(
  tx: PoolClient,
  orgId: string,
  facts: CoreFact[],
) {
  for (const f of facts) {
    const text = Array.from(factText(f.value)).slice(0, 2000).join("");
    await tx.query(
      "insert into app.knowledge_unit(org_id,hash,source,language,title,text)values($1,$2,'fact',$3,$4,$5)on conflict do nothing",
      [
        orgId,
        unitHash(f.title, text),
        f.language,
        Array.from(f.title).slice(0, 200).join(""),
        text,
      ],
    );
  }
}

export async function freezeCore(
  tx: PoolClient,
  orgId: string,
  agentId: string,
): Promise<Required<Omit<CoreSnapshot, "context">>> {
  const core = await loadCore(tx, orgId, agentId);
  const catalogue = await freezeCatalogue(tx, orgId, agentId);
  await ensureFactUnits(tx, orgId, core.facts);
  return { ...core, catalogue };
}

export async function sessionContext(
  tx: PoolClient,
  orgId: string,
  locationId: string,
): Promise<SessionContext> {
  const row = (
    await tx.query(
      "select o.name as business,o.business_type,l.name as location,s.timezone,s.weekdays,s.closures from app.organization o join app.location l on l.org_id=o.id and l.id=$2 left join app.location_schedule s on s.org_id=o.id and s.location_id=l.id where o.id=$1",
      [orgId, locationId],
    )
  ).rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404);
  return {
    business: { name: row.business, type: row.business_type },
    location: { name: row.location },
    schedule: row.timezone
      ? {
          timezone: row.timezone,
          weekdays: row.weekdays,
          closures: row.closures,
        }
      : null,
  };
}

// Restore puts a version's core back into the draft. A version from before
// the knowledge core has none, which clears the draft tables.
export async function restoreCore(
  tx: PoolClient,
  orgId: string,
  agentId: string,
  snapshot: CoreSnapshot,
) {
  await tx.query("update app.agent set packs=$1 where org_id=$2 and id=$3", [
    (snapshot.packs ?? []).filter((p) => packIds.includes(p)),
    orgId,
    agentId,
  ]);
  for (const t of ["knowledge_fact", "knowledge_rule", "catalogue_row"])
    await tx.query(`delete from app.${t} where org_id=$1 and agent_id=$2`, [
      orgId,
      agentId,
    ]);
  for (const f of snapshot.facts ?? [])
    await tx.query(
      "insert into app.knowledge_fact(org_id,agent_id,pack_id,field_key,title,value,language)values($1,$2,$3,$4,$5,$6,$7)",
      [orgId, agentId, f.packId, f.fieldKey, f.title, JSON.stringify(f.value), f.language],
    );
  // Rules come back as owner rules plus overrides that reproduce the version:
  // pack defaults it dropped become "off", edited text becomes an edit.
  const frozen = snapshot.rules ?? [];
  for (const pack of activePacks(snapshot.packs))
    for (const rule of pack.rules) {
      const kept = frozen.find((r) => r.packId === pack.id && r.ruleId === rule.id);
      if (kept && kept.text === rule.text.en) continue;
      await tx.query(
        "insert into app.knowledge_rule(org_id,agent_id,kind,text,pack_id,pack_rule_id,enabled)values($1,$2,$3,$4,$5,$6,$7)",
        [orgId, agentId, rule.kind, kept?.text ?? rule.text.en, pack.id, rule.id, !!kept],
      );
    }
  for (const r of frozen.filter((r) => !r.packId))
    await tx.query(
      "insert into app.knowledge_rule(org_id,agent_id,kind,text)values($1,$2,$3,$4)",
      [orgId, agentId, r.kind, r.text],
    );
  if (snapshot.catalogue)
    await tx.query(
      `insert into app.catalogue_row(org_id,agent_id,item,aliases,lookup_keys,search_text,price_sen,stock_note,attributes,language,updated_at,created_at)
       select org_id,$2,item,aliases,lookup_keys,search_text,price_sen,stock_note,attributes,language,updated_at,now()+ordinal*interval '1 microsecond'
       from app.catalogue_set_row where org_id=$1 and set_id=$3 order by ordinal`,
      [orgId, agentId, snapshot.catalogue.setId],
    );
}

export async function enforceCoreLimits(
  tx: PoolClient,
  orgId: string,
  agentId: string,
) {
  const c = (
    await tx.query(
      "select (select count(*) from app.knowledge_fact where org_id=$1 and agent_id=$2)::int as facts,(select count(*) from app.knowledge_rule where org_id=$1 and agent_id=$2)::int as rules,(select count(*) from app.catalogue_row where org_id=$1 and agent_id=$2)::int as rows",
      [orgId, agentId],
    )
  ).rows[0];
  if (
    c.facts > LIMITS.facts ||
    c.rules > LIMITS.rules ||
    c.rows > LIMITS.catalogueRows
  )
    throw new AppError("KNOWLEDGE_LIMIT", 422);
}
