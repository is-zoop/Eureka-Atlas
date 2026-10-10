const assert = require("node:assert/strict");
const test = require("node:test");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { QueryCompilerService } = require("../dist/query/query-compiler.service");
const { normalizeType } = require("../dist/metadata/datasource-adapter");
const { scopeDataDomains } = require("../dist/ask/ask-query-schema");

test("real search tool accepts only true domains of scoped tables, not platform names", async () => {
  const [{ Type }, { validateToolArguments }] = await Promise.all([import("typebox"), import("@earendil-works/pi-ai")]);
  const scope = { tableIds: ["table"], packages: new Map([["table", { table: { data_domain: "销售管理" } }]]) };
  const service = new AskRunService({}, {}, {}, {}, {});
  const tool = service.tools("test-run", "test-member", {}, Type, scope).find((item) => item.name === "search_semantic_assets");
  const validate = (parameters) => validateToolArguments(tool, { id: "search", type: "toolCall", name: tool.name, arguments: parameters });
  assert.deepEqual(validate({ keywords: ["天猫流量"], data_domain: "销售管理" }), { keywords: ["天猫流量"], data_domain: "销售管理" });
  assert.deepEqual(validate({ keywords: ["天猫流量"] }), { keywords: ["天猫流量"] });
  for (const domain of ["天猫", "电商", "未选表的域"]) assert.throws(() => validate({ keywords: ["流量"], data_domain: domain }), /Validation failed/);
  const empty = service.tools("test-run", "test-member", {}, Type, { tableIds: [], packages: new Map() }).find((item) => item.name === "search_semantic_assets");
  assert.throws(() => validateToolArguments(empty, { id: "empty", type: "toolCall", name: empty.name, arguments: { keywords: ["流量"], data_domain: "销售管理" } }), /Validation failed/);
  assert.deepEqual(scopeDataDomains([{ table: { data_domain: " 销售管理 " } }, { table: { data_domain: "销售管理" } }, { table: { data_domain: null } }]), ["销售管理"]);
});

test("search execution rechecks fresh scoped domains after metadata changes", async () => {
  const { prisma } = require("@eureka-atlas/database");
  const { Type } = await import("typebox");
  const old = prisma.askRun.findUniqueOrThrow;
  const oldFind = prisma.askRun.findUnique;
  prisma.askRun.findUnique = async () => ({ session: { ownerMemberNo: "test-member" } });
  prisma.askRun.findUniqueOrThrow = async () => ({ tableIds: ["table"] });
  try {
    const initial = { tableIds: ["table"], packages: new Map([["table", { table: { data_domain: "销售管理" } }]]) };
    const service = new AskRunService({ resolve: async () => ({ tableIds: ["table"], packages: new Map([["table", { table: { data_domain: "运营管理" } }]]) }) }, {}, {}, {}, {});
    const tool = service.tools("test-run", "test-member", {}, Type, initial).find((item) => item.name === "search_semantic_assets");
    await assert.rejects(tool.execute("search", { keywords: ["流量"], data_domain: "销售管理" }), /真实数据域或省略 data_domain/);
  } finally { prisma.askRun.findUniqueOrThrow = old; prisma.askRun.findUnique = oldFind; }
});

async function queryTools() {
  const [{ Type }, { validateToolArguments }] = await Promise.all([
    import("typebox"), import("@earendil-works/pi-ai"),
  ]);
  const tools = new AskRunService({}, {}, {}, {}, {}).tools("test-run", "test-member", {}, Type, { tableIds: [], packages: new Map() });
  return {
    query: tools.find((tool) => tool.name === "query_data"),
    candidates: tools.find((tool) => tool.name === "get_dimension_values"),
    validate: (tool, args) => validateToolArguments(tool, { id: "call", type: "toolCall", name: tool.name, arguments: args }),
  };
}
const dateRange = { start: "2026-08-01", end: "2026-08-31" };
const queryArgs = (filter) => ({ table_id: "table", metric_ids: ["gmv"], date_range: dateRange, filters: [filter] });

test("both real query tools expose and validate all supported filter enums and cardinalities", async () => {
  const { query, candidates, validate } = await queryTools();
  const rules = [
    ...["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "CONTAINS"].map((operator) => ({ operator, values: ["x"] })),
    { operator: "BETWEEN", values: ["a", "z"] },
    { operator: "IN", values: ["a", "b"] },
    { operator: "IS_NULL" },
    { operator: "IS_NOT_NULL", values: [] },
  ];
  for (const rule of rules) {
    const filter = { field_id: "shop", ...rule };
    assert.deepEqual(validate(query, queryArgs(filter)), queryArgs(filter));
    const input = { table_id: "table", field_id: "shop", date_range: dateRange, filters: [filter] };
    assert.deepEqual(validate(candidates, input), input);
  }
  const json = JSON.stringify(query.parameters);
  assert.match(json, /DATE_INCREMENTAL/);
  assert.match(json, /FULL_SNAPSHOT/);
  assert.match(json, /CONTAINS/);
  assert.match(JSON.stringify(candidates.parameters), /normalized_type=STRING/);
});

test("bad operators and malformed values are rejected before tool execution", async () => {
  const { query, candidates, validate } = await queryTools();
  const invalid = [
    { operator: "=", values: ["ELLE女装旗舰店"] },
    { operator: "LIKE", values: ["ELLE"] },
    { operator: "eq", values: ["ELLE"] },
    { operator: "EQ" },
    { operator: "EQ", values: [] },
    { operator: "EQ", values: ["a", "b"] },
    { operator: "CONTAINS", values: ["a", "b"] },
    { operator: "BETWEEN", values: ["a"] },
    { operator: "BETWEEN", values: ["a", "b", "c"] },
    { operator: "IN", values: [] },
    { operator: "IN", values: Array(101).fill("a") },
    { operator: "IS_NULL", values: ["a"] },
    { operator: "EQ", value: "a" },
  ];
  for (const rule of invalid) {
    const filter = { field_id: "shop", ...rule };
    assert.throws(() => validate(query, queryArgs(filter)), /Validation failed/);
    assert.throws(() => validate(candidates, { table_id: "table", field_id: "shop", filters: [filter] }), /Validation failed/);
  }
  assert.throws(() => validate(query, { table_id: "table", metric_ids: [] }), /Validation failed/);
  assert.throws(() => validate(query, { table_id: "table", metric_ids: ["gmv"], sql: "SELECT 1" }), /Validation failed/);
  assert.throws(() => validate(candidates, { table_id: "table", keyword: "ELLE" }), /Validation failed/);
});

const pkg = () => ({
  source: { type: "MAXCOMPUTE", project: "dw" },
  table: { id: "table", name: "traffic", query_config: {
    storage: "DATE_INCREMENTAL", default_stat_date: { field_id: "date", format: "yyyyMMdd" },
  } },
  fields: [
    { id: "date", column: "date_pt", name: "日期", type: "PARTITION", is_partition: true, normalized_type: normalizeType("string") },
    { id: "shop", column: "shop_name", name: "店铺名称", type: "DIMENSION", normalized_type: normalizeType("string"), candidate_value_queryable: true },
    { id: "gmv", column: "gmv", name: "GMV", type: "METRIC", normalized_type: "DECIMAL", aggregation: "SUM" },
  ],
  metrics: [],
});

test("native MaxCompute string candidate lookup compiles with one keyword and either date format", async () => {
  const { candidates, validate } = await queryTools();
  const compiler = new QueryCompilerService();
  for (const range of [dateRange, { start: "20260801", end: "20260831" }]) {
    const input = validate(candidates, { table_id: "table", field_id: "shop", keyword: "ELLE", date_range: range });
    const compiled = compiler.compileDimensionValues(pkg(), input);
    assert.match(compiled.sql, /shop_name.*LIKE '%ELLE%'/);
    assert.match(compiled.sql, /date_pt.*BETWEEN '20260801' AND '20260831'/);
  }
});

test("date requirements remain conditional on storage for metrics and candidate lookups", async () => {
  const { candidates, query, validate } = await queryTools();
  const compiler = new QueryCompilerService();
  const candidateInput = validate(candidates, { table_id: "table", field_id: "shop" });
  const queryInput = validate(query, { table_id: "table", metric_ids: ["gmv"] });
  assert.throws(() => compiler.compileDimensionValues(pkg(), candidateInput), /date_range.*start, end/);
  assert.throws(() => compiler.compileQuery(pkg(), queryInput), /date_range.*start, end/);
  const snapshot = pkg();
  snapshot.table.query_config.storage = "FULL_SNAPSHOT";
  assert.match(compiler.compileDimensionValues(snapshot, candidateInput, { snapshotDate: "20260831" }).sql, /date_pt.*= '20260831'/);
  assert.throws(() => compiler.compileDimensionValues(snapshot, { ...candidateInput, date_range: dateRange }, { snapshotDate: "20260831" }), /最新快照/);
});

test("non-string keywords and bad API filter input give actionable errors without generating SQL", () => {
  const compiler = new QueryCompilerService();
  const data = pkg();
  data.fields[1].normalized_type = "INTEGER";
  assert.throws(() => compiler.compileDimensionValues(data, { table_id: "table", field_id: "shop", keyword: "ELLE", date_range: dateRange }), /店铺名称.*INTEGER.*STRING/);
  assert.throws(() => compiler.compileQuery(pkg(), queryArgs({ field_id: "shop", operator: "=", values: ["ELLE"] })), /等于使用 EQ/);
  assert.throws(() => compiler.compileQuery(pkg(), queryArgs({ field_id: "shop", operator: "EQ", values: [123] })), /字符串数组/);
  assert.throws(() => compiler.compileQuery(pkg(), queryArgs({ field_id: "shop", operator: "IS_NULL", values: ["ELLE"] })), /不应提供 values/);
  assert.match(compiler.compileQuery(pkg(), queryArgs({ field_id: "shop", operator: "EQ", values: ["ELLE女装旗舰店"] })).sql, /shop_name.*= 'ELLE女装旗舰店'/);
});
