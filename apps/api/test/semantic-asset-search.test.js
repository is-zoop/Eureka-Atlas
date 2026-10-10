const assert = require("node:assert/strict");
const test = require("node:test");
const { searchSemanticPackages } = require("../dist/semantic/semantic-asset-search");

const catalog = (name, aliases = [], description = "") => ({ id: name, name, aliases, description, usage_notes: null });
const source = (id, metricName) => ({
  table: { id, name: `physical_${id}`, data_domain: "销售", business_name: `${id}日报`, description: "店铺经营日报", grain: ["biz_date", "shop_id"] },
  source: { name: "warehouse", project: "dw", catalog: "", schema: "ads" },
  fields: [{ id: `${id}-shop`, name: "店铺", type: "DIMENSION", groupable: true, catalog: catalog("店铺", ["门店"]) }, { id: `${id}-metric`, name: metricName, type: "METRIC", groupable: false, catalog: catalog(metricName, metricName === "销售额" ? ["GMV"] : []) }],
  metrics: [], completeness: { status: "COMPLETE", issues: [] },
});

test("ranks a fully covered scoped asset ahead of partial candidates", () => {
  const result = searchSemanticPackages([source("sales", "销售额"), source("traffic", "访客数")], { metrics: ["GMV"], dimensions: ["店铺"] });
  assert.equal(result.total, 2);
  assert.equal(result.items[0].table_id, "sales");
  assert.equal(result.items[0].coverage.status, "FULL");
});

test("keeps a partial candidate when a requested asset is missing", () => {
  const result = searchSemanticPackages([source("sales", "销售额")], { keywords: ["日报"], metrics: ["访客数"] });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].coverage.metrics[0].status, "MISSING");
});

test("returns description matches, exact-match ambiguity, and stable pages", () => {
  const ambiguous = source("ambiguous", "销售额");
  ambiguous.fields.push({ id: "ambiguous-metric-2", name: "销售额", type: "METRIC", groupable: false, catalog: catalog("销售额", ["GMV"]) });
  const description = searchSemanticPackages([ambiguous], { keywords: ["经营"], metrics: ["GMV"] });
  assert.equal(description.items[0].match_reasons[0].basis, "DESCRIPTION");
  assert.equal(description.items[0].coverage.metrics[0].status, "AMBIGUOUS");

  const paged = searchSemanticPackages([source("b", "销售额"), source("a", "销售额")], { metrics: ["GMV"], page_size: 1, page: 2 });
  assert.equal(paged.total, 2);
  assert.equal(paged.items[0].table_id, "b");
});

test("requires at least one search condition", () => {
  assert.throws(() => searchSemanticPackages([source("sales", "销售额")], {}), /至少输入/);
});

test("search matches groupable partitions as dimensions but honors disabled grouping", () => {
  const data = source("sales", "销售额");
  const partition = { id: "date", name: "统计日期", type: "PARTITION", groupable: true, catalog: null };
  data.fields.push(partition);
  const input = { metrics: ["GMV"], dimensions: ["统计日期"] };
  const result = searchSemanticPackages([data], input);
  assert.equal(result.items[0].coverage.status, "FULL");
  assert.equal(result.items[0].coverage.dimensions[0].status, "MATCHED");
  partition.groupable = false;
  assert.equal(searchSemanticPackages([data], input).items[0].coverage.dimensions[0].status, "MISSING");
});
