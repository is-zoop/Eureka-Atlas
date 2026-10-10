const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { completeToolHistory } = require("../dist/ask/ask-history");
const { AskRunService } = require("../dist/ask/ask-run.service");

const model = {
  id: "mock-codex", name: "Mock", provider: "openai-codex", api: "openai-codex-responses",
  reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const user = (content = "查询销售额") => ({ role: "user", content, timestamp: 1 });
const call = (id) => ({ type: "toolCall", id, name: "query_data", arguments: {} });
const assistant = (content, stopReason = "stop") => ({
  role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
  stopReason, timestamp: 2,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const answer = (text = "销售额为 10") => assistant([{ type: "text", text }]);
const result = (toolCallId, text = "10") => ({
  role: "toolResult", toolCallId, toolName: "query_data",
  content: [{ type: "text", text }], isError: false, timestamp: 3,
});
const round = (id = "call_1|fc_1") => [
  user(), assistant([call(id)], "toolUse"), result(id), answer(),
];
const size = (messages) => messages.reduce((total, message) => total + JSON.stringify(message).length, 0);
const replayableAskHistory = (groups) => groups.filter(completeToolHistory).flat();

test("history loading never deletes large valid rounds before summarization", () => {
  const old = [
    user(), assistant([{ type: "text", text: "a".repeat(25000) }, call("call_old|fc_old")], "toolUse"),
    result("call_old|fc_old", "b".repeat(50000)), answer(),
  ];
  const recent = [user("c".repeat(20000)), answer()];
  assert.ok(size(old) < 80000);
  assert.ok(size(old) + size(recent) > 80000);
  // The former message-by-message trimming retained this orphaned tool result.
  const broken = [...old, ...recent];
  let estimated = size(broken);
  while (estimated > 80000) estimated -= JSON.stringify(broken.shift()).length;
  assert.equal(broken[0].role, "toolResult");
  assert.deepEqual(replayableAskHistory([old, recent]), [...old, ...recent]);
});

test("preserves full multi-call batches and multiple tool turns without mutating persisted messages", () => {
  const first = [
    user(), assistant([call("one"), call("two")], "toolUse"),
    result("two"), result("one"),
    assistant([call("three")], "toolUse"), { ...result("three"), isError: true }, answer(),
  ];
  const groups = [first, round("four")];
  const original = structuredClone(groups);
  assert.deepEqual(replayableAskHistory(groups), groups.flat());
  assert.deepEqual(groups, original);
});

test("oversized rounds remain available to the summarizer instead of being silently skipped", () => {
  const first = round("first");
  const oversized = [user(), answer("a".repeat(80001))];
  const latest = round("latest");
  assert.deepEqual(replayableAskHistory([first, oversized, latest]), [...first, ...oversized, ...latest]);
  assert.deepEqual(replayableAskHistory([oversized]), oversized);
  assert.deepEqual(replayableAskHistory([[], first]), first);
});

test("excludes malformed tool histories as whole rounds, retaining valid surrounding context", () => {
  const valid = round("valid");
  const invalid = [
    [user(), result("orphan"), answer()],
    [user(), assistant([call("missing")], "toolUse"), answer()],
    [user(), assistant([call("unfinished")], "toolUse")],
    [user(), assistant([call("duplicate"), call("duplicate")], "toolUse"), result("duplicate")],
    [user(), assistant([call("twice")], "toolUse"), result("twice"), result("twice")],
    [user(), assistant([call("wrong-name")], "toolUse"), { ...result("wrong-name"), toolName: "other_tool" }],
    [user(), assistant([call("interrupted")], "toolUse"), user(), result("interrupted")],
    [user(), assistant([call("")], "toolUse"), result("")],
    ...["error", "aborted"].map((stop) => [user(), assistant([call(stop)], stop), result(stop), answer()]),
  ];
  for (const malformed of invalid) {
    assert.deepEqual(replayableAskHistory([malformed, valid]), valid);
    assert.deepEqual(replayableAskHistory([valid, malformed]), valid);
  }
});

test("session history keeps round boundaries and the existing table access restrictions", async () => {
  const original = prisma.askRun.findMany;
  const permitted = round("permitted");
  const outsideScope = round("outside");
  const malformed = [user(), result("orphan"), answer()];
  let reads = 0;
  prisma.askRun.findMany = async (query) => {
    reads++;
    assert.deepEqual(query.where, { askSessionId: "session", status: "SUCCEEDED" });
    assert.deepEqual(query.orderBy, [{ startedAt: "asc" }, { id: "asc" }]);
    assert.deepEqual(query.include.messages.orderBy, { sequence: "asc" });
    return [
      { id: "permitted", tableIds: ["allowed"], messages: permitted.map((content, i) => ({ content, sequence: i + 1 })), events: [] },
      { id: "outside", tableIds: ["forbidden"], messages: outsideScope.map((content, i) => ({ content, sequence: i + 1 })), events: [] },
      { id: "malformed", tableIds: ["allowed"], messages: malformed.map((content, i) => ({ content, sequence: i + 1 })), events: [] },
    ];
  };
  try {
    const service = new AskRunService({}, {}, {}, {}, {});
    assert.deepEqual(await service.messageHistory({ askSessionId: null }, { tableIds: ["allowed"] }), { messages: [], references: [] });
    assert.equal(reads, 0);
    const history = await service.messageHistory({ askSessionId: "session" }, { tableIds: ["allowed"] });
    assert.deepEqual(history.messages, permitted);
    assert.deepEqual(history.references, permitted.map((_, i) => ({ runId: "permitted", sequence: i + 1 })));
    assert.equal(reads, 1);
  } finally { prisma.askRun.findMany = original; }
});

test("actual Pi Responses serialization pairs every output, including cross-provider replay", async () => {
  const { convertResponsesMessages } = await import("@earendil-works/pi-ai/api/openai-responses-shared");
  const providers = new Set(["openai", "openai-codex", "azure-openai"]);
  for (const source of [
    { provider: model.provider, api: model.api, model: model.id },
    { provider: "deepseek", api: "openai-completions", model: "deepseek-chat" },
  ]) {
    const history = round().map((message) => message.role === "assistant" ? { ...message, ...source } : message);
    const malformed = [user(), result("call_orphan|fc_orphan"), answer()];
    const replay = replayableAskHistory([malformed, history]);
    const serialized = convertResponsesMessages(model, { messages: [...replay, user("按日期分组")] }, providers);
    const pending = new Set();
    let outputs = 0;
    for (const item of serialized) {
      if (item.type === "function_call") pending.add(item.call_id);
      if (item.type === "function_call_output") {
        assert.ok(pending.delete(item.call_id), "output must have a preceding matching function_call");
        assert.equal(item.output, "10");
        outputs++;
      }
    }
    assert.equal(outputs, 1);
    assert.equal(pending.size, 0);
  }
});
