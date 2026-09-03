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
  selectedColumns: ["a"],
  table: {
    businessName: "店铺销售",
    description: "销售日报",
    grain: "日期+店铺",
    permissionColumnId: "b",
  },
  columns: [
    {
      metaColumnId: "a",
      metricName: "销售额",
      semanticType: "METRIC",
      aggregation: "SUM",
      unit: "元",
    },
  ],
};
test("saves compact draft and validates metric aggregation", () => {
  const service = new GovernanceWorkspaceService({}, {});
  const draft = service.normalizeDraft(input, fields, table);
  assert.equal(draft.table.permissionColumnId, "b");
  assert.doesNotThrow(() => service.validatePublish(draft));
  const invalid = service.normalizeDraft(
    { ...input, columns: [{ ...input.columns[0], aggregation: "" }] },
    fields,
    table,
  );
  assert.throws(() => service.validatePublish(invalid), /aggregation/);
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
