/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props?.children)]; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(""); if (node == null || typeof node === "boolean") return ""; return typeof node === "object" ? text(node.props?.children) : String(node); }
const operation = { id: "query", title: "提交指标查询", description: "示例", method: "POST", path: "/api/external/v1/queries", params_example: {}, request_example: { table_id: "table", content_version: "v1", metric_ids: ["amount"], idempotency_key: "test-request" }, request_schema: { properties: { table_id: { type: "string" } }, required: ["table_id"] }, params_schema: { properties: {} }, response_schema: { type: "object" }, response_example: { id: "q1", status: "RUNNING" }, notes: ["只接受字段 ID"] };
const catalog = { title: "Atlas", version: "v1", authentication: "Bearer <HAZE_PERSONAL_CREDENTIAL>", workflow: ["搜索", "读取语义", "查询"], limits: { requests_per_minute: 60, concurrent_queries_per_user: 3, query_rows: 5000, result_bytes: 5242880, result_retention_seconds: 86400 }, errors: [{ status: 401, code: "INVALID_CREDENTIAL", description: "无效凭证" }], operations: [{ ...operation, id: "search", title: "搜索资产", path: "/api/external/v1/semantic/search" }, operation] };
const reply = (status = 202, state = "RUNNING") => ({ status, elapsed_ms: 10, body: { data: { id: "q1", status: state } }, request_id: "request-1", retry_after: null });
function fixture(relative, component, props = {}, overrides = {}) {
  const slots = [], deps = [], pending = [], cleanups = [], calls = [], replies = [];
  let cursor = 0, effect = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(fn, next) { const index = effect++; if (!deps[index] || next.some((v, i) => v !== deps[index][i])) { deps[index] = next; pending.push(() => { cleanups[index]?.(); cleanups[index] = fn(); }); } },
  };
  const source = fs.readFileSync(path.join(__dirname, relative), "utf8"), code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "@/lib/api") return { api: async () => catalog };
    if (name === "@/lib/external-api") return {
      externalPath: (op, params) => op.path.replace(":queryId", params.queryId || "q1"),
      callExternalApi: async (...args) => { calls.push(args); return overrides.call ? overrides.call(...args) : replies.shift() || reply(); },
      waitForPoll: signal => overrides.wait ? overrides.wait(signal) : Promise.resolve(),
      curlExample: () => "Authorization: Bearer <HAZE_PERSONAL_CREDENTIAL>",
    };
    return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : String(key) });
  };
  const browser = new EventTarget(); browser.location = new URL("https://atlas.example/api-center");
  new Function("module", "exports", "require", "window", "navigator", code)(mod, mod.exports, localRequire, browser, { clipboard: { writeText: async () => {} } });
  return { calls, replies, props, slots, browser,
    render() { cursor = 0; effect = 0; return mod.exports[component](props); },
    async flush() { for (const run of pending.splice(0)) run(); await new Promise(resolve => setImmediate(resolve)); },
    unmount() { cleanups.forEach(fn => fn?.()); },
  };
}
const button = (tree, label) => nodes(tree).find(node => node.type === "Button" && text(node) === label);

test("API center loads the protected directory, selects real operations and requires an explicit masked credential", async () => {
  const f = fixture("../components/api-center/api-center.tsx", "ApiCenter");
  f.render(); await f.flush(); let tree = f.render();
  const header = nodes(tree).find(node => node.type === "IntegrationsTabs");
  assert.ok(text(header.props.help).includes("60")); assert.ok(text(header.props.help).includes("3"));
  assert.equal(nodes(tree).some(node=>node.type==='PageHeader'),false);
  const input = nodes(tree).find(node => node.type === "Input" && node.props.id === "api-personal-credential"); assert.equal(input.props.type, "password"); assert.equal(input.props.value, "");
  input.props.onChange({ target: { value: "haze_A_key" } });
  button(tree, "提交指标查询POST · query").props.onClick(); tree = f.render();
  const panel = nodes(tree).find(node => node.type === "ApiTestPanel"); assert.equal(panel.props.operation.id, "query"); assert.equal(panel.props.credential, "haze_A_key");
  assert.ok(nodes(header.props.actions).some(node => node.type === "a" && node.props.href === "/api/api-center/openapi"));
  f.unmount();
});

test("API center places the download action in the header and all general guidance behind its help tooltip", async () => {
  const f = fixture("../components/api-center/api-center.tsx", "ApiCenter");
  const initialHeader = nodes(f.render()).find(node => node.type === "IntegrationsTabs");
  assert.equal(initialHeader.props.actions, null);
  assert.ok(nodes(initialHeader.props.help).some(node => node.type === "Button" && node.props["aria-label"] === "开放 API 使用说明"));
  await f.flush(); const tree = f.render(), header = nodes(tree).find(node => node.type === "IntegrationsTabs");
  assert.equal(header.props.description, undefined);
  const help = nodes(header.props.help), content = help.find(node => node.type === "TooltipContent");
  assert.equal(help.find(node => node.type === "TooltipTrigger").props.asChild, true);
  assert.equal(content.props.side, "bottom"); assert.equal(content.props.align, "start");
  for (const detail of ["个人凭证", "Atlas External API · v1", catalog.authentication, "搜索 → 读取语义 → 查询", "5000", "5 MiB", "24 小时", "MaxCompute"]) assert.ok(text(content).includes(detail), detail);
  const download = nodes(header.props.actions).find(node => node.type === "a");
  assert.equal(download.props.href, "/api/api-center/openapi"); assert.equal(download.props.download, "atlas-openapi.json");
  assert.equal(nodes(tree).some(node => node.type === "a" && node.props.href === download.props.href), false);
  assert.equal(text(tree).includes(catalog.authentication), false);
  f.unmount();
});

test("API directory and detail are separate bounded keyboard-accessible scrolling regions", async () => {
  const f = fixture("../components/api-center/api-center.tsx", "ApiCenter");
  f.render(); await f.flush(); const tree = f.render();
  assert.ok(tree.props.className.includes("lg:h-[calc(100dvh-105px)]"));
  const nav = nodes(tree).find(node => node.type === "nav" && node.props["aria-label"] === "开放接口列表");
  const detail = nodes(tree).find(node => node.type === "Card" && node.props["aria-label"] === "API 详情");
  for (const pane of [nav, detail]) {
    assert.equal(pane.props.tabIndex, 0);
    for (const style of ["shadcn-scrollbar", "min-h-0", "overflow-y-auto", "overscroll-contain", "lg:max-h-none"]) assert.ok(pane.props.className.split(" ").includes(style), style);
  }
  assert.ok(nav.props.className.includes("max-h-72")); assert.ok(detail.props.className.includes("max-h-[70dvh]"));
  const grid = nodes(tree).find(node => node.props.className?.includes("lg:grid-cols-[260px_minmax(0,1fr)]"));
  assert.ok(grid.props.className.includes("min-h-0")); assert.ok(grid.props.className.includes("lg:flex-1"));
  assert.ok(grid.props.className.includes("lg:grid-rows-[minmax(0,1fr)]"));
  assert.deepEqual(grid.props.children, [nav, detail]);
  f.unmount();
});

test("shared Haze-style page headers retain normal titles/descriptions and expose a trailing action slot", () => {
  const action = { type: "a", props: { children: "下载", href: "/example" } };
  const f = fixture("../components/common/page-header.tsx", "PageHeader", { title: "页面标题", description: "原页面说明", actions: action });
  const tree = f.render(); assert.equal(tree.type, "header");
  assert.equal(text(nodes(tree).find(node => node.type === "h1")), "页面标题");
  assert.ok(text(tree).includes("原页面说明"));
  assert.ok(nodes(tree.props.children[1]).includes(action));
  assert.ok(tree.props.className.includes("justify-between")); assert.ok(tree.props.className.includes("shrink-0"));
});

test("leaving the page clears the credential field, including the DOM value before back-forward cache", async () => {
  const f = fixture("../components/api-center/api-center.tsx", "ApiCenter");
  f.render(); await f.flush(); let tree = f.render();
  const input = nodes(tree).find(node => node.type === "Input" && node.props.id === "api-personal-credential");
  input.props.ref.current = { value: "haze_A_key" };
  input.props.onChange({ target: { value: "haze_A_key" } }); tree = f.render();
  assert.equal(nodes(tree).find(node => node.type === "Input").props.value, "haze_A_key");
  f.browser.dispatchEvent(new Event("pagehide")); tree = f.render();
  assert.equal(nodes(tree).find(node => node.type === "Input").props.value, "");
  assert.equal(input.props.ref.current.value, ""); f.unmount();
});

test("online testing submits exact input and exposes state/result/cancel controls for returned tasks", async () => {
  const f = fixture("../components/api-center/api-test-panel.tsx", "ApiTestPanel", { operation, credential: "haze_A_key" });
  let tree = f.render(); await f.flush(); tree = f.render();
  button(tree, "发送请求").props.onClick(); await f.flush(); tree = f.render();
  assert.equal(f.calls[0][0], "/api/external/v1/queries"); assert.equal(f.calls[0][1], "POST"); assert.equal(f.calls[0][2], "haze_A_key"); assert.deepEqual(f.calls[0][3], operation.request_example);
  assert.ok(text(tree).includes("HTTP 202")); assert.ok(text(tree).includes("request-1")); assert.ok(button(tree, "读取结果"));
  button(tree, "读取状态").props.onClick(); await f.flush(); tree = f.render(); assert.equal(f.calls.at(-1)[0], "/api/external/v1/queries/q1");
  button(tree, "取消查询").props.onClick(); tree = f.render(); assert.equal(nodes(tree).find(node => node.type === "Dialog").props.open, true); assert.equal(f.calls.length, 2);
  button(tree, "确认取消").props.onClick(); await f.flush(); assert.equal(f.calls.at(-1)[0], "/api/external/v1/queries/q1/cancel"); assert.equal(f.calls.at(-1)[1], "POST");
  f.unmount();
});

test("task tracking stops at terminal state and malformed JSON makes no request", async () => {
  const f = fixture("../components/api-center/api-test-panel.tsx", "ApiTestPanel", { operation, credential: "haze_A_key" });
  f.render(); await f.flush(); let tree = f.render();
  nodes(tree).find(node => node.type === "Textarea").props.onChange({ target: { value: "not JSON" } }); tree = f.render(); button(tree, "发送请求").props.onClick(); await f.flush(); tree = f.render(); assert.equal(f.calls.length, 0); assert.ok(text(tree).includes("有效 JSON"));
  nodes(tree).find(node => node.type === "Textarea").props.onChange({ target: { value: JSON.stringify(operation.request_example) } }); tree = f.render(); button(tree, "发送请求").props.onClick(); await f.flush(); tree = f.render();
  f.replies.push(reply(200, "RUNNING"), reply(200, "SUCCEEDED")); button(tree, "跟踪状态").props.onClick(); await f.flush(); tree = f.render();
  assert.equal(f.calls.length, 3); assert.ok(text(tree).includes("状态跟踪已结束")); assert.equal(button(tree, "取消查询").props.disabled, true);
  f.unmount();
});

test("stop waiting aborts only local work, while HTTP 401 remains visible without touching web auth", async () => {
  let waitingSignal;
  const f = fixture("../components/api-center/api-test-panel.tsx", "ApiTestPanel", { operation, credential: "haze_A_key" }, { wait: signal => { waitingSignal = signal; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })); } });
  f.render(); await f.flush(); let tree = f.render(); button(tree, "发送请求").props.onClick(); await f.flush(); tree = f.render();
  button(tree, "跟踪状态").props.onClick(); await f.flush(); tree = f.render(); button(tree, "停止等待").props.onClick(); await f.flush(); tree = f.render();
  assert.equal(waitingSignal.aborted, true); assert.equal(f.calls.some(call => call[0].endsWith("/cancel")), false); assert.ok(text(tree).includes("不会自动取消"));
  f.replies.push({ ...reply(401), body: { error: { code: "INVALID_CREDENTIAL", message: "凭证失效" } } }); button(tree, "发送请求").props.onClick(); await f.flush(); tree = f.render(); assert.ok(text(tree).includes("HTTP 401"));
  assert.equal(nodes(tree).find(node => node.type === "ApiJson").props.value.error.code, "INVALID_CREDENTIAL");
  f.unmount();
});

test("credential changes and unmount abort stale calls and discard old-account responses", async () => {
  let finish;
  const f = fixture("../components/api-center/api-test-panel.tsx", "ApiTestPanel", { operation, credential: "haze_A_key" }, { call: () => new Promise(resolve => { finish = resolve; }) });
  f.render(); await f.flush(); let tree = f.render(); button(tree, "发送请求").props.onClick();
  f.props.credential = "haze_B_key"; f.render(); await f.flush(); finish(reply()); await f.flush();
  assert.equal(f.calls[0][4].aborted, true); assert.equal(nodes(f.render()).some(node => node.type === "ApiJson"), false);
  f.unmount();
});
