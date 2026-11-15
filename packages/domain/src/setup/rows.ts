// Staged price rows (setup_item kind catalogue_row): how each is read, how it
// is matched against other staged rows and existing catalogue rows, and what
// apply will do with it. The setup view and applySetup both call planRows, so
// the review page shows exactly what apply then does.
//
// No Node-only imports here or in anything this file imports: the browser
// recomputes outcomes with planFromView once the owner names rows to replace
// (tests/api/setup-rows.test.ts guards this).
import type {
  SetupItem,
  SetupRowOutcome,
} from "../../../contracts/src/setup.ts";
import { normaliseCode } from "../knowledge/codes.ts";

const cut = (text: string, max: number) =>
  Array.from(text).slice(0, max).join("").trim();
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

// The match key of a whole name: NFKC, lower case, and every character that
// is not a letter, digit or combining mark removed (spaces, punctuation,
// symbols). "Kopi O", "kopi-o" and "KopiO" share a key, as do "NS-40" and
// "NS40"; Tamil "பால்" and "பல்" do not, because their vowel signs are kept.
// No length cap. A name with no letters or digits (an emoji, for example) has
// the empty key, which never matches or de-duplicates anything. Lookup keys
// the agent uses (normaliseCode) are a separate thing and are not changed.
export const rowKey = (text: string) => {
  const key = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
  // Marks alone (an emoji's variation selector, U+FE0F) are not a name.
  return /[\p{L}\p{N}]/u.test(key) ? key : "";
};

export type StagedRow = {
  // The payload had an item name.
  named: boolean;
  // Item and variant joined, inner whitespace collapsed, cut to 200 code
  // points (the catalogue_row.item check).
  item: string;
  priceSen: number | null;
  // unit and notes, cut to their limits, only when not empty.
  attributes: Record<string, string>;
  key: string;
  // normaliseCode of the item: the whole-name lookup key, used only to narrow
  // the query for existing rows.
  code: string;
};

// A staged price row as apply writes it, read without trusting the stored
// payload.
export function stagedRow(payload: unknown): StagedRow {
  const p = (payload ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? collapse(v) : "");
  const name = text(p.item);
  const variant = text(p.variant);
  const item = cut(variant ? `${name} ${variant}` : name, 200);
  const priceSen =
    typeof p.priceSen === "number" &&
    Number.isInteger(p.priceSen) &&
    p.priceSen >= 0 &&
    p.priceSen <= 100000000000
      ? p.priceSen
      : null;
  const unit = cut(text(p.unit), 60);
  const notes = cut(text(p.notes), 300);
  return {
    named: !!name,
    item,
    priceSen,
    attributes: { ...(unit ? { unit } : {}), ...(notes ? { notes } : {}) },
    key: rowKey(item),
    code: normaliseCode(item),
  };
}

export type StagedInput = {
  id: string;
  state: string;
  needsCheck: boolean;
  payload: unknown;
};
// A staged row whose existing match is already known (planFromView).
export type MatchedInput = StagedInput & { target?: ExistingRow };
export type ExistingRow = {
  id: string;
  item: string;
  aliases: string[];
  priceSen: number | null;
  attributes: Record<string, unknown>;
};
export type RowOutcome = SetupRowOutcome;
export type RowPlan = {
  id: string;
  outcome: RowOutcome;
  row: StagedRow;
  // The existing confirmed row this staged row matches, if any.
  target?: ExistingRow;
  // For a duplicate: the staged row that is written or updated instead.
  duplicateOf?: string;
};
export type RowTotals = {
  total: number;
  flagged: number;
  noPrice: number;
  willWrite: number;
  duplicates: number;
  conflicts: number;
};

// The existing row a key matches: a row whose item has that key beats one
// whose alias has it; then the oldest (existing rows come oldest first).
export function matcher(existing: ExistingRow[]) {
  const byItem = new Map<string, ExistingRow>();
  const byAlias = new Map<string, ExistingRow>();
  for (const e of existing) {
    const k = rowKey(e.item);
    if (k && !byItem.has(k)) byItem.set(k, e);
    for (const a of e.aliases) {
      const ak = rowKey(a);
      if (ak && !byAlias.has(ak)) byAlias.set(ak, e);
    }
  }
  return (key: string) =>
    key ? (byItem.get(key) ?? byAlias.get(key)) : undefined;
}

// One outcome for every staged price row (live ones: pending or confirmed;
// the caller leaves out removed and applied items), in the order given.
//  - no price: no_price, whatever the state or flag;
//  - pending and flagged, or no name: unconfirmed;
//  - the rest are candidates. A candidate named in replace goes first, then
//    confirmed before pending, then document order (the order given). In that
//    order each candidate claims its key and its target existing row:
//    - key or target already claimed by a written or updated row: duplicate
//      of that row;
//    - matches an existing row: update when named in replace, otherwise
//      conflict (the owner keeps the current row). A conflict claims nothing,
//      so other rows on the same target are conflicts too;
//    - otherwise write.
// The view passes an empty replace: every match is shown as kept.
export function planRows(
  staged: StagedInput[],
  existing: ExistingRow[],
  replace: ReadonlySet<string>,
): { plans: RowPlan[]; totals: RowTotals } {
  const match = matcher(existing);
  return planMatched(
    staged.map((s) => {
      const target = match(stagedRow(s.payload).key);
      return target ? { ...s, target } : s;
    }),
    replace,
  );
}

// The same plan, with each row's existing match given.
export function planMatched(
  staged: MatchedInput[],
  replace: ReadonlySet<string>,
): { plans: RowPlan[]; totals: RowTotals } {
  const plans: RowPlan[] = staged.map((s) => {
    const row = stagedRow(s.payload);
    const target = s.target;
    const outcome: RowOutcome =
      row.priceSen === null
        ? "no_price"
        : (s.needsCheck && s.state === "pending") || !row.named
          ? "unconfirmed"
          : "write";
    return { id: s.id, outcome, row, ...(target ? { target } : {}) };
  });
  const rank = (i: number) => [
    replace.has(staged[i]!.id) ? 0 : 1,
    staged[i]!.state === "confirmed" ? 0 : 1,
    i,
  ];
  const order = plans
    .map((_, i) => i)
    .filter((i) => plans[i]!.outcome === "write")
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
    });
  const keys = new Map<string, string>();
  const targets = new Map<string, string>();
  for (const i of order) {
    const p = plans[i]!;
    const winner =
      (p.row.key && keys.get(p.row.key)) ||
      (p.target && targets.get(p.target.id));
    if (winner) {
      p.outcome = "duplicate";
      p.duplicateOf = winner;
      continue;
    }
    if (p.target && !replace.has(p.id)) {
      p.outcome = "conflict";
      continue;
    }
    if (p.target) {
      p.outcome = "update";
      targets.set(p.target.id, p.id);
    }
    if (p.row.key) keys.set(p.row.key, p.id);
  }
  const count = (o: RowOutcome) => plans.filter((p) => p.outcome === o).length;
  return {
    plans,
    totals: {
      total: staged.length,
      flagged: staged.filter((s) => s.state === "pending" && s.needsCheck)
        .length,
      noPrice: plans.filter((p) => p.row.priceSen === null).length,
      willWrite: count("write") + count("update"),
      duplicates: count("duplicate"),
      conflicts: count("conflict"),
    },
  };
}

// For the review page: the planner input from the setup view's items (price
// rows that carry an outcome, put back in document order by position; the
// existing match from current) and the ids the owner names in replace.
export function viewInput(
  items: readonly SetupItem[],
  replace: readonly string[],
): { staged: MatchedInput[]; replace: ReadonlySet<string> } {
  const staged = items
    .filter((i) => i.kind === "catalogue_row" && i.outcome !== undefined)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((i) => ({
      id: i.id,
      state: i.state,
      needsCheck: i.needsCheck,
      payload: i.payload,
      ...(i.current
        ? {
            target: {
              id: i.current.id,
              item: i.current.item,
              aliases: [],
              priceSen: i.current.priceSen,
              attributes: {},
            },
          }
        : {}),
    }));
  return { staged, replace: new Set(replace) };
}

// Outcomes and totals for the view's price rows with the owner's replace
// choice: what apply will do, unless the rows change on the server first.
export function planFromView(
  items: readonly SetupItem[],
  replace: readonly string[],
): { plans: RowPlan[]; totals: RowTotals } {
  const input = viewInput(items, replace);
  return planMatched(input.staged, input.replace);
}
