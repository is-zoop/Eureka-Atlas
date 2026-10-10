const assert = require("node:assert/strict");
const test = require("node:test");
const { buildSemanticPackage } = require("../dist/package/builder/semantic-package.builder");

const date = new Date("2026-09-29T00:00:00.000Z");
const source = () => ({
  table: {
    id: "table-1", name: "shop_sales", status: "ACTIVE", updatedAt: date,
    metaProject: { id: "project-1", name: "sales", catalog: "", schema: "dw", status: "ACTIVE", updatedAt: date, dataSource: { id: "source-1", name: "warehouse", type: "MAXCOMPUTE", updatedAt: date } },
    semantic: { id: "semantic-1", businessName: "店铺销售日报", dataDomain: "销售管理", description: "店铺每日销售", grain: "biz_date,shop_id", queryConfig: { default_stat_date: { field_id: "date", format: "yyyy-MM-dd" }, storage: null }, updatedAt: date },
    columns: [
      { id: "date", name: "biz_date", dataType: "date", normalizedType: "DATE", isPartition: false, status: "ACTIVE", updatedAt: date, semantic: { id: "column-date", metricName: "业务日期", semanticType: "DIMENSION", aggregation: null, unit: null, groupable: true, candidateValueQueryable: true, labelDescription: null, updatedAt: date, metricCatalogBindings: [], dimensionCatalogBinding: { dimensionCatalog: { id: "catalog-date", name: "业务日期", description: "业务日期", aliases: [], usageNotes: null, status: "PUBLISHED", updatedAt: date } } } },
      { id: "shop", name: "shop_id", dataType: "string", normalizedType: "STRING", isPartition: false, status: "ACTIVE", updatedAt: date, semantic: { id: "column-shop", metricName: "店铺", semanticType: "DIMENSION", aggregation: null, unit: null, groupable: true, candidateValueQueryable: true, labelDescription: null, updatedAt: date, metricCatalogBindings: [], dimensionCatalogBinding: { dimensionCatalog: { id: "catalog-shop", name: "店铺", description: "店铺维度", aliases: ["店铺名称"], usageNotes: "用于筛选", status: "PUBLISHED", updatedAt: date } } } },
      { id: "gmv", name: "gmv", dataType: "decimal(18,2)", normalizedType: "DECIMAL", isPartition: false, status: "ACTIVE", updatedAt: date, semantic: { id: "column-gmv", metricName: "销售额", semanticType: "METRIC", aggregation: "SUM", unit: "元", groupable: false, candidateValueQueryable: false, labelDescription: null, updatedAt: date, metricCatalogBindings: [{ metricCatalog: { id: "catalog-gmv", name: "销售额", description: "成交金额", aliases: ["GMV"], usageNotes: "默认使用", status: "PUBLISHED", updatedAt: date } }], dimensionCatalogBinding: null } },
    ],
    semanticMetrics: [],
  },
});

test("builds a complete Agent semantic package with a stable content version", () => {
  const first = buildSemanticPackage(source());
  const second = buildSemanticPackage(source());
  assert.equal(first.schema_version, 1);
  assert.equal(first.content_version, second.content_version);
  assert.equal(first.completeness.status, "COMPLETE");
  assert.equal(first.fields.find((field) => field.column === "gmv").catalog.aliases[0], "GMV");
  assert.equal(first.source.type, "MAXCOMPUTE");
});

test("reports an invalid default statistic date without blocking package construction", () => {
  const input = source();
  input.table.semantic.queryConfig = { default_stat_date: { field_id: "removed", format: "yyyyMMdd" }, storage: null };
  const result = buildSemanticPackage(input);
  assert.equal(result.completeness.status, "INCOMPLETE");
  assert.ok(result.completeness.issues.some((issue) => issue.code === "DEFAULT_STAT_DATE_INVALID"));
});
