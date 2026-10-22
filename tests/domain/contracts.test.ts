import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commands } from "../../packages/contracts/src/core.ts";
test("generated OpenAPI covers every named command and mutation guard", () => {
  const doc = JSON.parse(
    readFileSync("packages/contracts/openapi.json", "utf8"),
  );
  for (const [name, c] of Object.entries(commands)) {
    const path = "/api/v1" + c.path.replace(/:([a-zA-Z]+)/g, "{$1}"),
      op = doc.paths[path]?.[c.method.toLowerCase()];
    assert.equal(op?.operationId, name);
    if (c.method !== "GET") {
      assert.ok(
        op.parameters.some((p: { name: string }) => p.name === "X-CSRF-Token"),
      );
      assert.ok(
        op.parameters.some(
          (p: { name: string }) => p.name === "Idempotency-Key",
        ),
      );
      assert.ok(op.requestBody.required);
    }
  }
});
