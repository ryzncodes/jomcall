import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
test("contacts isolate tenants and serialize note, consent and DNC edits", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h);
  try {
    const made = await api.request(
      h.alice,
      h.orgA.id,
      "POST",
      "/api/v1/contacts",
      { name: "Pelanggan Contoh", phone: null, preferredLanguage: "ms" },
    );
    assert.equal(made.status, 200);
    const id = made.body.data.id;
    assert.equal(
      (await api.request(h.bob, h.orgB.id, "GET", "/api/v1/contacts/" + id))
        .status,
      404,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "PATCH",
          "/api/v1/contacts/" + id,
          {
            name: "Pelanggan",
            phone: "01234",
            preferredLanguage: "ms",
            expectedRevision: 1,
            role: "owner",
          },
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await api.request(
          h.staff,
          h.orgA.id,
          "POST",
          `/api/v1/contacts/${id}/notes`,
          { text: "Sample internal note", expectedRevision: 1 },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "POST",
          `/api/v1/contacts/${id}/notes`,
          { text: "Stale note", expectedRevision: 1 },
        )
      ).status,
      409,
    );
    const consent = {
      expectedRevision: 2,
      channel: "whatsapp",
      purpose: "service",
      granted: true,
      source: "manual",
      evidence: "Sample customer request",
    };
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "POST",
          `/api/v1/contacts/${id}/consents`,
          consent,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "PUT",
          `/api/v1/contacts/${id}/do-not-contact`,
          { expectedRevision: 3, enabled: true, reason: "Sample opt-out" },
        )
      ).status,
      200,
    );
    const detail = (
      await api.request(h.alice, h.orgA.id, "GET", "/api/v1/contacts/" + id)
    ).body.data;
    assert.equal(detail.do_not_contact, true);
    assert.equal(detail.notes.items.length, 2);
    assert.equal(detail.consents.items.length, 1);
    assert.equal(detail.consents.items[0].granted, true);
    assert.equal(
      (
        await api.request(
          h.alice,
          h.orgA.id,
          "GET",
          "/api/v1/contacts?search=%25",
        )
      ).body.data.items.length,
      0,
    );
  } finally {
    await api.close();
    await h.close();
  }
});
