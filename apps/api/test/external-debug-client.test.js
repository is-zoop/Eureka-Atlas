const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const { ApiCenterService } = require("../dist/api-center/api-center.service");
const { createExternalFixture, nativeFetch } = require("./helpers/external-fixture");

test("the actual browser debug client exercises the real documented HTTP routes with Bearer, never Cookie", async () => {
  const f = await createExternalFixture(), calls = [];
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../../web/lib/external-api.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "fetch", code)(mod, mod.exports, async (route, options) => { calls.push({ route, options }); assert.equal(options.credentials, "omit"); assert.equal(options.headers.Cookie, undefined); return nativeFetch(f.base + route, options); });
  const client = mod.exports;
  try {
    const catalog = await f.app.get(ApiCenterService).catalog();
    const map = { "example-table": "table", "example-version": "v1", "example-day": "day", "example-shop": "shop", "example-amount": "amount" };
    let queryId;
    for (const operation of catalog.operations) {
      const replace = (_, value) => typeof value === "string" ? map[value] ?? value : value;
      const body = JSON.parse(JSON.stringify(operation.request_example), replace), params = JSON.parse(JSON.stringify(operation.params_example), replace);
      if (body.idempotency_key) body.idempotency_key = "debug-" + operation.id;
      if (params.queryId) params.queryId = queryId;
      if (["status", "result", "cancel"].includes(operation.id)) f.state.remoteStatus = "SUCCEEDED";
      const route = client.externalPath(operation, params);
      const result = await client.callExternalApi(route, operation.method, "haze_A_key", body, new AbortController().signal);
      assert.equal(result.status, operation.success_status, operation.id);
      assert.ok(await f.contracts.checkResponse(operation.id, result.body.data), operation.id);
      assert.equal(result.request_id, result.body.request_id);
      if (operation.id === "query") queryId = result.body.data.id;
      const snippet = client.curlExample(operation, "https://atlas.example"); assert.ok(snippet.includes("<HAZE_PERSONAL_CREDENTIAL>")); assert.equal(snippet.includes("haze_A_key"), false);
    }
    assert.equal(calls.length, 7);
    const invalid = await client.callExternalApi("/api/external/v1/semantic/packages/table", "GET", "wrong-key", undefined, new AbortController().signal);
    assert.equal(invalid.status, 401); assert.equal(invalid.body.error.code, "INVALID_CREDENTIAL");
    const web = await nativeFetch(f.base + "/api/api-center", { headers: { Cookie: f.cookie } }); assert.equal(web.status, 200);
    assert.equal(JSON.stringify([...f.rows.values()]).includes("haze_A_key"), false);
  } finally { await f.close(); }
});
