const test = require("node:test"), assert = require("node:assert/strict");
const { createExternalFixture, queryBody } = require("./helpers/external-fixture");

test("alias search, paging, publication and exact Package versions are enforced over HTTP", async () => {
  const f = await createExternalFixture();
  try {
    f.pkg.fields.find(field => field.id === "amount").catalog.aliases.push("GMV");
    const aliases = await f.request("/semantic/search", { method: "POST", body: { keywords: [], metrics: ["销售额"] } });
    assert.equal(aliases.body.data.total, 1); assert.equal(aliases.body.data.items[0].coverage.status, "FULL");
    assert.equal(aliases.body.data.items[0].coverage.metrics[0].matches[0].asset_id, "amount");
    const page = await f.request("/semantic/search", { method: "POST", body: { keywords: ["gmv"], page: 2, page_size: 1 } }); assert.equal(page.body.data.total, 1); assert.equal(page.body.data.items.length, 0);
    assert.equal((await f.request("/semantic/search", { method: "POST", body: { keywords: ["gmv"], data_domain: "其他域" } })).body.data.total, 0);
    const stale = await f.request("/queries", { method: "POST", body: { ...queryBody(), content_version: "old-version" } }); assert.equal(stale.response.status, 409); assert.equal(stale.body.error.code, "SEMANTIC_VERSION_CHANGED");
    assert.equal((await f.request("/semantic/packages/draft")).response.status, 404);
    f.state.published = false;
    assert.equal((await f.request("/semantic/search", { method: "POST", body: { keywords: ["销售额"] } })).body.data.total, 0);
    assert.equal((await f.request("/queries", { method: "POST", body: queryBody() })).response.status, 404); assert.equal(f.submissions(), 0);
  } finally { await f.close(); }
});

test("invalid metric, grouping, candidate and filter inputs cannot reach remote submission", async () => {
  const f = await createExternalFixture();
  try {
    const invalid = [{ ...queryBody(), metric_ids: ["shop"] }, { ...queryBody(), dimension_ids: ["amount"] }, { ...queryBody(), metric_ids: ["SELECT * FROM sales"] }, ...[{ operator: "BETWEEN", values: ["a"] }, { operator: "IN", values: [] }, { operator: "IS_NULL", values: ["a"] }, { operator: "EQ", values: [123] }].map(filter => ({ ...queryBody(), filters: [{ field_id: "shop", ...filter }] }))];
    for (const body of invalid) assert.equal((await f.request("/queries", { method: "POST", body })).response.status, 400);
    const candidate = { table_id: "table", field_id: "day", content_version: "v1", idempotency_key: "bad-values", date_range: queryBody().date_range };
    assert.equal((await f.request("/queries/dimension-values", { method: "POST", body: candidate })).response.status, 400);
    f.pkg.fields.find(field => field.id === "shop").normalized_type = "INTEGER";
    assert.equal((await f.request("/queries", { method: "POST", body: { ...queryBody(), filters: [{ field_id: "shop", operator: "CONTAINS", values: ["旗舰店"] }] } })).response.status, 400);
    assert.equal(f.submissions(), 0);
  } finally { await f.close(); }
});

test("native calendar dates are normalized while snapshot dates remain server-selected", async () => {
  const f = await createExternalFixture();
  try {
    const day = f.pkg.fields.find(field => field.id === "day"); day.normalized_type = "DATE"; day.data_type = "DATE"; f.pkg.table.query_config.default_stat_date.format = "yyyy-MM-dd";
    const compact = await f.request("/queries", { method: "POST", body: { ...queryBody("compact"), date_range: { start: "20261001", end: "20261015" } } });
    assert.equal(compact.response.status, 202); assert.match(compact.body.data.sql, /2026-10-01/); assert.match(compact.body.data.sql, /2026-10-15/);
    day.normalized_type = "STRING"; day.data_type = "STRING"; f.pkg.table.query_config.storage = "FULL_SNAPSHOT"; f.pkg.table.query_config.default_stat_date.format = "yyyyMMdd";
    assert.equal((await f.request("/queries", { method: "POST", body: queryBody("snapshot-wrong") })).response.status, 400);
    const { date_range, ...snapshot } = queryBody("snapshot");
    const latest = await f.request("/queries", { method: "POST", body: snapshot });
    assert.equal(latest.response.status, 202); assert.equal(latest.body.data.snapshot_date, "20261001"); assert.match(latest.body.data.sql, /day` = '20261001'/);
  } finally { await f.close(); }
});
