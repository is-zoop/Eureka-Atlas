const test = require("node:test"), assert = require("node:assert/strict");
const { createExternalFixture, queryBody } = require("./helpers/external-fixture");

test("HTTP lifecycle preserves task status, cancellation, timeout, expiry and rejects unowned or unrelated task kinds", async () => {
  const f = await createExternalFixture();
  try {
    const submitted = await f.request("/queries", { method: "POST", body: queryBody("cancel-me") }); const id = submitted.body.data.id;
    assert.equal(submitted.response.status, 202); assert.equal(submitted.body.data.status, "RUNNING");
    assert.equal((await f.request(`/queries/${id}/result`)).body.error.code, "QUERY_NOT_SUCCEEDED");
    assert.equal((await f.request(`/queries/${id}/cancel`, { method: "POST" })).body.data.status, "CANCELLING");
    assert.equal((await f.request(`/queries/${id}`)).body.data.status, "CANCELLED");
    f.state.remoteStatus = "RUNNING";
    const timed = await f.request("/queries", { method: "POST", body: queryBody("timeout-me") });
    f.rows.get(timed.body.data.id).submittedAt = new Date(Date.now() - 11 * 60 * 1000);
    assert.equal((await f.request(`/queries/${timed.body.data.id}`)).body.data.status, "TIMED_OUT");
    f.state.remoteStatus = "SUCCEEDED";
    const completed = await f.request("/queries", { method: "POST", body: queryBody("expire-me") }); const completedId = completed.body.data.id;
    assert.equal((await f.request(`/queries/${completedId}/result`)).response.status, 200);
    const row = f.rows.get(completedId); row.submittedAt = new Date(Date.now() - 25 * 3600000); row.expiresAt = new Date(row.submittedAt.getTime() + 86400000);
    const expired = await f.request(`/queries/${completedId}/result`); assert.equal(expired.response.status, 410); assert.equal(expired.body.error.code, "RESULT_EXPIRED");
    for (const [name, ownerMemberNo, kind] of [["legacy", null, "SEMANTIC_QUERY"], ["other-member", "B", "SEMANTIC_QUERY"], ["data-query", "A", "DATA_QUERY"]]) {
      f.rows.set(name, { ...row, id: name, ownerMemberNo, kind });
      for (const [path, method] of [[`/queries/${name}`, "GET"], [`/queries/${name}/result`, "GET"], [`/queries/${name}/cancel`, "POST"]]) assert.equal((await f.request(path, { method })).response.status, 404);
    }
  } finally { await f.close(); }
});

test("saved results preserve precision/nulls and explicitly flag row and byte limits", async () => {
  const f = await createExternalFixture();
  try {
    f.state.remoteStatus = "SUCCEEDED"; f.state.resultRows = 5001; f.state.returnNull = true;
    const first = await f.request("/queries", { method: "POST", body: { ...queryBody("rows"), limit: 5000 } });
    const rows = await f.request(`/queries/${first.body.data.id}/result`);
    assert.equal(rows.body.data.result.rows.length, 5000); assert.equal(rows.body.data.result.truncated, true);
    assert.equal(rows.body.data.result.rows[0][1], null); assert.equal(rows.body.data.result.rows[1][1], "12345678901234567890.12");
    f.state.resultRows = 150; f.state.largeValue = "说明".repeat(10000); f.state.returnNull = false;
    const second = await f.request("/queries", { method: "POST", body: queryBody("bytes") });
    const bytes = await f.request(`/queries/${second.body.data.id}/result`);
    assert.equal(bytes.response.status, 200); assert.equal(bytes.body.data.result.truncated, true);
    assert.ok(bytes.body.data.result.result_bytes > 5 * 1024 * 1024); assert.ok(bytes.body.data.result.rows.length < 150);
  } finally { await f.close(); }
});
