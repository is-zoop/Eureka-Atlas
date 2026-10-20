const test = require("node:test"), assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { QueryExecutionService } = require("../dist/query/query-execution.service");
const { ExternalLimitsService } = require("../dist/external-api/external-limits");
const { ExternalDataService } = require("../dist/external-api/external-data.service");
const { ConflictException } = require("@nestjs/common");
async function fixture(run) {
  const original = prisma.queryExecution, rows = new Map(); let seq = 0, submits = 0, version = "v1", remote = "RUNNING";
  prisma.queryExecution = {
    findUnique: async ({ where }) => where.id ? rows.get(where.id) || null : [...rows.values()].find(row => row.ownerMemberNo === where.ownerMemberNo_idempotencyKey.ownerMemberNo && row.idempotencyKey === where.ownerMemberNo_idempotencyKey.idempotencyKey) || null,
    count: async ({ where }) => [...rows.values()].filter(row => row.ownerMemberNo === where.ownerMemberNo && row.kind === where.kind && where.status.in.includes(row.status)).length,
    create: async ({ data }) => { const row = { ...data, id: "q" + ++seq, submittedAt: new Date(), startedAt: null, completedAt: null, status: "PENDING", result: null, error: null }; rows.set(row.id, row); return row; },
    update: async ({ where, data }) => Object.assign(rows.get(where.id), data),
  };
  const queries = new QueryExecutionService({}, {}, { compileQuery: () => ({ sql: "SELECT SUM(amount) FROM sales", outputs: [], limit: 100 }), compileDimensionValues: () => ({ sql: "SELECT DISTINCT shop FROM sales", outputs: [], limit: 50 }) });
  queries.resolveSnapshot = async () => null;
  queries.clientFor = async () => ({ submitSql: async () => { submits++; return "remote"; }, getInstance: async () => ({ status: remote }), cancelInstance: async () => {} });
  queries.projectFor = async () => "dw";
  const scope = { search: async () => ({ items: [], total: 0 }), queryablePackage: async (id, expected) => { assert.equal(id, "table"); if (expected !== undefined && expected !== version) throw new ConflictException(); return { table: { id }, source: { type: "MAXCOMPUTE", id: "source", project: "dw" }, content_version: version }; } };
  const service = new ExternalDataService(scope, queries, new ExternalLimitsService());
  try { await run({ service, queries, rows, setVersion: value => { version = value; }, setRemote: value => { remote = value; }, submits: () => submits }); } finally { prisma.queryExecution = original; }
}
const input = { table_id: "table", metric_ids: ["amount"], content_version: "v1", idempotency_key: "request-1" };
test("external queries return tasks immediately, preserve idempotency and do not expose results in status", async () => fixture(async ({ service, rows, setVersion, submits }) => {
  const task = await service.submit("A", input); assert.equal(task.status, "RUNNING"); assert.equal(task.result, undefined); assert.ok(task.expires_at); assert.equal(submits(), 1);
  setVersion("v2"); assert.equal((await service.submit("A", input)).id, task.id); assert.equal(submits(), 1);
  await assert.rejects(service.submit("A", { ...input, limit: 10 }), e => e.getStatus() === 409);
  await assert.rejects(service.submit("A", { ...input, idempotency_key: "request-2" }), e => e.getStatus() === 409); assert.equal(submits(), 1);
  const row = rows.get(task.id); row.status = "SUCCEEDED"; row.result = { columns: [{ id: "amount", name: "金额", type: "DECIMAL", unit: "元" }], rows: Array.from({ length: 150 }, () => ["12345678901234567890.12", null]), truncated: false, result_bytes: 8000 };
  assert.equal((await service.status("A", task.id)).result, undefined);
  const result = await service.result("A", task.id); assert.equal(result.result.rows.length, 150); assert.equal(result.result.rows[0][0], "12345678901234567890.12");
  row.expiresAt = new Date(0); await assert.rejects(service.result("A", task.id), e => e.getStatus() === 410);
}));
test("task state, results, cancellation and idempotency remain owner-scoped across credentials", async () => fixture(async ({ service, rows }) => {
  const a = await service.submit("A", input), b = await service.submit("B", input); assert.notEqual(a.id, b.id);
  for (const method of ["status", "result", "cancel"]) await assert.rejects(service[method]("B", a.id), e => e.getStatus() === 404);
  await assert.rejects(service.result("A", a.id), e => e.getStatus() === 409);
  rows.get(a.id).kind = "DATA_QUERY";
  await assert.rejects(service.status("A", a.id), e => e.getStatus() === 404);
}));
test("dimension queries use the same async lifecycle; cancellation and timeout are preserved", async () => fixture(async ({ service, rows, setRemote }) => {
  const task = await service.submit("A", { table_id: "table", field_id: "shop", content_version: "v1", idempotency_key: "values" }, true);
  assert.match(task.sql, /DISTINCT/);
  assert.equal((await service.cancel("A", task.id)).status, "CANCELLING");
  setRemote("CANCELLED"); assert.equal((await service.status("A", task.id)).status, "CANCELLED");
  const timed = await service.submit("A", { ...input, idempotency_key: "timeout" });
  const row = rows.get(timed.id); row.submittedAt = new Date(Date.now() - 11 * 60 * 1000);
  assert.equal((await service.status("A", timed.id)).status, "TIMED_OUT");
}));
