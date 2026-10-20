const test = require("node:test"), assert = require("node:assert/strict");
const { createExternalFixture, queryBody, nativeFetch } = require("./helpers/external-fixture");

test("every external operation and both documentation endpoints enforce the API role matrix", async () => {
  const f = await createExternalFixture();
  f.keys.set("haze_unknown", { ...f.keys.get("haze_A_key"), role_code: "OWNER" });
  try {
    for (const [key, role, permitted] of [["haze_A_key", "ADMIN", true], ["haze_B_key", "SYSTEM_ADMIN", true], ["haze_user_key", "USER", false], ["haze_dev_key", "DEVELOPER", false], ["haze_unknown", "OWNER", false]]) {
      const cases = [["/semantic/search", "POST", { keywords: ["销售额"] }, 200], ["/semantic/packages/table", "GET", undefined, 200], ["/queries", "POST", queryBody(role), 202], ["/queries/dimension-values", "POST", { table_id: "table", content_version: "v1", field_id: "shop", idempotency_key: role + "-values", date_range: { start: "2026-10-01", end: "2026-10-15" } }, 202]];
      let id = "not-visible";
      for (const [route, method, body, expected] of cases) {
        const result = await f.request(route, { method, body, key });
        assert.equal(result.response.status, permitted ? expected : 403, `${role} ${route}`);
        if (permitted && route === "/queries") id = result.body.data.id;
      }
      f.state.remoteStatus = "SUCCEEDED";
      for (const [route, method] of [[`/queries/${id}`, "GET"], [`/queries/${id}/result`, "GET"], [`/queries/${id}/cancel`, "POST"]]) assert.equal((await f.request(route, { method, key })).response.status, permitted ? 200 : 403, `${role} ${route}`);
      f.state.remoteStatus = "RUNNING";
      f.state.webRole = role;
      for (const suffix of ["", "/openapi"]) {
        const response = await nativeFetch(f.base + "/api/api-center" + suffix, { headers: { Cookie: f.cookie } });
        assert.equal(response.status, permitted ? 200 : 403, `${role} docs ${suffix}`); await response.text();
      }
    }
  } finally { await f.close(); }
});

test("missing/reset/disabled credentials fail immediately and rotation keeps stable user ownership", async () => {
  const f = await createExternalFixture();
  try {
    for (const key of [null, "unknown-key"]) {
      const result = await f.request("/semantic/packages/table", { key }); assert.equal(result.response.status, 401); assert.equal(result.body.error.code, "INVALID_CREDENTIAL");
    }
    const task = await f.request("/queries", { method: "POST", body: queryBody("owned-before-rotation") });
    const id = task.body.data.id; f.state.remoteStatus = "SUCCEEDED";
    assert.equal((await f.request(`/queries/${id}/result`)).response.status, 200);
    const owner = f.keys.get("haze_A_key"); f.keys.delete("haze_A_key"); f.keys.set("haze_A_rotated", owner);
    assert.equal((await f.request(`/queries/${id}`, { key: "haze_A_key" })).response.status, 401);
    assert.equal((await f.request(`/queries/${id}/result`, { key: "haze_A_rotated" })).response.status, 200);
    for (const [route, method] of [[`/queries/${id}`, "GET"], [`/queries/${id}/result`, "GET"], [`/queries/${id}/cancel`, "POST"]]) assert.equal((await f.request(route, { method, key: "haze_B_key" })).response.status, 404);
    owner.role_code = "DEVELOPER"; assert.equal((await f.request(`/queries/${id}`, { key: "haze_A_rotated" })).response.status, 403);
    owner.role_code = "ADMIN"; owner.status = "disabled"; assert.equal((await f.request(`/queries/${id}`, { key: "haze_A_rotated" })).response.status, 401);
    owner.status = "active"; assert.equal((await f.request(`/queries/${id}`, { key: "haze_A_rotated" })).response.status, 200);
    assert.equal(JSON.stringify([...f.rows.values()]).includes("haze_A_"), false);
  } finally { await f.close(); }
});

test("external credential failures cannot erase or borrow a browser session", async () => {
  const f = await createExternalFixture();
  try {
    for (const key of [null, "bad-key", "web-session", "haze_user_key"]) {
      const before = f.calls.length;
      const result = await f.request("/semantic/packages/table", { key, cookie: f.cookie });
      assert.equal(result.response.status, key === "haze_user_key" ? 403 : 401);
      assert.equal(result.response.headers.get("set-cookie"), null);
      assert.equal(f.calls.slice(before).some(call => new URL(call.url).pathname === "/api/auth/me"), false);
    }
    f.state.hazeOutage = true;
    const outage = await f.request("/semantic/packages/table", { cookie: f.cookie }); assert.equal(outage.response.status, 503); assert.equal(outage.response.headers.get("set-cookie"), null);
    f.state.hazeOutage = false;
    const stillLoggedIn = await nativeFetch(f.base + "/api/api-center", { headers: { Cookie: f.cookie } }); assert.equal(stillLoggedIn.status, 200);
    const bearerCannotLogin = await nativeFetch(f.base + "/api/api-center", { headers: { Authorization: "Bearer haze_A_key" } }); assert.equal(bearerCannotLogin.status, 401);
  } finally { await f.close(); }
});
