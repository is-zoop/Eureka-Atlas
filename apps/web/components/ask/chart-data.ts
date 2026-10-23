import type { AskChartSpec, QueryResult } from "@eureka-atlas/types";
import { convertUnitValue } from "@eureka-atlas/result-format";

export const chartColors = ["#3b82f6", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16", "#ec4899", "#f97316", "#6366f1", "#0f766e", "#a855f7", "#ca8a04", "#e11d48", "#0284c7", "#65a30d", "#c026d3", "#c2410c", "#4f46e5", "#475569"];
export const chartTypes = [{ value: "line", label: "折线图" }, { value: "bar", label: "柱状图" }, { value: "pie", label: "饼图" }];
export const isNumericColumn = (type: string) => /^(tinyint|smallint|int|integer|bigint|float|double|decimal|numeric|number|real)/i.test(type);
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export type ChartPoint = { label: string; values: Array<number | null>; raw: string[] };
export type ChartData = { points: ChartPoint[]; names: string[]; unit: string; error?: string };

const dateColumn = (column: QueryResult["columns"][number]) => /date|time|日期|月份|年月|时间/i.test(column.type + " " + column.name);
const labelFor = (value: unknown, column: QueryResult["columns"][number]) => {
  const raw = value === null ? "NULL" : String(value);
  return dateColumn(column) && /^\d{8}$/.test(raw) ? raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6) : raw;
};

export function chartData(result: QueryResult, spec: AskChartSpec): ChartData {
  const invalid = (error: string): ChartData => ({ points: [], names: [], unit: "", error });
  if (!["line", "bar", "pie"].includes(spec.type) || !Number.isInteger(spec.x_column) || !result.columns[spec.x_column] || !spec.y_columns.length || spec.y_columns.length > 4) return invalid("图表配置无效，请重新选择横轴和指标。");
  if (new Set(spec.y_columns).size !== spec.y_columns.length || spec.y_columns.some((index) => !Number.isInteger(index) || index === spec.x_column || !result.columns[index] || !isNumericColumn(result.columns[index].type))) return invalid("请选择数值指标，并使用不同的列作为横轴。");
  const units = new Set(spec.y_columns.map((index) => result.columns[index].unit ?? ""));
  if (units.size > 1) return invalid("指标单位不同，请选择一个指标或相同单位的指标。");
  if (spec.type === "pie" && (spec.y_columns.length !== 1 || result.rows.length > 20)) return invalid("饼图只支持一个指标和最多 20 个分类，请选择柱状图或调整查询。");
  const categories = result.rows.map((row) => JSON.stringify(row[spec.x_column]));
  if (new Set(categories).size !== categories.length) return invalid("横轴存在重复分类，请选择唯一分类或按该维度重新查询；图表不会自行汇总。");
  let count = 0;
  let positive = false;
  let error = "";
  const points = result.rows.map((row): ChartPoint => ({
    label: labelFor(row[spec.x_column], result.columns[spec.x_column]),
    raw: spec.y_columns.map((index) => row[index] === null ? "NULL" : convertUnitValue(String(row[index]), result.columns[index].unit)),
    values: spec.y_columns.map((index) => {
      const raw = row[index];
      if (raw === null) return null;
      if ((typeof raw !== "number" && typeof raw !== "string") || !decimal.test(String(raw)) || !Number.isFinite(Number(raw))) { error = "指标包含无法绘图的值，请使用表格查看。"; return null; }
      const value = Number(convertUnitValue(raw, result.columns[index].unit));
      if (!Number.isFinite(value)) { error = "指标换算后超出图表数值范围，请使用表格查看。"; return null; }
      count++;
      if (value > 0) positive = true;
      if (spec.type === "pie" && value < 0) error = "饼图不支持负值，请切换为柱状图。";
      return value;
    }),
  }));
  if (error) return invalid(error);
  if (!points.length) return invalid("没有符合条件的数据。");
  if (!count || (spec.type === "pie" && !positive)) return invalid("没有可绘图的指标值，请使用表格查看。");
  return { points, names: spec.y_columns.map((index) => result.columns[index].name), unit: result.columns[spec.y_columns[0]].unit ?? "" };
}