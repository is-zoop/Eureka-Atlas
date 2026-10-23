const assert = require("node:assert/strict");
const test = require("node:test");
const { prisma } = require("@eureka-atlas/database");
const { SelectableSemanticTablesService } = require("../dist/semantic/selectable-semantic-tables.service");

const packageFor = (id, domain, businessName, project) => ({
  table: { id, data_domain: domain, business_name: businessName, name: id + "_physical" },
  source: { id: "source-" + id, name: "数仓", project, catalog: "catalog", schema: "schema" },
  completeness: { status: "COMPLETE", issues: [] },
});

test("lists only active published tables with an active published field", async () => {
  const originalTransaction = prisma.$transaction;
  const originalTables = prisma.metaTable;
  const calls = [];
  prisma.$transaction = async (work) => work(prisma);
  prisma.metaTable = {
    findMany: async (query) => {
      calls.push(query);
      return [packageFor('table-a','销售','店铺销售','dw'),packageFor('table-b',null,'订单明细','ods')].map(p=>({id:p.table.id,name:p.table.name,semantic:{businessName:p.table.business_name,dataDomain:p.table.data_domain},metaProject:{name:p.source.project,catalog:p.source.catalog,schema:p.source.schema,dataSource:{id:p.source.id,name:p.source.name}}}));
    },
  };
  const packages = { getInTransaction: async (_tx, id) => id === "table-a" ? packageFor(id, "销售", "店铺销售", "dw") : packageFor(id, null, "订单明细", "ods") };
  try {
    const result = await new SelectableSemanticTablesService().list();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].where.status, "ACTIVE");
    assert.equal(calls[0].where.metaProject.status, "ACTIVE");
    assert.deepEqual(calls[0].where.semantic, { isNot: null });
    assert.deepEqual(calls[0].where.columns.some, { status: "ACTIVE", semantic: { isNot: null } });
    assert.deepEqual(result.items.map((item) => item.id), ["table-a", "table-b"]);
    assert.deepEqual(result.groups.map((group) => group.label), ["销售", "未分类"]);
    assert.equal(result.items[0].source.project, "dw");
    assert.equal("credential" in result.items[0].source, false);
  } finally {
    prisma.$transaction = originalTransaction;
    prisma.metaTable = originalTables;
  }
});
