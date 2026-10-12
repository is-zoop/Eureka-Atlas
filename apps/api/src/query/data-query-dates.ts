import { BadRequestException } from "@nestjs/common";
import type { DataDateFilter, DataQueryFilter, DataQueryFilterLogic, QueryFilter, SemanticPackage } from "@eureka-atlas/types" with { "resolution-mode": "import" };

export const shiftDay = (day: string, days: number) => new Date(Date.parse(day + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const validDay = (day: unknown): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + "T00:00:00Z")) && new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
export function resolveDate(filter: DataDateFilter, now = new Date()) {
  if (filter.preset === "CUSTOM") {
    if (!validDay(filter.start) || !validDay(filter.end) || filter.start > filter.end) throw new BadRequestException("请选择有效的日期区间");
    return { start: filter.start, end: filter.end };
  }
  const days = { YESTERDAY: 1, LAST_7_DAYS: 7, LAST_30_DAYS: 30, LAST_N_DAYS: filter.days }[filter.preset];
  if (!Number.isInteger(days) || !days || days < 1 || days > 36500) throw new BadRequestException("近 N 天必须为 1 到 36500 的整数");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  const today = part("year") + "-" + part("month") + "-" + part("day");
  return { start: shiftDay(today, -days), end: shiftDay(today, -1) };
}
export function normalizeDataFilterLogic(value: unknown): DataQueryFilterLogic {
  if (value === undefined) return "AND";
  if (value !== "AND" && value !== "OR") throw new BadRequestException("筛选条件关系只能是 AND 或 OR");
  return value;
}

export type DataFilterGroup = { logic: DataQueryFilterLogic; filters: QueryFilter[] };

export function normalizeDataFilters(pkg: SemanticPackage, input: DataQueryFilter[] = [], now = new Date()) {
  if (!Array.isArray(input) || input.length > 100) throw new BadRequestException("筛选条件最多 100 个");
  // Each UI condition stays one group: a datetime range needs both bounds even under OR.
  const groups: DataFilterGroup[] = [];
  const resolvedDates: Array<{field_id:string;start:string;end:string}> = [];
  let dateRange: {start:string;end:string} | undefined;
  const config = pkg.table.query_config;
  for (const item of input) {
    if (!item || typeof item !== "object") throw new BadRequestException("筛选条件无效");
    const logic = normalizeDataFilterLogic(item.logic);
    const field = pkg.fields.find(f => f.id === item.field_id);
    if (!field) throw new BadRequestException("筛选字段不属于当前表");
    if (config.storage === "FULL_SNAPSHOT" && field.id === config.default_stat_date.field_id) throw new BadRequestException("快照日期由系统自动选择，不能手动筛选");
    if (!("preset" in item)) { groups.push({ logic, filters: [item] }); continue; }
    const isDefault = field.id === config.default_stat_date.field_id;
    if (!["DATE","DATETIME"].includes(field.normalized_type) && !(isDefault && ["yyyyMMdd","yyyy-MM-dd","yyyy/MM/dd"].includes(config.default_stat_date.format))) throw new BadRequestException("此字段未配置日期类型或日期格式");
    const range = resolveDate(item, now);
    resolvedDates.push({field_id:field.id,start:range.start,end:range.end});
    if (isDefault) {
      if (dateRange) throw new BadRequestException("默认统计日期只能设置一个范围");
      dateRange = range;
    } else if (field.normalized_type === "DATETIME") {
      groups.push({logic,filters:[{field_id:field.id,operator:"GTE",values:[range.start+" 00:00:00"]},{field_id:field.id,operator:"LT",values:[shiftDay(range.end,1)+" 00:00:00"]}]});
    } else { groups.push({logic,filters:[{field_id:field.id,operator:"BETWEEN",values:[range.start,range.end]}]}); }
  }
  if (config.storage === "DATE_INCREMENTAL" && !dateRange) throw new BadRequestException("日期增量表必须选择默认统计日期范围");
  return { filters: groups.flatMap(group => group.filters), groups, dateRange, resolvedDates };
}
