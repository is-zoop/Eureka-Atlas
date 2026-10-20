/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
function load(fetch) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/external-api.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} }; new Function("module", "exports", "fetch", code)(mod, mod.exports, fetch); return mod.exports;
}
test("debug calls use Bearer only, omit Cookie and return 401/403 as local results rather than auth events", async () => {
  const calls = [];
  const client = load(async (url, options) => { calls.push({ url, options }); return Response.json({ error: { code: "INVALID_CREDENTIAL", message: "凭证无效" }, request_id: "id-1" }, { status: 401, headers: { "X-Request-Id": "id-1" } }); });
  const result = await client.callExternalApi("/api/external/v1/queries", "POST", "haze_test_key", { table_id: "table" }, new AbortController().signal);
  assert.equal(result.status, 401); assert.equal(result.request_id, "id-1"); assert.equal(result.body.error.code, "INVALID_CREDENTIAL");
  const request = calls[0]; assert.equal(request.options.credentials, "omit"); assert.equal(request.options.redirect, "error"); assert.equal(request.options.cache, "no-store"); assert.equal(request.options.headers.Authorization, "Bearer haze_test_key"); assert.equal(request.options.headers.Cookie, undefined);
  assert.deepEqual(JSON.parse(request.options.body), { table_id: "table" });
});
test("debug URL and path fields cannot point at unrelated hosts or management APIs", async () => {
  const client = load(async () => { throw new Error("must not call"); });
  for (const value of ["https://evil.invalid", "../secret", "a/b", "a?key=secret", "%2F"]) assert.throws(() => client.externalPath({ path: "/api/external/v1/queries/:queryId" }, { queryId: value }));
  assert.throws(() => client.externalPath({ path: "/api/settings" }, {}));
  assert.equal(client.externalPath({ path: "/api/external/v1/queries/:queryId/result" }, { queryId: "q-1" }), "/api/external/v1/queries/q-1/result");
  await assert.rejects(client.callExternalApi("/api/settings", "GET", "haze_key", {}, new AbortController().signal));
});
test("copyable request examples contain only a credential placeholder and shell-escape body values", () => {
  const client = load(() => {});
  const snippet = client.curlExample({ method: "POST", path: "/api/external/v1/queries", params_example: {}, request_example: { value: "O'Reilly" } }, "https://atlas.example");
  const deployed = client.curlExample({method:'GET',path:'/api/external/v1/queries/:queryId',params_example:{queryId:'owned'},request_example:{}},'https://atlas.paiwo188.com');
  assert.ok(deployed.includes('https://atlas.paiwo188.com/api/external/v1/queries/owned'));assert.equal(deployed.includes('localhost'),false);
  assert.ok(snippet.includes("<HAZE_PERSONAL_CREDENTIAL>")); assert.ok(snippet.includes("https://atlas.example/api/external/v1/queries")); assert.ok(snippet.includes("'\"'\"'"));
});
test("debug responses redact echoed credentials in data and headers before entering UI state", async () => {
  const client = load(async () => Response.json({ data: { authorization: "Bearer haze_private_key", nested: ["haze_private_key", null] } }, { headers: { "X-Request-Id": "echo-haze_private_key" } }));
  const result = await client.callExternalApi("/api/external/v1/queries", "POST", "haze_private_key", {}, new AbortController().signal);
  assert.equal(JSON.stringify(result).includes("haze_private_key"), false);
  assert.equal(result.body.data.authorization, "Bearer [REDACTED]"); assert.equal(result.body.data.nested[1], null);
});
test("debug sources neither persist credentials nor publish web authentication events", () => {
  for (const file of ["../lib/external-api.ts", "../components/api-center/api-center.tsx", "../components/api-center/api-test-panel.tsx"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\.(?:log|warn|error)|dispatchEvent|AUTH_UNAUTHORIZED_EVENT/);
  }
});
test("stopping polling aborts its timer without submitting cancellation", async () => {
  let calls = 0; const client = load(() => { calls++; }); const controller = new AbortController();
  const waiting = client.waitForPoll(controller.signal); controller.abort(); await assert.rejects(waiting, e => e.name === "AbortError"); assert.equal(calls, 0);
});
