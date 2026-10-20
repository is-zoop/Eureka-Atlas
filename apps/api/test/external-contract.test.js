const test = require("node:test"), assert = require("node:assert/strict");
const { createExternalFixture, queryBody, nativeFetch } = require("./helpers/external-fixture");

test("external HTTP inputs and outputs use validated contracts and traced envelopes", async () => {
  const f = await createExternalFixture();
  try {
    const search = await f.request("/semantic/search", { method: "POST", body: { keywords: ["销售额"], page_size: 1 } });
    assert.equal(search.response.status, 200); assert.equal(search.body.data.total, 1); assert.ok(await f.contracts.checkResponse("search", search.body.data));
    assert.equal(search.body.request_id, search.response.headers.get("x-request-id")); assert.equal(search.response.headers.get("cache-control"), "no-store");
    const pkg = await f.request("/semantic/packages/table"); assert.equal(pkg.response.status, 200); assert.ok(await f.contracts.checkResponse("package", pkg.body.data));
    const submit = await f.request("/queries", { method: "POST", body: queryBody() });
    assert.equal(submit.response.status, 202); assert.equal(submit.body.data.status, "RUNNING"); assert.ok(await f.contracts.checkResponse("query", submit.body.data));
    const pending = await f.request(`/queries/${submit.body.data.id}/result`); assert.equal(pending.response.status, 409); assert.equal(pending.body.error.code, "QUERY_NOT_SUCCEEDED");
    f.state.remoteStatus = "SUCCEEDED";
    const result = await f.request(`/queries/${submit.body.data.id}/result`); assert.equal(result.response.status, 200); assert.ok(await f.contracts.checkResponse("result", result.body.data));
    assert.equal(result.body.data.result.rows.length, 150); assert.equal(result.body.data.result.rows[0][1], "12345678901234567890.12");
    assert.equal(result.body.data.result.truncated, false);
  } finally { await f.close(); }
});

test("invalid IDs, extra identity/SQL fields, filters and calendar dates fail before submission", async () => {
  const f = await createExternalFixture();
  try {
    const { content_version: _, ...withoutVersion } = queryBody();
    const invalid = [withoutVersion, { ...queryBody(), owner_member_no: "B" }, { ...queryBody(), sql: "SELECT * FROM secret" }, { ...queryBody(), metric_ids: [] }, { ...queryBody(), limit: 5001 }, { ...queryBody(), filters: [{ field_id: "shop", operator: "LIKE", values: ["a"] }] }, { ...queryBody(), filters: [{ field_id: "shop", operator: "EQ", values: ["a", "b"] }] }, { ...queryBody(), date_range: { start: "2026-02-30", end: "2026-03-01" } }, { ...queryBody(), date_range: { start: "20261016", end: "20261001" } }, { ...queryBody(), date_range: undefined }];
    for (const body of invalid) {
      const res = await f.request("/queries", { method: "POST", body }); assert.equal(res.response.status, 400); assert.equal(res.body.error.code, "INVALID_REQUEST"); assert.ok(res.body.request_id);
    }
    assert.equal(f.submissions(), 0);
    assert.equal((await f.request("/semantic/packages/table?owner=A")).response.status, 400);
    assert.equal((await f.request("/queries?owner_member_no=B", { method: "POST", body: queryBody() })).response.status, 400);
    assert.equal((await f.request("/semantic/packages/bad%20id")).response.status, 400);
    const unknown = await f.request("/missing"); assert.equal(unknown.response.status, 404); assert.equal(unknown.body.error.code, "NOT_FOUND");
    const malformed = await nativeFetch(f.base + "/api/external/v1/queries", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer haze_A_key" }, body: '{"sql":"haze_A_key"' });
    assert.equal(malformed.status, 400); assert.equal(JSON.stringify(await malformed.json()).includes("haze_A_key"), false);
  } finally { await f.close(); }
});

test("omitted limits use documented defaults and equivalent explicit defaults replay the same task", async () => {
  const f = await createExternalFixture();
  try {
    const { limit, ...input } = queryBody();
    const first = await f.request("/queries", { method: "POST", body: input });
    const replay = await f.request("/queries", { method: "POST", body: { ...input, limit: 100 } });
    assert.equal(replay.body.data.id, first.body.data.id); assert.equal(f.submissions(), 1);
    f.state.remoteStatus = "SUCCEEDED";
    const result = await f.request(`/queries/${first.body.data.id}/result`);
    assert.equal(result.body.data.result.rows.length, 100); assert.equal(result.body.data.result.truncated, true);
    const candidate = await f.request("/queries/dimension-values", { method: "POST", body: { table_id: "table", field_id: "shop", idempotency_key: "values", content_version: "v1", date_range: input.date_range } });
    const values = await f.request(`/queries/${candidate.body.data.id}/result`);
    assert.equal(values.body.data.result.rows.length, 50); assert.equal(values.body.data.result.truncated, true);
  } finally { await f.close(); }
});

test("external version, publication and error contracts prevent stale or unpublished execution", async () => {
  const f = await createExternalFixture();
  try {
    f.pkg.content_version = "v2";
    const stale = await f.request("/queries", { method: "POST", body: queryBody() }); assert.equal(stale.response.status, 409); assert.equal(stale.body.error.code, "SEMANTIC_VERSION_CHANGED");
    f.state.published = false;
    assert.equal((await f.request("/semantic/packages/table")).response.status, 404);
    assert.equal((await f.request("/semantic/search", { method: "POST", body: { keywords: ["销售额"] } })).body.data.total, 0);
    assert.equal((await f.request("/queries", { method: "POST", body: { ...queryBody(), content_version: "v2" } })).response.status, 404);
    assert.equal(f.submissions(), 0);
    f.state.published = true; f.state.remoteError = true;
    const failed = await f.request("/queries", { method: "POST", body: { ...queryBody(), content_version: "v2" } });
    assert.equal(failed.body.data.status, "FAILED"); assert.equal(JSON.stringify(failed.body).includes("secret_access_key"), false);
    f.state.hazeOutage = true;
    const outage = await f.request("/semantic/packages/table"); assert.equal(outage.response.status, 503); assert.equal(outage.response.headers.get("set-cookie"), null); assert.equal(JSON.stringify(outage.body).includes("haze_A_key"), false);
  } finally { await f.close(); }
});
