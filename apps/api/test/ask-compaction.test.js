const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { AskContextCompactor } = require("../dist/ask/ask-compaction");
const { completeToolHistory } = require("../dist/ask/ask-history");
const { AskRunService } = require("../dist/ask/ask-run.service");

const model = {
  id: "mock-codex", name: "Mock", provider: "openai-codex", api: "openai-codex-responses",
  reasoning: true, input: ["text"], contextWindow: 16000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const user = (content = "查询9月GMV，按财务店铺分组") => ({ role: "user", content, timestamp: 1 });
const call = (id) => ({ type: "toolCall", id, name: "query_data", arguments: { metric: "GMV", table_id: "table" } });
const assistant = (content, stopReason = "stop") => ({
  role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
  stopReason, timestamp: 2,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const answer = (text = "GMV为10") => assistant([{ type: "text", text }]);
const result = (toolCallId, text = '{"query_id":"query-1","rows":[[10]]}') => ({
  role: "toolResult", toolCallId, toolName: "query_data",
  content: [{ type: "text", text }], isError: false, timestamp: 3,
});
const round = (id = "call_old|fc_old", large = false) => [
  user(), assistant([call(id)], "toolUse"),
  result(id, '{"query_id":"query-1","rows":"' + (large ? "x".repeat(60000) : "10") + '"}'), answer(),
];
const text = (message) => typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
const storedRound = (id, messages, events = [], tableIds = ["table"]) => ({
  id, tableIds, events, messages: messages.map((content, i) => ({ sequence: i + 1, content })),
});
const saved = (summary, runId, sequence, tableIds = ["table"]) => ({
  payload: { compaction: { summary, through_run_id: runId, through_sequence: sequence, table_ids: tableIds } },
});

async function setup(overrides = {}) {
  const core = await import("@earendil-works/pi-agent-core");
  const requests = []; const checkpoints = []; const starts = [];
  const models = {
    async completeSimple(requestModel, context, options) {
      assert.equal(this, models, "OAuth/provider runtime must retain its receiver");
      requests.push({ model: requestModel, context, options });
      return answer("## Goal\n9月GMV按店铺分组\n## Critical Context\ntable / query-1 / GMV=10\n已完成查询，后续按日期分析。");
    },
  };
  const compactor = new AskContextCompactor(core, {
    model, models, apiKey: "mock-key", headers: { "X-Request": "test" },
    systemPrompt: "只能读取授权的正式语义，不得编造查询结果。", tools: [],
    onStart: async () => { starts.push(true); },
    onComplete: async (value) => { checkpoints.push(value); },
    ...overrides,
  });
  return { compactor, requests, checkpoints, starts, core, models };
}

test("short conversations pass through unchanged and do not invoke the summarizer", async () => {
  const { compactor, requests, checkpoints } = await setup();
  const messages = [...round(), user("改成按日期分组")];
  assert.deepEqual(await compactor.transform(messages), messages);
  assert.equal(requests.length, 0);
  assert.equal(checkpoints.length, 0);
});

test("over-limit tool history becomes a real Pi summary while recent calls stay paired", async () => {
  const { compactor, requests, checkpoints } = await setup();
  const messages = [...round(undefined, true), ...round("call_recent|fc_recent"), user("按日期分组")];
  const original = structuredClone(messages);
  const replay = await compactor.transform(messages);
  assert.equal(requests.length, 1);
  assert.match(requests[0].context.systemPrompt, /context summarization assistant/);
  assert.equal(requests[0].context.messages.length, 1);
  assert.match(text(requests[0].context.messages[0]), /query_data\(metric="GMV", table_id="table"\)/);
  assert.match(text(requests[0].context.messages[0]), /query-1/);
  assert.match(text(requests[0].context.messages[0]), /2000|truncated/i);
  assert.match(text(replay[0]), /compacted.*summary/s);
  assert.match(text(replay[0]), /query-1/);
  assert.deepEqual(replay.slice(1), messages.slice(checkpoints[0].coveredCount));
  assert.equal(completeToolHistory(replay), true);
  assert.deepEqual(replay.at(-1), messages.at(-1));
  assert.ok(checkpoints[0].tokensAfter < checkpoints[0].tokensBefore);
  assert.equal(checkpoints[0].usage.length, 1);
  assert.deepEqual(messages, original);
  const options = requests[0].options;
  assert.equal(options.apiKey, "mock-key");
  assert.deepEqual(options.headers, { "X-Request": "test" });
  assert.equal(options.cacheRetention, "none");
  assert.equal(options.timeoutMs, 60000);
  assert.ok(options.sessionId);
  assert.equal(requests[0].model.id, model.id);
});

test("recent multi-tool results stay together even if the keep budget lands inside a batch", async () => {
  const { compactor, checkpoints } = await setup();
  const messages = [
    ...round(undefined, true), user("检查结果"),
    assistant([call("call_a|fc_a"), call("call_b|fc_b")], "toolUse"),
    result("call_b|fc_b", "b".repeat(24000)), result("call_a|fc_a", "a".repeat(24000)),
  ];
  const replay = await compactor.transform(messages);
  assert.equal(completeToolHistory(replay), true);
  assert.notEqual(messages[checkpoints[0].coveredCount]?.role, "toolResult");
});

test("rolling compaction updates the previous summary and does not regenerate it on each request", async () => {
  const { compactor, requests, checkpoints } = await setup();
  const messages = [...round(undefined, true), user("按日期分组")];
  await compactor.transform(messages);
  const firstCovered = checkpoints[0].coveredCount;
  const extended = [...messages, assistant([call("call_new|fc_new")], "toolUse"), result("call_new|fc_new", "z".repeat(60000))];
  const replay = await compactor.transform(extended);
  assert.equal(requests.length, 2);
  assert.match(text(requests[1].context.messages[0]), /<previous-summary>/);
  assert.match(text(requests[1].context.messages[0]), /9月GMV按店铺分组/);
  assert.ok(checkpoints[1].coveredCount > firstCovered);
  assert.equal(completeToolHistory(replay), true);
  // Reconstructing the same summary changes only its synthetic timestamp.
  const reloaded = await compactor.transform(extended);
  assert.deepEqual(reloaded.map(({ timestamp: _, ...message }) => message), replay.map(({ timestamp: _, ...message }) => message));
  assert.equal(requests.length, 2);
});

test("large existing sessions are summarized in bounded batches without dropping any prefix message", async () => {
  const { compactor, requests, checkpoints, core } = await setup();
  const messages = Array.from({ length: 24 }, (_, i) => [
    user("round-" + i + ": " + "fact ".repeat(2200)), answer("已确认 round-" + i),
  ]).flat();
  messages.push(user("继续汇总"));
  const replay = await compactor.transform(messages);
  assert.ok(requests.length > 1);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].usage.length, requests.length);
  const combined = requests.map((request) => text(request.context.messages[0])).join("\n");
  for (const message of messages.slice(0, checkpoints[0].coveredCount).filter((message) => message.role === "user")) {
    assert.ok(combined.includes(message.content));
  }
  for (const request of requests) {
    assert.ok(core.estimateTokens(request.context.messages[0]) + request.options.maxTokens < model.contextWindow);
    assert.equal(request.context.tools, undefined);
  }
  assert.deepEqual(replay.at(-1), messages.at(-1));
});

test("provider-reported usage triggers compaction even when the character estimate is small", async () => {
  const { compactor, requests } = await setup();
  const previous = answer("已读取数据");
  previous.usage = { ...previous.usage, input: 14000, totalTokens: 14001 };
  const messages = [user(), previous, user("继续")];
  const replay = await compactor.transform(messages);
  assert.equal(requests.length, 1);
  assert.equal(completeToolHistory(replay), true);
  await compactor.transform(messages);
  assert.equal(requests.length, 1, "stale usage must not repeatedly compact the same history");
});

test("model failures and empty or truncated summaries leave the original history intact", async () => {
  for (const response of [
    { ...answer(""), stopReason: "error", errorMessage: "mock failure" },
    answer("  "),
    { ...answer("incomplete"), stopReason: "length" },
    { ...answer(""), stopReason: "aborted" },
  ]) {
    const checkpoints = [];
    const models = { completeSimple: async () => response };
    const { compactor } = await setup({ models, onComplete: async (value) => checkpoints.push(value) });
    const messages = [...round(undefined, true), user("继续")];
    const original = structuredClone(messages);
    await assert.rejects(compactor.transform(messages), /压缩|摘要/);
    assert.deepEqual(messages, original);
    assert.equal(checkpoints.length, 0);
    models.completeSimple = async () => answer("完整摘要，query-1");
    assert.match(text((await compactor.transform(messages))[0]), /完整摘要/);
    assert.equal(checkpoints.length, 1);
  }
});

test("failed checkpoint persistence and cancellation do not advance the compaction boundary", async () => {
  const controller = new AbortController();
  const { compactor } = await setup({ models: { completeSimple: async () => { controller.abort(); return answer("summary"); } } });
  await assert.rejects(compactor.transform([...round(undefined, true), user("继续")], controller.signal));
  const aborted = new AbortController(); aborted.abort();
  const fresh = await setup();
  await assert.rejects(fresh.compactor.transform(round(), aborted.signal));
  assert.equal(fresh.requests.length, 0);
  let fail = true;
  const retry = await setup({ onComplete: async () => { if (fail) throw new Error("checkpoint write failed"); } });
  const messages = [...round(undefined, true), user("继续")];
  await assert.rejects(retry.compactor.transform(messages), /checkpoint write failed/);
  fail = false;
  await retry.compactor.transform(messages);
  assert.equal(retry.requests.length, 2);
  assert.doesNotMatch(text(retry.requests[1].context.messages[0]), /<previous-summary>/);
});

test("unpaired live tools and a single oversized question fail clearly rather than being discarded", async () => {
  const { compactor, requests } = await setup();
  const malformed = [...round(undefined, true), user(), result("call_orphan")];
  await assert.rejects(compactor.transform(malformed), /完整配对/);
  await assert.rejects(compactor.transform([user("x".repeat(60000))]), /当前问题/);
  assert.equal(requests.length, 0);
});

test("checkpoint reload after restart reuses its summary without another model call", async () => {
  const original = prisma.askRun.findMany;
  const messages = round(undefined, true);
  prisma.askRun.findMany = async () => [
    storedRound("old", messages, [saved("9月GMV，table，query-1", "old", 3)]),
  ];
  try {
    const history = await new AskRunService({}, {}, {}, {}, {}).messageHistory({ askSessionId: "session" }, { tableIds: ["table"] });
    assert.deepEqual(history.checkpoint, { summary: "9月GMV，table，query-1", coveredCount: 3 });
    const { compactor, requests } = await setup({ checkpoint: history.checkpoint });
    const replay = await compactor.transform([...history.messages, user("按日期分组")]);
    assert.match(text(replay[0]), /query-1/);
    assert.deepEqual(replay.slice(1), [messages[3], user("按日期分组")]);
    assert.equal(requests.length, 0);
  } finally { prisma.askRun.findMany = original; }
});

test("fresh provider usage still triggers compaction after restoring a checkpoint", async () => {
  const { compactor, requests, checkpoints } = await setup({ checkpoint: { summary: "已有摘要，query-1", coveredCount: 3 } });
  const messages = [...round(undefined, true), user("继续")];
  await compactor.transform(messages);
  assert.equal(requests.length, 0);
  const response = assistant([call("call_new")], "toolUse");
  response.usage = { ...response.usage, input: 14000, totalTokens: 14001 };
  await compactor.transform([...messages, response, result("call_new")]);
  assert.equal(requests.length, 1);
  assert.match(text(requests[0].context.messages[0]), /<previous-summary>/);
  assert.ok(checkpoints[0].coveredCount > 3);
});

test("checkpoint reload rejects changed scope, missing boundaries and boundaries inside a tool batch", async () => {
  const original = prisma.askRun.findMany;
  try {
    for (const checkpoint of [
      saved("wrong scope", "old", 3, ["table", "other"]),
      saved("missing", "removed", 3),
      saved("orphan result", "old", 2),
    ]) {
      prisma.askRun.findMany = async () => [storedRound("old", round(), [checkpoint])];
      const history = await new AskRunService({}, {}, {}, {}, {}).messageHistory({ askSessionId: "session" }, { tableIds: ["table"] });
      assert.equal(history.checkpoint, undefined);
      assert.deepEqual(history.messages, round());
    }
    prisma.askRun.findMany = async () => [
      storedRound("old", round(), [saved("good", "old", 3)]),
      storedRound("unauthorized", round("call_other"), [saved("secret", "old", 3)], ["other"]),
    ];
    const history = await new AskRunService({}, {}, {}, {}, {}).messageHistory({ askSessionId: "session" }, { tableIds: ["table"] });
    assert.equal(history.checkpoint.summary, "good");
  } finally { prisma.askRun.findMany = original; }
});

test("compacted transcript serializes matching function calls and outputs for Codex", async () => {
  const { convertResponsesMessages } = await import("@earendil-works/pi-ai/api/openai-responses-shared");
  const { compactor } = await setup();
  const messages = [...round(undefined, true), ...round("call_recent|fc_recent"), user("继续")];
  const replay = await compactor.transform(messages);
  const input = convertResponsesMessages(model, { messages: replay }, new Set(["openai-codex", "openai"]));
  const pending = new Set();
  let outputs = 0;
  for (const item of input) {
    if (item.type === "function_call") pending.add(item.call_id);
    if (item.type === "function_call_output") {
      assert.ok(pending.delete(item.call_id));
      outputs++;
    }
  }
  assert.equal(outputs, 1);
  assert.equal(pending.size, 0);
});

test("real Pi run compacts mid-tool-loop, persists exact boundaries, and restores them next round", async () => {
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  const undo = [];
  const override = (object, key, value) => {
    const original = object[key]; object[key] = value;
    undo.push(() => { object[key] = original; });
  };
  const old = round(undefined, true);
  const stored = []; const events = []; const contexts = [];
  const run = { session: { ownerMemberNo: "test-member" }, id: "live", askSessionId: "session", status: "RUNNING", tableIds: ["table"], modelConfigId: "model", thinkingLevel: "off", loopVersion: 0 };
  let summaries = 0;
  const models = {
    completeSimple: async (_, context) => {
      assert.match(context.systemPrompt, /context summarization assistant/);
      summaries++;
      return answer("9月GMV按日期分析；table；query-1；query-live；已执行查询，请总结结果。");
    },
    streamSimple: (_, context) => {
      contexts.push(context);
      assert.equal(completeToolHistory(context.messages), true);
      const first = contexts.length === 1;
      const message = first ? assistant([call("call_live|fc_live")], "toolUse") : answer("最终结果：GMV为10。");
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end();
      });
      return stream;
    },
  };
  try {
    override(prisma.askRunMessage, "findMany", async () => []);
    override(prisma.askRun, "findUniqueOrThrow", async () => run);
    override(prisma.askRun, "findUnique", async () => run);
    override(prisma.askRun, "update", async ({ data }) => { Object.assign(run, data); return run; });
    const service = new AskRunService(
      { resolve: async () => ({ tableIds: ["table"], packages: new Map() }) },
      { agentRuntime: async () => ({ model, runtime: models, apiKey: "mock" }) },
      {}, { publish: async (_, type, payload) => { events.push({ type, payload }); } },
      { askPrompt: async () => ({ prompt: "请仅查询授权表。", defaultPrompt: "", customized: true }) },
    );
    service.messageHistory = async () => ({
      messages: old, references: old.map((_, i) => ({ runId: "old", sequence: i + 1 })),
    });
    service.recordMessage = async (_, message) => { stored.push(message); return stored.length; };
    service.tools = () => [{
      name: "query_data", description: "mock query", parameters: { type: "object", properties: {} },
      execute: async () => ({
        content: [{ type: "text", text: '{"query_id":"query-live","rows":"' + "z".repeat(80000) + '"}' }],
        details: { row_count_returned: 1, result_complete: true },
      }),
    }];
    await service.run("live", "改为按日期分组", 0);
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(run.answer, "最终结果：GMV为10。");
    assert.equal(summaries, 2);
    assert.equal(contexts.length, 2);
    const checkpoints = events.filter((event) => event.payload.compaction);
    assert.equal(checkpoints.length, 2);
    assert.equal(checkpoints[0].payload.compaction.through_run_id, "old");
    assert.equal(checkpoints[0].payload.compaction.through_sequence, 3);
    assert.equal(checkpoints[1].payload.compaction.through_run_id, "live");
    assert.equal(checkpoints[1].payload.compaction.through_sequence, 3);
    assert.equal(stored.length, 4, "summaries must not replace the persisted original transcript");
    override(prisma.askRun, "findMany", async () => [
      storedRound("old", old), storedRound("live", stored, checkpoints),
    ]);
    const restored = await new AskRunService({}, {}, {}, {}, {}).messageHistory({ askSessionId: "session" }, { tableIds: ["table"] });
    assert.equal(restored.checkpoint.coveredCount, 7);
    const { compactor, requests } = await setup({ checkpoint: restored.checkpoint });
    const replay = await compactor.transform([...restored.messages, user("再看利润")]);
    assert.match(text(replay[0]), /query-live/);
    assert.equal(text(replay.at(-1)), "再看利润");
    assert.equal(requests.length, 0);
  } finally { undo.reverse().forEach((restore) => restore()); }
});
