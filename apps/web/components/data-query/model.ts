import type { DataDateFilter, DataQueryMode, SemanticPackage } from "@eureka-atlas/types";
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
