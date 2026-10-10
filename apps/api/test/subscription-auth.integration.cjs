const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { prisma } = require("@eureka-atlas/database");
const { CredentialCryptoService } = require("../dist/datasource/credential-crypto.service");
const { OAuthCredentialStore } = require("../dist/model-config/oauth-credential-store");
const { SubscriptionModelsStore } = require("../dist/model-config/subscription-models-store");

(async () => {
  const { createModels } = await import("@earendil-works/pi-ai");
  const crypto = new CredentialCryptoService();
  const builtinId = "__subscription_fixture_" + randomUUID();
  const rows = [];
  try {
    const oauth = await prisma.modelProvider.create({ data: { name: builtinId + "_oauth", kind: "BUILTIN", builtinId, authMode: "OAUTH", protocol: "openai-completions" } });
    rows.push(oauth.id);
    const apiKey = await prisma.modelProvider.create({ data: { name: builtinId + "_api", kind: "BUILTIN", builtinId, authMode: "API_KEY", protocol: "openai-completions" } });
    rows.push(apiKey.id);
    await assert.rejects(prisma.modelProvider.create({ data: { name: builtinId + "_duplicate", kind: "BUILTIN", builtinId, authMode: "OAUTH", protocol: "openai-completions" } }), (error) => error.code === "P2002");
    const store = new OAuthCredentialStore(oauth.id, builtinId, crypto);
    await store.modify(builtinId, async () => ({ type: "oauth", access: "fixture-expired", refresh: "fixture-refresh", expires: 0 }));
    assert.ok(!(await prisma.modelProvider.findUnique({ where: { id: oauth.id } })).oauthEncrypted.includes("fixture-refresh"));
    const runtime = createModels({ credentials: store, authContext: { env: async () => undefined, fileExists: async () => false } });
    let refreshes = 0;
    runtime.setProvider({ id: builtinId, name: "Fixture", getModels: () => [], auth: { oauth: {
      name: "Fixture", login: async () => { throw new Error("Not used"); },
      refresh: async () => { refreshes++; await new Promise((resolve) => setTimeout(resolve, 30)); return { type: "oauth", access: "fixture-new", refresh: "fixture-rotated", expires: Date.now() + 3600000 }; },
      toAuth: async (credential) => ({ apiKey: credential.access }),
    } }, stream: () => { throw new Error("Not used"); }, streamSimple: () => { throw new Error("Not used"); } });
    const results = await Promise.all(Array.from({ length: 4 }, () => runtime.getAuth(builtinId)));
    assert.equal(refreshes, 1);
    assert.ok(results.every((result) => result.auth.apiKey === "fixture-new"));
    const abort = new AbortController();
    await assert.rejects(store.modify(builtinId, async () => { abort.abort(); return { type: "oauth", access: "not-committed", refresh: "invalid", expires: 0 }; }, { signal: abort.signal }), /abort/i);
    assert.equal((await store.read(builtinId)).access, "fixture-new");
    const catalog = new SubscriptionModelsStore(oauth.id, builtinId, crypto);
    const entry = { models: [], checkedAt: Date.now() };
    await catalog.write(builtinId, entry);
    assert.deepEqual(await new SubscriptionModelsStore(oauth.id, builtinId, crypto).read(builtinId), entry);
    await catalog.delete(builtinId);
    await store.delete(builtinId);
    assert.equal(await store.read(builtinId), undefined);
    console.log("PASS: database OAuth/API-key coexistence, encrypted credentials, concurrent Pi refresh, cancellation rollback, catalog persistence and logout");
  } finally {
    for (const id of rows) {
      await prisma.systemSetting.deleteMany({ where: { key: "subscription_model_catalog:" + id } });
      await prisma.modelProvider.delete({ where: { id } });
    }
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error.name + ": " + error.message); process.exitCode = 1; });
