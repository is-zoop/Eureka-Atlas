const test = require("node:test"), assert = require("node:assert/strict");
const { ApiCenterService } = require("../dist/api-center/api-center.service"), { ExternalContractService } = require("../dist/external-api/external-contract.service");
const { createExternalFixture, nativeFetch } = require("./helpers/external-fixture");

test("API catalog paths come from real handlers; every published example satisfies its runtime contract", async () => {
  const contracts = new ExternalContractService(), service = new ApiCenterService(contracts);
  const catalog = await service.catalog();
  assert.equal(catalog.operations.length, 7); assert.equal(catalog.base_path, "/api/external/v1");
  assert.equal(catalog.limits.concurrent_queries_per_user, 3); assert.equal(catalog.limits.requests_per_minute, 60);
  for (const op of catalog.operations) {
    assert.ok(op.path.startsWith(catalog.base_path + "/"));
    await contracts.validate(op.id, op.request_example, op.params_example);
    assert.ok(await contracts.checkResponse(op.id, op.response_example), op.id + " response example");
    assert.equal(op.success_status, ["query", "dimensionValues"].includes(op.id) ? 202 : 200);
  }
  const document = await service.openapi();
  assert.deepEqual(document.servers,[{url:'/'}]);
  assert.equal(new URL(document.servers[0].url,'https://atlas.paiwo188.com/api/api-center/openapi').origin,'https://atlas.paiwo188.com');
  assert.equal(document.openapi, "3.1.0"); assert.equal(Object.keys(document.paths).length, 7);
  for (const op of catalog.operations) {
    const method = document.paths[op.path.replace(/:([A-Za-z]+)/g, "{$1}")][op.method.toLowerCase()];
    assert.equal(method.operationId, op.id); assert.deepEqual(method.security, [{ HazePersonalCredential: [] }]);
    assert.deepEqual(method.responses[op.success_status].content["application/json"].schema.properties.data, op.response_schema);
    if (op.method === "POST") assert.deepEqual(method.requestBody.content["application/json"].schema, op.request_schema);
  }
});

test("every displayed request/path parameter has actionable documentation shared with OpenAPI", async () => {
  const contracts = new ExternalContractService(), service = new ApiCenterService(contracts);
  const catalog = await service.catalog(), document = await service.openapi();
  for (const operation of catalog.operations) {
    for (const [name, field] of Object.entries({ ...operation.request_schema.properties, ...operation.params_schema.properties })) {
      assert.equal(typeof field.description, "string", `${operation.id}.${name}`);
      assert.ok(field.description.trim().length >= 20, `${operation.id}.${name} must explain what to fill`);
      assert.equal(field.description.includes("详见下方完整 Schema"), false);
    }
    const published = document.paths[operation.path.replace(/:([A-Za-z]+)/g, "{$1}")][operation.method.toLowerCase()];
    if (operation.method === "POST") assert.deepEqual(published.requestBody.content["application/json"].schema, operation.request_schema);
    for (const parameter of published.parameters) assert.deepEqual(parameter.schema, operation.params_schema.properties[parameter.name]);
  }
  const search = catalog.operations.find(operation => operation.id === "search").request_schema;
  assert.deepEqual(search.required, ["keywords"]);
  assert.ok(search.properties.keywords.description.includes("可传 []"));
  assert.ok(search.properties.metrics.description.includes("指标中心"));
  assert.ok(search.properties.metrics.description.includes("目录 ID"));
  assert.ok(search.properties.dimensions.description.includes("真实字段取值"));
  assert.ok(search.properties.data_domain.description.includes("Package.table.data_domain"));
  assert.equal(search.properties.page.default, 1); assert.equal(search.properties.page.minimum, 1); assert.equal(search.properties.page.maximum, 100000);
  assert.equal(search.properties.page_size.default, 20); assert.equal(search.properties.page_size.maximum, 100);
  for (const name of ["keywords", "metrics", "dimensions"]) {
    assert.equal(search.properties[name].maxItems, 100); assert.equal(search.properties[name].items.minLength, 1); assert.equal(search.properties[name].items.maxLength, 256);
  }
});

test("search examples demonstrate Chinese metric/dimension names and explain partial results without pretending to search data values", async () => {
  const service = new ApiCenterService(new ExternalContractService());
  const operation = (await service.catalog()).operations.find(operation => operation.id === "search");
  assert.deepEqual(operation.request_example, { keywords: [], metrics: ["销售额"], dimensions: ["店铺"], page: 1, page_size: 20 });
  const notes = operation.notes.join("\n");
  for (const term of ["不是严格的 AND", "FULL", "PARTIAL", "UNSPECIFIED", "MATCHED", "TENTATIVE", "AMBIGUOUS", "MISSING", "实际取值", "候选值接口"]) assert.ok(notes.includes(term), term);
  const response = operation.response_example;
  assert.equal(response.total, 1); assert.equal(response.items[0].coverage.status, "FULL");
  assert.equal(response.items[0].coverage.metrics[0].matches[0].asset_id, "example-amount");
  assert.equal(response.items[0].coverage.dimensions[0].matches[0].asset_id, "example-shop");
  assert.deepEqual(response.items[0].match_reasons, []);
});

test("catalog and dedicated OpenAPI documents require admin web authentication and never include a real key", async () => {
  const f = await createExternalFixture();
  try {
    for (const suffix of ["", "/openapi"]) {
      assert.equal((await nativeFetch(f.base + "/api/api-center" + suffix, { headers: { Authorization: "Bearer haze_A_key" } })).status, 401);
      const response = await nativeFetch(f.base + "/api/api-center" + suffix, { headers: { Cookie: f.cookie } });
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      const text = await response.text(); assert.equal(text.includes("haze_A_key"), false); assert.equal(text.includes("web-session"), false);
    }
    const api = await f.request("/semantic/search", { method: "POST", body: { keywords: ["销售额"] } }); assert.equal(api.response.status, 200);
  } finally { await f.close(); }
});
