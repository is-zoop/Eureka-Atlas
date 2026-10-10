import { BadRequestException } from "@nestjs/common";
import type { Type as TypeBox } from "typebox" with { "resolution-mode": "import" };
import type { AskClarification, AskClarificationRequest } from "@eureka-atlas/types" with { "resolution-mode": "import" };

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function clarificationParameters(Type: typeof TypeBox) {
  return Type.Object({
    question: Type.String({ minLength: 1 }),
    selection_mode: Type.Union([Type.Literal("single"), Type.Literal("multiple")], {
      description: "互斥选项用 single；可同时成立、合并执行的选项用 multiple。混合情况拆成连续问题。",
    }),
    options: Type.Array(Type.Object({
      summary: Type.String({ minLength: 1, description: "简短的业务摘要，不包含字母编号。" }),
      description: Type.String({ minLength: 1, description: "解释范围和选项差异，只使用已确认的表、指标和日期。" }),
    }, { additionalProperties: false }), { maxItems: 8, description: "最多 8 个选项，纯文字澄清传空数组。" }),
  }, { additionalProperties: false });
}

export function createClarification(id: string, input: unknown): AskClarification {
  const value = record(input);
  const question = text(value.question);
  if (!question) throw new BadRequestException("澄清问题不能为空");
  if (value.selection_mode !== "single" && value.selection_mode !== "multiple") {
    throw new BadRequestException("澄清选择模式必须是 single 或 multiple");
  }
  if (!Array.isArray(value.options) || value.options.length > 8) {
    throw new BadRequestException("澄清选项必须是数组，最多 8 项");
  }
  const options = value.options.map((item: unknown, index: number) => {
    const option = record(item);
    const summary = text(option.summary);
    const description = text(option.description);
    if (!summary || !description) throw new BadRequestException("澄清选项需要摘要和详细说明");
    return { id: String.fromCharCode(65 + index), summary, description };
  });
  return { id, question, selection_mode: value.selection_mode, options, response: null, answer: null };
}

export function answerClarification(clarification: AskClarification, input: AskClarificationRequest) {
  if (!Array.isArray(input.selected_option_ids) || input.selected_option_ids.some((id) => typeof id !== "string") ||
    typeof input.custom_text !== "string") {
    throw new BadRequestException("请提交选项 ID 数组和补充文字");
  }
  const selected = new Set(input.selected_option_ids);
  if (selected.size !== input.selected_option_ids.length) throw new BadRequestException("选项 ID 不能重复");
  if (input.selected_option_ids.some((id) => !clarification.options.some((option) => option.id === id))) {
    throw new BadRequestException("存在未知的选项 ID");
  }
  if (clarification.selection_mode === "single" && selected.size > 1) {
    throw new BadRequestException("单选问题只能选择一个选项");
  }
  const customText = input.custom_text.trim();
  if (!selected.size && !customText) throw new BadRequestException("请选择选项或输入自己的回答");
  const options = clarification.options.filter((option) => selected.has(option.id));
  const parts: string[] = [];
  if (options.length) parts.push("所选选项：\n" + options.map((option) =>
    option.id + ". " + option.summary + "： " + option.description).join("\n"));
  if (customText) parts.push("补充说明： " + customText);
  return {
    response: { selected_option_ids: options.map((option) => option.id), custom_text: customText },
    answer: parts.join("\n"),
  };
}

/** Only the current protocol is accepted. Old pending runs must be stopped and asked again. */
export function readClarification(value: unknown, id: string): AskClarification | null {
  if (!id) return null;
  const stored = record(value);
  try {
    const clarification = createClarification(id, stored);
    const options = stored.options as Array<Record<string, unknown>>;
    if (options.some((option, index) => option.id !== clarification.options[index].id) ||
      !(stored.answer === null || typeof stored.answer === "string")) return null;
    if (stored.response === null && stored.answer === null) return clarification;
    const response = record(stored.response);
    const answered = answerClarification(clarification, {
      clarification_id: id,
      selected_option_ids: response.selected_option_ids as string[],
      custom_text: response.custom_text as string,
    });
    if (stored.answer !== answered.answer) return null;
    return { ...clarification, ...answered };
  } catch {
    return null;
  }
}