const test = require("node:test");
const assert = require("node:assert/strict");
const { AskExecutionGuard, ASK_EXECUTION_LIMITS: limits } = require("../dist/ask/ask-execution-guard");

test("fresh execution segments have 24/48 budgets, independent of previous clarification segments", () => {
  const guard = new AskExecutionGuard(12, 20);
  for (let i = 0; i < limits.segmentModels; i++) guard.modelStarted();
  assert.equal(guard.reason, null);
  guard.modelStarted();
  assert.match(guard.reason, /本次执行段.*24 次/);
  const tools = new AskExecutionGuard(12, 20);
  for (let i = 0; i < limits.segmentTools; i++) tools.toolStarted("query_data", { i });
  assert.equal(tools.reason, null);
  tools.toolStarted("query_data", {});
  assert.match(tools.reason, /本次执行段.*48 次/);
});

test("clarification resets segment counters but preserves the 60/120 whole-run budgets", () => {
  const model = new AskExecutionGuard(59, 0);
  model.modelStarted();
  assert.equal(model.reason, null);
  model.modelStarted();
  assert.match(model.reason, /整轮.*60 次/);
  const tools = new AskExecutionGuard(0, 119);
  tools.toolStarted("query_data", {});
  assert.equal(tools.reason, null);
  tools.toolStarted("query_data", {});
  assert.match(tools.reason, /整轮.*120 次/);
});

const repeat = (guard, args, details, isError = false, name = "search_semantic_assets") => {
  guard.toolStarted(name, args);
  return guard.toolFinished(name, args, { details }, isError);
};

test("three identical calls warn, the fourth is stopped, including validation errors", () => {
  for (const isError of [false, true]) {
    const guard = new AskExecutionGuard();
    const args = { keywords: ["流量"], data_domain: "销售管理" };
    const result = { items: [], total: 0 };
    assert.equal(repeat(guard, args, result, isError), undefined);
    assert.equal(repeat(guard, { data_domain: "销售管理", keywords: ["流量"] }, result, isError), undefined);
    assert.match(repeat(guard, args, result, isError), /连续 3 次/);
    assert.equal(guard.reason, null);
    guard.toolStarted("search_semantic_assets", args);
    assert.match(guard.reason, /相同参数连续重复且无新进展/);
  }
});

test("changed arguments, returned data, tool or error state reset no-progress detection", () => {
  const variants = [
    [{ keywords: ["店铺"] }, { total: 0 }, false, "search_semantic_assets"],
    [{ keywords: ["流量"] }, { total: 1 }, false, "search_semantic_assets"],
    [{ keywords: ["流量"] }, { total: 0 }, true, "search_semantic_assets"],
    [{ keywords: ["流量"] }, { total: 0 }, false, "get_semantic_package"],
    [{ keywords: ["流量"] }, { total: 0 }, false, "request_clarification"],
  ];
  for (const variant of variants) {
    const guard = new AskExecutionGuard();
    repeat(guard, { keywords: ["流量"] }, { total: 0 });
    repeat(guard, { keywords: ["流量"] }, { total: 0 });
    assert.equal(repeat(guard, ...variant), undefined);
    assert.equal(guard.reason, null);
  }
});

test("new query IDs alone are not progress, but new rows are", () => {
  const guard = new AskExecutionGuard();
  for (let i = 0; i < 3; i++) {
    const warning = repeat(guard, { table_id: "table" }, { query_id: "query-" + i, rows: [[10]], row_count_returned: 1 }, false, "query_data");
    assert.equal(Boolean(warning), i === 2);
  }
  const progressing = new AskExecutionGuard();
  for (let i = 0; i < 4; i++) {
    assert.equal(repeat(progressing, {}, { rows: [[i]], query_id: "q" + i }, false, "get_dimension_values"), undefined);
  }
  assert.equal(progressing.reason, null);
});

test("timeout is explicit and the first stop reason cannot be overwritten", () => {
  const guard = new AskExecutionGuard();
  guard.timedOut();
  assert.match(guard.reason, /15 分钟.*等待用户澄清.*不计入/);
  const reason = guard.reason;
  guard.stop("another reason");
  guard.modelStarted();
  guard.toolStarted("query_data", {});
  assert.equal(guard.reason, reason);
});

test("different validation failures are progress even when the SDK returns empty details", () => {
  const guard = new AskExecutionGuard();
  for (const text of ["missing date", "missing date", "bad operator", "bad operator"]) {
    guard.toolStarted("query_data", {});
    assert.equal(guard.toolFinished("query_data", {}, { details: {}, content: [{ type: "text", text }] }, true), undefined);
  }
  assert.equal(guard.reason, null);
});
