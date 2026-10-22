import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("member permissions, owner protection and immediate revocation", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const members = await api.request(
      h.alice,
      h.orgA.id,
      "GET",
      "/api/v1/members",
    );
    assert.equal(members.status, 200);
    const owner = members.body.data.find(
        (x: { user_id: string }) => x.user_id === h.alice.userId,
      ),
      staff = members.body.data.find(
        (x: { user_id: string }) => x.user_id === h.staff.userId,
      );
    assert.equal(staff.email, h.staff.confirmedEmail);
    assert.ok(
      !members.body.data.some(
        (m: { email: string }) => m.email === h.bob.confirmedEmail,
      ),
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "POST",
          `/api/v1/members/${owner.id}/revoke`,
          { expectedRevision: owner.revision },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await api.request(h.staff, h.orgA.id, "POST", "/api/v1/invitations", {
          email: "staff-test@example.invalid",
          role: "admin",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "PATCH",
          `/api/v1/members/${staff.id}`,
          { role: "admin", expectedRevision: staff.revision },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await api.request(h.staff, h.orgA.id, "POST", "/api/v1/invitations", {
          email: "admin-test@example.invalid",
          role: "admin",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "POST",
          `/api/v1/members/${staff.id}/revoke`,
          { expectedRevision: 2 },
        )
      ).status,
      200,
    );
    assert.equal(
      (await api.request(h.staff, h.orgA.id, "GET", "/api/v1/members")).status,
      404,
    );
    await assert.rejects(
      h.sqlAsApp(h.alice, h.orgA.id, (tx) =>
        tx.query("update app.member set role='owner' where id=$1", [staff.id]),
      ),
      /permission denied/,
    );
  } finally {
    await api.close();
    await h.close();
  }
});
