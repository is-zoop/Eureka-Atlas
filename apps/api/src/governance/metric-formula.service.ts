import { BadRequestException, Injectable } from "@nestjs/common";

export type FormulaField = { id: string; column: string };
const unsafePattern = /\b(SELECT|FROM|JOIN|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b|;|--|\/\*/i;
const keywords = ["SUM", "COUNT", "AVG", "MIN", "MAX", "IF", "NULLIF", "COALESCE", "ROUND", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST", "AS", "DISTINCT"];

@Injectable()
export class MetricFormulaService {
  validateAndResolve(formula: string, selectedFields: FormulaField[], allFields: FormulaField[]) {
    const value = formula.trim();
    if (!value) this.fail("计算公式不能为空", 0);
    const unsafe = unsafePattern.exec(value);
    if (unsafe) this.fail("公式仅支持单表表达式，不能包含完整 SQL、注释或分号", unsafe.index);
    this.validateStructure(value);
    const selectedByName = new Map(selectedFields.map((field) => [field.column.toLowerCase(), field]));
    const allByName = new Map(allFields.map((field) => [field.column.toLowerCase(), field]));
    const dependencies: FormulaField[] = [];
    for (const match of value.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const identifier = match[0];
      const known = allByName.get(identifier.toLowerCase());
      if (!known) continue;
      const selected = selectedByName.get(identifier.toLowerCase());
      if (!selected) this.fail(`公式引用了未选择字段：${identifier}`, match.index ?? 0);
      if (!dependencies.some((field) => field.id === selected.id)) dependencies.push(selected);
    }
    if (!dependencies.length) this.fail("公式至少需要引用一个当前已选字段", 0);
    return {
      formula: this.normalize(value),
      dependencies: dependencies.map((field) => ({ meta_column_id: field.id, column: field.column })),
      warnings: this.unknownFunctions(value, allByName),
    };
  }

  private validateStructure(value: string) {
    const stack: number[] = [];
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (quote) {
        if (char === quote && value[index + 1] !== quote) quote = "";
        else if (char === quote) index += 1;
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === "(") stack.push(index);
      if (char === ")") {
        if (!stack.length) this.fail("存在未匹配的右括号", index);
        stack.pop();
      }
    }
    if (quote) this.fail("字符串引号未闭合", value.length - 1);
    if (stack.length) this.fail("左括号未闭合", stack.at(-1) ?? 0);
    if (/[+\-*/,(]\s*$/.test(value)) this.fail("公式结尾缺少表达式", value.length - 1);
  }

  private normalize(value: string) {
    return value.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (word) => keywords.includes(word.toUpperCase()) ? word.toUpperCase() : word);
  }

  private unknownFunctions(value: string, fields: Map<string, FormulaField>) {
    const warnings: string[] = [];
    for (const match of value.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      const name = match[1];
      if (!keywords.includes(name.toUpperCase()) && !fields.has(name.toLowerCase())) warnings.push(`未识别函数：${name}；请确认其兼容 MaxCompute`);
    }
    return [...new Set(warnings)];
  }

  private fail(message: string, position: number): never {
    throw new BadRequestException({ message, position, code: "FORMULA_INVALID" });
  }
}
