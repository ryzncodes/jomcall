import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createHarness } from "../helpers/local.ts";
import { createApiHarness } from "../helpers/api.ts";
async function link(email: string, kind: string) {
  for (let i = 0; i < 40; i++) {
    const list = await (
      await fetch("http://127.0.0.1:54624/api/v1/messages")
    ).json();
    for (const item of list.messages ?? []) {
      if (!item.To?.some((to: { Address: string }) => to.Address === email))
        continue;
      const message = await (
        await fetch("http://127.0.0.1:54624/api/v1/message/" + item.ID)
      ).json();
      const match = String(message.HTML).match(
        new RegExp(
          "http://127.0.0.1:4182/api/auth/" +
            kind +
            "\\?token_hash=([a-f0-9]+)",
        ),
      );
      if (match) return "/api/auth/" + kind + "?token_hash=" + match[1];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("LOCAL_MAIL_NOT_FOUND");
}
test("signup confirmation and recovery links stay local and single-use", async () => {
  const h = await createHarness(),
    api = await createApiHarness(h),
    email = `mail-${randomUUID()}@example.invalid`,
    password = randomBytes(18).toString("hex");
  let id: string | undefined;
  try {
    assert.equal(
      (
        await api.request(null, null, "POST", "/api/auth/signup", {
          email,
          password,
        })
      ).status,
      200,
    );
    id = (
      await h.cleanup.query("select id from auth.users where email=$1", [email])
    ).rows[0]?.id;
    assert.equal(
      (
        await api.request(null, null, "POST", "/api/auth/login", {
          email,
          password,
        })
      ).status,
      401,
    );
    const confirm = await link(email, "confirm");
    assert.equal((await api.request(null, null, "GET", confirm)).status, 303);
    assert.equal((await api.request(null, null, "GET", confirm)).status, 401);
    const signed = await api.request(null, null, "POST", "/api/auth/login", {
      email,
      password,
    });
    assert.equal(signed.status, 200);
    const reset = await api.request(
      null,
      null,
      "POST",
      "/api/auth/forgot-password",
      { email },
    );
    assert.equal(reset.status, 200);
    const recovery = await link(email, "recovery");
    assert.equal(
      (
        await api.request(
          null,
          null,
          "GET",
          recovery + "&next=https://example.invalid",
        )
      ).status,
      422,
    );
    const recovered = await api.request(null, null, "GET", recovery);
    assert.equal(recovered.status, 303);
    const cookies = recovered.headers.getSetCookie();
    const actor = {
      token: cookies
        .find((x) => x.startsWith("ca_local_access="))!
        .split(";")[0]
        .split("=")
        .slice(1)
        .join("="),
      refreshToken: cookies
        .find((x) => x.startsWith("ca_local_refresh="))!
        .split(";")[0]
        .split("=")
        .slice(1)
        .join("="),
    };
    assert.equal(
      (
        await api.request(actor, null, "POST", "/api/auth/reset-password", {
          password: password + "new",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api.request(null, null, "POST", "/api/auth/login", {
          email,
          password,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await api.request(null, null, "POST", "/api/auth/login", {
          email,
          password: password + "new",
        })
      ).status,
      200,
    );
    assert.equal((await api.request(null, null, "GET", recovery)).status, 401);
  } finally {
    if (id) await h.admin.auth.admin.deleteUser(id);
    await api.close();
    await h.close();
  }
});
