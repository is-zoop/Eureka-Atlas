const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { completeToolHistory } = require("../dist/ask/ask-history");

const model = { id: "mock", name: "Mock", provider: "openai", api: "openai-completions", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const assistant = (content, stopReason = "stop") => ({ role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason, timestamp: Date.now() });
const call = (id, args = {}, name = "search_semantic_assets") => ({ type: "toolCall", id, name, arguments: args });
const user = (content) => ({ role: "user", content, timestamp: Date.now() });
const result = (id, text = "已确认表 table、2026年8月、ELLE女装旗舰店-日常", name = "search_semantic_assets") => ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError: false, timestamp: Date.now() });
const prior = (count) => [user("查询 ELLE女装旗舰店 8月的天猫流量来源所有指标"), ...Array.from({ length: count }, (_, i) => [assistant([call("prior-" + i)], "toolUse"), result("prior-" + i)]).flat()];

async function withRun(previous, plan, check) {
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  const undo = [];
  const override = (object, key, value) => { const old = object[key]; object[key] = value; undo.push(() => { object[key] = old; }); };
  const run = { session: { ownerMemberNo: "test-member" }, id: "mock-run", status: "RUNNING", tableIds: ["table"], modelConfigId: "model", thinkingLevel: "off", loopVersion: 1 };
  const stored = [...previous];
  const events = [];
  let calls = 0;
  let executions = 0;
  let timeout;
  try {
    override(prisma.askRunMessage, "findMany", async () => previous.map((content, i) => ({ sequence: i + 1, role: content.role === "assistant" ? "ASSISTANT" : content.role === "toolResult" ? "TOOL" : "USER", content })));
    override(prisma.askRun, "findUniqueOrThrow", async () => run);
    override(prisma.askRun, "findUnique", async () => run);
    override(prisma.askRun, "update", async ({ data }) => { Object.assign(run, data); return run; });
    const originalTimeout = global.setTimeout;
    override(global, "setTimeout", (fn, ms, ...args) => {
      if (ms === 15 * 60 * 1000) timeout = fn;
      return originalTimeout(fn, ms, ...args);
    });
    const runtime = { model, apiKey: "mock", runtime: { streamSimple: (_model, context, options) => {
      const message = plan({ callNumber: ++calls, context, options, run, timeout });
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); });
      return stream;
    } } };
    const scope = { tableIds: ["table"], packages: new Map([["table", { table: { data_domain: "销售管理" } }]]) };
    const service = new AskRunService({ resolve: async () => scope }, { agentRuntime: async () => runtime }, {}, { publish: async (_, type, payload) => { events.push({ type, payload }); } }, { askPrompt: async () => ({ prompt: "测试提示词" }) });
    service.messageHistory = async () => ({ messages: [], references: [] });
    service.recordMessage = async (_, message) => { stored.push(message); return stored.length; };
    service.tools = () => [{ name: "search_semantic_assets", description: "mock", parameters: { type: "object", properties: { index: { type: "integer" } }, additionalProperties: false }, execute: async () => { executions++; return { content: [{ type: "text", text: "empty" }], details: { items: [], total: 0 } }; } }];
    await service.run(run.id, "用户对年份澄清的回答：2026年，请继续", 1);
    await check({ run, stored, events, calls, executions });
    assert.equal(service.live.size, 0);
  } finally { undo.reverse().forEach((fn) => fn()); }
}

const paired = (messages) => {
  const calls = new Set();
  for (const message of messages) {
    if (message.role === "assistant") for (const part of message.content) if (part.type === "toolCall") calls.add(part.id);
    if (message.role === "toolResult") assert.ok(calls.delete(message.toolCallId), "no orphaned function_call_output");
  }
  assert.equal(calls.size, 0);
};

test("real Pi clarification resumes the current run's tools and confirmed values, past the former 12-call limit", async () => {
  const previous = prior(12);
  await withRun(previous, ({ context }) => {
    assert.deepEqual(context.messages.slice(0, previous.length), previous);
    assert.match(JSON.stringify(context.messages), /ELLE女装旗舰店-日常/);
    assert.match(context.systemPrompt, /真实数据域.*销售管理/);
    return assistant([{ type: "text", text: "已复用本轮语义和候选值。" }]);
  }, ({ run, stored, calls }) => {
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(calls, 1);
    assert.ok(completeToolHistory(stored));
    paired(stored);
  });
});

test("native Pi repetition warnings reach the model, fourth identical call is blocked with a clear reason", async () => {
  await withRun([], ({ callNumber, context }) => {
    if (callNumber === 4) assert.match(JSON.stringify(context.messages), /连续 3 次.*再次原样调用将停止/);
    return assistant([call("repeat-" + callNumber)], "toolUse");
  }, ({ run, executions, calls, stored, events }) => {
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /search_semantic_assets.*无新进展/);
    assert.equal(executions, 3);
    assert.equal(calls, 4);
    paired(stored);
    assert.equal(events.at(-1).payload.status, "FAILED");
    assert.match(events.find((event) => event.type === "error").payload.message, /无新进展/);
  });
});

test("model budget halts before a 25th provider request, not as user cancellation", async () => {
  await withRun([], ({ callNumber }) => assistant([call("model-" + callNumber, { index: callNumber })], "toolUse"), ({ run, executions, calls, stored }) => {
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /模型调用上限.*24 次/);
    assert.equal(calls, 24);
    assert.equal(executions, 24);
    paired(stored);
  });
});

test("failed schema validation also counts toward repetition protection, without executing queries", async () => {
  await withRun([], ({ callNumber }) => assistant([call("invalid-" + callNumber, { index: "invalid" })], "toolUse"), ({ run, executions, calls, stored }) => {
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /无新进展/);
    assert.equal(executions, 0);
    assert.equal(calls, 4);
    paired(stored);
  });
});

test("a model that corrects parameters after the warning can complete normally", async () => {
  await withRun([], ({ callNumber }) => callNumber === 5
    ? assistant([{ type: "text", text: "已更正参数并完成。" }])
    : assistant([call("correct-" + callNumber, callNumber === 4 ? { index: 1 } : {})], "toolUse"), ({ run, executions, calls, stored }) => {
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(executions, 4);
    assert.equal(calls, 5);
    assert.ok(completeToolHistory(stored));
    paired(stored);
  });
});

test("tool budget counts full batches and pairs blocked outputs without extra executions", async () => {
  await withRun([], () => assistant(Array.from({ length: 50 }, (_, i) => call("batch-" + i, { index: i })), "toolUse"), ({ run, executions, calls, stored }) => {
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /工具调用上限.*48 次/);
    assert.equal(calls, 1);
    assert.equal(executions, 48);
    assert.equal(stored.filter((item) => item.role === "toolResult").length, 50);
    paired(stored);
  });
});

test("whole-run model budget survives resumed clarification", async () => {
  await withRun(prior(59), ({ callNumber }) => assistant([call("total-" + callNumber, { index: callNumber })], "toolUse"), ({ run, calls, stored }) => {
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /整轮模型调用上限.*60 次/);
    assert.equal(calls, 1);
    paired(stored);
  });
});

test("whole-run tool budget survives resumed clarification", async () => {
  const previous = [user("查询"), assistant(Array.from({ length: 119 }, (_, i) => call("previous-batch-" + i)), "toolUse"), ...Array.from({ length: 119 }, (_, i) => result("previous-batch-" + i))];
  await withRun(previous, () => assistant([call("new-120", { index: 120 }), call("new-121", { index: 121 })], "toolUse"), ({ run, calls, executions, stored }) => {
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /整轮工具调用上限.*120 次/);
    assert.equal(calls, 1);
    assert.equal(executions, 1);
    paired(stored);
  });
});

test("malformed current-round replay fails clearly instead of resending orphaned outputs", async () => {
  await withRun([user("查询"), result("orphan")], () => { throw new Error("must not call provider"); }, ({ run, calls }) => {
    assert.equal(calls, 0);
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /澄清上下文.*不完整/);
  });
});

test("active-segment timeout aborts the provider signal and exposes timeout rather than generic aborted", async () => {
  await withRun([], ({ timeout, options }) => {
    timeout();
    assert.equal(options.signal.aborted, true);
    return { ...assistant([], "aborted"), errorMessage: "This operation was aborted" };
  }, ({ run }) => {
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /15 分钟查询超时/);
    assert.doesNotMatch(run.error, /This operation was aborted/);
  });
});

test("provider aborts are failures; explicit user cancellation is not rewritten as a failure", async () => {
  await withRun([], () => ({ ...assistant([], "aborted"), errorMessage: "provider aborted" }), ({ run }) => {
    assert.equal(run.status, "FAILED");
    assert.equal(run.error, "provider aborted");
  });
  await withRun([], ({ run }) => {
    run.status = "CANCELLED";
    return { ...assistant([], "aborted"), errorMessage: "This operation was aborted" };
  }, ({ run, events }) => {
    assert.equal(run.status, "CANCELLED");
    assert.equal(run.error, undefined);
    assert.equal(events.some((event) => event.type === "error"), false);
  });
});
