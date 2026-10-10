const assert = require("node:assert/strict");
const test = require("node:test");
const { prisma } = require("@eureka-atlas/database");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { ModelConfigService } = require("../dist/model-config/model-config.service");

async function runtimeFor(value) {
  const models = new ModelConfigService({ decrypt: () => "test-key" }, {}, {});
  models.model = async () => ({
    id: "new-model", modelId: "new-model", reasoning: value.reasoning, maxTokens: 100,
    provider: { name: "test", authMode: "API_KEY", apiKeyEncrypted: "test", headers: {} },
  });
  models.runtimeModel = async () => ({ runtime: {}, value });
  return models.agentRuntime("new-model");
}

const deepseekLevels = { reasoning: true, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", xhigh: "max", max: null } };
const requiredThinking = { reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: null, high: "high" } };

async function withSession(runtime, sessionChanges, callback) {
  const previousFind = prisma.askSession.findUnique;
  const previousUpdate = prisma.askSession.update;
  const session = { ownerMemberNo: "test-member",
    id: "session", title: "对话", tableIds: [], modelConfigId: "old-model", thinkingLevel: "medium",
    configurationVersion: 1, createdAt: new Date(), updatedAt: new Date(), runs: [],
    ...sessionChanges,
  };
  const writes = [];
  try {
    prisma.askSession.findUnique = async () => session;
    prisma.askSession.update = async ({ data }) => {
      writes.push(data);
      return { ...session, ...data, configurationVersion: session.configurationVersion + 1 };
    };
    const service = new AskRunService({}, { agentRuntime: async () => runtime }, {}, {});
    await callback(service, writes);
  } finally {
    prisma.askSession.findUnique = previousFind;
    prisma.askSession.update = previousUpdate;
  }
}

test("switching to DeepSeek resets unsupported medium to its resolved default in one update", async () => {
  const runtime = await runtimeFor(deepseekLevels);
  assert.equal(runtime.defaultThinkingLevel, "off");
  await withSession(runtime, {}, async (service, writes) => {
    const result = await service.updateSession("test-member", "session", { model_id: "new-model", expected_configuration_version: 1 });
    assert.equal(result.model_id, "new-model");
    assert.equal(result.thinking_level, "off");
    assert.equal(result.configuration_version, 2);
    assert.equal(writes.length, 1);
  });
});

test("switching retains a thinking level supported by the new model", async () => {
  const runtime = await runtimeFor(deepseekLevels);
  await withSession(runtime, { thinkingLevel: "high" }, async (service) => {
    const result = await service.updateSession("test-member", "session", { model_id: "new-model", expected_configuration_version: 1 });
    assert.equal(result.thinking_level, "high");
  });
});

test("switching to a model without reasoning selects off", async () => {
  const runtime = await runtimeFor({ reasoning: false });
  await withSession(runtime, { thinkingLevel: "high" }, async (service) => {
    const result = await service.updateSession("test-member", "session", { model_id: "new-model", expected_configuration_version: 1 });
    assert.equal(result.thinking_level, "off");
  });
});

test("model default is adjusted when off is unsupported, including new sessions", async () => {
  const runtime = await runtimeFor(requiredThinking);
  assert.equal(runtime.defaultThinkingLevel, "medium");
  await withSession(runtime, { thinkingLevel: "off" }, async (service) => {
    const result = await service.updateSession("test-member", "session", { model_id: "new-model", expected_configuration_version: 1 });
    assert.equal(result.thinking_level, "medium");
  });
  const previousCreate = prisma.askSession.create;
  try {
    prisma.askSession.create = async ({ data }) => ({ ...data, id: "new", configurationVersion: 1, createdAt: new Date(), updatedAt: new Date() });
    const service = new AskRunService({}, { agentRuntime: async () => runtime }, {}, {});
    assert.equal((await service.createSession("test-member", { model_id: "new-model" })).thinking_level, "medium");
  } finally {
    prisma.askSession.create = previousCreate;
  }
});

test("explicit unsupported thinking and unchanged-model invalid settings still reject without writes", async () => {
  const runtime = await runtimeFor(deepseekLevels);
  await withSession(runtime, {}, async (service, writes) => {
    await assert.rejects(service.updateSession("test-member", "session", { model_id: "new-model", thinking_level: "medium", expected_configuration_version: 1 }), /当前模型不支持/);
    assert.equal(writes.length, 0);
  });
  await withSession(runtime, { modelConfigId: "new-model" }, async (service, writes) => {
    await assert.rejects(service.updateSession("test-member", "session", { title: "新标题", expected_configuration_version: 1 }), /当前模型不支持/);
    assert.equal(writes.length, 0);
  });
});

test("switching respects configuration conflicts and running-session lock", async () => {
  const runtime = await runtimeFor(deepseekLevels);
  await withSession(runtime, {}, async (service, writes) => {
    await assert.rejects(service.updateSession("test-member", "session", { model_id: "new-model", expected_configuration_version: 0 }), /配置已被更新/);
    assert.equal(writes.length, 0);
  });
  await withSession(runtime, { runs: [{ id: "run" }] }, async (service, writes) => {
    await assert.rejects(service.updateSession("test-member", "session", { model_id: "new-model", expected_configuration_version: 1 }), /当前问题尚未结束/);
    assert.equal(writes.length, 0);
  });
});
