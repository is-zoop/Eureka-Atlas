import { BadRequestException } from "@nestjs/common";
import type { AskChartSpec, AskSavedQueryResult } from "@eureka-atlas/types" with { "resolution-mode": "import" };

const numericType = /^(tinyint|smallint|int|integer|bigint|float|double|decimal|numeric|number|real)/i;
const numericValue = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Chart definitions reference saved columns; the model never supplies plotted values or HTML. */
export function validateCharts(input: unknown, queryIds: string[], snapshots: AskSavedQueryResult[]): AskChartSpec[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 4) throw new BadRequestException("一次最多展示 4 张图表");
  const selected = new Set(queryIds);
  const queries = new Set<string>();
  return input.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new BadRequestException("图表配置无效");
    const value = item as Record<string, unknown>;
    const saved = snapshots.find((snapshot) => snapshot.query_id === value.query_id);
    if (typeof value.query_id !== "string" || !selected.has(value.query_id) || !saved || !("metric_ids" in saved.query_definition)) throw new BadRequestException("图表只能引用本轮已选的指标查询结果");
    if (queries.has(value.query_id)) throw new BadRequestException("每个查询结果只能指定一张图表");
    queries.add(value.query_id);
    if (!["line", "bar", "pie"].includes(String(value.type))) throw new BadRequestException("仅支持折线图、柱状图和饼图");
    if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 120) throw new BadRequestException("图表标题为 1 到 120 个字符");
    const result = saved.execution.result;
    if (!result || !Number.isInteger(value.x_column) || Number(value.x_column) < 0 || Number(value.x_column) >= result.columns.length) throw new BadRequestException("图表横轴列不存在");
    if (!Array.isArray(value.y_columns) || !value.y_columns.length || value.y_columns.length > 4) throw new BadRequestException("请选择 1 到 4 个数值指标");
    const yColumns = value.y_columns as number[];
    if (new Set(yColumns).size !== yColumns.length || yColumns.some((index) => !Number.isInteger(index) || index < 0 || index >= result.columns.length || index === value.x_column || !numericType.test(result.columns[index].type))) throw new BadRequestException("图表指标必须是不同的数值列，且不能与横轴相同");
    const units = new Set(yColumns.map((index) => result.columns[index].unit ?? ""));
    if (units.size > 1) throw new BadRequestException("同一图表的指标单位必须一致，请分别展示不同单位的指标");
    const xColumn = Number(value.x_column);
    const categories = result.rows.map((row) => JSON.stringify(row[xColumn]));
    if (new Set(categories).size !== categories.length) throw new BadRequestException("横轴存在重复分类，请查询唯一分组结果；图表不会自行汇总");
    if (value.type === "pie" && (yColumns.length !== 1 || result.rows.length > 20)) throw new BadRequestException("饼图只支持一个指标和最多 20 个分类，请使用柱状图或调整查询");
    let validCount = 0;
    let hasPositive = false;
    for (const row of result.rows) for (const index of yColumns) {
      const raw = row[index];
      if (raw === null) continue;
      if ((typeof raw !== "number" && typeof raw !== "string") || !numericValue.test(String(raw)) || !Number.isFinite(Number(raw))) throw new BadRequestException("指标含有无法绘图的值，请查看结果表");
      validCount++;
      if (Number(raw) > 0) hasPositive = true;
      if (value.type === "pie" && Number(raw) < 0) throw new BadRequestException("饼图不支持负值，请使用柱状图");
    }
    if (result.rows.length && (!validCount || (value.type === "pie" && !hasPositive))) throw new BadRequestException("没有可绘图的指标值，请使用表格查看");
    return { query_id: value.query_id, type: value.type as AskChartSpec["type"], title: value.title.trim(), x_column: xColumn, y_columns: yColumns };
  });
}

export function finalCharts(messages: Array<{ role: string; content: unknown }>, queryIds: string[]): AskChartSpec[] {
  for (const message of [...messages].reverse()) {
    const content = message.content as { toolName?: string; isError?: boolean; details?: { charts?: AskChartSpec[] } } | null;
    if (message.role !== "TOOL" || content?.toolName !== "present_query_results" || content.isError) continue;
    return (content.details?.charts ?? []).filter((chart) => queryIds.includes(chart.query_id));
  }
  return [];
}