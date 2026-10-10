const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { CredentialCryptoService } = require("../dist/datasource/credential-crypto.service");
const { OAuthCredentialStore } = require("../dist/model-config/oauth-credential-store");
const { SubscriptionModelsStore } = require("../dist/model-config/subscription-models-store");
const { SubscriptionAuthService } = require("../dist/model-config/subscription-auth.service");
const { ModelConfigService } = require("../dist/model-config/model-config.service");

const crypto = new CredentialCryptoService();
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(fn) { for (let i = 0; i < 300; i++) { if (fn()) return; await tick(); } throw new Error("Login did not finish"); }
function mockDb(row) {
  const undo = [];
  const replace = (object, key, value) => { const previous = object[key]; object[key] = value; undo.push(() => object[key] = previous); };
  const env = process.env.DATA_SOURCE_ENCRYPTION_KEY;
  process.env.DATA_SOURCE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const settings = new Map();
  let queue = Promise.resolve();
  let locks = 0;
  replace(prisma.modelProvider, "findUnique", async () => row);
  replace(prisma.modelProvider, "findUniqueOrThrow", async () => row);
  replace(prisma.modelProvider, "update", async ({ data }) => { Object.assign(row, data); return row; });
  replace(prisma.$transaction ? prisma : {}, "$transaction", (fn) => {
    const next = queue.then(() => fn({
      $queryRaw: async (strings, id) => { assert.equal(id, row.id); assert.match(strings.join(""), /FOR UPDATE/); locks++; },
      modelProvider: prisma.modelProvider,
    }));
    queue = next.catch(() => {});
    return next;
  });
  replace(prisma.systemSetting, "findUnique", async ({ where }) => settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null);
  replace(prisma.systemSetting, "upsert", async ({ where, create, update }) => { const value = settings.has(where.key) ? update.value : create.value; settings.set(where.key, value); return { key: where.key, value }; });
  replace(prisma.systemSetting, "deleteMany", async ({ where }) => { settings.delete(where.key); return { count: 1 }; });
  return { replace, settings, locks: () => locks, restore() { undo.reverse().forEach((fn) => fn()); if (env === undefined) delete process.env.DATA_SOURCE_ENCRYPTION_KEY; else process.env.DATA_SOURCE_ENCRYPTION_KEY = env; } };
}
async function fixture(loginFlow, initial) {
  const pi = await import("@earendil-works/pi-ai");
  const row = { id: "atlas-provider", builtinId: "test-subscription", authMode: "OAUTH", oauthEncrypted: null, apiKeyEncrypted: null };
  const db = mockDb(row);
  const store = new OAuthCredentialStore(row.id, row.builtinId, crypto);
  if (initial) await store.modify(row.builtinId, async () => initial);
  const runtime = pi.createModels({ credentials: store, authContext: { env: async () => undefined, fileExists: async () => false } });
  const model = { id: "model", name: "Subscription Model", provider: row.builtinId, api: "openai-completions", baseUrl: "https://example.invalid/v1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 };
  let refreshes = 0;
  let dispatched;
  const stream = (effectiveModel, context, options) => {
    dispatched = { model: effectiveModel, context, options };
    const events = pi.createAssistantMessageEventStream();
    const message = { role: "assistant", content: [{ type: "text", text: "OK" }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
    queueMicrotask(() => { events.push({ type: "done", reason: "stop", message }); events.end(); });
    return events;
  };
  runtime.setProvider({ id: row.builtinId, name: "Subscription", getModels: () => [model],
    auth: { oauth: { name: "Subscription", login: loginFlow, refresh: async () => { refreshes++; await tick(); return { type: "oauth", access: "fresh-access", refresh: "fresh-refresh", expires: Date.now() + 3600000 }; }, toAuth: async (credential) => ({ apiKey: credential.access, headers: { "x-subscription": "yes" }, baseUrl: "https://account.invalid/v1" }) } },
    stream, streamSimple: stream });
  const service = new SubscriptionAuthService(crypto, { apply: async (runtime) => runtime });
  service.runtime = async () => ({ runtime, builtinId: row.builtinId });
  return { row, db, store, runtime, service, model, refreshes: () => refreshes, dispatched: () => dispatched, close() { service.onModuleDestroy(); db.restore(); } };
}

test("Pi catalog exposes all installed OAuth providers separately from API key support", async () => {
  const models = new ModelConfigService(crypto, {}, { apply: async (runtime) => runtime });
  const catalog = await models.builtinCatalog();
  const ids = catalog.filter((entry) => entry.oauthName).map((entry) => entry.id);
  assert.ok(ids.includes("openai-codex"));
  assert.ok(ids.includes("radius"));
  assert.ok(ids.includes("github-copilot"));
  assert.equal(catalog.find((entry) => entry.id === "anthropic").hasApiKey, true);
});

test("real Pi login supports device events, manual prompts, rejects duplicates and never exposes credentials", async () => {
  const f = await fixture(async (interaction) => {
    interaction.notify({ type: "device_code", userCode: "CODE-123", verificationUri: "https://example.invalid/device" });
    const answer = await interaction.prompt({ type: "manual_code", message: "Enter code" });
    assert.equal(answer, "accepted-code");
    return { type: "oauth", access: "secret-access", refresh: "secret-refresh", expires: Date.now() + 3600000 };
  });
  try {
    const started = await f.service.start(f.row.id);
    await until(() => f.service.status(f.row.id, started.id).prompt);
    await assert.rejects(f.service.start(f.row.id), /正在登录/);
    assert.throws(() => f.service.status("other-provider", started.id), /已结束/);
    assert.throws(() => f.service.answer(f.row.id, started.id, { promptId: "forged", value: "accepted-code" }), /步骤已结束/);
    const prompt = f.service.status(f.row.id, started.id).prompt;
    f.service.answer(f.row.id, started.id, { promptId: prompt.id, value: "accepted-code" });
    assert.throws(() => f.service.answer(f.row.id, started.id, { promptId: prompt.id, value: "accepted-code" }), /步骤已结束/);
    await until(() => f.service.status(f.row.id, started.id).status === "SUCCEEDED");
    const publicLogin = JSON.stringify(f.service.status(f.row.id, started.id));
    assert.ok(publicLogin.includes("CODE-123"));
    assert.ok(!publicLogin.includes("secret-access"));
    assert.ok(!f.row.oauthEncrypted.includes("secret-access"));
    assert.equal((await f.store.read(f.row.builtinId)).access, "secret-access");
    await f.service.logout(f.row.id);
    assert.equal(await f.store.read(f.row.builtinId), undefined);
  } finally { f.close(); }
});

test("cancelled or failed OAuth login does not persist tokens or leak provider error payloads", async () => {
  const f = await fixture(async (interaction) => {
    await interaction.prompt({ type: "secret", message: "Code" });
    throw new Error("raw-secret-token");
  });
  try {
    const cancelled = await f.service.start(f.row.id);
    await until(() => f.service.status(f.row.id, cancelled.id).prompt);
    f.service.cancel(f.row.id, cancelled.id);
    await until(() => f.service.status(f.row.id, cancelled.id).status === "CANCELLED");
    assert.equal(f.row.oauthEncrypted, null);
    const failed = await f.service.start(f.row.id);
    await until(() => f.service.status(f.row.id, failed.id).prompt);
    f.service.answer(f.row.id, failed.id, { promptId: f.service.status(f.row.id, failed.id).prompt.id, value: "value" });
    await until(() => f.service.status(f.row.id, failed.id).status === "FAILED");
    assert.ok(!JSON.stringify(f.service.status(f.row.id, failed.id)).includes("raw-secret"));
    assert.equal(f.row.oauthEncrypted, null);
  } finally { f.close(); }
});

test("concurrent real Pi auth resolution refreshes once under database lock; logout serializes with refresh", async () => {
  const f = await fixture(async () => { throw new Error("unused"); }, { type: "oauth", access: "expired", refresh: "rotating", expires: 0 });
  try {
    const auth = await Promise.all([f.runtime.getAuth(f.row.builtinId), f.runtime.getAuth(f.row.builtinId)]);
    assert.equal(f.refreshes(), 1);
    assert.equal(auth[0].auth.apiKey, "fresh-access");
    assert.ok(f.db.locks() >= 3);
    assert.equal((await f.store.read(f.row.builtinId)).refresh, "fresh-refresh");
    await assert.rejects(f.store.read("outside"), /mismatch/);
    await f.store.modify(f.row.builtinId, async () => ({ type: "oauth", access: "expired-again", refresh: "again", expires: 0 }));
    await Promise.all([f.runtime.getAuth(f.row.builtinId), f.store.delete(f.row.builtinId)]);
    assert.equal(await f.store.read(f.row.builtinId), undefined);
  } finally { f.close(); }
});

test("ask and governance use real Pi OAuth auth application including account base URL and headers", async () => {
  const f = await fixture(async () => { throw new Error("unused"); }, { type: "oauth", access: "account-token", refresh: "refresh", expires: Date.now() + 3600000 });
  try {
    const config = { id: "config", providerId: f.row.id, modelId: f.model.id, displayName: "My Model", provider: { ...f.row, kind: "BUILTIN", name: "My Subscription", headers: {}, compat: {} }, protocol: f.model.api, maxTokens: 1024, contextWindow: 128000, reasoning: false, headers: {}, compat: {}, cost: {}, lastTestStatus: "UNTESTED" };
    f.db.replace(prisma.modelConfig, "findUnique", async () => config);
    f.db.replace(prisma.modelConfig, "findMany", async () => [{ ...config, provider: { ...config.provider, ...f.row } }]);
    const models = new ModelConfigService(crypto, f.service, { apply: async (runtime) => runtime });
    const available = await models.available();
    assert.equal(available[0].id, config.id);
    const agent = await models.agentRuntime(config.id);
    assert.equal(agent.apiKey, undefined);
    await agent.runtime.completeSimple(agent.model, { messages: [] }, { apiKey: agent.apiKey });
    assert.equal(f.dispatched().options.apiKey, "account-token");
    assert.equal(f.dispatched().options.headers["x-subscription"], "yes");
    assert.equal(f.dispatched().model.baseUrl, "https://account.invalid/v1");
    assert.equal(await models.complete(config, "system", "user"), "OK");
    const publicProvider = models.publicProvider({ ...config.provider, models: [config], oauthEncrypted: "private", apiKeyEncrypted: null });
    assert.equal(publicProvider.hasSubscription, true);
    assert.ok(!Object.hasOwn(publicProvider, "oauthEncrypted"));
    assert.ok(!Object.hasOwn(publicProvider, "apiKeyEncrypted"));
    await f.service.logout(f.row.id);
    assert.equal((await models.available()).length, 0); // mock config needs current database snapshot
  } finally { f.close(); }
});

test("provider-owned model catalog is encrypted, restores across store instances, and clears on logout", async () => {
  const row = { id: "catalog-provider", builtinId: "radius", authMode: "OAUTH", oauthEncrypted: null };
  const db = mockDb(row);
  try {
    const store = new SubscriptionModelsStore(row.id, row.builtinId, crypto);
    const entry = { models: [{ id: "dynamic", provider: "radius", headers: { token: "private-catalog-header" } }], checkedAt: 123 };
    await store.write("radius", entry);
    assert.ok(![...db.settings.values()][0].includes("private-catalog-header"));
    assert.deepEqual(await new SubscriptionModelsStore(row.id, row.builtinId, crypto).read("radius"), entry);
    assert.equal(await store.read("other"), undefined);
    await assert.rejects(store.write("other", entry), /mismatch/);
    await store.delete("radius");
    assert.equal(await store.read("radius"), undefined);
  } finally { db.restore(); }
});

test("OAuth provider creation validates supported method and permits separate API key provider", async () => {
  const row = { id: "new", name: "Subscription", models: [] };
  const db = mockDb(row);
  try {
    db.replace(prisma.modelProvider, "create", async ({ data }) => ({ ...data, id: "new", models: [] }));
    const models = new ModelConfigService(crypto, {}, { apply: async (runtime) => runtime });
    await assert.rejects(models.createProvider({ name: "bad", kind: "CUSTOM", protocol: "openai-completions", authMode: "OAUTH", baseUrl: "https://example.invalid" }), /Invalid authentication/);
    await assert.rejects(models.createProvider({ name: "bad", kind: "BUILTIN", protocol: "openai-completions", authMode: "OAUTH", builtinId: "deepseek" }), /Unsupported OAuth/);
    const oauth = await models.createProvider({ name: "Anthropic Subscription", kind: "BUILTIN", protocol: "anthropic-messages", authMode: "OAUTH", builtinId: "anthropic", apiKey: "ignore-key" });
    const apiKey = await models.createProvider({ name: "Anthropic API", kind: "BUILTIN", protocol: "anthropic-messages", authMode: "API_KEY", builtinId: "anthropic", apiKey: "api-key" });
    assert.equal(oauth.authMode, "OAUTH"); assert.equal(oauth.hasApiKey, false);
    assert.equal(apiKey.authMode, "API_KEY"); assert.equal(apiKey.hasApiKey, true);
  } finally { db.restore(); }
});
