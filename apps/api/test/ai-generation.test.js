const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GovernanceGenerationService,
} = require("../dist/governance/governance-generation.service");
const { GovernanceAiService } = require("../dist/governance/governance-ai.service");

test("uses Markdown only as temporary AI generation reference", () => {
  const service = new GovernanceGenerationService({}, {});
  assert.equal(service.reference({ fileName: "context.md", content: "  # 业务口径  " }), "# 业务口径");
  assert.equal(service.reference({ fileName: "empty.md", content: "   " }), undefined);
  assert.throws(() => service.reference({ content: "x".repeat(1_000_001) }), /1 MB/);
});

test("limits calculated metric suggestions to five without Markdown and removes the limit with Markdown", () => {
  const service = new GovernanceAiService({});
  const result = { table: { business_name: "销售表", description: "销售数据" }, columns: [{ column_name: "pay_amt", metric_name: "支付金额", semantic_type: "METRIC" }], metrics: Array.from({ length: 6 }, (_, index) => ({ name: `指标${index}`, formula: "SUM(pay_amt)" })) };
  assert.throws(() => service.parse(JSON.stringify(result), ["pay_amt"], new Map(), false), /more than 5/);
  assert.equal(service.parse(JSON.stringify(result), ["pay_amt"], new Map(), true).metrics.length, 6);
});

test("normalizes new table and column semantic suggestions", () => {
  const service = new GovernanceAiService({});
  const result = {
    table: { data_domain: "销售管理", business_name: "销售表", description: "销售数据", grain: "店铺，商品标签", permission_column_name: "shop_id", permission_relation: "平台店铺名称" },
    columns: [
      { column_name: "shop_id", metric_name: "店铺", semantic_type: "DIMENSION", groupable: false, candidate_value_queryable: true },
      { column_name: "tag", metric_name: "商品标签", semantic_type: "LABEL", groupable: true, candidate_value_queryable: false, label_description: "用于商品筛选" },
    ],
  };
  const parsed = service.parse(JSON.stringify(result), ["shop_id", "tag"], new Map(), false);
  assert.equal(parsed.table.data_domain, "销售管理");
  assert.equal(parsed.table.grain, "shop_id,tag");
  assert.equal(parsed.table.permission_column_name, "shop_id");
  assert.equal(parsed.columns[0].groupable, false);
  assert.equal(parsed.columns[1].candidate_value_queryable, false);
  assert.equal(parsed.columns[1].label_description, "用于商品筛选");
  const incompletePermission = service.parse(JSON.stringify({ ...result, table: { ...result.table, permission_relation: null } }), ["shop_id", "tag"], new Map(), false);
  assert.equal(incompletePermission.table.permission_column_name, null);
  assert.equal(incompletePermission.table.permission_relation, null);
  const unknownDomain = service.parse(JSON.stringify({ ...result, table: { ...result.table, data_domain: "电商" } }), ["shop_id", "tag"], new Map(), false);
  assert.equal(unknownDomain.table.data_domain, null);
});

test("accepts AI JSON wrapped in a Markdown code fence", () => {
  const service = new GovernanceAiService({});
  const result = { table: { business_name: "销售表", description: "销售数据" }, columns: [{ column_name: "pay_amt", metric_name: "支付金额", semantic_type: "METRIC" }] };
  const parsed = service.parse(`模型结果：\n\n\`\`\`JSON\n${JSON.stringify(result)}\n\`\`\``, ["pay_amt"], new Map(), false);
  assert.equal(parsed.columns[0].metric_name, "支付金额");
});

test("AI partition suggestions default grouping on, allow disabling, and forbid candidate queries", () => {
  const service = new GovernanceAiService({});
  for (const [groupable, expected] of [[undefined, true], [true, true], [false, false]]) {
    const result = { table: { business_name: "销售表", description: "销售数据" }, columns: [{ column_name: "date_pt", metric_name: "日期", semantic_type: "PARTITION", groupable, candidate_value_queryable: true }] };
    const parsed = service.parse(JSON.stringify(result), ["date_pt"], new Map(), false);
    assert.equal(parsed.columns[0].groupable, expected);
    assert.equal(parsed.columns[0].candidate_value_queryable, false);
  }
});
test("uses a configured system prompt and keeps Markdown reference in user context", async () => {
  const service = new GovernanceAiService({}, {}, {}, { aiPrompt: async () => ({ prompt: "固定约束：只输出符合 JSON Schema；禁止完整 SQL" }) });
  const prompt = await service.prompt({ table: { name: "sales" }, columns: [] }, "# 销售口径\n请使用自然语言");
  assert.match(prompt.system, /只输出符合 JSON Schema/);
  assert.match(prompt.system, /禁止完整 SQL/);
  assert.match(prompt.user, /supplementary_business_reference/);
  assert.match(prompt.user, /销售口径/);
  assert.match(prompt.user, /分区groupable缺省为true/);
});
