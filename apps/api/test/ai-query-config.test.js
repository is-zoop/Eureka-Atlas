const assert = require("node:assert/strict");
const test = require("node:test");
const { prisma } = require("@eureka-atlas/database");
const { GovernanceAiService } = require("../dist/governance/governance-ai.service");
const { MetricFormulaService } = require("../dist/governance/metric-formula.service");
const { GovernanceWorkspaceService } = require("../dist/governance/governance-workspace.service");
const { DEFAULT_AI_SYSTEM_PROMPT } = require("../dist/governance/ai-prompt");
const { DEFAULT_GOVERNANCE_OPTIONS } = require("../dist/system-settings/system-settings.service");

async function withGeneration({ storage, partition = false, selectPartition = false, fieldId = "date", semanticPartition = false, removedPartition = false }, run) {
  const originals = Object.fromEntries(["governanceTask", "metaColumn", "aiTableSuggestion", "aiColumnSuggestion", "aiMetricSuggestion", "$transaction"].map(key => [key, prisma[key]]));
  const fields = [
    { id: "date", name: "biz_date", dataType: "STRING", normalizedType: "STRING", isPartition: false, status: "ACTIVE", ordinal: 0 },
    { id: "amount", name: "pay_amt", dataType: "DECIMAL", normalizedType: "DECIMAL", isPartition: false, status: "ACTIVE", ordinal: 1 },
    ...(partition || removedPartition ? [{ id: "partition", name: "ds", dataType: "STRING", normalizedType: "STRING", isPartition: true, status: removedPartition ? "DELETED" : "ACTIVE", ordinal: 2 }] : []),
  ];
  const selectedIds = ["date", "amount", ...(selectPartition ? ["partition"] : [])];
  const selected = fields.filter(field => selectedIds.includes(field.id));
  const response = {
    table: { business_name: "销售表", description: "销售业务数据", query_config: { default_stat_date: { field_id: fieldId, format: "yyyy-MM-dd" }, storage } },
    columns: selected.map(field => ({ column_name: field.name, metric_name: field.id === "amount" ? "支付金额" : "统计日期", semantic_type: field.id === "amount" ? "METRIC" : (field.isPartition || semanticPartition) ? "PARTITION" : "DIMENSION", aggregation: field.id === "amount" ? "SUM" : "", unit: field.id === "amount" ? "元" : "" })),
    metrics: [{ name: "总支付金额", formula: "SUM(pay_amt)", unit: "元" }],
  };
  const persisted = { table: null, columns: [], metrics: [], task: null, transactions: 0, prompt: null, columnQueries: [] };
  const steps = [];
  const task = { id: "task", metaTableId: "table", selectedColumns: selectedIds, metaTable: { name: "sales", comment: "销售数据", type: "MANAGED_TABLE", metaProject: { name: "dw" } } };
  const noop = async () => {};
  prisma.governanceTask = { findUnique: async () => task };
  prisma.metaColumn = { findMany: async query => { persisted.columnQueries.push(query); return fields.filter(field => !query.where.status || field.status === query.where.status); } };
  prisma.aiTableSuggestion = { findUnique: async () => persisted.table?.create ?? null };
  prisma.aiColumnSuggestion = { findMany: async () => persisted.columns.map(item => ({ ...item, metaColumn: selected.find(field => field.id === item.metaColumnId) })) };
  prisma.aiMetricSuggestion = { findMany: async () => persisted.metrics };
  prisma.$transaction = async callback => {
    persisted.transactions++;
    return callback({
      aiTableSuggestion: { upsert: async record => { persisted.table = record; } },
      aiColumnSuggestion: { deleteMany: noop, createMany: async ({ data }) => { persisted.columns = data; } },
      aiMetricSuggestion: { deleteMany: noop, createMany: async ({ data }) => { persisted.metrics = data; } },
      governanceTask: { update: async ({ data }) => { persisted.task = data; } },
    });
  };
  const service = new GovernanceAiService(
    { complete: async (system, user) => { persisted.prompt = { system, user: JSON.parse(user) }; return JSON.stringify(response); } },
    new MetricFormulaService(),
    { build: async () => ({ fieldReferences: [], metricReferences: [] }) },
    { aiPrompt: async () => ({ prompt: "自定义提示词" }), governanceOptions: async () => DEFAULT_GOVERNANCE_OPTIONS },
  );
  try {
    await run({ execute: () => service.execute("task", { onStep: async step => steps.push(step) }), persisted, steps });
  } finally { Object.assign(prisma, originals); }
}

for (const storage of ["DATE_INCREMENTAL", "FULL_SNAPSHOT", "null", null]) {
  test(`non-partitioned AI generation clears ${JSON.stringify(storage)} storage while saving date, columns and metrics`, async () => {
    await withGeneration({ storage }, async ({ execute, persisted, steps }) => {
      const result = await execute();
      for (const data of [persisted.table.create, persisted.table.update]) {
        assert.equal(data.queryConfig.storage, null);
        assert.deepEqual(data.queryConfig.default_stat_date, { field_id: "date", format: "yyyy-MM-dd" });
        assert.equal(data.businessName, "销售表");
      }
      assert.equal(result.columns.length, 2);
      assert.equal(result.metrics.length, 1);
      assert.equal(persisted.metrics[0].formula, "SUM(pay_amt)");
      assert.equal(persisted.task.status, "REVIEWING");
      assert.equal(steps.at(-1), "SAVING_SUGGESTIONS");
      assert.equal(persisted.prompt.user.current_table_context.table.has_partition, false);
      assert.match(persisted.prompt.user.required_response_contract.table, /has_partition 为 false 时 storage 必须为 JSON null/);
    });
  });
}

for (const storage of ["DATE_INCREMENTAL", "FULL_SNAPSHOT"]) {
  for (const selectPartition of [true, false]) {
    test(`partitioned AI generation preserves ${storage}, partition selected=${selectPartition}`, async () => {
      await withGeneration({ storage, partition: true, selectPartition }, async ({ execute, persisted }) => {
        await execute();
        assert.equal(persisted.table.create.queryConfig.storage, storage);
        assert.equal(persisted.table.update.queryConfig.storage, storage);
        assert.equal(persisted.prompt.user.current_table_context.table.has_partition, true);
        assert.equal(persisted.prompt.user.current_table_context.columns.some(field => field.is_partition), selectPartition);
      });
    });
  }
}

test("a suggested PARTITION semantic type cannot make a non-partitioned table eligible for storage", async () => {
  await withGeneration({ storage: "FULL_SNAPSHOT", semanticPartition: true }, async ({ execute, persisted }) => {
    await execute();
    assert.equal(persisted.table.create.queryConfig.storage, null);
    assert.equal(persisted.prompt.user.current_table_context.table.has_partition, false);
  });
});

test("deleted partition metadata is excluded from AI table context and storage eligibility", async () => {
  await withGeneration({ storage: "DATE_INCREMENTAL", removedPartition: true }, async ({ execute, persisted }) => {
    await execute();
    assert.equal(persisted.table.create.queryConfig.storage, null);
    assert.equal(persisted.prompt.user.current_table_context.table.has_partition, false);
    assert.ok(persisted.columnQueries.every(query => query.where.status === "ACTIVE"));
  });
});

test("clearing non-applicable AI storage does not bypass validation of foreign default dates", async () => {
  await withGeneration({ storage: "FULL_SNAPSHOT", fieldId: "foreign" }, async ({ execute, persisted, steps }) => {
    await assert.rejects(execute, /默认统计日期必须使用/);
    assert.equal(persisted.transactions, 0);
    assert.equal(steps.at(-1), "VALIDATING_RESULT");
  });
});

test("partitioned AI generation still rejects unknown storage modes", async () => {
  await withGeneration({ storage: "UNKNOWN", partition: true }, async ({ execute, persisted }) => {
    await assert.rejects(execute, /存储方式无效/);
    assert.equal(persisted.transactions, 0);
  });
});

test("manual drafts retain strict non-partitioned storage validation", () => {
  const service = new GovernanceWorkspaceService({}, {});
  const fields = [{ id: "date", name: "biz_date", dataType: "STRING", isPartition: false }];
  for (const storage of ["DATE_INCREMENTAL", "FULL_SNAPSHOT"]) {
    assert.throws(() => service.normalizeDraft({ selectedColumns: ["date"], table: { queryConfig: { storage } }, columns: [{ metaColumnId: "date", metricName: "统计日期", semanticType: "DIMENSION" }] }, fields, { name: "sales" }), /只有物理分区表才能设置存储方式/);
  }
});

test("default governance prompt distinguishes physical partitions from date fields and requires JSON null", () => {
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /current_table_context.table.has_partition/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /日期字段.*不等于物理分区/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /必须为 JSON `null`/);
});
