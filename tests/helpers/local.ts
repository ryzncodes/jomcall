import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { Database } from "../../packages/db/src/index.ts";
export async function createHarness() {
  if (new URL(process.env.SUPABASE_URL!).hostname !== "127.0.0.1")
    throw Error("LOCAL_ONLY");
  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const cleanup = new pg.Pool({
    connectionString: process.env.LOCAL_ADMIN_DATABASE_URL,
  });
  const namespace = `test_${randomUUID()}`;
  const users: string[] = [];
  const orgs: string[] = [];
  const db = new Database(process.env.APP_DATABASE_URL!, 1);
  async function actor() {
    const email = `test-${randomUUID()}@example.invalid`,
      password = randomBytes(24).toString("hex");
    const made = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (made.error) throw made.error;
    users.push(made.data.user.id);
    const auth = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const signed = await auth.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const token = signed.data.session!.access_token;
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    return {
      userId: made.data.user.id,
      sessionId: claims.session_id,
      confirmedEmail: email,
      token,
      refreshToken: signed.data.session!.refresh_token,
      auth,
      password,
    };
  }
  const alice = await actor(),
    bob = await actor(),
    staff = await actor();
  async function organization(identity: typeof alice) {
    const x = await db.bootstrap(
      identity,
      {
        name: "Studio Contoh",
        businessType: "other",
        primaryLocationName: "Cawangan Contoh",
      },
      { idempotencyKey: randomUUID() },
    );
    orgs.push(x.orgId);
    return { id: x.orgId, agentId: x.agentId, locationId: x.locationId };
  }
  async function close() {
    const queuePool = new pg.Pool({
      connectionString: process.env.QUEUE_DATABASE_URL,
    });
    try {
      for (const prefix of ["core_", "agent_"]) {
        if (
          (
            await cleanup.query(
              "select to_regprocedure('pgboss.delete_queue(text)') as fn",
            )
          ).rows[0].fn
        )
          if (
            (
              await queuePool.query(
                "select name from pgboss.queue where name=$1",
                [prefix + namespace],
              )
            ).rowCount
          )
            await queuePool.query("select pgboss.delete_queue($1)", [
              prefix + namespace,
            ]);
      }
    } finally {
      await queuePool.end();
    }
    for (const id of orgs)
      await cleanup.query("delete from app.organization where id=$1", [id]);
    for (const id of users) await admin.auth.admin.deleteUser(id);
    await db.close();
    await cleanup.end();
  }
  try {
    const orgA = await organization(alice),
      orgB = await organization(bob);
    await cleanup.query(
      "insert into app.member(org_id,user_id,role) values($1,$2,'staff')",
      [orgA.id, staff.userId],
    );
    return {
      db,
      admin,
      cleanup,
      alice,
      bob,
      staff,
      orgA,
      orgB,
      namespace,
      sqlAsApp: db.withUserTransaction.bind(db),
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
