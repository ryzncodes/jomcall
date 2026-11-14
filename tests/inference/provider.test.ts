import test from "node:test";
import assert from "node:assert/strict";
import {
  agentVoiceProvider,
  configuredProvider,
  createModelClient,
  defaultHostedModel,
  getReadiness,
} from "../../packages/inference/src/provider.ts";

test("provider selection: disabled by default, hosted model named in one place", async () => {
  assert.equal(await configuredProvider({}), null);
  assert.equal(
    await configuredProvider({ JOMCALL_MODEL_PROVIDER: "disabled" }),
    null,
  );
  assert.deepEqual(
    await configuredProvider({ JOMCALL_MODEL_PROVIDER: "openrouter" }),
    {
      provider: "openrouter",
      model: defaultHostedModel,
      identity: "openrouter:" + defaultHostedModel,
    },
  );
  assert.deepEqual(
    await configuredProvider({
      JOMCALL_MODEL_PROVIDER: "openrouter",
      JOMCALL_HOSTED_MODEL: "vendor/model-2",
    }),
    {
      provider: "openrouter",
      model: "vendor/model-2",
      identity: "openrouter:vendor/model-2",
    },
  );
  await assert.rejects(
    configuredProvider({
      JOMCALL_MODEL_PROVIDER: "openrouter",
      JOMCALL_HOSTED_MODEL: "https://example.test/x",
    }),
    /HOSTED_MODEL_REQUIRED/,
  );
  await assert.rejects(
    configuredProvider({ JOMCALL_MODEL_PROVIDER: "elsewhere" }),
    /MODEL_PROVIDER_UNKNOWN/,
  );
});

test("hosted readiness needs no key and makes no network request", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("NETWORK_USED");
  };
  try {
    assert.deepEqual(
      await getReadiness({ JOMCALL_MODEL_PROVIDER: "openrouter" }),
      {
        configured: true,
        available: true,
        modelDigest: "openrouter:" + defaultHostedModel,
        reason: null,
      },
    );
    assert.deepEqual(
      await getReadiness({
        JOMCALL_MODEL_PROVIDER: "openrouter",
        JOMCALL_HOSTED_MODEL: "not a model",
      }),
      {
        configured: true,
        available: false,
        modelDigest: null,
        reason: "HOSTED_MODEL_REQUIRED",
      },
    );
    assert.deepEqual(await getReadiness({}), {
      configured: false,
      available: false,
      modelDigest: null,
      reason: "MODEL_DISABLED",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("only the worker needs the key: a hosted client without one fails closed", async () => {
  const config = await configuredProvider({
    JOMCALL_MODEL_PROVIDER: "openrouter",
  });
  await assert.rejects(createModelClient(config!, {}), /HOSTED_MODEL_REQUIRED/);
  const client = await createModelClient(config!, {
    OPENROUTER_API_KEY: "test-key",
  });
  assert.equal(typeof client.generate, "function");
});

test("agent voice provider: empty means disabled, hosted needs the model key", () => {
  assert.equal(agentVoiceProvider({}), "disabled");
  assert.equal(agentVoiceProvider({ JOMCALL_VOICE_PROVIDER: "" }), "disabled");
  assert.equal(
    agentVoiceProvider({ JOMCALL_VOICE_PROVIDER: "disabled" }),
    "disabled",
  );
  assert.equal(
    agentVoiceProvider({
      JOMCALL_VOICE_PROVIDER: "hosted",
      ANTHROPIC_API_KEY: "not-a-real-key",
    }),
    "hosted",
  );
  assert.throws(
    () => agentVoiceProvider({ JOMCALL_VOICE_PROVIDER: "local" }),
    /^Error: VOICE_PROVIDER_INVALID$/,
  );
  for (const key of [undefined, "", "   "])
    assert.throws(
      () =>
        agentVoiceProvider({
          JOMCALL_VOICE_PROVIDER: "hosted",
          ANTHROPIC_API_KEY: key,
        }),
      /^Error: VOICE_MODEL_KEY_MISSING$/,
    );
});
