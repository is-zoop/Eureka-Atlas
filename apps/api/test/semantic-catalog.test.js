const assert = require("node:assert/strict");
const test = require("node:test");
const { prisma } = require("@eureka-atlas/database");
const { SemanticCatalogService } = require("../dist/semantic/semantic-catalog.service");

const rows = [
  { id: "A", name: "A销售额", description: "销售金额", aliases: ["GMV", "成交金额", "Gross Merchandise Value"], status: "PUBLISHED", editedAt: new Date(), dataSource: "交易", type: "ATOMIC" },
  { id: "B", name: "B净额", description: "净金额", aliases: ["net_gmv", "净成交额"], status: "PUBLISHED", editedAt: null, dataSource: "财务", type: "DERIVED" },
  { id: "C", name: "C归档", description: "归档指标", aliases: ["GMV"], status: "ARCHIVED", editedAt: new Date(), dataSource: "交易", type: "ATOMIC" },
  { id: "D", name: "D GMV成本", description: "成本", aliases: [], status: "PUBLISHED", editedAt: null, dataSource: "交易", type: "ATOMIC" },
  { id: "E", name: "E营销", description: "GMV口径", aliases: [], status: "PUBLISHED", editedAt: null, dataSource: "交易", type: "ATOMIC" },
  { id: "F", name: "F特殊字符", description: "特殊来源", aliases: ["100%_raw\\quote'"], status: "PUBLISHED", editedAt: null, dataSource: "交易", type: "ATOMIC" },
].map(row => ({ unit: "元", category: null, owner: null, usageNotes: null, _count: { bindings: 1 }, ...row }));
const contains = (value, query) => value.toLowerCase().includes(query.toLowerCase());
function matches(row, where) {
  return row.status === where.status &&
    (!where.type || row.type === where.type) &&
    (!where.dataSource || contains(row.dataSource, where.dataSource.contains)) &&
    (!Object.hasOwn(where, "editedAt") || (where.editedAt === null ? row.editedAt === null : row.editedAt !== null)) &&
    (!where.OR || where.OR.some(term => term.name ? contains(row.name, term.name.contains) : term.description ? contains(row.description, term.description.contains) : term.id.in.includes(row.id)));
}
async function fixture(kind, run) {
  const key = kind === "metrics" ? "semanticMetricCatalog" : "semanticDimensionCatalog";
  const original = { delegate: prisma[key], query: prisma.$queryRaw };
  const calls = { alias: [], count: [], list: [] };
  prisma.$queryRaw = async query => {
    calls.alias.push(query);
    const table = kind === "metrics" ? "semantic_metric_catalog" : "semantic_dimension_catalog";
    assert.match(query.sql, new RegExp(`SELECT id FROM ${table}`));
    assert.match(query.sql, /jsonb_array_elements_text\(aliases\)/);
    assert.match(query.sql, /strpos\(lower\(alias.value\), lower\(\?\)\) > 0/);
    assert.match(query.sql, /status = 'PUBLISHED'/);
    assert.equal(query.values.length, 1);
    return rows.filter(row => row.status === "PUBLISHED" && row.aliases.some(alias => contains(alias, query.values[0]))).map(({ id }) => ({ id }));
  };
  prisma[key] = {
    count: async ({ where }) => { calls.count.push(where); return rows.filter(row => matches(row, where)).length; },
    findMany: async query => {
      if (query.distinct) return [{ dataSource: "交易" }, { dataSource: "财务" }];
      calls.list.push(query);
      return rows.filter(row => matches(row, query.where)).sort((a, b) => a.id.localeCompare(b.id)).slice(query.skip, query.skip + query.take);
    },
  };
  try { await run({ search: query => new SemanticCatalogService()[kind](query), calls }); }
  finally { prisma[key] = original.delegate; prisma.$queryRaw = original.query; }
}

for (const kind of ["metrics", "dimensions"]) {
  test(`${kind}: aliases support partial case-insensitive search alongside names and descriptions`, async () => {
    await fixture(kind, async ({ search, calls }) => {
      const result = await search({ q: "  gMv  " });
      assert.deepEqual(result.items.map(item => item.id), ["A", "B", "D", "E"]);
      assert.equal(result.total, 4);
      assert.deepEqual(result.items[0].aliases, rows[0].aliases);
      assert.deepEqual(calls.alias[0].values, ["gMv"]);
      assert.deepEqual(calls.count[0], calls.list[0].where);
      assert.deepEqual((await search({ q: "merchandise" })).items.map(item => item.id), ["A"]);
      assert.deepEqual((await search({ q: "成交" })).items.map(item => item.id), ["A", "B"]);
    });
  });

  test(`${kind}: alias matches respect filters, pagination and published status`, async () => {
    await fixture(kind, async ({ search }) => {
      const paged = await search({ q: "gmv", page: 2, pageSize: 1 });
      assert.equal(paged.total, 4);
      assert.equal(paged.totalPages, 4);
      assert.equal(paged.page, 2);
      assert.equal(paged.items[0].id, "B");
      const filtered = await search({ q: "gmv", editStatus: "UNEDITED", dataSource: "财务", ...(kind === "metrics" ? { type: "DERIVED" } : {}) });
      assert.equal(filtered.total, 1);
      assert.equal(filtered.items[0].id, "B");
      assert.equal((await search({ q: "gmv", editStatus: "EDITED" })).items[0].id, "A");
      const clamped = await search({ q: "gmv", page: 5, pageSize: 2 });
      assert.equal(clamped.page, 2);
      assert.deepEqual(clamped.items.map(item => item.id), ["D", "E"]);
    });
  });

  test(`${kind}: blank and unmatched searches return correct counts and aliases`, async () => {
    await fixture(kind, async ({ search, calls }) => {
      const all = await search({ q: "   " });
      assert.equal(all.total, 5);
      assert.equal(calls.alias.length, 0);
      assert.equal(calls.list[0].where.OR, undefined);
      assert.deepEqual(all.items.find(item => item.id === "D").aliases, []);
      const empty = await search({ q: "没有对应别名" });
      assert.deepEqual(empty.items, []);
      assert.equal(empty.total, 0);
      assert.equal(empty.totalPages, 1);
    });
  });

  test(`${kind}: special characters are literal parameters, not SQL wildcards or injection`, async () => {
    await fixture(kind, async ({ search, calls }) => {
      for (const query of ["%_", "\\quote'", "' OR 1=1 --"]) {
        const result = await search({ q: query });
        assert.deepEqual(calls.alias.at(-1).values, [query]);
        assert.equal(calls.alias.at(-1).sql.includes(query), false);
        assert.deepEqual(result.items.map(item => item.id), query.includes("OR 1=1") ? [] : ["F"]);
      }
    });
  });
}
