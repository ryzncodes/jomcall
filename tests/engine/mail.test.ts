import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
import { Engine } from "../../engine/src/engine.ts";
test("local invitation delivery ignores stale operations and purges acknowledged ciphertext", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  let engine: Engine | undefined;
  try {
    const req = (method: string, path: string, body?: unknown) =>
      api.request(h.alice, h.orgA.id, method, "/api/v1" + path, body);
    const inv = (
      await req("POST", "/invitations", {
        email: h.bob.confirmedEmail,
        role: "staff",
      })
    ).body.data;
    const original = (
      await h.cleanup.query(
        "select token_hash from app.invitation where id=$1",
        [inv.id],
      )
    ).rows[0].token_hash;
    await req("POST", `/invitations/${inv.id}/resend`, {});
    engine = await Engine.create(h.namespace);
    await engine.tick();
    const row = (
      await h.cleanup.query(
        "select token_hash,delivery_ciphertext,delivery_state from app.invitation where id=$1",
        [inv.id],
      )
    ).rows[0];
    assert.notEqual(row.token_hash, original);
    assert.equal(row.delivery_state, "sent");
    assert.equal(row.delivery_ciphertext, null);
    const messages = await (
      await fetch("http://127.0.0.1:54624/api/v1/messages")
    ).json();
    const matching = messages.messages.filter(
      (m: { To: { Address: string }[]; Subject: string }) =>
        m.To.some((t) => t.Address === h.bob.confirmedEmail) &&
        m.Subject === "Your local workspace invitation",
    );
    assert.equal(matching.length, 1);
    const mail = await (
      await fetch("http://127.0.0.1:54624/api/v1/message/" + matching[0].ID)
    ).json();
    assert.match(
      mail.Text,
      /http:\/\/127.0.0.1:4182\/invite\?token=[a-f0-9]{64}/,
    );
    const token = mail.Text.match(/token=([a-f0-9]{64})/)[1];
    assert.equal(
      (
        await api.request(h.bob, null, "POST", "/api/v1/invitations/accept", {
          token,
        })
      ).status,
      200,
    );
    const cancelled = (
      await req("POST", "/invitations", {
        email: h.staff.confirmedEmail,
        role: "staff",
      })
    ).body.data;
    await req("POST", `/invitations/${cancelled.id}/revoke`, {});
    await engine.tick();
    assert.equal(
      (
        await h.cleanup.query(
          "select delivery_ciphertext from app.invitation where id=$1",
          [cancelled.id],
        )
      ).rows[0].delivery_ciphertext,
      null,
    );
  } finally {
    await engine?.close();
    await api.close();
    await h.close();
  }
});
