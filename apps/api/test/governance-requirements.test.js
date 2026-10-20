const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { SemanticReferenceService } = require("../dist/governance/semantic-reference.service");
const { HttpException, BadRequestException } = require("@nestjs/common");
const { prisma } = require("@eureka-atlas/database");
const { GovernanceAiService } = require("../dist/governance/governance-ai.service");
const { MetricFormulaService } = require("../dist/governance/metric-formula.service");
const { GovernanceGenerationService, generationErrorMessage } = require("../dist/governance/governance-generation.service");
const { DEFAULT_AI_SYSTEM_PROMPT } = require("../dist/governance/ai-prompt");

const reference = "# 订单业务\n| 物理字段 | 名称 | 单位 |\n| pay_amt | 支付金额 | 元 |\n| shop_id | 店铺编号 | |\n\n计算指标：总支付金额，公式 SUM(pay_amt)，单位元。";
const result = () => ({
  table: { business_name: "订单业务", description: "订单口径", grain: "shop_id" },
  columns: [
    { column_name: "pay_amt", metric_name: "支付金额", semantic_type: "METRIC", aggregation: "SUM", unit: "元" },
    { column_name: "shop_id", metric_name: "店铺编号", semantic_type: "DIMENSION" },
  ],
  metrics: [{ name: "总支付金额", formula: "SUM(pay_amt)", unit: "元" }],
});
const contractResult = () => ({
  table: { business_name: "订单业务", description: null },
  columns: [
    { column_name: "pay_amt", metric_name: "支付金额", unit: "元", aggregation: null, evidence: "| pay_amt | 支付金额 | 元 |" },
    { column_name: "shop_id", metric_name: "店铺编号", unit: null, aggregation: null, evidence: "| shop_id | 店铺编号 | |" },
  ],
  metrics: [{ name: "总支付金额", formula: "SUM(pay_amt)", unit: "元", evidence: "计算指标：总支付金额，公式 SUM(pay_amt)，单位元。" }],
});
const names = ["pay_amt", "shop_id"];
const preferred = new Map([["pay_amt", "历史支付金额"], ["shop_id", "历史店铺"]]);

test("Markdown is the naming and business-contract authority even with a custom system prompt", async () => {
  const service = new GovernanceAiService({}, {}, {}, { aiPrompt: async () => ({ prompt: "用户自定义系统提示词" }) });
  const prompt = await service.prompt({ table: { name: "orders" }, columns: [] }, reference);
  const payload = JSON.parse(prompt.user);
  assert.match(payload.reference_policy, /最高优先级/);
  assert.match(payload.reference_policy, /不得改写、使用同义词或被历史名称、注释覆盖/);
  assert.match(payload.reference_policy, /依次参考治理历史已发布名称、字段注释、物理字段名推导/);
  assert.match(payload.reference_policy, /不能因此报错或遗漏字段/);
  assert.match(payload.calculated_metric_policy, /最多 5 条/);
  assert.equal(payload.supplementary_business_reference, reference);
  assert.match(payload.required_response_contract.table, /permission_column_name 和 permission_relation 为可选项/);
  assert.match(DEFAULT_AI_SYSTEM_PROMPT, /名称必须逐字采用原文/);
});

test("document names, units and formula are retained rather than being replaced by historical names", () => {
  const service = new GovernanceAiService({});
  const parsed = service.parse(JSON.stringify(result()), names, preferred, contractResult());
  assert.deepEqual(parsed.columns.map(column => column.metric_name), ["支付金额", "店铺编号"]);
  assert.equal(parsed.columns[0].unit, "元");
  assert.equal(parsed.metrics[0].name, "总支付金额");
  assert.equal(parsed.metrics[0].formula, "SUM(pay_amt)");
  assert.equal(parsed.table.permission_column_name, null);
  assert.equal(parsed.table.permission_relation, null);
});

for (const supplied of ["成交金额", "历史支付金额", ""]) {
  test(`an explicit document mapping overrides the generated name without rejecting the result: ${supplied}`, () => {
    const service = new GovernanceAiService({});
    const changed = result(); changed.columns[0].metric_name = supplied;
    const parsed = service.parse(JSON.stringify(changed), names, preferred, contractResult());
    assert.equal(parsed.columns[0].metric_name, "支付金额");
  });
}

test("partial Markdown mappings allow historical names for uncovered fields", () => {
  const service = new GovernanceAiService({});
  const changed = result(); changed.columns[0].metric_name = ""; changed.columns[1].metric_name = "shop_id";
  const partial = contractResult(); partial.columns.shift();
  const parsed = service.parse(JSON.stringify(changed), names, preferred, partial);
  assert.equal(parsed.columns[0].metric_name, "历史支付金额");
  assert.equal(parsed.columns[1].metric_name, "店铺编号");
  assert.equal(service.parse(JSON.stringify(changed), names, preferred, undefined).columns[0].metric_name, "历史支付金额");
});

test("Markdown permits inferred calculations, while a blank reference retains ordinary naming policy", async () => {
  const service = new GovernanceAiService({}, {}, {}, { aiPrompt: async () => ({ prompt: "system" }) });
  const changed = result(); changed.metrics[0].name = "推导销售额";
  const parsed = service.parse(JSON.stringify(changed), names, preferred, contractResult());
  assert.equal(parsed.metrics[0].name, "推导销售额");
  const prompt = await service.prompt({ table: { name: "orders" }, columns: [] }, "   ");
  assert.match(JSON.parse(prompt.user).reference_policy, /未上传 Markdown/);
});

test("structural validation still prevents invalid AI suggestions from being saved", async () => {
  const oldTransaction = prisma.$transaction;
  let touched = false;
  const changed = result(); changed.columns[0].column_name = "foreign";
  let calls = 0;
  const service = new GovernanceAiService(
    { complete: async () => JSON.stringify(calls++ === 0 ? contractResult() : changed) }, {}, {},
    { governanceOptions: async () => ({ dataDomains: [], permissionRelations: [] }), aiPrompt: async () => ({ prompt: "system" }) },
  );
  service.task = async () => ({ columns: names.map((name, i) => ({ id: String(i), name })), allColumns: [] });
  service.context = async () => ({ table: { has_partition: false }, columns: names.map(name => ({ name })), fieldReferences: [] });
  try {
    prisma.$transaction = async () => { touched = true; };
    await assert.rejects(() => service.execute("task", { referenceMarkdown: reference }), /AI 建议与已选字段不一致/);
    assert.equal(touched, false);
  } finally { prisma.$transaction = oldTransaction; }
});

test("AI structural validation errors are Chinese", () => {
  const service = new GovernanceAiService({});
  assert.throws(() => service.parse("not json", names, preferred, undefined), /不是有效的 JSON/);
  assert.throws(() => service.parse("{}", names, preferred, undefined), /AI 建议格式不正确/);
  const changed = result(); changed.columns[1].column_name = "foreign";
  assert.throws(() => service.parse(JSON.stringify(changed), names, preferred, undefined), /缺少字段：shop_id；多余字段：foreign/);
});

test("generation errors preserve actionable Chinese messages and translate provider or unexpected failures", () => {
  assert.equal(generationErrorMessage(new BadRequestException("权限字段为选填项"), "VALIDATING_RESULT"), "权限字段为选填项");
  assert.match(generationErrorMessage(new Error("provider connection failed"), "CALLING_LLM"), /AI 模型调用失败/);
  assert.match(generationErrorMessage(new HttpException("Unauthorized", 401), "CALLING_LLM"), /鉴权失败/);
  assert.match(generationErrorMessage(new HttpException("Rate limited", 429), "CALLING_LLM"), /额度不足/);
  assert.match(generationErrorMessage(new Error("database down"), "SAVING_SUGGESTIONS"), /保存 AI 建议失败/);
  assert.match(generationErrorMessage(undefined), /AI 建议生成失败/);
  const service = new GovernanceGenerationService({}, {});
  const record = { id: "old", status: "FAILED", step: "VALIDATING_RESULT", message: "AI 建议生成失败", error: "Storage type is only available for partitioned tables", startedAt: new Date(), completedAt: new Date() };
  assert.match(service.view(record).error, /AI 返回的建议未通过校验/);
  assert.equal(service.view({ ...record, error: null }).error, null);
});

test("background generation stores a Chinese error instead of returning the raw provider message", async () => {
  const originals = Object.fromEntries(["aiGeneration", "governanceTask", "$transaction"].map(key => [key, prisma[key]]));
  const generation = { id: "generation", status: "RUNNING", step: "CALLING_LLM", previousTaskStatus: "REVIEWING" };
  let update;
  prisma.aiGeneration = { findUnique: async () => generation, update: args => { update = args; return Promise.resolve(args); } };
  prisma.governanceTask = { update: async () => ({}) };
  prisma.$transaction = async operations => Promise.all(operations);
  const service = new GovernanceGenerationService({ update: async () => {} }, { execute: async () => { throw new Error("provider failure with internal details"); } });
  try {
    await service.run("generation", "task", {});
    assert.equal(update.data.status, "FAILED");
    assert.match(update.data.error, /AI 模型调用失败/);
    assert.doesNotMatch(update.data.error, /internal details/);
  } finally { Object.assign(prisma, originals); }
});

async function markdownPipeline(contract, generated, run, { markdown = reference, fields = names.map((name, i) => ({ id: String(i), name, isPartition: false })), preferredNames = preferred } = {}) {
  const oldTransaction = prisma.$transaction;
  const calls = [], saved = {};
  const service = new GovernanceAiService(
    { complete: async (system, user) => { calls.push({ system, user: JSON.parse(user) }); return JSON.stringify(calls.length === 1 ? contract : generated); } },
    new MetricFormulaService(), {},
    { governanceOptions: async () => ({ dataDomains: [], permissionRelations: [] }), aiPrompt: async () => ({ prompt: "custom system" }) },
  );
  service.task = async () => ({ columns: fields, allColumns: fields });
  service.context = async () => ({ table: { has_partition: false }, columns: fields, fieldReferences: [...preferredNames].map(([current_column, preferred_name]) => ({ current_column, preferred_name })) });
  service.suggestions = async () => saved;
  const noop = async () => {};
  try {
    prisma.$transaction = async callback => {
      saved.started = true;
      return callback({
        aiTableSuggestion: { upsert: async record => { saved.table = record; } },
        aiColumnSuggestion: { deleteMany: noop, createMany: async record => { saved.columns = record.data; } },
        aiMetricSuggestion: { deleteMany: noop, createMany: async record => { saved.metrics = record.data; } },
        governanceTask: { update: noop },
      });
    };
    await run({ service, calls, saved, execute: () => service.execute("task", { referenceMarkdown: markdown }) });
  } finally { prisma.$transaction = oldTransaction; }
}

test("the checked document field mapping and explicit units/formulas override swapped names and model drift", async () => {
  const generated = result();
  generated.columns[0].metric_name = "店铺编号";
  generated.columns[0].unit = "美元";
  generated.columns[1].metric_name = "支付金额";
  generated.metrics[0].formula = "SUM(pay_amt)*2";
  generated.metrics[0].unit = "美元";
  generated.table.business_name = "AI 自拟表名称";
  await markdownPipeline(contractResult(), generated, async ({ execute, calls, saved }) => {
    await execute();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].user.markdown_contract, contractResult());
    assert.equal(calls[1].user.supplementary_business_reference, undefined);
    assert.deepEqual(saved.columns.map(column => column.metricName), ["支付金额", "店铺编号"]);
    assert.equal(saved.columns[0].unit, "元");
    assert.equal(saved.metrics[0].formula, "SUM(pay_amt)");
    assert.equal(saved.metrics[0].unit, "元");
    assert.equal(saved.table.create.businessName, "订单业务");
  });
});

test("an incomplete extraction quote is ignored without preventing inference", async () => {
  const contract = contractResult(); contract.columns[0].evidence = contract.columns[1].evidence;
  const generated = result(); generated.columns[0].metric_name = "";
  await markdownPipeline(contract, generated, async ({ execute, calls, saved }) => {
    await execute();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].user.markdown_contract.columns.map(column => column.column_name), ["shop_id"]);
    assert.equal(saved.columns[0].metricName, "历史支付金额");
    assert.equal(saved.columns[1].metricName, "店铺编号");
  });
});

test("missing Markdown mappings use historical names, while unsubstantiated units are not authoritative", async () => {
  const missing = contractResult(); missing.columns.pop();
  const generated = result(); generated.columns[1].metric_name = "shop_id";
  await markdownPipeline(missing, generated, async ({ execute, calls, saved }) => {
    await execute();
    assert.equal(calls.length, 2);
    assert.equal(saved.columns[0].metricName, "支付金额");
    assert.equal(saved.columns[1].metricName, "历史店铺");
  });
  const fakeUnit = contractResult(); fakeUnit.columns[0].unit = "美元";
  await markdownPipeline(fakeUnit, result(), async ({ execute, calls, saved }) => {
    await execute();
    assert.equal(calls[1].user.markdown_contract.columns[0].unit, null);
    assert.equal(saved.columns[0].unit, "元");
  });
});

test("inferred calculations still pass formula safety checks before saving", async () => {
  const generated = result(); generated.metrics[0] = { name: "推导指标", formula: "SELECT * FROM other_table" };
  await markdownPipeline(contractResult(), generated, async ({ execute, saved }) => {
    await assert.rejects(execute, /SQL|SELECT|公式|表达式/i);
    assert.equal(saved.started, undefined);
  });
});

for (const decodedEvidence of [false, true]) {
  test(`crowd portrait Markdown saves all eight escaped field mappings (decoded evidence=${decodedEvidence})`, async () => {
    const markdown = fs.readFileSync(path.join(__dirname, "fixtures/crowd-portrait.md"), "utf8");
    const mappings = [["get_date", "日期"], ["shop_project", "品牌项目名"], ["shop_fin_name", "店铺名称"], ["crowd_detail_name", "人群名称"], ["crowd_detail_type", "人群类型"], ["customer_num", "客户数"], ["customer_type", "客户类型"], ["crowd_type", "人群归属"]];
    const fields = mappings.map(([name], index) => ({ id: String(index), name, isPartition: false }));
    const contract = {
      table: { business_name: "天猫客户人群", description: null },
      columns: mappings.map(([column_name, metric_name]) => {
        const evidence = markdown.split("\n").find(line => line.includes(`| ${metric_name} |`) && line.includes(column_name.replaceAll("_", "\\_"))).trim();
        return { column_name, metric_name, evidence: decodedEvidence ? evidence.replaceAll("\\_", "_") : evidence, unit: null, aggregation: column_name === "customer_num" ? "SUM" : null };
      }),
      metrics: [],
    };
    const generated = {
      table: { business_name: "模型自拟名称", description: "客户画像数据" },
      columns: mappings.map(([column_name]) => ({ column_name, metric_name: "模型自拟字段名", semantic_type: column_name === "customer_num" ? "METRIC" : "DIMENSION", aggregation: "AVG" })),
    };
    await markdownPipeline(contract, generated, async ({ execute, calls, saved }) => {
      await execute();
      assert.deepEqual(saved.columns.map(column => column.metricName), mappings.map(([, name]) => name));
      assert.equal(saved.columns[5].aggregation, "SUM");
      assert.equal(saved.table.create.businessName, "天猫客户人群");
      assert.equal(calls[1].user.markdown_contract.columns.length, 8);
    }, { markdown, fields });
  });
}

test("Markdown with no mappings uses actual history, comments and physical-name inference", async () => {
  const originals = { columnSemantic: prisma.columnSemantic, semanticMetric: prisma.semanticMetric };
  const fields = [
    { id: "0", name: "pay_amt", dataType: "DECIMAL", comment: "注释支付金额", isPartition: false },
    { id: "1", name: "shop_id", dataType: "STRING", comment: "注释店铺编号", isPartition: false },
    { id: "2", name: "order_count", dataType: "BIGINT", comment: null, isPartition: false },
  ];
  try {
    prisma.columnSemantic = { findMany: async () => [{ metricName: "历史支付金额", semanticType: "METRIC", aggregation: "SUM", unit: "元", metaColumn: { name: "pay_amt", metaTable: { name: "orders", metaProject: { name: "dw" } } } }] };
    prisma.semanticMetric = { findMany: async () => [] };
    const historical = await new SemanticReferenceService().build(fields);
    const preferredNames = new Map(historical.fieldReferences.map(item => [item.current_column, item.preferred_name]));
    const contract = { table: { business_name: null, description: null }, columns: [], metrics: [] };
    const generated = {
      table: { business_name: "推导表名", description: "推导业务描述" },
      columns: fields.map(field => ({ column_name: field.name, metric_name: field.name, semantic_type: field.name === "shop_id" ? "DIMENSION" : "METRIC", aggregation: "SUM" })),
      metrics: [{ name: "推导总支付金额", formula: "SUM(pay_amt)", reason: "根据当前金额字段推导，待人工确认" }],
    };
    await markdownPipeline(contract, generated, async ({ execute, calls, saved }) => {
      await execute();
      assert.deepEqual(saved.columns.map(column => column.metricName), ["历史支付金额", "注释店铺编号", "订单数量"]);
      assert.equal(saved.table.create.businessName, "推导表名");
      assert.equal(saved.metrics[0].name, "推导总支付金额");
      assert.match(saved.metrics[0].reason, /待人工确认/);
      assert.equal(calls[1].user.current_table_context.columns[1].comment, "注释店铺编号");
      assert.deepEqual(calls[1].user.markdown_contract.columns, []);
      assert.match(calls[0].system, /直接省略，不报错/);
    }, { markdown: "# 业务说明\n本文未记录任何物理字段与名称的对应关系。", fields, preferredNames });
  } finally { Object.assign(prisma, originals); }
});

test("duplicate, foreign and unsubstantiated document mappings do not block inference", async () => {
  const contract = contractResult();
  contract.columns.push({ ...contract.columns[0] }, { column_name: "foreign", metric_name: "店铺编号", evidence: "| shop_id | 店铺编号 | |", unit: null, aggregation: null }, null);
  contract.metrics.push({ ...contract.metrics[0] });
  const generated = result(); generated.columns[0].metric_name = "推导支付金额";
  await markdownPipeline(contract, generated, async ({ execute, calls, saved }) => {
    await execute();
    assert.deepEqual(calls[1].user.markdown_contract.columns.map(column => column.column_name), ["shop_id"]);
    assert.deepEqual(calls[1].user.markdown_contract.metrics, []);
    assert.equal(saved.columns[0].metricName, "推导支付金额");
    assert.equal(saved.columns[1].metricName, "店铺编号");
  });
});

test("escaped business names and metric formulas are normalized before applying the contract", async () => {
  const markdown = String.raw`表：订单\_业务
| pay\_amt | 支付\_金额 | 元 | sum |
计算指标：支付\_总额，公式 SUM(pay\_amt)，单位元。`;
  const contract = {
    table: { business_name: "订单_业务", description: null },
    columns: [{ column_name: "pay_amt", metric_name: "支付_金额", unit: "元", aggregation: "sum", evidence: String.raw`| pay\_amt | 支付\_金额 | 元 | sum |` }],
    metrics: [{ name: "支付_总额", formula: "SUM(pay_amt)", unit: "元", evidence: String.raw`计算指标：支付\_总额，公式 SUM(pay\_amt)，单位元。` }],
  };
  const generated = result(); generated.metrics[0] = { name: "支付_总额", formula: "SUM(pay_amt)*2" };
  await markdownPipeline(contract, generated, async ({ execute, saved }) => {
    await execute();
    assert.equal(saved.table.create.businessName, "订单_业务");
    assert.equal(saved.columns[0].metricName, "支付_金额");
    assert.equal(saved.columns[0].aggregation, "SUM");
    assert.equal(saved.metrics[0].formula, "SUM(pay_amt)");
  }, { markdown });
});
