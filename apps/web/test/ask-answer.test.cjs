
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const root = path.resolve(__dirname, "..");
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const candidate = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const resolved = [candidate, candidate + ".ts", candidate + ".tsx"].find((item) => fs.existsSync(item));
      return load(resolved);
    }
    return require(specifier);
  };
  new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
  cache.set(file, mod.exports);
  return mod.exports;
}
const { toTsv } = load(path.join(root, "components/ask/table-copy.ts"));

test("session title is truncated with a Tooltip trigger and a separate three-dot menu", () => {
  const { SessionListItem } = load(path.join(root, "components/ask/session-list-item.tsx"));
  const { TooltipProvider } = load(path.join(root, "components/ui/tooltip.tsx"));
  const title = "查询所有店铺本年度每个月销售额与利润并按店铺分组";
  const html = renderToStaticMarkup(React.createElement(TooltipProvider, null,
    React.createElement(SessionListItem, {
      session: { id: "session", title, table_ids: ["table"] }, selected: true, busy: false,
      onSelect() {}, onRename() {}, onDelete() {},
    }),
  ));
  assert.match(html, /class="min-w-0 flex-1 truncate"/);
  assert.doesNotMatch(html, /会话处理中/);
  assert.doesNotMatch(html, /张表/);
  assert.match(html, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(html, /data-state="closed"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-current="true"/);
  assert.match(html, new RegExp(`aria-label="会话操作：${title}"`));
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
});

test("running session spinner stays inline before the truncated title", () => {
  const { SessionListItem } = load(path.join(root, "components/ask/session-list-item.tsx"));
  const { TooltipProvider } = load(path.join(root, "components/ui/tooltip.tsx"));
  const html = renderToStaticMarkup(React.createElement(TooltipProvider, null,
    React.createElement(SessionListItem, {
      session: { id: "session", title: "查询月度销售趋势" }, selected: true, busy: true,
      onSelect() {}, onRename() {}, onDelete() {},
    }),
  ));
  const selection = html.match(/<button\b[^>]*aria-current="true"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(selection, /class="flex min-w-0 items-center gap-2 text-left"/);
  assert.match(selection, /size-3 shrink-0 animate-spin/);
  assert.ok(selection.indexOf('aria-label="会话处理中"') < selection.indexOf("查询月度销售趋势"));
  assert.doesNotMatch(selection, /mt-1/);
  assert.match(selection, /min-w-0 flex-1 truncate/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
});
test("ask table selection can hide source details while retaining table names", () => {
  const { SemanticTableSelector } = load(path.join(root, "components/semantic/semantic-table-selector.tsx"));
  const table = { id: "table", business_name: "店铺销售", physical_name: "sales_daily", data_domain: "销售", source: { name: "MaxCompute", project: "source_project", catalog: "", schema: "" }, completeness: { status: "COMPLETE", issues: [] } };
  const render = (showSourceDetails) => renderToStaticMarkup(React.createElement(SemanticTableSelector, { tables: [table], value: [], onValueChange() {}, showSourceDetails }));
  const html = render(false);
  assert.match(html, /店铺销售/);
  assert.match(html, /sales_daily/);
  assert.doesNotMatch(html, /MaxCompute|source_project/);
  assert.match(render(true), /MaxCompute/);
  assert.match(render(true), /source_project/);
});

test("TSV preserves Chinese, null, empty and exact precision and normalizes embedded separators", () => {
  assert.equal(toTsv([["店铺", "金额", "利润"], ["中\t文\r\n店铺", "900719925474099312345.678901", null], ["旗舰店", "", ""]]), "店铺\t金额\t利润\n中 文 店铺\t900719925474099312345.678901\tNULL\n旗舰店\t\t");
  assert.equal(toTsv([["店铺", "金额"]]), "店铺\t金额");
});
test("safe Markdown uses shared tables and keeps native alignment without raw HTML", () => {
  const { AnswerMarkdown } = load(path.join(root, "components/ask/answer-markdown.tsx"));
  const html = renderToStaticMarkup(React.createElement(AnswerMarkdown, null, "# 标题\n\n- 一\n- 二\n\n| 名称 | 金额 |\n| --- | ---: |\n| 中文 | 123 |\n\n<script>alert(1)</script>\n\n[链接](https://example.com)"));
  assert.match(html, /ask-data-table/);
  assert.match(html, /text-align:right/);
  assert.match(html, /复制表格/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<script|alert\(1\)/);
});
test("terminal response uses persisted final answer instead of concatenated intermediate text", () => {
  const { RunAnswer } = load(path.join(root, "components/ask/run-answer.tsx"));
  const run = { status: "SUCCEEDED", question: "查询", answer: "最终回答", model_id: "old", model_display_name: null, model_provider_name: null, processing: { message_count: 3, tool_count: 1, steps: [] }, condition_changes: { inherited: [], changed: [] }, messages: [], queries: [], charts: [], final_query_ids: [], result_summaries: [] };
  const html = renderToStaticMarkup(React.createElement(RunAnswer, { run, streamed: "中间步骤不应进入正文", results: {}, resultErrors: {}, onRefresh() {}, onDownload() {} }));
  assert.match(html, /最终回答/);
  assert.match(html, /模型名称未记录/);
  assert.match(html, /模型 ID：old/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /中间步骤不应进入正文/);
});

test("final query results are shown once while text-only answers keep Markdown tables", () => {
  const { RunAnswer } = load(path.join(root, "components/ask/run-answer.tsx"));
  const run = {
    status: "SUCCEEDED", question: "查询", answer: "结论和口径\n\n| 店铺 | GMV |\n| --- | ---: |\n| 中文店铺 | 27,224,557.00 |",
    model_id: "model", model_display_name: "模型", model_provider_name: "供应商",
    processing: { message_count: 3, tool_count: 1, steps: [] },
    condition_changes: { inherited: [], changed: [] }, messages: [],
    queries: [{ id: "query", status: "SUCCEEDED" }], charts: [], final_query_ids: ["query"], result_summaries: [],
  };
  const saved = { source: { business_name: "业务表", physical_name: "sales" }, query_definition: {},
    execution: { result: { columns: [{ name: "店铺", type: "STRING" }, { name: "GMV", type: "DECIMAL" }], rows: [["中文店铺", "27224557"]] }, elapsed_ms: null, sql: "SELECT ..." } };
  const render = (current, results) => renderToStaticMarkup(React.createElement(RunAnswer, { run: current, results, resultErrors: {}, onRefresh() {}, onDownload() {} }));
  const html = render(run, { query: saved });
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.match(html, /结论和口径/);
  assert.match(html, /模型 ID：model/);
  assert.doesNotMatch(html, /供应商/);
  assert.match(html, /27224557/);
  assert.doesNotMatch(html, /27,224,557/);
  assert.match(html, /下载 Excel/);
  assert.match(html, /复制表格/);
  assert.match(html, /查看 SQL、口径与来源/);
  assert.ok(html.indexOf("下载 Excel") < html.indexOf('aria-label="复制表格"'));
  assert.ok(html.indexOf('aria-label="复制表格"') < html.indexOf('class="ask-table-wrap"'));
  assert.equal((html.match(/aria-label="复制表格"/g) ?? []).length, 1);
  const loading = render(run, {});
  assert.doesNotMatch(loading, /<table/);
  assert.match(loading, /正在读取已保存/);
  const textOnly = render({ ...run, queries: [], charts: [], final_query_ids: [] }, {});
  assert.match(textOnly, /<table/);
  assert.match(textOnly, /27,224,557/);
});

test("all process steps start collapsed and query logs bind only their originating tool", () => {
  const { RunAnswer } = load(path.join(root, "components/ask/run-answer.tsx"));
  const { buildStepLogs } = load(path.join(root, "components/ask/step-log.ts"));
  const { StepLogCard } = load(path.join(root, "components/ask/step-log-card.tsx"));
  const { QueryResult } = load(path.join(root, "components/ask/query-result.tsx"));
  const step = (call, name) => ({ id: call, kind: "tool", tool_call_id: call, name, summary: "处理完成", status: "SUCCEEDED", elapsed_ms: 100 });
  const message = (call, toolName, queryId) => ({ role: "TOOL", content: { toolCallId: call, toolName, details: { query_id: queryId } } });
  const run = {
    id: "run", status: "RUNNING", question: "查询", answer: null, model_id: "model",
    processing: { message_count: 4, tool_count: 4, steps: [step("call-query", "执行查询"), step("call-values", "查询候选值"), step("call-search", "搜索资产"), step("call-foreign", "执行查询")] },
    condition_changes: { inherited: [], changed: [] },
    messages: [message("call-values", "get_dimension_values", "values"), message("call-search", "search_semantic_assets", "query"), message("call-query", "query_data", "query"), message("call-foreign", "query_data", "foreign")],
    queries: [{ id: "query", status: "SUCCEEDED" }, { id: "values", status: "SUCCEEDED" }], charts: [], final_query_ids: ["query"], result_summaries: [],
  };
  const saved = (label) => ({ source: { business_name: label, physical_name: "sales" }, query_definition: {}, execution: { result: { columns: [{ name: "字段", type: "STRING" }], rows: [[label]] }, elapsed_ms: null, sql: "SELECT " + label } });
  const results = { query: saved("查询数据"), values: saved("候选取值"), foreign: saved("越界结果") };
  const html = renderToStaticMarkup(React.createElement(RunAnswer, { run, results, resultErrors: {}, onRefresh() {}, onDownload() {} }));
  assert.match(html, /aria-expanded="true"/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<details|lucide-triangle|查询数据|候选取值|越界结果/);
  const logs = buildStepLogs(run, results);
  assert.equal(logs.get("call-query").queryId, "query");
  assert.equal(logs.get("call-values").queryId, "values");
  assert.equal(logs.get("call-search").queryId, undefined);
  assert.equal(logs.get("call-foreign").queryId, undefined);
  for (const [index, queryId, label] of [[0, "query", "查询数据"], [1, "values", "候选取值"]]) {
    const step = run.processing.steps[index];
    const card = renderToStaticMarkup(React.createElement(StepLogCard, { run, step, log: logs.get(step.id) },
      React.createElement(QueryResult, { saved: results[queryId], status: "SUCCEEDED", onRefresh() {}, onDownload() {} })));
    assert.match(card, new RegExp(label));
    assert.match(card, /查看 SQL、口径与来源/);
    assert.match(card, /SELECT/);
    assert.match(card, /复制表格/);
    assert.doesNotMatch(card, /越界结果/);
  }
});

test("failed tool logs keep errors separate from actual input parameters and escape HTML", () => {
  const { RunAnswer } = load(path.join(root, "components/ask/run-answer.tsx"));
  const { buildStepLogs } = load(path.join(root, "components/ask/step-log.ts"));
  const { StepLogCard } = load(path.join(root, "components/ask/step-log-card.tsx"));
  const { toolFailureText } = load(path.join(root, "components/ask/tool-failure.tsx"));
  const missingTable = 'Validation failed for tool "query_data":\n  - table_id: must have required properties table_id\n\nReceived arguments:\n{"filters":["不应重复回显的参数"]}';
  assert.equal(toolFailureText({ isError: true, content: [{ type: "text", text: missingTable }] }), 'Validation failed for tool "query_data":\n  - table_id: must have required properties table_id');
  assert.equal(toolFailureText({ isError: false, content: [{ type: "text", text: "正常结果" }] }), null);
  assert.equal(toolFailureText({ isError: true }), "工具调用失败，未记录具体错误。");
  const steps = ["missing-table", "wrong-metric"].map((call) => ({ id: call, kind: "tool", tool_call_id: call, name: "执行查询", status: "FAILED", summary: "处理失败", elapsed_ms: 0 }));
  const run = { id: "run", status: "RUNNING", question: "所有指标", answer: null, model_id: "model", processing: { message_count: 5, tool_count: 2, steps }, condition_changes: { inherited: [], changed: [] },
    messages: [
      { id: "model", sequence: 1, role: "ASSISTANT", content: { content: [{ type: "toolCall", id: "missing-table", name: "query_data", arguments: { limit: 50 } }, { type: "toolCall", id: "wrong-metric", name: "query_data", arguments: { metric_ids: ["metric"] } }] } },
      { sequence: 2, role: "TOOL", content: { toolCallId: "missing-table", toolName: "query_data", isError: true, content: [{ type: "text", text: missingTable }] } },
      { sequence: 3, role: "TOOL", content: { toolCallId: "wrong-metric", toolName: "query_data", isError: true, content: [{ type: "text", text: "字段 近1天排行 不是原子指标<script>" }] } },
    ], queries: [], charts: [], final_query_ids: [], result_summaries: [] };
  const html = renderToStaticMarkup(React.createElement(RunAnswer, { run, results: {}, resultErrors: {}, onRefresh() {}, onDownload() {} }));
  assert.match(html, /点击查看日志/);
  assert.doesNotMatch(html, /Received arguments|不应重复回显的参数|查看原始参数/);
  const logs = buildStepLogs(run, {});
  const cards = steps.map(step => renderToStaticMarkup(React.createElement(StepLogCard, { run, step, log: logs.get(step.id) })));
  assert.match(cards[0], /table_id/);
  assert.doesNotMatch(cards[0], /近1天排行/);
  assert.match(cards[0], /&quot;limit&quot;: 50/);
  assert.match(cards[1], /近1天排行/);
  assert.doesNotMatch(cards[1], /table_id: must/);
  assert.doesNotMatch(cards.join(""), /Received arguments|不应重复回显的参数|<script>/);
  assert.match(cards[1], /&lt;script&gt;/);
});

test("charts map saved dates and exact values without treating null or empty strings as zero", () => {
  const { chartData } = load(path.join(root, "components/ask/chart-data.ts"));
  const result = { columns: [{ id: "date", name: "日期", type: "STRING" }, { id: "gmv", name: "GMV", type: "DECIMAL", unit: "元" }], rows: [["20260901", "9007199254740993.123456789"], ["20260902", null], ["20260903", "-12.5"]], truncated: false };
  const spec = { query_id: "q", type: "line", title: "每日GMV", x_column: 0, y_columns: [1] };
  const data = chartData(result, spec);
  assert.equal(data.points.length, 3);
  assert.equal(data.points[0].label, "2026-09-01");
  assert.equal(data.points[0].raw[0], "9007199254740993.123456789");
  assert.equal(data.points[1].values[0], null);
  assert.equal(data.points[2].values[0], -12.5);
  assert.match(chartData({ ...result, rows: [["d", ""]] }, spec).error, /无法绘图/);
  assert.match(chartData({ ...result, rows: [] }, spec).error, /没有符合/);
  assert.match(chartData({ ...result, rows: [["d", 1], ["d", 2]] }, spec).error, /重复分类/);
  assert.match(chartData({ ...result, rows: [["d", -1]] }, { ...spec, type: "pie" }).error, /负值/);
  assert.match(chartData({ ...result, rows: [["d", 0]] }, { ...spec, type: "pie" }).error, /没有可绘图/);
});

test("HTML charts render line gaps, negative bars and single-slice pies without invalid geometry", () => {
  const { chartData } = load(path.join(root, "components/ask/chart-data.ts"));
  const { QueryChart } = load(path.join(root, "components/ask/query-chart.tsx"));
  const result = { columns: [{ name: "分类", type: "STRING" }, { name: "指标", type: "DECIMAL", unit: "元" }], rows: [["甲<script>", "1e308"], ["乙", null], ["丙", "-1e308"]] };
  const spec = { query_id: "q", type: "line", title: "图表<script>", x_column: 0, y_columns: [1] };
  const render = (current, definition) => renderToStaticMarkup(React.createElement(QueryChart, { data: chartData(current, definition), spec: definition }));
  const line = render(result, spec);
  assert.equal((line.match(/<path d=/g) ?? []).length, 2);
  assert.match(line, /&lt;script&gt;/);
  assert.match(line, /NULL/);
  assert.doesNotMatch(line, /NaN|Infinity|<script/);
  const bar = render(result, { ...spec, type: "bar" });
  assert.match(bar, /-1e308/);
  assert.doesNotMatch(bar, /NaN|Infinity/);
  const pie = render({ ...result, rows: [["单一", "10"]] }, { ...spec, type: "pie" });
  assert.match(pie, /<circle/);
  assert.match(pie, /单一/);
  assert.doesNotMatch(pie, /NaN|Infinity/);
});

test("chart view uses all 5000 saved rows while table page remains limited, and HTML preserves exact values", () => {
  const { chartData } = load(path.join(root, "components/ask/chart-data.ts"));
  const { QueryChart } = load(path.join(root, "components/ask/query-chart.tsx"));
  const { QueryResult } = load(path.join(root, "components/ask/query-result.tsx"));
  const { buildChartHtml } = load(path.join(root, "components/ask/chart-export.ts"));
  const spec = { query_id: "q", type: "line", title: "图表</title><script>alert(1)</script>", x_column: 0, y_columns: [1] };
  const rows = Array.from({ length: 5000 }, (_, index) => ["分类" + index, String(index)]);
  rows[0][1] = "9007199254740993.123456789";
  rows[1][1] = null;
  const saved = { query_id: "q", source: { business_name: "业务<script>", physical_name: "sales", project: "project", catalog: "", schema: "" }, query_definition: { metric_ids: ["value"], dimension_ids: ["name"], date_range: { start: "2026-09-01", end: "2026-09-30" } }, execution: { sql: "SELECT '<script>'", content_version: "v1", submitted_at: "2026-09-30", elapsed_ms: null, result: { columns: [{ id: "name", name: "分类", type: "STRING", unit: null }, { id: "value", name: "金额", type: "DECIMAL", unit: "元" }], rows, truncated: true } } };
  const data = chartData(saved.execution.result, spec);
  assert.equal(data.points.length, 5000);
  const svg = renderToStaticMarkup(React.createElement(QueryChart, { data, spec }));
  assert.match(svg, /分类4999/);
  const chart = renderToStaticMarkup(React.createElement(QueryResult, { saved, chart: spec, status: "SUCCEEDED", onRefresh() {}, onDownload() {} }));
  assert.match(chart, /<svg/);
  assert.match(chart, /下载 HTML/);
  assert.doesNotMatch(chart, /下载 Excel/);
  assert.equal((chart.match(/下载 HTML/g) ?? []).length, 1);
  assert.match(chart, /全部已保存的 5000 行/);
  assert.match(chart, /仅包含本次返回结果/);
  assert.doesNotMatch(chart, /<table/);
  const table = renderToStaticMarkup(React.createElement(QueryResult, { saved, status: "SUCCEEDED", onRefresh() {}, onDownload() {} }));
  assert.match(table, /共 5000 行/);
  assert.doesNotMatch(table, /分类4999/);
  assert.match(table, /下载 Excel/);
  assert.doesNotMatch(table, /role="tab(?:list)?"|图表|下载 HTML/);
  const emptyTable = renderToStaticMarkup(React.createElement(QueryResult, { saved: { ...saved, execution: { ...saved.execution, result: { ...saved.execution.result, rows: [] } } }, status: "SUCCEEDED", onRefresh() {}, onDownload() {} }));
  assert.match(emptyTable, /下载 Excel/);
  assert.doesNotMatch(emptyTable, /role="tab(?:list)?"|图表|下载 HTML/);
  const html = buildChartHtml(saved, spec, svg);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /分类4999/);
  assert.match(html, /9007199254740993.123456789/);
  assert.match(html, /NULL/);
  assert.match(html, /2026-09-01 ～ 2026-09-30/);
  assert.match(html, /语义版本：v1/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 5001);
  const empty = buildChartHtml({ ...saved, execution: { ...saved.execution, result: { ...saved.execution.result, rows: [["", ""]] } } }, spec, "<svg></svg>");
  assert.match(empty, /<td><\/td><td><\/td>/);
});
test("one header download action follows table/chart switching and disables invalid chart exports", () => {
  const slots = [];
  let cursor = 0;
  const exports = [];
  let excelCalls = 0;
  let chartDataCalls = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef() {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: { querySelector: () => ({ outerHTML: "<svg></svg>" }) } };
      return slots[index];
    },
  };
  const localRequire = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "./chart-data") { const actual = load(path.join(root, "components/ask/chart-data.ts")); return { ...actual, chartData: (...args) => { chartDataCalls++; return actual.chartData(...args); } }; }
    if (name === "./chart-export") return { downloadChartHtml: (...args) => exports.push(args) };
    return new Proxy({}, { get: (_, key) => key });
  };
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(root, "components/ask/query-visualization.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
  const saved = { query_id: "q", source: { business_name: "销售" }, query_definition: { metric_ids: ["gmv"], dimension_ids: ["date"] }, execution: { result: { columns: [{ id: "date", name: "日期", type: "STRING" }, { id: "gmv", name: "GMV", type: "DECIMAL", unit: "元" }], rows: [["20260901", "123"]] } } };
  const preferred = { query_id: "q", type: "line", title: "每日GMV", x_column: 0, y_columns: [1] };
  const render = (chart = preferred) => { cursor = 0; return mod.exports.QueryVisualization({ saved, preferred: chart, children: "table", onDownload: () => excelCalls++ }); };
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== "object") return undefined;
    if (Array.isArray(tree)) { for (const child of tree) { const match = find(child, predicate); if (match) return match; } return undefined; }
    return predicate(tree) ? tree : find(tree.props?.children, predicate);
  };
  const download = (tree) => find(tree, (node) => node.type === "Button" && ["下载 Excel", "下载 HTML"].includes(node.props.children?.[1]));
  let tree = render(null);
  assert.equal(chartDataCalls, 0);
  assert.equal(find(tree, (node) => node.type === "Tabs"), undefined);
  assert.equal(download(tree).props.children[1], "下载 Excel");
  slots.length = 0;
  tree = render();
  assert.equal(download(tree).props.children[1], "下载 HTML");
  find(tree, (node) => node.type === "Tabs").props.onValueChange("table");
  tree = render();
  let button = download(tree);
  assert.equal(button.props.children[1], "下载 Excel");
  button.props.onClick();
  assert.equal(excelCalls, 1);
  assert.equal(exports.length, 0);
  find(tree, (node) => node.type === "Tabs").props.onValueChange("chart");
  tree = render();
  button = download(tree);
  assert.equal(button.props.children[1], "下载 HTML");
  assert.equal(chartDataCalls, 2);
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(excelCalls, 1);
  assert.equal(exports.length, 1);
  assert.equal(exports[0][0], saved);
  assert.equal(exports[0][1].type, "line");
  assert.equal(exports[0][2], "<svg></svg>");
  const metric = find(tree, (node) => node.type === "Combobox" && node.props["aria-label"] === "图表指标");
  metric.props.onValueChange("0");
  tree = render();
  assert.equal(download(tree).props.disabled, true);
  find(tree, (node) => node.type === "Tabs").props.onValueChange("table");
  tree = render();
  button = download(tree);
  assert.equal(button.props.children[1], "下载 Excel");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(excelCalls, 2);
  assert.equal(exports.length, 1);
});