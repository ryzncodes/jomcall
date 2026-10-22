import { randomUUID } from "node:crypto";
import { bookingFixture } from "./booking.ts";
export async function agentFixture() {
  const f = await bookingFixture();
  const s = (
    await f.req("POST", "/agent-tests", {
      agentId: f.h.orgA.agentId,
      locationId: f.h.orgA.locationId,
      source: { kind: "draft", expectedRevision: 1 },
    })
  ).body.data;
  const t = (
    await f.h.cleanup.query(
      "insert into app.test_turn(org_id,session_id,client_turn_id,request_hash,input,state,lease_token,lease_until)values($1,$2,$3,'fixture','Test','running',$4,now()+interval '60 seconds')returning *",
      [f.h.orgA.id, s.id, randomUUID(), randomUUID()],
    )
  ).rows[0];
  return { ...f, session: s, turn: t };
}
