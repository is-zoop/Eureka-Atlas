const assert = require("node:assert/strict");
const test = require("node:test");
const { SemanticScopeService } = require("../dist/semantic/semantic-scope.service");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { prisma } = require("@eureka-atlas/database");

const scopeService = (ids) => new SemanticScopeService(
  { list: async () => ({ items: ids.map((id) => ({ id })) }) },
  { get: async (id) => ({ table: { id }, content_version: `version-${id}` }) },
);

test("empty table selection resolves all queryable tables", async () => {
  const scope = await scopeService(["a", "b"]).resolve([]);
  assert.deepEqual(scope.tableIds, ["a", "b"]);
  assert.deepEqual([...scope.packages.keys()], ["a", "b"]);
});

test("explicit selection remains restricted and deduplicated", async () => {
  const scope = await scopeService(["a", "b"]).resolve(["b", "b"]);
  assert.deepEqual(scope.tableIds, ["b"]);
  assert.deepEqual([...scope.packages.keys()], ["b"]);
});

test("invalid selected tables cannot expand the scope to all tables", async () => {
  await assert.rejects(scopeService(["a"]).resolve(["deleted"]), /已选择表不可查询或已失效/);
});

test("no available queryable tables returns a clear error", async () => {
  await assert.rejects(scopeService([]).resolve([]), /暂无可查询表/);
});

test("run creation snapshots resolved table IDs without replacing the session selection", async () => {
  const undo = [];
  const override = (object, key, value) => {
    const old = object[key]; object[key] = value; undo.push(() => { object[key] = old; });
  };
  const session = { ownerMemberNo: "test-member", id: "session", title: "existing", tableIds: [], createdAt: new Date(), updatedAt: new Date(), configurationVersion: 1, modelConfigId: "model", thinkingLevel: "off" };
  let created;
  try {
    override(prisma.askRun, "findUnique", async () => null);
    override(prisma.askSession, "findUnique", async () => session);
    override(prisma, "$transaction", async (callback) => callback({
      askSession: { findUnique: async () => session },
      askRun: { findFirst: async () => null, create: async ({ data }) => { created = { ...data, id: "run", loopVersion: 0 }; return created; } },
    }));
    override(prisma.askRun, "update", async ({ data }) => Object.assign(created, data));
    const service = new AskRunService(scopeService(["a", "b"]), {
      agentRuntime: async () => ({ thinkingLevels: ["off"], displayName: "model", providerName: "provider" }),
    }, {}, { publish: async () => {} });
    service.run = async () => {};
    service.detail = async () => created;
    await service.create("test-member", "session", { question: "销售额", idempotency_key: "key", expected_configuration_version: 1 });
    assert.deepEqual(created.tableIds, ["a", "b"]);
    assert.deepEqual(created.packageVersions, { a: "version-a", b: "version-b" });
    assert.deepEqual(session.tableIds, []);
  } finally { undo.reverse().forEach((restore) => restore()); }
});
