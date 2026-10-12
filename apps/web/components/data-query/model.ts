import type { DataDateFilter, DataQueryMode, SavedDataQueryConfig, SemanticPackage } from "@eureka-atlas/types";

export function configKey(config: SavedDataQueryConfig) {
  return JSON.stringify({ table_id: config.table_id, mode: config.mode, field_ids: config.field_ids, filters: (config.filters ?? []).map(filter => "preset" in filter
    ? { field_id: filter.field_id, preset: filter.preset, days: filter.days, start: filter.start, end: filter.end, logic: filter.logic ?? "AND" }
    : { field_id: filter.field_id, operator: filter.operator, values: filter.values ?? [], logic: filter.logic ?? "AND" }), order_by: (config.order_by ?? []).map(order => ({ field_id: order.field_id, direction: order.direction })) });
}

const validDay = (day?: string) => !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + "T00:00:00Z")) && new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
export function configErrors(pkg: SemanticPackage, config: SavedDataQueryConfig): string[] {
  const errors: string[] = [];
  if (!config.field_ids.length) errors.push("请至少选择一个输出字段");
  const fields = outputFields(pkg, config.mode);
  for (const id of config.field_ids) {
    const field = fields.find(item => item.id === id);
    if (!field) errors.push(`输出字段 ${id} 已失效，请移除或重新选择`);
    else if (field.disabled) errors.push(`字段「${field.name}」不适用于当前模式，请移除或切换模式`);
  }
  if (config.mode === "AGGREGATE" && !config.field_ids.some(id => pkg.fields.some(field => field.id === id && field.type === "METRIC") || pkg.metrics.some(metric => metric.id === id))) errors.push("汇总查询需要至少选择一个指标");
  for (const order of config.order_by ?? []) if (!config.field_ids.includes(order.field_id) || !fields.some(field => field.id === order.field_id && !field.disabled)) errors.push("排序字段已失效，请重新选择排序");
  const filters = config.filters ?? [];
  const defaultDate = pkg.table.query_config.default_stat_date.field_id;
  if (pkg.table.query_config.storage === "DATE_INCREMENTAL" && !filters.some(filter => filter.field_id === defaultDate && "preset" in filter)) errors.push("日期增量表必须选择默认统计日期范围");
  if (filters.filter(filter => filter.field_id === defaultDate && "preset" in filter).length > 1) errors.push("默认统计日期只能设置一个范围");
  for (const filter of filters) {
    const field = pkg.fields.find(item => item.id === filter.field_id);
    if (!field) { errors.push(`筛选字段 ${filter.field_id} 已失效，请删除或更换`); continue; }
    if (pkg.table.query_config.storage === "FULL_SNAPSHOT" && field.id === defaultDate) errors.push("快照日期由系统自动选择，请删除手动筛选");
    if ("preset" in filter) {
      if (!dateField(pkg, field.id)) errors.push(`「${field.name}」已不适用日期预设，请更换筛选方式`);
      if (filter.preset === "CUSTOM" && (!validDay(filter.start) || !validDay(filter.end) || filter.start! > filter.end!)) errors.push(`「${field.name}」需要有效日期区间`);
      if (filter.preset === "LAST_N_DAYS" && (!Number.isInteger(filter.days) || !filter.days || filter.days < 1 || filter.days > 36500)) errors.push("近 N 天必须为 1 到 36500 的整数");
    } else {
      const values = filter.values ?? [];
      if (["IS_NULL", "IS_NOT_NULL"].includes(filter.operator)) { if (values.length) errors.push(`「${field.name}」空值条件不能填写值`); continue; }
      if ((filter.operator === "IN" && (!values.length || values.length > 100)) || (filter.operator === "BETWEEN" && values.length !== 2) || (!["IN", "BETWEEN"].includes(filter.operator) && values.length !== 1)) errors.push(`请补全「${field.name}」的筛选值`);
      if (filter.operator === "CONTAINS" && field.normalized_type !== "STRING") errors.push(`「${field.name}」不支持包含条件`);
      if (["INTEGER", "DECIMAL"].includes(field.normalized_type) && values.some(value => !/^-?\d+(\.\d+)?$/.test(value))) errors.push(`「${field.name}」需要有效数值`);
      if (field.normalized_type === "BOOLEAN" && values.some(value => !["true", "false"].includes(value))) errors.push(`「${field.name}」需要 true 或 false`);
    }
  }
  return [...new Set(errors)];
}
export function outputFields(pkg: SemanticPackage,mode: DataQueryMode) {
  return [...pkg.fields.map(field => ({id:field.id,name:field.name,column:field.column,group:field.type,disabled:mode === "AGGREGATE" && field.type !== "METRIC" && !field.groupable})),...pkg.metrics.map(metric => ({id:metric.id,name:metric.name,column:"计算指标",group:"METRIC",disabled:mode === "DETAIL"}))];
}
export function dateField(pkg: SemanticPackage,id: string) {
  const field = pkg.fields.find(item => item.id === id);
  return !!field && (["DATE","DATETIME"].includes(field.normalized_type) || (pkg.table.query_config.default_stat_date.field_id === id && ["yyyyMMdd","yyyy-MM-dd","yyyy/MM/dd"].includes(pkg.table.query_config.default_stat_date.format)));
}
export function defaultFilters(pkg: SemanticPackage): DataDateFilter[] {
  const config = pkg.table.query_config;
  return config.storage === "DATE_INCREMENTAL" && config.default_stat_date.field_id ? [{field_id:config.default_stat_date.field_id,preset:"YESTERDAY"}] : [];
}
export function previewDate(filter: DataDateFilter,now = new Date()) {
  if(filter.preset === "CUSTOM")return [filter.start ?? "",filter.end ?? ""].join(" 至 ");
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const part = (key:string) => parts.find(item => item.type === key)!.value;
  const today = Date.parse(part("year")+"-"+part("month")+"-"+part("day")+"T00:00:00Z");
  const days = {YESTERDAY:1,LAST_7_DAYS:7,LAST_30_DAYS:30,LAST_N_DAYS:filter.days ?? 1}[filter.preset];
  return [new Date(today-days*86400000).toISOString().slice(0,10),new Date(today-86400000).toISOString().slice(0,10)].join(" 至 ");
}
