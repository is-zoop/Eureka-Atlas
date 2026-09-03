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

test("keeps Markdown reference separate from AI JSON output constraints", () => {
  const service = new GovernanceAiService({});
  const prompt = service.prompt({ table: { name: "sales" }, columns: [] }, "# 销售口径\n请使用自然语言");
  assert.match(prompt, /只返回 JSON/);
  assert.match(prompt, /补充业务参考/);
  assert.match(prompt, /不得改变输出 JSON 格式和字段范围/);
});
