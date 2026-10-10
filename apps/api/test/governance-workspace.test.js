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
  assert.equal(draft.columns[2].groupable, true);
  assert.equal(draft.columns[2].candidateValueQueryable, false);
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
  assert.equal(normalized.columns[2].groupable, true);
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

test("partition grouping defaults on but preserves an explicit opt-out", () => {
  const service = new GovernanceWorkspaceService({}, {});
  const columns = [{ id: "date", name: "date_pt", dataType: "string", isPartition: true }];
  for (const [groupable, expected] of [[undefined, true], [true, true], [false, false]]) {
    const draft = service.normalizeDraft({ selectedColumns: ["date"], columns: [{ metaColumnId: "date", semanticType: "PARTITION", groupable, candidateValueQueryable: true }] }, columns, table);
    assert.equal(draft.columns[0].groupable, expected);
    assert.equal(draft.columns[0].candidateValueQueryable, false);
  }
});

test("publishing persists partition grouping for both create and update", async () => {
  const { prisma } = require("@eureka-atlas/database");
  const oldTransaction = prisma.$transaction;
  const oldFindColumns = prisma.metaColumn.findMany;
  const columns = [...fields, { id: "date", name: "date_pt", dataType: "string", isPartition: true }];
  const draftInput = { ...input, selectedColumns: ["a", "b", "date"], columns: [...input.columns, { metaColumnId: "date", metricName: "统计日期", semanticType: "PARTITION", groupable: true, candidateValueQueryable: true }] };
  const service = new GovernanceWorkspaceService({ generateForTable: async () => {} }, {}, { syncForTable: async () => {} }, {});
  const draft = service.normalizeDraft(draftInput, columns, table);
  service.task = async () => ({ id: "task", metaTableId: "table", selectedColumns: draft.selectedColumns, metaTable: table, review: { tableDraft: draft.table, columnDrafts: draft.columns, metricDrafts: [] } });
  service.get = async () => ({});
  const persisted = [];
  const publishedTables = [];
  const noop = async () => {};
  try {
    prisma.metaColumn.findMany = async () => columns;
    prisma.$transaction = async (callback) => callback({
      tableSemantic: { upsert: async (record) => publishedTables.push(record) },
      columnSemantic: { deleteMany: noop, upsert: async (record) => persisted.push(record) },
      semanticMetric: { deleteMany: noop },
      governanceTask: { update: noop },
    });
    await service.publish("task", { member_no: "member-A", name: "发布人甲" });
    for (const record of [publishedTables[0].create, publishedTables[0].update]) {
      assert.equal(record.publishedBy, "member-A");
      assert.equal(record.publishedByName, "发布人甲");
    }
    assert.ok(persisted.every(record => record.create.publishedBy === "member-A" && record.update.publishedBy === "member-A"));
    await service.publish("task", { member_no: "member-B", name: "发布人乙" });
    assert.equal(publishedTables[1].update.publishedBy, "member-B");
    assert.equal(publishedTables[1].update.publishedByName, "发布人乙");
    const partition = persisted.find((record) => record.where.metaColumnId === "date");
    for (const record of [partition.create, partition.update]) {
      assert.equal(record.semanticType, "PARTITION");
      assert.equal(record.groupable, true);
      assert.equal(record.candidateValueQueryable, false);
    }
  } finally { prisma.$transaction = oldTransaction; prisma.metaColumn.findMany = oldFindColumns; }
});

test("publication requires a verified member before saving a draft or starting database work", async () => {
  const service = new GovernanceWorkspaceService({}, {}, {}, {});
  let touched = false;
  service.update = async () => { touched = true; };
  service.task = async () => { touched = true; };
  await assert.rejects(() => service.publish("task", undefined, input), error => error.getStatus() === 401);
  await assert.rejects(() => service.publish("task", { member_no: "", name: "伪造用户" }, input), error => error.getStatus() === 401);
  assert.equal(touched, false);
});

test("publish controller only accepts the publisher from authenticated request context", async () => {
  const { GovernanceWorkspaceController } = require("../dist/governance/governance.controller");
  const calls = [];
  const controller = new GovernanceWorkspaceController({ publish: async (...args) => { calls.push(args); return {}; } }, {});
  const body = { ...input, publishedBy: "fake", publishedByName: "伪造用户" };
  await controller.publish({ authUser: { member_no: "member-A", name: "发布人甲" } }, "task", body);
  assert.deepEqual(calls[0], ["task", { member_no: "member-A", name: "发布人甲" }, body]);
  assert.throws(() => controller.publish({}, "task", body), error => error.getStatus() === 401);
  assert.equal(calls.length, 1);
});
