const assert = require("node:assert/strict");
const test = require("node:test");
const { QueryCompilerService } = require("../dist/query/query-compiler.service");
const { QueryExecutionService } = require("../dist/query/query-execution.service");

const pkg = (storage = "DATE_INCREMENTAL") => ({
  source: { id: "source-1", type: "MAXCOMPUTE", project: "dw", catalog: "", schema: "" },
  table: { id: "table-1", name: "shop_sales", query_config: { default_stat_date: { field_id: "ds", format: "yyyyMMdd" }, storage } },
  fields: [
    { id: "ds", column: "ds", name: "统计日期", type: "PARTITION", is_partition: true, normalized_type: "STRING", groupable: false, candidate_value_queryable: false },
    { id: "shop", column: "shop_id", name: "店铺", type: "DIMENSION", is_partition: false, normalized_type: "STRING", groupable: true, candidate_value_queryable: true },
    { id: "gmv", column: "gmv", name: "成交金额", type: "METRIC", aggregation: "SUM", unit: "元", is_partition: false, normalized_type: "DECIMAL", groupable: false, candidate_value_queryable: false },
    { id: "visitor", column: "visitor", name: "访客数", type: "METRIC", aggregation: "SUM", unit: "人", is_partition: false, normalized_type: "INTEGER", groupable: false, candidate_value_queryable: false },
  ],
  metrics: [{ id: "rate", name: "转化率", formula: "SUM(gmv) / NULLIF(SUM(visitor), 0)", unit: "%", dependencies: [] }],
});

test("compiles a governed atomic metric with dimensions and date range", () => {
  const result = new QueryCompilerService().compileQuery(pkg(), { table_id: "table-1", metric_ids: ["gmv"], dimension_ids: ["shop"], date_range: { start: "20260901", end: "20260930" }, filters: [{ field_id: "shop", operator: "CONTAINS", values: ["旗舰"] }] });
  assert.match(result.sql, /SUM\(`gmv`\)/);
  assert.match(result.sql, /`ds` BETWEEN '20260901' AND '20260930'/);
  assert.match(result.sql, /AS `店铺`/);
  assert.match(result.sql, /AS `成交金额`/);
  assert.match(result.sql, /^SELECT\n  /);
  assert.match(result.sql, /\nFROM /);
  assert.match(result.sql, /\nWHERE /);
  assert.match(result.sql, /\nGROUP BY `shop_id`/);
  assert.match(result.sql, /\nLIMIT 101;$/);
});

test("converts browser ISO dates to the published partition format", () => {
  const result = new QueryCompilerService().compileQuery(pkg(), { table_id: "table-1", metric_ids: ["gmv"], date_range: { start: "2026-09-01", end: "2026-09-29" } });
  assert.match(result.sql, /`ds` BETWEEN '20260901' AND '20260929'/);
});

test("groups an enabled partition into daily metric results without relaxing date filters", () => {
  const data = pkg();
  data.fields[0].groupable = true;
  const input = { table_id: "table-1", metric_ids: ["gmv"], dimension_ids: ["ds"], date_range: { start: "2026-09-01", end: "2026-09-30" }, order_by: [{ field_id: "ds", direction: "ASC" }] };
  const compiler = new QueryCompilerService();
  const result = compiler.compileQuery(data, input);
  assert.match(result.sql, /`ds` AS `统计日期`/);
  assert.match(result.sql, /`ds` BETWEEN '20260901' AND '20260930'/);
  assert.match(result.sql, /GROUP BY `ds`/);
  assert.match(result.sql, /ORDER BY `统计日期` ASC/);
  data.fields[0].groupable = false;
  assert.throws(() => compiler.compileQuery(data, input), /不能用于分组/);
  data.fields[2].groupable = true;
  assert.throws(() => compiler.compileQuery(data, { ...input, dimension_ids: ["gmv"] }), /不能用于分组/);
  assert.throws(() => compiler.compileDimensionValues(data, { table_id: "table-1", field_id: "ds", date_range: input.date_range }), /未开放候选值查询/);
});
test("requires a date range for incremental tables", () => {
  assert.throws(() => new QueryCompilerService().compileQuery(pkg(), { table_id: "table-1", metric_ids: ["gmv"] }), /日期范围/);
});

test("accepts a published derived metric expression", () => {
  const result = new QueryCompilerService().compileQuery(pkg(), { table_id: "table-1", metric_ids: ["rate"], date_range: { start: "20260901", end: "20260930" } });
  assert.match(result.sql, /SUM\(gmv\) \/ NULLIF\(SUM\(visitor\), 0\)/);
});

test("uses latest configured snapshot partition without accepting a default date range", () => {
  const compiler = new QueryCompilerService();
  const result = compiler.compileQuery(pkg("FULL_SNAPSHOT"), { table_id: "table-1", metric_ids: ["gmv"] }, { snapshotDate: "20260929" });
  assert.match(result.sql, /`ds` = '20260929'/);
  assert.match(result.sql, /__snapshot_date/);
  assert.throws(() => compiler.compileQuery(pkg("FULL_SNAPSHOT"), { table_id: "table-1", metric_ids: ["gmv"], date_range: { start: "20260901", end: "20260930" } }), /自动选择最新快照/);
});

test("rejects unsupported fields and injected filter values", () => {
  const compiler = new QueryCompilerService();
  assert.throws(() => compiler.compileQuery(pkg(), { table_id: "table-1", metric_ids: ["shop"], date_range: { start: "20260901", end: "20260930" } }), /不是原子指标/);
  assert.throws(() => compiler.compileQuery(pkg(), { table_id: "table-1", metric_ids: ["gmv"], date_range: { start: "20260901", end: "20260930" }, filters: [{ field_id: "gmv", operator: "GT", values: ["1; DROP TABLE x"] }] }), /数字筛选值无效/);
});

test("parses quoted comma-delimited MaxCompute results into table cells", () => {
  const service = new QueryExecutionService({}, {}, {});
  const raw = '"d_shop","m_profit","m_income"' + "\n" + '"含,逗号的店铺","-70780.3058","94500.55"' + "\n" + '"无数据店铺","\\N","\\N"';
  const parsed = service.parseResult(raw, 'SELECT `shop` AS `d_shop`, SUM(`profit`) AS `m_profit`, SUM(`income`) AS `m_income`;', [
    { id: "shop", name: "店铺", type: "STRING", unit: null },
    { id: "profit", name: "利润", type: "DECIMAL", unit: "元" },
    { id: "income", name: "收入", type: "DECIMAL", unit: "元" },
  ]);
  assert.deepEqual(parsed.result.rows, [["含,逗号的店铺", "-70780.3058", "94500.55"], ["无数据店铺", null, null]]);
  assert.equal(parsed.result.columns.length, 3);
});
test("removes MaxCompute result headers when Latin aliases are normalized to lowercase", () => {
  const service = new QueryExecutionService({}, {}, {});
  const sql = 'SELECT shop AS `财务店铺名称`, SUM(gmv) AS `GMV去内购`;';
  const columns = [{ id: "shop", name: "财务店铺名称", type: "STRING", unit: null }, { id: "gmv", name: "GMV去内购", type: "DECIMAL", unit: "元" }];
  const raw = '"财务店铺名称","gmv去内购"\n"中文店铺","27224557"\n"旗舰店","22832497"';
  const parsed = service.parseResult(raw, sql, columns, 1);
  assert.deepEqual(parsed.result.rows, [["中文店铺", "27224557"]]);
  assert.equal(parsed.result.truncated, true);
  assert.equal(parsed.result.columns[1].name, "GMV去内购");
  const headerless = service.parseResult('"中文店铺","27224557"', sql, columns);
  assert.deepEqual(headerless.result.rows, [["中文店铺", "27224557"]]);
});
