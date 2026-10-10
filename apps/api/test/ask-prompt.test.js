const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("@eureka-atlas/database");
const { ASK_SYSTEM_PROMPT, ASK_QUERY_INSTRUCTIONS, buildAskSystemPrompt } = require("../dist/ask/ask-prompt");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { SystemSettingsService } = require("../dist/system-settings/system-settings.service");
const { SystemSettingsController } = require("../dist/system-settings/system-settings.controller");

test("ask prompt saves, feeds the Agent and resets independently of governance", async () => {
  const read = prisma.$queryRaw;
  const write = prisma.$executeRaw;
  const saved = new Map([["ai_system_prompt", "治理提示词保持原样"]]);
  prisma.$queryRaw = async (sql) => saved.has(sql.values[0]) ? [{ value: saved.get(sql.values[0]) }] : [];
  prisma.$executeRaw = async (sql) => {
    if (sql.strings.join("").startsWith("INSERT")) saved.set(sql.values[1], sql.values[2]);
    else saved.delete(sql.values[0]);
    return 1;
  };
  try {
    const settings = new SystemSettingsService();
    const controller = new SystemSettingsController(settings, {});
    assert.deepEqual(await controller.getAskPrompt(), { prompt: ASK_SYSTEM_PROMPT, defaultPrompt: ASK_SYSTEM_PROMPT, customized: false });
    const custom = "自定义问数提示词，{{current_date}}，{{table_count}} 张表";
    assert.equal((await controller.saveAskPrompt({ prompt: "  " + custom + "  " })).prompt, custom);
    assert.equal((await controller.getAskPrompt()).customized, true);
    const run = new AskRunService({}, {}, {}, {}, settings);
    const prompt = await run.systemPrompt({ tableIds: ["table-a", "table-b"], packages: new Map() });
    assert.ok(prompt.startsWith(buildAskSystemPrompt(custom, 2)));
    assert.match(prompt, /真实数据域：\[\]/);
    assert.equal((await settings.aiPrompt()).prompt, "治理提示词保持原样");
    await assert.rejects(controller.saveAskPrompt({ prompt: "  " }), /cannot be empty/);
    await assert.rejects(controller.saveAskPrompt({ prompt: "a".repeat(30001) }), /30,000/);
    assert.equal((await controller.getAskPrompt()).prompt, custom);
    assert.deepEqual(await controller.resetAskPrompt(), { prompt: ASK_SYSTEM_PROMPT, defaultPrompt: ASK_SYSTEM_PROMPT, customized: false });
    assert.equal((await settings.aiPrompt()).prompt, "治理提示词保持原样");
  } finally { prisma.$queryRaw = read; prisma.$executeRaw = write; }
});

test("ask prompt fills runtime variables in the configured template", () => {
  const rendered = buildAskSystemPrompt(ASK_SYSTEM_PROMPT, 3);
  assert.match(ASK_SYSTEM_PROMPT, /{{current_date}}/);
  assert.match(ASK_SYSTEM_PROMPT, /{{table_count}}/);
  assert.doesNotMatch(rendered, /{{current_date}}|{{table_count}}/);
  assert.ok(rendered.includes(new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })));
  assert.match(rendered, /本次已选的 3 张表/);
  assert.match(rendered, /present_query_results/);
  assert.match(rendered, /request_clarification/);
  assert.match(rendered, /默认以表格和文字回答，不主动生成图表/);
  assert.match(rendered, /只有当前用户问题明确要求生成或修改图表/);
  assert.match(rendered, /仅查询趋势、对比、环比、同比、排行或占比不代表要求图表/);
  assert.match(rendered, /不要因为上一轮生成过图表就沿用绘图意图/);
  const custom = buildAskSystemPrompt("仅输出结论", 3);
  assert.ok(custom.includes(ASK_QUERY_INSTRUCTIONS));
  assert.match(custom, /^仅输出结论\n\n查询工具执行规范/);
  assert.match(custom, /get_dimension_values 都必须传 date_range.start\/end/);
  assert.match(custom, /不能传 =、LIKE/);
  assert.match(custom, /候选值查询失败不是/);
  assert.match(custom, /本次运行支持 HTML\/SVG 图表/);
});
