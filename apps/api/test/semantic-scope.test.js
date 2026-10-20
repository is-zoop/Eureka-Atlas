const test = require("node:test"), assert = require("node:assert/strict");
const { SemanticScopeService } = require("../dist/semantic/semantic-scope.service");
const pkg = { content_version: "v1", source: { id: "source", name: "数据源", type: "MAXCOMPUTE", project: "dw", catalog: "dw", schema: "" }, table: { id: "published", name: "sales", business_name: "订单", description: "订单数据", data_domain: "销售管理", grain: [] }, fields: [{ id: "amount", name: "GMV去内购", type: "METRIC", groupable: false, catalog: { id: "catalog", name: "GMV去内购", aliases: ["销售额"], description: "", usage_notes: null } }], metrics: [], completeness: { status: "COMPLETE", issues: [] } };
test("all entry points require a currently queryable table and a current Package version", async () => {
  let available = ["published"], version = "v1", reads = 0;
  const scope = new SemanticScopeService({ list: async () => ({ items: available.map(id => ({ id })) }) }, { get: async () => { reads++; return { ...pkg, content_version: version }; } });
  assert.equal((await scope.queryablePackage("published", "v1")).table.id, "published");
  const selection = await scope.resolve(["published"]);
  version = "v2";
  await assert.rejects(scope.queryablePackage("published", "v1"), e => e.getStatus() === 409 && e.getResponse().code === "SEMANTIC_VERSION_CHANGED");
  assert.equal((await scope.queryablePackage("published", "v2")).content_version, "v2");
  await assert.rejects(scope.queryablePackage("draft"), e => e.getStatus() === 404);
  await assert.rejects(scope.package(selection, "draft"), e => e.getStatus() === 404);
  available = []; const before = reads;
  await assert.rejects(scope.package(selection, "published"), e => e.getStatus() === 404);
  assert.equal(reads, before, "an unpublished table must not be read by direct ID");
});
test("search reuses aliases, only loads queryable packages and supports empty published scope", async () => {
  let ids = ["published"];
  const service = new SemanticScopeService({ list: async () => ({ items: ids.map(id => ({ id })) }) }, { get: async id => { assert.equal(id, "published"); return pkg; } });
  const result = await service.search({ keywords: [], metrics: ["销售额"], page_size: 1 });
  assert.equal(result.total, 1); assert.equal(result.items[0].table_id, "published");
  assert.equal(result.items[0].coverage.metrics[0].matches[0].basis, "EXACT_NAME_OR_ALIAS");
  assert.equal((await service.search({ keywords: ["销售额"], page: 2, page_size: 1 })).items.length, 0);
  ids = []; assert.equal((await service.search({ keywords: ["销售额"] })).total, 0);
  await assert.rejects(service.search({ keywords: [] }), e => e.getStatus() === 400);
});
