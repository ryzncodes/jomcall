import type pg from "pg";

// The one call other parts of JomCall make to bill usage. Stable interface:
//   recordUsage(db, { orgId, kind, quantity, idempotencyKey, occurredAt?, ref? })
// - kind "voice_second": quantity is call seconds (a 3-minute call is 180).
// - kind "whatsapp_conversation" and "typed_turn": quantity is a count.
// - idempotencyKey: stable per billable unit, e.g. "call:<call id>". A retry
//   with the same key returns the first result and never charges twice. The
//   same key with a different kind or quantity fails with CONFLICT.
// Bill only after the provider confirms the event (design spec section 6).
// Never refuses for low credit: usage that happened is always recorded.
// The connection must be a role granted app_private.record_usage
// (jomcall_worker or jomcall_agent).
export type UsageKind = "voice_second" | "whatsapp_conversation" | "typed_turn";
export type UsageInput = {
  orgId: string;
  kind: UsageKind;
  quantity: number;
  idempotencyKey: string;
  occurredAt?: Date;
  ref?: Record<string, string | number | boolean>;
};
export type WalletState = {
  balanceSen: number;
  currency: "MYR";
  state: "unfunded" | "ok" | "low" | "grace" | "exhausted";
  serviceAllowed: boolean;
  lowThresholdSen: number;
  graceFloorSen: number;
};
export type UsageResult = WalletState & {
  usageEventId: string;
  amountSen: number;
  duplicate: boolean;
};

export async function recordUsage(
  db: Pick<pg.Pool | pg.PoolClient, "query">,
  input: UsageInput,
): Promise<UsageResult> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)
    throw Error("INVALID_USAGE");
  const row = (
    await db.query(
      "select app_private.record_usage($1,$2,$3,$4,$5,$6) as value",
      [
        input.orgId,
        input.kind,
        input.quantity,
        input.idempotencyKey,
        input.occurredAt ?? new Date(),
        JSON.stringify(input.ref ?? {}),
      ],
    )
  ).rows[0].value;
  return { ...row, balanceSen: Number(row.balanceSen) };
}

// Ask before starting a new call or conversation. A call already in
// progress is never cut off; it finishes and is billed into grace.
export async function walletState(
  db: Pick<pg.Pool | pg.PoolClient, "query">,
  orgId: string,
): Promise<WalletState> {
  const row = (
    await db.query("select app_private.wallet_state($1) as value", [orgId])
  ).rows[0].value;
  return { ...row, balanceSen: Number(row.balanceSen) };
}
