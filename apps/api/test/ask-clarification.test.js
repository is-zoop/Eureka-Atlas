const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { createClarification, answerClarification, readClarification } = require("../dist/ask/ask-clarification");
const { buildAskSystemPrompt } = require("../dist/ask/ask-prompt");
const input = (selection_mode = "multiple") => ({
  question: "请选择需要的指标",
  selection_mode,
  options: [{ summary: "收入", description: "销售收入，按店铺汇总" }, { summary: "利润", description: "实际利润，按店铺汇总" }],
});
const request = (selected_option_ids = [], custom_text = "") => ({ clarification_id: "c", selected_option_ids, custom_text });

test("clarification tool schema validates the real Pi protocol and rejects old or malformed options", async () => {
  const [{ Type }, { validateToolArguments }] = await Promise.all([import("typebox"), import("@earendil-works/pi-ai")]);
  const tool = new AskRunService({}, {}, {}, {}, {}).tools("run", "test-member", {}, Type, { tableIds: [], packages: new Map() }).find(t => t.name === "request_clarification");
  const validate = args => validateToolArguments(tool, { id: "tool-call", type: "toolCall", name: tool.name, arguments: args });
  assert.deepEqual(validate(input()), input());
  assert.deepEqual(validate({ ...input("single"), options: [] }).options, []);
  for (const invalid of [
    { question: "请选择", options: ["旧选项"] },
    { ...input(), selection_mode: "guess" },
    { ...input(), options: ["字符串"] },
    { ...input(), options: [{ summary: "摘要" }] },
    { ...input(), options: Array(9).fill(input().options[0]) },
    { ...input(), question: "" },
    { ...input(), unexpected: true },
  ]) assert.throws(() => validate(invalid), /Validation failed/);
});

test("server assigns A-H, accepts text-only questions, and validates nonblank option fields and mode", () => {
  const eight = createClarification("c", { ...input(), options: Array(8).fill(input().options[0]) });
  assert.deepEqual(eight.options.map(o => o.id), ["A","B","C","D","E","F","G","H"]);
  assert.equal(eight.selection_mode, "multiple");
  assert.equal(eight.response, null);
  assert.equal(eight.answer, null);
  assert.deepEqual(createClarification("c", { ...input("single"), options: [] }).options, []);
  for (const invalid of [
    { ...input(), question: " \n " }, { ...input(), selection_mode: null },
    { ...input(), options: null }, { ...input(), options: Array(9).fill(input().options[0]) },
    { ...input(), options: [{ summary: "  ", description: "范围" }] },
    { ...input(), options: [{ summary: "摘要", description: "" }] },
  ]) assert.throws(() => createClarification("c", invalid), /澄清/);
});

test("answers preserve card order and full business context for selection, custom text, or both", () => {
  const clarification = createClarification("c", input());
  const combined = answerClarification(clarification, request(["B", "A"], "  2026 年 8 月\n只看已确认店铺  "));
  assert.deepEqual(combined.response, { selected_option_ids: ["A", "B"], custom_text: "2026 年 8 月\n只看已确认店铺" });
  assert.equal(combined.answer, "所选选项：\nA. 收入： 销售收入，按店铺汇总\nB. 利润： 实际利润，按店铺汇总\n补充说明： 2026 年 8 月\n只看已确认店铺");
  assert.match(answerClarification(clarification, request(["B"])).answer, /实际利润/);
  assert.equal(answerClarification(clarification, request([], "自己的范围")).answer, "补充说明： 自己的范围");
  assert.equal(answerClarification(createClarification("c", { ...input(), options: [] }), request([], "2026 年")).answer, "补充说明： 2026 年");
  const saved = { ...clarification, ...combined };
  assert.deepEqual(readClarification(saved, "c"), saved);
});

test("unknown, duplicate, single-mode multiple, malformed and empty responses are rejected", () => {
  const multiple = createClarification("c", input());
  for (const invalid of [request(["X"]), request(["A", "A"]), request([], " \n "), request(null, "文字"), request([1]), request([], null)]) {
    assert.throws(() => answerClarification(multiple, invalid));
  }
  assert.throws(() => answerClarification(createClarification("c", input("single")), request(["A", "B"])), /单选/);
  assert.match(answerClarification(createClarification("c", input("single")), request(["B"])).answer, /B\. 利润/);
  assert.equal(readClarification({ question: "旧问题", options: ["旧项"], answer: null }, "c"), null);
});

async function withPending(check) {
  const saved = createClarification("c", input());
  const run = { session: { ownerMemberNo: "test-member" }, id: "run", status: "WAITING_CLARIFICATION", clarificationId: "c", clarification: saved, loopVersion: 1 };
  const oldFind = prisma.askRun.findUnique, oldUpdate = prisma.askRun.updateMany;
  const writes = [], resumed = [];
  prisma.askRun.findUnique = async () => ({ ...run });
  prisma.askRun.updateMany = async ({ where, data }) => {
    if (run.status !== where.status || run.clarificationId !== where.clarificationId) return { count: 0 };
    writes.push(data);
    Object.assign(run, data, { loopVersion: run.loopVersion + 1 });
    return { count: 1 };
  };
  const service = new AskRunService({}, {}, {}, { publish: async () => {} }, {});
  service.run = async (...args) => { resumed.push(args); };
  service.detail = async () => run;
  try { await check({ service, run, writes, resumed }); }
  finally { prisma.askRun.findUnique = oldFind; prisma.askRun.updateMany = oldUpdate; }
}

test("continue saves structured response and sends complete business answer with confirmed-condition instructions", async () => {
  await withPending(async ({ service, run, writes, resumed }) => {
    await service.clarify("test-member", "run", request(["B", "A"], "2026 年 8 月"));
    assert.equal(writes.length, 1);
    assert.equal(run.status, "RUNNING");
    assert.deepEqual(run.clarification.response, { selected_option_ids: ["A", "B"], custom_text: "2026 年 8 月" });
    assert.match(resumed[0][1], /收入.*销售收入/s);
    assert.match(resumed[0][1], /利润.*实际利润/s);
    assert.match(resumed[0][1], /2026 年 8 月/);
    assert.match(resumed[0][1], /保留此前已确认的表、日期、店铺真实名称和指标/);
    assert.equal(resumed[0][2], 2);
  });
});

test("invalid, stale, legacy and duplicate submissions do not resume a run", async () => {
  await withPending(async ({ service, run, writes, resumed }) => {
    await assert.rejects(service.clarify("test-member", "run", { ...request(["A"]), clarification_id: "stale" }), /失效/);
    await assert.rejects(service.clarify("test-member", "run", request(["unknown"])), /未知/);
    assert.equal(writes.length, 0);
    run.clarification = { question: "旧问题", options: ["旧选项"], answer: null };
    await assert.rejects(service.clarify("test-member", "run", request([], "自己的回答")), /旧格式/);
    assert.equal(resumed.length, 0);
    run.clarification = createClarification("c", input());
    const result = await Promise.allSettled([service.clarify("test-member", "run", request(["A"])), service.clarify("test-member", "run", request(["B"]))]);
    assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(writes.length, 1);
    assert.equal(resumed.length, 1);
  });
});

test("custom system prompts receive explicit clarification modes and mixed-conflict splitting rules", () => {
  const prompt = buildAskSystemPrompt("自定义提示词", 1);
  assert.match(prompt, /selection_mode.*single.*multiple/);
  assert.match(prompt, /拆成连续澄清/);
  assert.match(prompt, /不臆造表、指标或日期/);
  assert.match(prompt, /纯文字澄清传空数组/);
});

test("real Pi pauses for structured clarification then receives confirmed answer and archives response metadata", { timeout: 5000 }, async () => {
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
  const undo = [];
  const override = (obj, key, value) => { const old = obj[key]; obj[key] = value; undo.push(() => { obj[key] = old; }); };
  const run = { session: { ownerMemberNo: "test-member" }, id: "run", status: "RUNNING", loopVersion: 0, tableIds: ["table"], modelConfigId: "model", thinkingLevel: "off" };
  const saved = [];
  let modelCalls = 0, complete;
  const done = new Promise(resolve => { complete = resolve; });
  const model = { id: "mock", name: "Mock", provider: "openai", api: "openai-completions", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  try {
    override(prisma.askRunMessage, "findMany", async () => saved.map((content, i) => ({ content, sequence: i + 1, role: content.role === "assistant" ? "ASSISTANT" : content.role === "toolResult" ? "TOOL" : "USER" })));
    override(prisma.askRun, "findUniqueOrThrow", async () => ({ ...run }));
    override(prisma.askRun, "findUnique", async () => ({ ...run }));
    override(prisma.askRun, "update", async ({ data }) => { Object.assign(run, data); return { ...run }; });
    override(prisma.askRun, "updateMany", async ({ where, data }) => {
      if (run.status !== where.status || run.clarificationId !== where.clarificationId) return { count: 0 };
      Object.assign(run, data, { loopVersion: run.loopVersion + 1 }); return { count: 1 };
    });
    const runtime = { model, apiKey: "mock", runtime: { streamSimple: (_, context) => {
      const first = ++modelCalls === 1;
      if (!first) {
        const user = context.messages.at(-1);
        const text = typeof user.content === "string" ? user.content : user.content.map(p => p.text).join("");
        assert.match(text, /销售收入/); assert.match(text, /实际利润/); assert.match(text, /2026 年 8 月/);
        assert.ok(context.messages.some(m => m.role === "toolResult" && m.toolName === "request_clarification"));
      }
      const message = { role: "assistant", content: first ? [{ type: "toolCall", id: "clarify-call", name: "request_clarification", arguments: input() }] : [{ type: "text", text: "使用已确认的指标与日期继续。" }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: first ? "toolUse" : "stop", timestamp: Date.now() };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); });
      return stream;
    } } };
    const events = [];
    const service = new AskRunService({ resolve: async () => ({ tableIds: ["table"], packages: new Map() }) }, { agentRuntime: async () => runtime }, {}, { publish: async (_, type, payload) => { events.push({ type, payload }); if (type === "status" && payload.status === "SUCCEEDED") complete(); } }, { askPrompt: async () => ({ prompt: "测试提示词" }) });
    service.messageHistory = async () => ({ messages: [], references: [] });
    service.recordMessage = async (_, message) => { saved.push(message); return saved.length; };
    service.detail = async () => run;
    await service.run("run", "查询八月指标", 0);
    assert.equal(run.status, "WAITING_CLARIFICATION");
    assert.equal(modelCalls, 1);
    assert.equal(run.clarification.selection_mode, "multiple");
    assert.deepEqual(run.clarification.options.map(o => o.id), ["A", "B"]);
    assert.equal(events.find(e => e.type === "clarification").payload.id, run.clarificationId);
    await service.clarify("test-member", "run", { clarification_id: run.clarificationId, selected_option_ids: ["B", "A"], custom_text: "2026 年 8 月" });
    await done;
    await service.live.get("run")?.finished;
    assert.equal(modelCalls, 2);
    assert.equal(run.status, "SUCCEEDED");
    const recorded = saved.find(m => m.clarification_response);
    assert.deepEqual(recorded.clarification_response, { clarification_id: run.clarificationId, selected_option_ids: ["A", "B"], custom_text: "2026 年 8 月" });
    assert.match(run.answer, /已确认/);
  } finally { undo.reverse().forEach(fn => fn()); }
});
