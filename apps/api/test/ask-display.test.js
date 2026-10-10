
const assert = require("node:assert/strict");
const test = require("node:test");
const { processingDetails, toolSummary } = require("../dist/ask/ask-processing");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { AskController } = require("../dist/ask/ask.controller");

const step = (id, status = "RUNNING") => ({
  id, message_id: "assistant-1", tool_call_id: id, kind: "tool", name: "执行查询",
  status, summary: "正在处理", started_at: "2026-09-30T00:00:00.000Z",
  completed_at: null, elapsed_ms: null,
});
test("processing counts unique calls rather than polling and includes safe summaries only", () => {
  const details = processingDetails(4, [
    { type: "processing", payload: { step: step("call-1") } },
    ...Array.from({ length: 20 }, () => ({ type: "progress", payload: { query_id: "q", status: "RUNNING" } })),
    { type: "processing", payload: { step: { ...step("call-1", "SUCCEEDED"), summary: "已保存 1 行结果", elapsed_ms: 1000 } } },
  ], "SUCCEEDED", new Date());
  assert.equal(details.tool_count, 1);
  assert.equal(details.message_count, 4);
  assert.equal(details.steps[0].status, "SUCCEEDED");
  assert.equal(details.steps[0].elapsed_ms, 1000);
  assert.equal(toolSummary("query_data", { row_count_returned: 51, result_complete: false, rows: [["secret"]], thinking: "private" }, false), "已保存 51 行结果（返回结果已截断）");
  assert.equal(toolSummary("get_semantic_package", { credential: "secret" }, false).includes("secret"), false);
});
test("interrupted processing cannot remain running in terminal history", () => {
  const details = processingDetails(2, [{ type: "processing", payload: { step: step("x") } }], "INTERRUPTED", new Date("2026-09-30"));
  assert.equal(details.steps[0].status, "FAILED");
  assert.equal(processingDetails(0, [], "SUCCEEDED", null).tool_count, 0);
});
test("model snapshots survive mutable model configuration and old runs are explicit", () => {
  const service = new AskRunService({}, {}, {}, {}, {});
  const run = { session: { ownerMemberNo: "test-member" }, id: "run", status: "SUCCEEDED", modelConfigId: "removed-model", modelDisplayName: "原模型", modelProviderName: "原供应商", thinkingLevel: "off", tableIds: [], nextMessageSequence: 0, nextEventSequence: 3, startedAt: new Date(), completedAt: new Date() };
  const response = service.runResponse(run);
  assert.equal(response.model_display_name, "原模型");
  assert.equal(response.model_provider_name, "原供应商");
  assert.equal(response.event_cursor, 3);
  assert.equal(service.runResponse({ ...run, modelDisplayName: null, modelProviderName: null }).model_display_name, null);
});
test("SSE replay precedes concurrent live events and reconnect honors Last-Event-ID", async () => {
  let listener; let resume;
  const messages = [];
  const event = (sequence) => ({ sequence, type: "status", payload: {}, created_at: new Date().toISOString() });
  const events = {
    subscribe: (_, receive) => { listener = receive; return () => {}; },
    after: (_, cursor) => { resume = cursor; listener(event(9)); return Promise.resolve([event(8), event(9)]); },
  };
  const controller = new AskController({ assertRunOwnership: async () => {}, detail: async () => ({}) }, events, {}, { authenticate: async () => ({}) });
  let close;
  await controller.stream("run", "5", { authUser: { member_no: "test-member" }, headers: { "last-event-id": "7" } }, { on: (_, fn) => { close = fn; }, setHeader: () => {}, flushHeaders: () => {}, write: (text) => messages.push(text), end: () => {} });
  close();
  assert.equal(resume, 7);
  assert.deepEqual(messages.map((text) => Number(text.match(/id: (\d+)/)[1])), [8, 9]);
});

test("real Pi loop records separate assistant IDs and drains tool/message events before success", async () => {
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  const { prisma } = require("@eureka-atlas/database");
  const undo = [];
  const override = (object, key, value) => { const old = object[key]; object[key] = value; undo.push(() => { object[key] = old; }); };
  const run = { session: { ownerMemberNo: "test-member" }, id: "mock-run", status: "RUNNING", tableIds: ["table"], modelConfigId: "model", thinkingLevel: "off", loopVersion: 0 };
  const stored = [];
  const events = [];
  let modelCalls = 0;
  const model = { id: "mock", name: "Mock", provider: "openai", api: "openai-completions", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  try {
    override(prisma.askRunMessage, "findMany", async () => []);
    override(prisma.askRun, "findUniqueOrThrow", async () => run);
    override(prisma.askRun, "findUnique", async () => run);
    override(prisma.askRun, "update", async ({ data }) => { Object.assign(run, data); return run; });
    const runtime = {
      model, apiKey: "mock", runtime: { streamSimple: (_model, context) => {
        assert.ok(context.systemPrompt.startsWith("测试自定义问数提示词，1 张表")); assert.match(context.systemPrompt, /本次运行支持 HTML\/SVG 图表/);
        const stream = createAssistantMessageEventStream();
        const first = ++modelCalls === 1;
        const text = first ? "这是中间步骤，不是最终回答。" : "最终回答：销售额为 10。";
        const message = { role: "assistant", content: [{ type: "text", text }, ...(first ? [{ type: "toolCall", id: "call-1", name: "query_data", arguments: {} }] : [])], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: first ? "toolUse" : "stop", timestamp: Date.now() };
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
          stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
        });
        return stream;
      } },
    };
    const service = new AskRunService({ resolve: async () => ({ tableIds: ["table"], packages: new Map() }) }, { agentRuntime: async () => runtime }, {}, { publish: async (_, type, payload) => { await new Promise((resolve) => setTimeout(resolve, 1)); events.push({ type, payload }); } }, { askPrompt: async () => ({ prompt: "测试自定义问数提示词，{{table_count}} 张表" }) });
    service.messageHistory = async () => ({ messages: [], references: [] });
    service.recordMessage = async (_, message) => { stored.push(message); return stored.length; };
    service.tools = () => [{ name: "query_data", description: "mock", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "ok" }], details: { row_count_returned: 1, result_complete: true } }) }];
    await service.run(run.id, "查询销售额", 0);
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(run.answer, "最终回答：销售额为 10。");
    assert.equal(modelCalls, 2);
    const ends = events.filter((event) => event.type === "answer" && event.payload.phase === "end");
    assert.equal(ends.length, 2);
    assert.equal(ends[0].payload.intermediate, true);
    assert.notEqual(ends[0].payload.message_id, ends[1].payload.message_id);
    assert.equal(events.at(-1).payload.status, "SUCCEEDED");
    const details = processingDetails(stored.length, events, run.status, new Date());
    assert.equal(details.tool_count, 1);
    assert.equal(details.steps.find((entry) => entry.kind === "tool").status, "SUCCEEDED");
  } finally { undo.reverse().forEach((fn) => fn()); }
});
