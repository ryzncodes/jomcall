import pg from "pg";
import { createHash } from "node:crypto";
import {
  AppError,
  organizationInput,
  uuid,
  type Identity,
  type TenantContext,
  type MutationMeta,
  type Role,
} from "../../contracts/src/index.ts";
export class Database {
  pool: pg.Pool;
  constructor(url: string, max = 5) {
    const u = new URL(url);
    if (u.hostname !== "127.0.0.1" || u.port !== "54622")
      throw Error("LOCAL_DATABASE_REQUIRED");
    this.pool = new pg.Pool({ connectionString: url, max });
    this.pool.on("error", () => console.error("DATABASE_POOL_ERROR"));
  }
  async withIdentity<T>(
    identity: Identity,
    run: (tx: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      await tx.query(
        "select set_config('app.user_id',$1,true),set_config('app.session_id',$2,true)",
        [uuid.parse(identity.userId), uuid.parse(identity.sessionId)],
      );
      if (
        !(await tx.query("select app_private.session_active() as active"))
          .rows[0].active
      )
        throw new AppError("UNAUTHORIZED", 401);
      const result = await run(tx);
      await tx.query("commit");
      return result;
    } catch (e) {
      await tx.query("rollback");
      throw e;
    } finally {
      tx.release();
    }
  }
  async withUserTransaction<T>(
    identity: Identity,
    orgId: string,
    run: (tx: pg.PoolClient, context: TenantContext) => Promise<T>,
  ): Promise<T> {
    return this.withIdentity(identity, async (tx) => {
      await tx.query("select set_config('app.org_id',$1,true)", [
        uuid.parse(orgId),
      ]);
      const role = (
        await tx.query("select app_private.active_role($1) as role", [orgId])
      ).rows[0].role as Role | null;
      if (!role) throw new AppError("NOT_FOUND", 404);
      return run(tx, { identity, orgId, role });
    });
  }
  async bootstrap(identity: Identity, input: unknown, meta: MutationMeta) {
    const x = organizationInput.parse(input);
    const key = uuid.parse(meta.idempotencyKey);
    const hash = createHash("sha256").update(JSON.stringify(x)).digest("hex");
    return this.withIdentity(
      identity,
      async (tx) =>
        (
          await tx.query(
            "select app_private.bootstrap_workspace($1,$2,$3,$4,$5) as result",
            [x.name, x.businessType, x.primaryLocationName, key, hash],
          )
        ).rows[0].result as {
          orgId: string;
          locationId: string;
          agentId: string;
          role: "owner";
        },
    );
  }
  async organizations(identity: Identity) {
    return this.withIdentity(
      identity,
      async (tx) =>
        (await tx.query("select * from app_private.my_organizations()")).rows,
    );
  }
  close() {
    return this.pool.end();
  }
}
