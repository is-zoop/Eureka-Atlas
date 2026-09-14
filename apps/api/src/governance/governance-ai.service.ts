import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ColumnSemanticType, prisma } from "@eureka-atlas/database";
import { LlmService } from "../llm/llm.service";
import { MetricFormulaService } from "./metric-formula.service";
import { SemanticReferenceService } from "./semantic-reference.service";
import { DEFAULT_GOVERNANCE_OPTIONS, SystemSettingsService } from "../system-settings/system-settings.service";

type ParsedMetric = { name: string; formula: string; unit?: string; confidence?: number; reason?: string };
type Parsed = {
  table: { data_domain: string | null; business_name: string; description: string; grain: string; permission_column_name: string | null; permission_relation: string | null };
  columns: Array<{ column_name: string; metric_name: string; semantic_type: ColumnSemanticType; aggregation: string; unit: string; groupable: boolean; candidate_value_queryable: boolean; label_description: string | null; confidence: number; reason: string }>;
  metrics?: ParsedMetric[];
};
export type AiGenerationHooks = { referenceMarkdown?: string; signal?: AbortSignal; onStep?: (step: "PREPARING_CONTEXT" | "CALLING_LLM" | "VALIDATING_RESULT" | "SAVING_SUGGESTIONS", message: string) => Promise<void>; ensureActive?: () => Promise<void> };
const normalizedConfidence = (value: unknown) => { const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? "")); return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.7; };
const nullableText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const booleanValue = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "是"].includes(normalized)) return true;
  if (["false", "no", "否"].includes(normalized)) return false;
  return fallback;
};
const parseJsonObject = (raw: string) => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const object = trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  for (const candidate of [trimmed, fenced, object]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate) as unknown; } catch { /* Try the next representation. */ }
  }
  throw new BadRequestException("LLM returned invalid JSON");
};
const normalizeGrain = (value: unknown, selected: Map<string, string>, columns: Array<{ column_name: string; metric_name: string }>) => {
  const raw = nullableText(value);
  if (!raw) return "";
  const names = new Map(selected);
  for (const column of columns) names.set(column.metric_name.toLowerCase(), column.column_name);
  const resolved = raw.split(/[,，、;；|]+/).map((item) => names.get(item.trim().toLowerCase())).filter((item): item is string => Boolean(item));
  return resolved.length && resolved.length === raw.split(/[,，、;；|]+/).map((item) => item.trim()).filter(Boolean).length ? [...new Set(resolved)].join(",") : "";
};

@Injectable()
export class GovernanceAiService {
  constructor(private readonly llm: LlmService, private readonly formulas: MetricFormulaService, private readonly references: SemanticReferenceService, private readonly settings: SystemSettingsService) {}

  async execute(id: string, hooks: AiGenerationHooks = {}) {
    const task = await this.task(id);
    await hooks.onStep?.("PREPARING_CONTEXT", "正在整理表与字段上下文");
    const context = await this.context(task);
    await hooks.ensureActive?.();
    await hooks.onStep?.("CALLING_LLM", "正在调用 AI 模型生成建议");
    const options = await this.settings.governanceOptions();
    const prompt = await this.prompt(context, hooks.referenceMarkdown, options);
    const raw = await this.llm.complete(prompt.system, prompt.user, hooks.signal);
    await hooks.ensureActive?.();
    await hooks.onStep?.("VALIDATING_RESULT", "正在校验 AI 返回的建议");
    const parsed = this.parse(raw, task.columns.map((column) => column.name), new Map(context.fieldReferences.map((item) => [item.current_column, item.preferred_name])), Boolean(hooks.referenceMarkdown?.trim()), options);
    const columnSuggestions = parsed.columns.map((item) => {
      const column = task.columns.find((candidate) => candidate.name === item.column_name);
      if (!column) throw new BadRequestException("LLM response does not match selected columns");
      return { governanceTaskId: id, metaColumnId: column.id, metricName: item.metric_name, semanticType: item.semantic_type, aggregation: item.aggregation || null, unit: item.unit || null, groupable: item.groupable, candidateValueQueryable: item.candidate_value_queryable, labelDescription: item.label_description, confidence: item.confidence, reason: item.reason };
    });
    const metricSuggestions = (parsed.metrics ?? []).map((metric) => {
      const resolved = this.formulas.validateAndResolve(metric.formula, this.formulaFields(task.columns), this.formulaFields(task.allColumns));
      return { governanceTaskId: id, name: metric.name, formula: resolved.formula, unit: metric.unit || null, dependencies: resolved.dependencies, confidence: normalizedConfidence(metric.confidence), reason: String(metric.reason ?? "AI 生成建议").trim() || "AI 生成建议" };
    });
    await hooks.ensureActive?.();
    await hooks.onStep?.("SAVING_SUGGESTIONS", "正在保存 AI 建议");
    await prisma.$transaction(async (tx) => {
      const permissionColumnId = parsed.table.permission_column_name ? task.columns.find((column) => column.name === parsed.table.permission_column_name)?.id ?? null : null;
      await tx.aiTableSuggestion.upsert({ where: { governanceTaskId: id }, create: { governanceTaskId: id, dataDomain: parsed.table.data_domain, businessName: parsed.table.business_name, description: parsed.table.description, grain: parsed.table.grain || null, permissionColumnId, permissionRelation: parsed.table.permission_relation }, update: { dataDomain: parsed.table.data_domain, businessName: parsed.table.business_name, description: parsed.table.description, grain: parsed.table.grain || null, permissionColumnId, permissionRelation: parsed.table.permission_relation } });
      await tx.aiColumnSuggestion.deleteMany({ where: { governanceTaskId: id } });
      await tx.aiMetricSuggestion.deleteMany({ where: { governanceTaskId: id } });
      await tx.aiColumnSuggestion.createMany({ data: columnSuggestions });
      if (metricSuggestions.length) await tx.aiMetricSuggestion.createMany({ data: metricSuggestions });
      await tx.governanceTask.update({ where: { id }, data: { status: "REVIEWING" } });
    });
    return this.suggestions(id);
  }

  async suggestions(id: string) {
    await this.task(id);
    const [table, columns, metrics] = await Promise.all([
      prisma.aiTableSuggestion.findUnique({ where: { governanceTaskId: id } }),
      prisma.aiColumnSuggestion.findMany({ where: { governanceTaskId: id }, include: { metaColumn: { select: { id: true, name: true } } }, orderBy: { metaColumn: { ordinal: "asc" } } }),
      prisma.aiMetricSuggestion.findMany({ where: { governanceTaskId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    return { table, columns: columns.map((item) => ({ ...item, column: item.metaColumn })), metrics };
  }
  async count(id: string) { return prisma.aiColumnSuggestion.count({ where: { governanceTaskId: id } }); }

  private async task(id: string) {
    const task = await prisma.governanceTask.findUnique({ where: { id }, include: { metaTable: { include: { metaProject: true } } } });
    if (!task) throw new NotFoundException("Governance task not found");
    const selectedIds = Array.isArray(task.selectedColumns) ? task.selectedColumns.filter((item): item is string => typeof item === "string") : [];
    const allColumns = await prisma.metaColumn.findMany({ where: { metaTableId: task.metaTableId }, orderBy: { ordinal: "asc" } });
    const columns = allColumns.filter((column) => selectedIds.includes(column.id));
    if (!columns.length) throw new BadRequestException("Governance task has no selected columns");
    return { ...task, columns, allColumns };
  }
  private async context(task: Awaited<ReturnType<GovernanceAiService["task"]>>) {
    const historical = await this.references.build(task.columns);
    return { table: { project: task.metaTable.metaProject.name, name: task.metaTable.name, comment: task.metaTable.comment, type: task.metaTable.type }, columns: task.columns.map((column) => ({ name: column.name, type: column.dataType, comment: column.comment, is_partition: column.isPartition })), ...historical };
  }
  private async prompt(context: Awaited<ReturnType<GovernanceAiService["context"]>>, referenceMarkdown?: string, options: Awaited<ReturnType<SystemSettingsService["governanceOptions"]>> = DEFAULT_GOVERNANCE_OPTIONS) {
    const { prompt: system } = await this.settings.aiPrompt();
    const markdown = referenceMarkdown?.trim();
    return { system, user: JSON.stringify({ current_table_context: context, data_domain_options: options.dataDomains, permission_relation_options: options.permissionRelations, supplementary_business_reference: markdown, calculated_metric_policy: markdown ? "仅建议有 Markdown 明确依据的计算指标，不设数量上限" : "计算指标可省略，最多 5 条", required_response_contract: { table: "data_domain 必须从 data_domain_options 选择或为null；permission_relation 必须从 permission_relation_options 选择或为null；business_name、description、grain、permission_column_name（已选字段或null）与权限关系需成对。grain 必须仅使用当前已选字段的物理字段名，并使用英文逗号 , 分隔。", columns: "每个当前字段一项：column_name、metric_name、semantic_type、aggregation、unit、groupable、candidate_value_queryable、label_description、confidence、reason；维度和标签的两个开关缺省为true，其他类型为false", metrics: "name、formula、unit、confidence、reason" } }) };
  }
  private parse(raw: string, names: string[], preferredNames: Map<string, string>, hasReferenceMarkdown: boolean, options: Awaited<ReturnType<SystemSettingsService["governanceOptions"]>> = DEFAULT_GOVERNANCE_OPTIONS): Parsed {
    const data = parseJsonObject(raw);
    const result = data as Parsed;
    if (!result?.table || !Array.isArray(result.columns) || result.columns.length !== names.length || !result.table.business_name || !result.table.description) throw new BadRequestException("LLM response has an invalid suggestion structure");
    const selected = new Map(names.map((name) => [name.toLowerCase(), name]));
    const types: Record<string, ColumnSemanticType> = { METRIC: ColumnSemanticType.METRIC, "指标": ColumnSemanticType.METRIC, DIMENSION: ColumnSemanticType.DIMENSION, "维度": ColumnSemanticType.DIMENSION, LABEL: ColumnSemanticType.LABEL, ATTRIBUTE: ColumnSemanticType.LABEL, "标签": ColumnSemanticType.LABEL, PARTITION: ColumnSemanticType.PARTITION, "分区": ColumnSemanticType.PARTITION };
    const columns = result.columns.map((item) => {
      const columnName = selected.get(String(item.column_name ?? "").trim().toLowerCase()); const rawType = String(item.semantic_type ?? "").trim().toUpperCase();
      const semanticType = types[rawType] ?? (rawType.includes("METRIC") || rawType.includes("指标") ? ColumnSemanticType.METRIC : rawType.includes("DIMENSION") || rawType.includes("维度") ? ColumnSemanticType.DIMENSION : rawType.includes("LABEL") || rawType.includes("ATTRIBUTE") || rawType.includes("标签") ? ColumnSemanticType.LABEL : rawType.includes("PARTITION") || rawType.includes("分区") ? ColumnSemanticType.PARTITION : undefined);
      const supplied = String(item.metric_name ?? "").trim(); const preferred = columnName ? preferredNames.get(columnName) : undefined;
      const isMetric = semanticType === ColumnSemanticType.METRIC;
      const supportsOptions = semanticType === ColumnSemanticType.DIMENSION || semanticType === ColumnSemanticType.LABEL;
      return { column_name: columnName ?? String(item.column_name ?? "").trim(), semantic_type: semanticType, metric_name: !supplied || (columnName && supplied.toLowerCase() === columnName.toLowerCase() && preferred) ? preferred ?? supplied : supplied, aggregation: isMetric ? String(item.aggregation ?? "").trim() : "", unit: isMetric ? String(item.unit ?? "").trim() : "", groupable: supportsOptions ? booleanValue(item.groupable, true) : false, candidate_value_queryable: supportsOptions ? booleanValue(item.candidate_value_queryable, true) : false, label_description: semanticType === ColumnSemanticType.LABEL ? nullableText(item.label_description) : null, reason: String(item.reason ?? "AI 生成建议").trim() || "AI 生成建议", confidence: normalizedConfidence(item.confidence) };
    });
    const actual = columns.map((item) => item.column_name); const unexpected = actual.filter((name) => !names.includes(name)); const missing = names.filter((name) => !actual.includes(name));
    if (new Set(actual).size !== names.length || unexpected.length || missing.length) throw new BadRequestException(`LLM response does not match selected columns${missing.length ? `; missing: ${missing.slice(0, 8).join(", ")}` : ""}${unexpected.length ? `; unexpected: ${unexpected.slice(0, 8).join(", ")}` : ""}`);
    if (columns.some((item) => !item.metric_name || !item.semantic_type)) throw new BadRequestException(`LLM response has an invalid suggestion for column: ${columns.find((item) => !item.metric_name || !item.semantic_type)?.column_name}`);
    const rawTable = result.table as Record<string, unknown>;
    const requestedDataDomain = nullableText(rawTable.data_domain ?? rawTable.dataDomain);
    const dataDomain = requestedDataDomain && options.dataDomains.includes(requestedDataDomain) ? requestedDataDomain : null;
    const permissionColumnName = nullableText(rawTable.permission_column_name ?? rawTable.permissionColumnName);
    const requestedPermissionRelation = nullableText(rawTable.permission_relation ?? rawTable.permissionRelation);
    const resolvedPermissionColumnName = permissionColumnName ? selected.get(permissionColumnName.toLowerCase()) : null;
    const permissionRelation = requestedPermissionRelation && options.permissionRelations.includes(requestedPermissionRelation) ? requestedPermissionRelation : null;
    const permission = resolvedPermissionColumnName && permissionRelation ? { columnName: resolvedPermissionColumnName, relation: permissionRelation } : null;
    const metrics = Array.isArray(result.metrics) ? result.metrics : [];
    if (!hasReferenceMarkdown && metrics.length > 5) throw new BadRequestException("LLM returned more than 5 calculated metric suggestions");
    const normalizedMetrics = metrics.map((metric) => ({ name: String(metric.name ?? "").trim(), formula: String(metric.formula ?? "").trim(), unit: String(metric.unit ?? "").trim(), confidence: normalizedConfidence(metric.confidence), reason: String(metric.reason ?? "AI 生成建议").trim() || "AI 生成建议" }));
    if (normalizedMetrics.some((metric) => !metric.name || !metric.formula) || new Set(normalizedMetrics.map((metric) => metric.name)).size !== normalizedMetrics.length) throw new BadRequestException("LLM response has an invalid calculated metric suggestion");
    const grain = normalizeGrain(result.table.grain, selected, columns);
    return { table: { data_domain: dataDomain, business_name: String(result.table.business_name).trim(), description: String(result.table.description).trim(), grain, permission_column_name: permission?.columnName ?? null, permission_relation: permission?.relation ?? null }, columns, metrics: normalizedMetrics };
  }
  private formulaFields(columns: Array<{ id: string; name: string }>) { return columns.map((column) => ({ id: column.id, column: column.name })); }
}
