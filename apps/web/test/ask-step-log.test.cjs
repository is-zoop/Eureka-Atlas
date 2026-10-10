const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");
const cache = new Map();
function load(file, overrides = {}) {
  if (!Object.keys(overrides).length && cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => {
    if (name in overrides) return overrides[name];
    if (name.startsWith("@/") || name.startsWith(".")) {
      const candidate = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      return load([candidate, candidate + ".ts", candidate + ".tsx"].find(fs.existsSync));
    }
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
  if (!Object.keys(overrides).length) cache.set(file, mod.exports);
  return mod.exports;
}
const { buildStepLogs } = load(path.join(root, "components/ask/step-log.ts"));
const { StepLogCard } = load(path.join(root, "components/ask/step-log-card.tsx"));
const { QueryResult } = load(path.join(root, "components/ask/query-result.tsx"));
const at = "2026-10-08T03:46:42.812Z";
const step = (id, callId, messageId, status = "SUCCEEDED") => ({ id, tool_call_id: callId, message_id: messageId, kind: callId ? "tool" : "message", name: callId ? "执行查询" : "模型响应", status, summary: "摘要", started_at: at, completed_at: status === "RUNNING" ? null : at, elapsed_ms: status === "RUNNING" ? null : 3 });
const user = (id, sequence, text) => ({ id, sequence, role: "USER", content: { content: [{ type: "text", text }] } });
const assistant = (id, sequence, calls, text = "") => ({ id, sequence, role: "ASSISTANT", content: { content: [{ type: "thinking", thinking: "PRIVATE_THINKING", signature: "PRIVATE_SIGNATURE" }, ...(text ? [{ type: "text", text, textSignature: "PRIVATE_TEXT_SIGNATURE" }] : []), ...calls.map(call => ({ type: "toolCall", ...call }))], usage: { internal: "PRIVATE_USAGE" } } });
const tool = (id, sequence, callId, toolName, details) => ({ id, sequence, role: "TOOL", content: { toolCallId: callId, toolName, isError: false, details } });
const run = (messages, steps) => ({ id: "run", model_id: "model", model_display_name: "真实模型", status: "RUNNING", messages, processing: { message_count: messages.length, tool_count: steps.filter(s => s.kind === "tool").length, steps }, queries: [{ id: "q" }], result_summaries: [{ query_id: "q" }], final_query_ids: ["q"], charts: [], clarification: null });
const call = (id, name, args) => ({ id, name, arguments: args });
const card = (current, s, log, children) => renderToStaticMarkup(React.createElement(StepLogCard, { run: current, step: s, log }, children));

test("model steps use message IDs and parallel tool steps use call IDs regardless of return order", () => {
  const model = assistant("model-1", 1, [call("a", "search_semantic_assets", { keywords: ["店铺"] }), call("b", "search_semantic_assets", { keywords: ["流量"] })], "公开说明");
  const steps = [step("model-step", null, "model-1"), step("step-a", "a", "model-1"), step("step-b", "b", "model-1")];
  const current = run([model, tool("tool-b", 2, "b", "search_semantic_assets", { total: 2, items: [{ business_name: "流量表", physical_name: "flow", match_reasons: [{ text: "流量", basis: "NAME" }] }] }), tool("tool-a", 3, "a", "search_semantic_assets", { total: 0, items: [] })], steps);
  const logs = buildStepLogs(current, {});
  assert.equal(logs.get("model-step").calls.length, 2);
  assert.equal(logs.get("model-step").text, "公开说明");
  assert.deepEqual(logs.get("step-a").arguments, { keywords: ["店铺"] });
  assert.deepEqual(logs.get("step-b").arguments, { keywords: ["流量"] });
  assert.equal(logs.get("step-a").output[0].entries[0].value, "0");
  const modelHtml = card(current, steps[0], logs.get("model-step"));
  assert.match(modelHtml, /真实模型|公开说明/);
  assert.doesNotMatch(modelHtml, /PRIVATE_/);
  const a = card(current, steps[1], logs.get("step-a"));
  const b = card(current, steps[2], logs.get("step-b"));
  assert.doesNotMatch(a, /流量表/);
  assert.match(b, /流量表|flow|NAME/);
  // Reconnection merges the same messages and step IDs without extra output sections.
  const repeated = buildStepLogs({ ...current, messages: [...current.messages, current.messages[2]] }, {});
  assert.deepEqual(repeated.get("step-a"), logs.get("step-a"));
});

test("semantic output is whitelisted and query summaries resolve names only from recorded packages and columns", () => {
  const pkg = { content_version: "v-recorded", source: { name: "MaxCompute", project: "sales" }, table: { id: "table", business_name: "业绩表", name: "sales_daily", grain: ["shop", "date"], query_config: { storage: "DATE_INCREMENTAL", default_stat_date: { field_id: "date", format: "yyyyMMdd" } }, internal: "PRIVATE_TABLE" }, fields: [
    { id: "shop", name: "店铺名称", column: "shop_name", type: "DIMENSION", data_type: "string", unit: null, aggregation: null },
    { id: "date", name: "统计日期", column: "date_pt", type: "PARTITION", data_type: "string" },
    { id: "gmv", name: "GMV", column: "gmv_amt", type: "METRIC", data_type: "decimal", unit: "元", aggregation: "SUM", internal: "PRIVATE_FIELD" },
  ], metrics: [{ id: "price", name: "客单价", type: "DERIVED", unit: "元", formula: "SUM(amount) / NULLIF(SUM(users), 0)", dependencies: [{ id: "gmv", column: "gmv_amt" }] }], internal: "PRIVATE_PACKAGE" };
  const input = { table_id: "table", metric_ids: ["gmv", "unknown"], dimension_ids: ["shop"], filters: [{ field_id: "shop", operator: "EQ", values: ["中文店铺"] }], order_by: [{ field_id: "gmv", direction: "DESC" }], date_range: { start: "2026-10-07", end: "2026-10-07" }, limit: 5000 };
  const steps = [step("pkg", "p", "m1"), step("query", "q-call", "m2")];
  const current = run([assistant("m1", 1, [call("p", "get_semantic_package", { table_id: "table" })]), tool("p-out", 2, "p", "get_semantic_package", pkg), assistant("m2", 3, [call("q-call", "query_data", input)]), tool("q-out", 4, "q-call", "query_data", { query_id: "q", status: "SUCCEEDED", row_count_returned: 0, result_complete: true })], steps);
  const logs = buildStepLogs(current, {});
  const html = card(current, steps[0], logs.get("pkg"));
  assert.match(html, /v-recorded|DATE_INCREMENTAL|yyyyMMdd|gmv_amt|SUM|NULLIF/);
  assert.doesNotMatch(html, /PRIVATE_/);
  assert.match(JSON.stringify(logs.get("query").request), /业绩表|店铺名称|GMV、unknown|中文店铺|DESC|2026-10-07/);
  assert.equal(logs.get("query").queryId, "q");
  assert.match(card(current, steps[1], logs.get("query")), /返回行数.*?0/s);
});

test("each clarification binds its own following user answer rather than the latest answer", () => {
  const question = "请选择口径";
  const steps = [step("first", "c1", "m1"), step("second", "c2", "m2")];
  const current = run([
    assistant("m1", 1, [call("c1", "request_clarification", { question, options: ["核心", "全部"] })]),
    tool("out1", 2, "c1", "request_clarification", { waiting_for_user: true }),
    user("u1", 3, "用户对澄清问题「请选择口径」的回答：核心\n请接着本轮已完成的步骤执行，保留原条件。"),
    assistant("m2", 4, [call("c2", "request_clarification", { question, options: ["本月", "昨日"] })]),
    tool("out2", 5, "c2", "request_clarification", { waiting_for_user: true }),
    user("u2", 6, "用户对澄清问题「请选择口径」的回答：昨日\n请接着本轮已完成的步骤执行，保留原条件。"),
  ], steps);
  current.clarification = { question, answer: "昨日" };
  const logs = buildStepLogs(current, {});
  assert.equal(logs.get("first").output[0].entries.find(e => e.label === "用户回答").value, "核心");
  assert.equal(logs.get("second").output[0].entries.find(e => e.label === "用户回答").value, "昨日");
  assert.doesNotMatch(card(current, steps[0], logs.get("first")), /保留原条件/);
});

test("query logs retain exact data, SQL and metadata for candidates and final queries", () => {
  const saved = { query_id: "q", source: { business_name: "销售", physical_name: "sales", project: "project" }, query_definition: { table_id: "table", field_id: "shop", date_range: { start: "2026-10-07", end: "2026-10-07" } }, execution: { content_version: "v1", sql: "SELECT saved_data", status: "SUCCEEDED", elapsed_ms: 12, result: { columns: [{ id: "shop", name: "店铺", type: "STRING" }, { id: "gmv", name: "金额", type: "DECIMAL", unit: "元" }], rows: [["中文", "9007199254740993.123456789"], ["空值", null], ["空字符串", ""]], truncated: true } } };
  const steps = [step("candidate", "a", "m"), step("present", "b", "m2")];
  const current = run([assistant("m", 1, [call("a", "get_dimension_values", { table_id: "table", field_id: "shop", keyword: "中文", limit: 50 })]), tool("out", 2, "a", "get_dimension_values", { query_id: "q", status: "SUCCEEDED", row_count_returned: 3, result_complete: false, excerpt_complete: false }), assistant("m2", 3, [call("b", "present_query_results", { query_ids: ["q"], charts: [] })]), tool("out2", 4, "b", "present_query_results", { query_ids: ["q"], charts: [] })], steps);
  const logs = buildStepLogs(current, { q: saved });
  const queryElement = React.createElement(QueryResult, { saved, status: "SUCCEEDED", onRefresh() {}, onDownload() {} });
  const html = card(current, steps[0], logs.get("candidate"), queryElement);
  assert.match(html, /9007199254740993\.123456789|NULL|空字符串|SELECT saved_data|v1|结果已截断|复制表格|下载 Excel/);
  assert.match(JSON.stringify(logs.get("candidate").request), /店铺|中文/);
  assert.equal(logs.get("present").output[0].entries.find(e => e.label === "图表数量").value, "0");
  assert.doesNotMatch(card(current, steps[1], logs.get("present")), /PRIVATE_/);
});

function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, predicate); if (result) return result; } return undefined; }
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
function setupPanel() {
  const slots = [];
  let cursor = 0;
  const react = { useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  } };
  const { ProcessingDetails } = load(path.join(root, "components/ask/processing-details.tsx"), { react, "@/components/ui/button": { Button: "button" }, "lucide-react": { Check: "Check", CircleAlert: "CircleAlert", LoaderCircle: "LoaderCircle", ChevronRight: "ChevronRight" } });
  return { render(current) { cursor = 0; return ProcessingDetails({ run: current, renderStepLog: s => s.summary }); } };
}
const stepButton = (tree, id) => find(find(tree, node => node.props?.["data-step-id"] === id), node => node.type === "button");
const topButton = tree => find(tree, node => node.type === "button" && node.props.className === "ask-processing-toggle");
const content = (tree, id) => find(tree, node => node.props?.id === "run:log:" + id);

test("all step rows toggle independently without arrows and stay open across streaming and status updates", () => {
  const panel = setupPanel();
  let current = run([], [step("a", "a-call", "m", "RUNNING"), step("b", null, "m"), step("c", "c-call", "m", "FAILED")]);
  let tree = panel.render(current);
  assert.equal(topButton(tree).props["aria-expanded"], true);
  for (const s of current.processing.steps) {
    const button = stepButton(tree, s.id);
    assert.equal(button.props.type, "button");
    assert.equal(button.props["aria-expanded"], false);
    assert.equal(content(tree, s.id), undefined);
    assert.equal(find(button, node => node.type === "ChevronRight"), undefined);
  }
  assert.equal(stepButton(tree, "a").props.children[0].type, "LoaderCircle");
  assert.equal(stepButton(tree, "b").props.children[0].type, "Check");
  assert.equal(stepButton(tree, "c").props.children[0].type, "CircleAlert");
  stepButton(tree, "a").props.onClick();
  tree = panel.render(current);
  stepButton(tree, "b").props.onClick();
  tree = panel.render(current);
  assert.equal(stepButton(tree, "a").props["aria-expanded"], true);
  assert.equal(stepButton(tree, "b").props["aria-expanded"], true);
  current = { ...current, processing: { ...current.processing, steps: [{ ...current.processing.steps[0], status: "SUCCEEDED", summary: "工具最新返回" }, ...current.processing.steps.slice(1), step("new", "new-call", "m", "RUNNING")] } };
  tree = panel.render(current);
  assert.equal(content(tree, "a").props.children, "工具最新返回");
  assert.equal(stepButton(tree, "new").props["aria-expanded"], false);
  stepButton(tree, "a").props.onClick();
  tree = panel.render(current);
  assert.equal(content(tree, "a"), undefined);
  for (const status of ["WAITING_CLARIFICATION", "RUNNING", "CANCELLING", "SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"]) {
    current = { ...current, status };
    tree = panel.render(current);
    assert.equal(topButton(tree).props["aria-expanded"], ["RUNNING", "CANCELLING"].includes(status));
    if (!topButton(tree).props["aria-expanded"]) { topButton(tree).props.onClick(); tree = panel.render(current); }
    assert.equal(stepButton(tree, "b").props["aria-expanded"], true);
  }
  const restored = setupPanel();
  tree = restored.render(current);
  assert.equal(topButton(tree).props["aria-expanded"], false);
  topButton(tree).props.onClick();
  tree = restored.render(current);
  assert.equal(stepButton(tree, "b").props["aria-expanded"], false);
});

test("pending logs fill when the tool returns, and missing or stopped records never invent output", () => {
  const steps = [step("a", "call", "m", "RUNNING")];
  let current = run([assistant("m", 1, [call("call", "query_data", { table_id: "t", metric_ids: ["unresolved"], limit: 10 })])], steps);
  let log = buildStepLogs(current, {}).get("a");
  assert.match(card(current, steps[0], log), /等待工具返回|unresolved/);
  current = { ...current, messages: [...current.messages, tool("out", 2, "call", "query_data", { query_id: "q", status: "SUCCEEDED", row_count_returned: 0 })] };
  log = buildStepLogs(current, {}).get("a");
  assert.equal(log.hasOutput, true);
  assert.doesNotMatch(card(current, steps[0], log), /等待工具返回/);
  const missing = run([], [step("missing", "missing-call", "missing-model", "FAILED")]);
  const html = card(missing, missing.processing.steps[0], buildStepLogs(missing, {}).get("missing"));
  assert.match(html, /未记录/);
  assert.doesNotMatch(html, /等待工具返回/);
});

test("model failures expose recorded errors and an unanswered earlier clarification cannot inherit a later answer", () => {
  const model = assistant("m", 1, []);
  model.content.errorMessage = "模型请求失败<script>";
  const modelStep = step("model", null, "m", "FAILED");
  const current = run([model], [modelStep]);
  const log = buildStepLogs(current, {}).get("model");
  assert.equal(log.error, "模型请求失败<script>");
  const html = card(current, modelStep, log);
  assert.match(html, /失败详情|模型请求失败&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|PRIVATE_/);
  const clarification = run([
    assistant("m1", 1, [call("c1", "request_clarification", { question: "选择口径" })]),
    tool("out1", 2, "c1", "request_clarification", { waiting_for_user: true }),
    assistant("m2", 3, [call("c2", "request_clarification", { question: "选择口径" })]),
    tool("out2", 4, "c2", "request_clarification", { waiting_for_user: true, clarification_id: "second-question" }),
  ], [step("first", "c1", "m1"), step("second", "c2", "m2")]);
  clarification.clarification = { id: "second-question", question: "选择口径", answer: "仅第二次回答", response: null };
  const logs = buildStepLogs(clarification, {});
  assert.equal(logs.get("first").output[0].entries.find(e => e.label === "用户回答").value, "未记录");
  assert.equal(logs.get("second").output[0].entries.find(e => e.label === "用户回答").value, "仅第二次回答");
});
test("structured clarification logs keep each question's selections and custom text after another question replaces it", () => {
  const args = { question: "选择指标", selection_mode: "multiple", options: [{ summary: "收入", description: "销售收入，按店铺汇总" }, { summary: "利润", description: "利润，按店铺汇总" }] };
  const firstAnswer = "所选选项：\nA. 收入： 销售收入，按店铺汇总\nB. 利润： 利润，按店铺汇总\n补充说明： 2026 年 8 月";
  const firstUser = user("u1", 3, "用户对澄清问题「选择指标」的回答：" + firstAnswer + "\n请接着本轮已完成的步骤执行，保留此前条件。");
  firstUser.content.clarification_response = { clarification_id: "first-id", selected_option_ids: ["A", "B"], custom_text: "2026 年 8 月" };
  const steps = [step("first", "c1", "m1"), step("second", "c2", "m2")];
  const current = run([
    assistant("m1", 1, [call("c1", "request_clarification", args)]),
    tool("t1", 2, "c1", "request_clarification", { waiting_for_user: true, clarification_id: "first-id" }),
    firstUser,
    assistant("m2", 4, [call("c2", "request_clarification", { ...args, selection_mode: "single" })]),
    tool("t2", 5, "c2", "request_clarification", { waiting_for_user: true, clarification_id: "second-id" }),
  ], steps);
  current.clarification = { id: "second-id", question: args.question, selection_mode: "single", options: [], response: null, answer: null };
  const logs = buildStepLogs(current, {});
  const first = logs.get("first");
  const output = Object.fromEntries(first.output[0].entries.map(e => [e.label, e.value]));
  assert.equal(output["实际选择"], '["A","B"]');
  assert.equal(output["补充文字"], "2026 年 8 月");
  assert.equal(output["用户回答"], firstAnswer);
  assert.match(JSON.stringify(first.request), /可多选|A\. 收入|B\. 利润/);
  assert.equal(logs.get("second").output[0].entries.find(e => e.label === "用户回答").value, "未记录");
  const html = card(current, steps[0], first);
  assert.match(html, /收入|利润|2026 年 8 月/);
  assert.doesNotMatch(html, /PRIVATE_/);
});