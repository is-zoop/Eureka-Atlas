const assert = require("node:assert/strict");
const test = require("node:test");
const { GovernanceService } = require("../dist/governance/governance.service");
const { prisma } = require("@eureka-atlas/database");

const originals = { metaTable: prisma.metaTable, metaColumn: prisma.metaColumn, governanceTask: prisma.governanceTask, aiColumnSuggestion: prisma.aiColumnSuggestion, columnSemantic: prisma.columnSemantic, semanticPackage: prisma.semanticPackage };
const restore = () => Object.assign(prisma, originals);
const activeTable = { id: "table-1" };

test("creates repeated governance tasks and records normalized selected columns", async () => {
  const created = [];
  prisma.metaTable = { findUnique: async () => activeTable };
  prisma.metaColumn = { findMany: async ({ where }) => where.id.in.map((id) => ({ id })) };
  prisma.governanceTask = { create: async ({ data }) => { created.push(data); return { id: `task-${created.length}`, status: "PENDING", createdAt: new Date("2026-09-02T00:00:00.000Z") }; } };
  try {
    const service = new GovernanceService();
    const first = await service.create({ tableId: " table-1 ", columns: ["column-1", "column-2", "column-1"] });
    const second = await service.create({ tableId: "table-1", columns: ["column-1", "column-2"] });
    assert.equal(first.status, "PENDING"); assert.equal(second.id, "task-2"); assert.equal(created.length, 2);
    assert.deepEqual(created[0].selectedColumns, ["column-1", "column-2"]); assert.equal(created[0].createdBy, "local-user");
  } finally { restore(); }
});

test("rejects empty and foreign column selections", async () => {
  const service = new GovernanceService();
  await assert.rejects(() => service.create({ tableId: "table-1", columns: [] }), /请至少选择一个字段/);
  prisma.metaTable = { findUnique: async () => activeTable };
  prisma.metaColumn = { findMany: async () => [] };
  try { await assert.rejects(() => service.create({ tableId: "table-1", columns: ["other-table-column"] }), /选择的字段必须属于当前表/); } finally { restore(); }
});

test("lists newest tasks first and returns selected detail fields in saved order", async () => {
  const table = { id: "table-1", name: "orders", type: "TABLE", comment: null, metaProject: { name: "paiwo_smart" } };
  let listQuery;
  prisma.governanceTask = {
    findMany: async (query) => { listQuery = query; return [{ id: "new", selectedColumns: ["b", "a"], status: "PENDING", createdBy: "local-user", createdAt: new Date("2026-09-02"), updatedAt: new Date("2026-09-02"), metaTable: table }]; },
    findUnique: async () => ({ id: "detail", metaTableId: "table-1", selectedColumns: ["b", "a"], status: "PENDING", createdBy: "local-user", createdAt: new Date("2026-09-02"), updatedAt: new Date("2026-09-02"), metaTable: table }),
  };
  prisma.metaColumn = { findMany: async () => [{ id: "a", name: "first", dataType: "STRING", ordinal: 0, isPartition: false }, { id: "b", name: "second", dataType: "BIGINT", ordinal: 1, isPartition: false }] };
  prisma.aiColumnSuggestion = { count: async () => 0 };
  prisma.columnSemantic = { count: async () => 0 };
  prisma.semanticPackage = { findUnique: async () => null };
  try {
    const service = new GovernanceService(); const list = await service.list(); const detail = await service.get("detail");
    assert.deepEqual(listQuery.orderBy, { createdAt: "desc" }); assert.equal(list[0].columnCount, 2); assert.deepEqual(detail.columns.map((column) => column.id), ["b", "a"]);
  } finally { restore(); }
});
