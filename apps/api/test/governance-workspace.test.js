const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GovernanceWorkspaceService,
} = require("../dist/governance/governance-workspace.service");
const {
  classifySemanticType,
  normalizeSemanticType,
} = require("../dist/governance/semantic-classifier");
const fields = [
  { id: "a", name: "amount" },
  { id: "b", name: "shop_id" },
];
const table = { name: "shop_sales", comment: "店铺日报" };
const input = {
  selectedColumns: ["a", "b"],
  table: {
    businessName: "店铺销售",
    description: "销售日报",
    grain: "amount",
    permissionColumnId: "b",
    permissionRelation: "平台店铺名称",
  },
  columns: [
    {
      metaColumnId: "a",
      metricName: "销售额",
      semanticType: "METRIC",
      aggregation: "SUM",
      unit: "元",
      groupable: false,
      candidateValueQueryable: false,
      labelDescription: "",
    },
    {
      metaColumnId: "b",
      metricName: "店铺",
      semanticType: "DIMENSION",
      aggregation: "",
      unit: "",
      groupable: true,
      candidateValueQueryable: true,
      labelDescription: "",
    },
  ],
};
test("saves compact draft and validates metric aggregation", () => {
  const service = new GovernanceWorkspaceService({}, {});
  const draft = service.normalizeDraft(input, fields, table);
  assert.equal(draft.table.permissionColumnId, "b");
  assert.equal(draft.table.permissionRelation, "平台店铺名称");
  assert.equal(draft.columns[1].groupable, true);
  assert.equal(draft.columns[1].candidateValueQueryable, true);
  assert.doesNotThrow(() => service.validatePublish(draft));
  const invalid = service.normalizeDraft(
    {
      ...input,
      columns: [
        { ...input.columns[0], aggregation: "" },
        input.columns[1],
      ],
    },
    fields,
    table,
  );
  assert.throws(() => service.validatePublish(invalid), /aggregation/);
});
test("drops legacy grain names that are not selected physical columns", () => {
  const service = new GovernanceWorkspaceService({}, {});
  const draft = service.normalizeDraft(
    { ...input, table: { ...input.table, grain: "商品-流量来源-日期" } },
    fields,
    table,
  );
  assert.equal(draft.table.grain, "");
});
test("defaults names from comments and clears invalid semantic metadata", () => {
  const service = new GovernanceWorkspaceService({}, {});
  const columns = [
    { id: "metric", name: "gmv", dataType: "decimal(18,2)", comment: "成交金额", isPartition: false },
    { id: "label", name: "source_label", dataType: "string", comment: null, isPartition: false },
    { id: "partition", name: "day_pt", dataType: "string", comment: "日期分区", isPartition: true },
  ];
  const draft = service.defaultDraft(table, columns, columns.map((column) => column.id));
  assert.deepEqual(draft.columns.map((column) => column.metricName), ["成交金额", "", "day_pt"]);
  const normalized = service.normalizeDraft({
    selectedColumns: columns.map((column) => column.id),
    columns: draft.columns.map((column) => ({ ...column, aggregation: "SUM", unit: "元", groupable: true, candidateValueQueryable: true, labelDescription: "临时说明" })),
  }, columns, table);
  assert.equal(normalized.columns[0].aggregation, "SUM");
  assert.equal(normalized.columns[1].aggregation, "");
  assert.equal(normalized.columns[1].unit, "");
  assert.equal(normalized.columns[1].groupable, true);
  assert.equal(normalized.columns[1].candidateValueQueryable, true);
  assert.equal(normalized.columns[1].labelDescription, "临时说明");
  assert.equal(normalized.columns[2].groupable, false);
  assert.equal(normalized.columns[2].candidateValueQueryable, false);
  assert.equal(normalized.columns[2].labelDescription, "");
});
test("preclassifies metrics, dimensions, labels, and partitions and normalizes legacy attributes", () => {
  assert.equal(
    classifySemanticType({ name: "dt", dataType: "string", isPartition: true }),
    "PARTITION",
  );
  assert.equal(
    classifySemanticType({ name: "gmv", dataType: "decimal(18,2)" }),
    "METRIC",
  );
  assert.equal(
    classifySemanticType({ name: "goods_label", dataType: "string" }),
    "LABEL",
  );
  assert.equal(
    classifySemanticType({ name: "shop", dataType: "string" }),
    "DIMENSION",
  );
  assert.equal(normalizeSemanticType("ATTRIBUTE"), "LABEL");
});
