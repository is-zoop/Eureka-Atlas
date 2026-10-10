const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { PiCatalogService } = require("../dist/model-config/pi-catalog.service");
const { parsePiCatalog, mergePiModels, piCatalogOverlay } = require("../dist/model-config/pi-model-catalog");

const model = { id: "new-official-model", name: "New Official Model", api: "openai-completions", baseUrl: "https://api.deepseek.com", provider: "deepseek", reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 100000, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } };
const modified = "Thu, 01 Jan 2099 00:00:00 GMT";
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settled(service) { for (let i = 0; i < 300; i++) { if (!service.active) return; await tick(); } throw new Error("Refresh did not settle"); }
function fixture() {
  const data = new Map();
  const undo = [];
  const replace = (object, key, value) => { const old = object[key]; object[key] = value; undo.push(() => object[key] = old); };
  const originalOffline = process.env.PI_OFFLINE;
  delete process.env.PI_OFFLINE;
  replace(prisma.systemSetting, "findMany", async ({ where }) => [...data].filter(([key]) => where.key.in.includes(key)).map(([key, value]) => ({ key, value })));
  replace(prisma.systemSetting, "findUnique", async ({ where }) => data.has(where.key) ? { key: where.key, value: data.get(where.key) } : null);
  replace(prisma.systemSetting, "upsert", async ({ where, create, update }) => { const value = data.has(where.key) ? update.value : create.value; data.set(where.key, value); return { key: where.key, value }; });
  replace(prisma.modelProvider, "findMany", async () => [{ builtinId: "deepseek" }, { builtinId: "deepseek" }]);
  const service = new PiCatalogService();
  let requests = 0;
  replace(global, "fetch", async (url, options) => {
    requests++;
    assert.equal(url, "https://pi.dev/api/models/providers/deepseek");
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify([model]), { headers: { "last-modified": modified, etag: '"catalog-1"' } });
  });
  return { data, service, replace, requests: () => requests, close() { service.onModuleDestroy(); undo.reverse().forEach((fn) => fn()); if (originalOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = originalOffline; } };
}
test("official catalog defaults off; enable persists, refresh deduplicates, and metadata reaches real Pi runtime", async () => {
  const f = fixture();
  try {
    assert.equal((await f.service.status()).enabled, false);
    await f.service.refresh(true);
    assert.equal(f.requests(), 0);
    await f.service.update({ enabled: true });
    await settled(f.service);
    assert.equal(f.requests(), 1); // Two auth modes for the same provider share one catalog.
    const status = await f.service.status();
    assert.ok(status.lastSuccessAt);
    assert.equal(status.error, false);
    assert.equal((await new PiCatalogService().status()).enabled, true);
    const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
    const runtime = builtinModels();
    const originalProvider = runtime.getProvider("deepseek");
    const originalAuth = originalProvider.auth;
    const baselineCount = runtime.getModels("deepseek").length;
    await f.service.apply(runtime);
    assert.equal(runtime.getModel("deepseek", model.id).name, model.name);
    assert.equal(runtime.getModels("deepseek").length, baselineCount + 1);
    assert.equal(runtime.getProvider("deepseek"), originalProvider);
    assert.equal(originalProvider.auth, originalAuth);
    await f.service.apply(runtime);
    assert.equal(runtime.getModels("deepseek").length, baselineCount + 1);
    await f.service.refresh(false);
    assert.equal(f.requests(), 1); // Four-hour revalidation window.
    let release;
    f.replace(global, "fetch", async () => new Promise((resolve) => { release = () => resolve(new Response(null, { status: 304 })); }));
    const first = f.service.refresh(true);
    const second = f.service.refresh(true);
    await tick(); await tick();
    assert.ok(release);
    release();
    await Promise.all([first, second]);
    assert.equal((await f.service.status()).error, false);
    await assert.rejects(f.service.update({ enabled: "true" }), /布尔值/);
  } finally { f.close(); }
});
test("ETag revalidation keeps cached models, and failed or malformed responses never replace valid data", async () => {
  const f = fixture();
  try {
    await f.service.update({ enabled: true }); await settled(f.service);
    const saved = f.data.get("pi_model_catalog:deepseek");
    f.replace(global, "fetch", async (_, options) => { assert.equal(options.headers["if-none-match"], '"catalog-1"'); return new Response(null, { status: 304 }); });
    await f.service.refresh(true);
    assert.deepEqual(JSON.parse(f.data.get("pi_model_catalog:deepseek")).models, [model]);
    const successAt = (await f.service.status()).lastSuccessAt;
    f.replace(global, "fetch", async () => new Response("unavailable", { status: 503 }));
    await f.service.refresh(true);
    assert.equal((await f.service.status()).lastSuccessAt, successAt);
    assert.equal((await f.service.status()).error, true);
    assert.deepEqual(JSON.parse(f.data.get("pi_model_catalog:deepseek")).models, JSON.parse(saved).models);
    f.replace(global, "fetch", async () => new Response(JSON.stringify([{ id: "broken" }]), { headers: { "last-modified": modified } }));
    await f.service.refresh(true);
    assert.deepEqual(JSON.parse(f.data.get("pi_model_catalog:deepseek")).models, [model]);
    await f.service.update({ enabled: false });
    assert.equal((await f.service.status()).error, false);
  } finally { f.close(); }
});
test("turning off cancels requests without restoring enabled state; offline mode does not contact network", async () => {
  const f = fixture();
  try {
    f.data.set("pi_catalog_enabled", "true");
    process.env.PI_OFFLINE = "1";
    await f.service.refresh(true);
    assert.equal(f.requests(), 0);
    assert.equal((await f.service.status()).offline, true);
    delete process.env.PI_OFFLINE;
    let fetching = false;
    f.replace(global, "fetch", async (_, { signal }) => {
      fetching = true;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const pending = f.service.refresh(true);
    while (!fetching) await tick();
    await f.service.update({ enabled: false });
    await pending;
    assert.equal((await f.service.status()).enabled, false);
    assert.equal((await f.service.status()).error, false);
    assert.equal(f.data.has("pi_model_catalog:deepseek"), false);
  } finally { f.close(); }
});
test("overlay retains SDK-only models and ignores older official catalogs and unsupported API implementations", () => {
  const baseline = { ...model, id: "sdk-only" };
  assert.deepEqual(mergePiModels([baseline], [model]), [baseline, model]);
  assert.equal(mergePiModels([model], [{ ...model, name: "updated" }])[0].name, "updated");
  assert.deepEqual(piCatalogOverlay({ models: [model], lastModified: 1 }, 2), []);
  assert.deepEqual(piCatalogOverlay({ models: [model], lastModified: 3 }, 2), [model]);
  assert.deepEqual(parsePiCatalog("deepseek", [{ ...model, provider: "forged" }], new Set(["openai-completions"])), [model]);
  assert.deepEqual(parsePiCatalog("deepseek", [model], new Set(["anthropic-messages"])), []);
  assert.throws(() => parsePiCatalog("deepseek", [{ ...model, maxTokens: -1 }], new Set(["openai-completions"])), /Invalid Pi model/);
});
