require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../../.env") });
const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { AskRunService } = require("../dist/ask/ask-run.service");

test("database restores chart specs and archived data without live query or metadata dependencies", async () => {
  const memberNo = "integration-" + crypto.randomUUID();
  let session;
  const queryId = "chart-fixture-" + crypto.randomUUID();
  const chart = { query_id: queryId, type: "line", title: "归档趋势", x_column: 0, y_columns: [1] };
  const now = new Date().toISOString();
  const snapshot = { query_id: queryId, execution: { id: queryId, status: "SUCCEEDED", table_id: "removed-table", submitted_at: "2026-01-01T00:00:00.000Z", started_at: null, completed_at: now, elapsed_ms: 1, error: null, sql: "SELECT archived_data", content_version: "archived-version", snapshot_date: null, result: { columns: [{ id: "date", name: "日期", type: "STRING", unit: null }, { id: "metric", name: "金额", type: "DECIMAL", unit: "元" }], rows: [["20260101", "9007199254740993.123456789"], ["20260102", null]], truncated: false, result_bytes: 100 } }, source: { business_name: "已归档业务表", physical_name: "archived_sales", project: "original-project", catalog: "", schema: "" }, query_definition: { table_id: "removed-table", metric_ids: ["metric"], dimension_ids: ["date"] }, condition_changes: { inherited: [], changed: [] }, saved_at: now };
  try {
    session = await prisma.askSession.create({ data: { ownerMemberNo: memberNo, title: "[自动验收] HTML 图表", modelConfigId: "chart-fixture", tableIds: [] } });
    const run = await prisma.askRun.create({ data: { askSessionId: session.id, idempotencyKey: crypto.randomUUID(), question: "归档结果绘图", modelConfigId: "chart-fixture", tableIds: ["removed-table"] } });
    await prisma.askSavedQueryResult.create({ data: { askSessionId: session.id, askRunId: run.id, queryExecutionId: queryId, snapshot } });
    const service = new AskRunService({}, {}, {}, {}, {});
    const { Type } = await import("typebox");
    const tool = service.tools(run.id, memberNo, { abort: new AbortController(), guard: { totalTools: 1 } }, Type, { tableIds: [], packages: new Map() }).find((item) => item.name === "present_query_results");
    const presented = await tool.execute("present", { query_ids: [queryId], charts: [chart] });
    await service.recordMessage(run.id, { role: "assistant", content: [{ type: "toolCall", id: "present", name: "present_query_results", arguments: { query_ids: [queryId], charts: [chart] } }] });
    await service.recordMessage(run.id, { role: "toolResult", toolCallId: "present", toolName: "present_query_results", isError: false, content: presented.content, details: presented.details, timestamp: Date.now() });
    await prisma.askRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", answer: "已展示归档趋势", completedAt: new Date() } });
    const restored = new AskRunService({}, {}, {}, {}, {});
    const detail = await restored.detail(memberNo, run.id);
    assert.deepEqual(detail.charts, [chart]);
    assert.deepEqual(detail.final_query_ids, [queryId]);
    assert.equal(detail.processing.tool_count, 1);
    assert.deepEqual((await restored.listRuns(memberNo, session.id)).items[0].charts, [chart]);
    const result = await restored.queryResult(memberNo, run.id, queryId);
    assert.deepEqual(result, snapshot);
    await assert.rejects(restored.queryResult(memberNo, "another-run", queryId), error => error.getStatus() === 404);
    await assert.rejects(tool.execute("foreign", { query_ids: ["another-query"], charts: [{ ...chart, query_id: "another-query" }] }), /只能展示本轮/);
    assert.equal(await prisma.queryExecution.findUnique({ where: { id: queryId } }), null);
  } finally {
    if (session) await prisma.askSession.delete({ where: { id: session.id } });
    await prisma.$disconnect();
  }
});
