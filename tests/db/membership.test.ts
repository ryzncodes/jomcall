import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { decryptInvitationToken } from "../../packages/domain/src/invitation-crypto.ts";
test("invitation identity, single-use acceptance and token rotation", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const created = await api.request(
      h.alice,
      h.orgA.id,
      "POST",
      "/api/v1/invitations",
      { email: h.bob.confirmedEmail, role: "staff" },
    );
    assert.equal(created.status, 200);
    assert.equal(created.body.data.token_hash, undefined);
    const id = created.body.data.id;
    let row = (
      await h.cleanup.query("select * from app.invitation where id=$1", [id])
    ).rows[0];
    const first = decryptInvitationToken(
      row.delivery_ciphertext,
      process.env.INVITATION_KEY!,
      h.orgA.id + id,
    );
    assert.equal(
      (
        await api.request(h.staff, null, "POST", "/api/v1/invitations/accept", {
          token: first,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "POST",
          `/api/v1/invitations/${id}/resend`,
          {},
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await api.request(h.bob, null, "POST", "/api/v1/invitations/accept", {
          token: first,
        })
      ).status,
      404,
    );
    row = (
      await h.cleanup.query("select * from app.invitation where id=$1", [id])
    ).rows[0];
    const token = decryptInvitationToken(
      row.delivery_ciphertext,
      process.env.INVITATION_KEY!,
      h.orgA.id + id,
    );
    const [a, b] = await Promise.all([
      api.request(h.bob, null, "POST", "/api/v1/invitations/accept", { token }),
      api.request(h.bob, null, "POST", "/api/v1/invitations/accept", { token }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.body.data.id, a.body.data.id);
    assert.equal(
      (await api.request(h.bob, h.orgA.id, "GET", "/api/v1/members")).status,
      200,
    );
    assert.equal(
      (
        await h.cleanup.query(
          "select delivery_ciphertext from app.invitation where id=$1",
          [id],
        )
      ).rows[0].delivery_ciphertext,
      null,
    );
  } finally {
    await api.close();
    await h.close();
  }
});
