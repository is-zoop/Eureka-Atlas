const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCharts, finalCharts } = require("../dist/ask/ask-chart");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { buildAskSystemPrompt } = require("../dist/ask/ask-prompt");
const { prisma } = require("@eureka-atlas/database");

const saved = (rows = [["20260901", "123.4567890123456789"], ["20260902", null]]) => ({
  query_id: "q", query_definition: { metric_ids: ["gmv"], dimension_ids: ["date"] },
  execution: { result: { columns: [{ id: "date", name: "日期", type: "STRING", unit: null }, { id: "gmv", name: "GMV", type: "DECIMAL", unit: "元" }], rows } },
});
const spec = { query_id: "q", type: "line", title: "每日 GMV", x_column: 0, y_columns: [1] };

test("chart validation binds saved numeric columns and preserves exact rows", () => {
  const result = saved();
  const original = JSON.stringify(result);
  assert.deepEqual(validateCharts([spec], ["q"], [result]), [spec]);
  assert.deepEqual(validateCharts(undefined, ["q"], [result]), []);
  assert.equal(JSON.stringify(result), original);
  assert.equal(validateCharts([{ ...spec, type: "bar" }], ["q"], [saved([["日期", "-10"]])])[0].type, "bar");
  assert.equal(validateCharts([spec], ["q"], [saved([])])[0].type, "line");
});

test("charts reject foreign queries, candidates, invalid columns, HTML types, and malformed values", () => {
  for (const chart of [{ ...spec, query_id: "foreign" }, { ...spec, x_column: 5 }, { ...spec, x_column: -1 }, { ...spec, x_column: .5 }, { ...spec, y_columns: [0] }, { ...spec, y_columns: [1, 1] }, { ...spec, y_columns: [5] }, { ...spec, type: "html" }, { ...spec, title: "" }]) {
    assert.throws(() => validateCharts([chart], ["q"], [saved()]));
  }
  assert.throws(() => validateCharts([spec], [], [saved()]), /已选/);
  assert.throws(() => validateCharts([spec], ["q"], [{ ...saved(), query_definition: { field_id: "date" } }]), /指标查询/);
  for (const value of ["", "NaN", "Infinity", "1e999", true, "<script>"]) assert.throws(() => validateCharts([spec], ["q"], [saved([["日期", value]])]), /无法绘图/);
  assert.throws(() => validateCharts([spec], ["q"], [saved([["日期", null]])]), /没有可绘图/);
  assert.throws(() => validateCharts([spec, spec], ["q"], [saved()]), /一张图表/);
  assert.throws(() => validateCharts(Array(5).fill(spec), ["q"], [saved()]), /最多展示/);
  assert.throws(() => validateCharts([spec], ["q"], [saved([["同名", 1], ["同名", 2]])]), /重复分类/);
  const mixed = saved();
  mixed.execution.result.columns.push({ id: "rate", name: "利润率", type: "DECIMAL", unit: "%" });
  mixed.execution.result.rows = [["日期", 1, .2]];
  assert.throws(() => validateCharts([{ ...spec, y_columns: [1, 2] }], ["q"], [mixed]), /单位/);
});

test("pie validation rejects negatives, zero totals, excess categories and multiple metrics", () => {
  const pie = { ...spec, type: "pie" };
  assert.deepEqual(validateCharts([pie], ["q"], [saved([["单一", 10]])]), [pie]);
  assert.throws(() => validateCharts([pie], ["q"], [saved([["亏损", -1]])]), /负值/);
  assert.throws(() => validateCharts([pie], ["q"], [saved([["零", 0]])]), /没有可绘图/);
  assert.throws(() => validateCharts([pie], ["q"], [saved(Array.from({ length: 21 }, (_, index) => [String(index), 1]))]), /最多 20/);
});

test("presentation history uses the latest successful selection, surviving replay without showing stale charts", () => {
  const message = (charts, isError = false) => ({ role: "TOOL", content: { toolName: "present_query_results", isError, details: { query_ids: ["q"], charts } } });
  assert.deepEqual(finalCharts([message([spec]), message([], true)], ["q"]), [spec]);
  assert.deepEqual(finalCharts([message([spec]), message([])], ["q"]), []);
  assert.deepEqual(finalCharts([message([spec])], []), []);
  assert.match(buildAskSystemPrompt("自定义 {{table_count}}", 2), /^自定义 2[\s\S]*HTML\/SVG 图表/);
});

test("real Pi loop executes the chart presentation tool and restores its spec through run details", async () => {
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  const undo = [];
  const override = (object, key, value) => { const old = object[key]; object[key] = value; undo.push(() => { object[key] = old; }); };
  const run = { session: { ownerMemberNo: "test-member" }, id: "run", status: "RUNNING", tableIds: ["table"], modelConfigId: "model", thinkingLevel: "off", loopVersion: 0, startedAt: new Date(), nextMessageSequence: 0, nextEventSequence: 0 };
  const messages = [];
  const events = [];
  let calls = 0;
  let queryReads = 0;
  const model = { id: "mock", name: "Mock", provider: "openai", api: "openai-completions", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  try {
    override(prisma.askRunMessage, "findMany", async () => []);
    override(prisma.askRun, "findUniqueOrThrow", async () => run);
    override(prisma.askRun, "findUnique", async () => run);
    override(prisma.askRun, "update", async ({ data }) => { Object.assign(run, data); return run; });
    override(prisma.askSavedQueryResult, "findMany", async ({ where }) => {
      assert.equal(where.askRunId, "run");
      assert.deepEqual(where.queryExecutionId.in, ["q"]);
      queryReads++;
      return [{ queryExecutionId: "q", snapshot: saved() }];
    });
    const runtime = { model, runtime: { streamSimple: () => {
      const stream = createAssistantMessageEventStream();
      const first = ++calls === 1;
      const message = { role: "assistant", content: first ? [{ type: "toolCall", id: "present-1", name: "present_query_results", arguments: { query_ids: ["q"], charts: [spec] } }] : [{ type: "text", text: "已展示每日 GMV 折线图。" }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: first ? "toolUse" : "stop", timestamp: Date.now() };
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); });
      return stream;
    } } };
    const service = new AskRunService({ resolve: async () => ({ tableIds: ["table"], packages: new Map() }) }, { agentRuntime: async () => runtime }, {}, { publish: async (_, type, payload) => events.push({ type, payload }) }, { askPrompt: async () => ({ prompt: "测试" }) });
    service.messageHistory = async () => ({ messages: [], references: [] });
    service.recordMessage = async (_, content) => { messages.push({ id: "message-" + messages.length, sequence: messages.length + 1, createdAt: new Date(), role: content.role === "assistant" ? "ASSISTANT" : content.role === "toolResult" ? "TOOL" : "USER", content }); return messages.length; };
    await service.run("run", "画折线图", 0);
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(calls, 2);
    assert.equal(queryReads, 1);
    const presentation = messages.find((message) => message.content.toolName === "present_query_results");
    assert.deepEqual(presentation.content.details.charts, [spec]);
    const response = service.runResponse({ ...run, messages, events }, [{ queryExecutionId: "q", createdAt: new Date() }]);
    assert.deepEqual(response.final_query_ids, ["q"]);
    assert.deepEqual(response.charts, [spec]);
    assert.equal(response.processing.tool_count, 1);
    assert.match(response.processing.steps.find((step) => step.kind === "tool").summary, /1 张图表/);
    assert.equal(events.at(-1).payload.status, "SUCCEEDED");
  } finally { undo.reverse().forEach((restore) => restore()); }
});
