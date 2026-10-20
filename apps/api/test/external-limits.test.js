const test = require("node:test"), assert = require("node:assert/strict");
const { createExternalFixture, queryBody } = require("./helpers/external-fixture");
const { ExternalLimitsService, EXTERNAL_LIMITS } = require("../dist/external-api/external-limits");

test("request frequency is per Haze member, expires after a minute and has Retry-After", async () => {
  const f = await createExternalFixture();
  try {
    for (let index = 0; index < EXTERNAL_LIMITS.requests_per_minute; index++) assert.equal((await f.request("/semantic/packages/table")).response.status, 200);
    const limited = await f.request("/semantic/packages/table");
    assert.equal(limited.response.status, 429); assert.equal(limited.body.error.code, "RATE_LIMITED"); assert.ok(Number(limited.response.headers.get("retry-after")) > 0);
    assert.equal(limited.response.headers.get("set-cookie"), null);
    assert.equal((await f.request("/semantic/packages/table", { key: "haze_B_key" })).response.status, 200);
    const limits = new ExternalLimitsService(), headers = {};
    const response = { setHeader: (key, value) => { headers[key] = value; } };
    const savedNow = Date.now; let now = savedNow(); Date.now = () => now;
    try { for (let i = 0; i < 60; i++) limits.consume("A", response); assert.throws(() => limits.consume("A", response)); now += 60001; limits.consume("A", response); assert.equal(headers["RateLimit-Remaining"], 59); } finally { Date.now = savedNow; }
  } finally { await f.close(); }
});

test("parallel admission caps live queries without breaking idempotent retries", async () => {
  const f = await createExternalFixture();
  try {
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => f.request("/queries", { method: "POST", body: queryBody("parallel-" + index) })));
    assert.equal(responses.filter(res => res.response.status === 202).length, 3);
    assert.equal(responses.filter(res => res.response.status === 429 && res.body.error.code === "QUERY_LIMIT_REACHED").length, 3);
    assert.equal(f.submissions(), 3);
    const first = responses.find(res => res.response.status === 202), id = first.body.data.id, row = f.rows.get(id);
    const replay = await f.request("/queries", { method: "POST", body: row.request }); assert.equal(replay.response.status, 202); assert.equal(replay.body.data.id, id); assert.equal(f.submissions(), 3);
    await f.request(`/queries/${id}/cancel`, { method: "POST" }); await f.request(`/queries/${id}`);
    f.state.remoteStatus = "RUNNING";
    assert.equal((await f.request("/queries", { method: "POST", body: queryBody("after-cancel") })).response.status, 202);
    assert.equal((await f.request("/queries", { method: "POST", key: "haze_B_key", body: queryBody("other-member") })).response.status, 202);
  } finally { await f.close(); }
  const duplicate = await createExternalFixture();
  try {
    const result = await Promise.all(Array.from({ length: 5 }, () => duplicate.request("/queries", { method: "POST", body: queryBody("same-request") })));
    assert.ok(result.every(res => res.response.status === 202)); assert.equal(new Set(result.map(res => res.body.data.id)).size, 1); assert.equal(duplicate.submissions(), 1);
  } finally { await duplicate.close(); }
});

test("oversized requests fail before query execution with a stable 413 envelope", async () => {
  const f = await createExternalFixture();
  try {
    for (const size of [70000, 200000]) {
      const res = await f.request("/semantic/search", { method: "POST", body: { keywords: ["a".repeat(size)] } });
      assert.equal(res.response.status, 413); assert.equal(res.body.error.code, "PAYLOAD_TOO_LARGE"); assert.ok(res.body.request_id); assert.equal(f.submissions(), 0);
    }
  } finally { await f.close(); }
});
