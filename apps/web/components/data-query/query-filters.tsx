"use client";

import type { DataDateFilter, DataQueryFilter, QueryFilterOperator, SemanticPackage } from "@eureka-atlas/types";
import { Info, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { CandidateValues } from "./candidate-values";
import { DateRangePicker } from "./date-range-picker";
import { dateField, previewDate } from "./model";

const labels: Record<QueryFilterOperator, string> = { EQ: "等于", NEQ: "不等于", GT: "大于", GTE: "大于等于", LT: "小于", LTE: "小于等于", BETWEEN: "区间", IN: "多值", IS_NULL: "为空", IS_NOT_NULL: "不为空", CONTAINS: "包含" };
const presets = [{ value: "YESTERDAY", label: "昨日" }, { value: "LAST_7_DAYS", label: "近 7 天" }, { value: "LAST_30_DAYS", label: "近 30 天" }, { value: "CUSTOM", label: "自定义区间" }, { value: "LAST_N_DAYS", label: "近 N 天" }];
const selectStyle = "h-9 justify-between border border-slate-200 bg-white px-3";

export function QueryFilters({ pkg, filters, onChange }: { pkg: SemanticPackage; filters: DataQueryFilter[]; onChange: (filters: DataQueryFilter[]) => void }) {
  const config = pkg.table.query_config;
  const available = pkg.fields.filter(field => !(config.storage === "FULL_SNAPSHOT" && field.id === config.default_stat_date.field_id));
  const requiredDateId = config.storage === "DATE_INCREMENTAL" ? config.default_stat_date.field_id : null;
  const requiredDateIndex = filters.findIndex(filter => filter.field_id === requiredDateId);
  const fieldGroups = ([["METRIC", "指标"], ["DIMENSION", "维度"], ["LABEL", "标签"], ["PARTITION", "分区"]] as const)
    .map(([type, label]) => ({ label, options: available.filter(field => field.type === type).map(field => ({ value: field.id, label: field.name, disabled: field.id === requiredDateId })) }))
    .filter(group => group.options.length);
  const fieldOptions = fieldGroups.flatMap(group => group.options);
  const optionalFields = available.filter(field => field.id !== requiredDateId);
  const nextField = optionalFields.find(field => !filters.some(filter => filter.field_id === field.id)) ?? optionalFields[0];
  const replace = (index: number, value: DataQueryFilter) => onChange(filters.map((item, i) => i === index ? value : item));
  const initial = (id: string): DataQueryFilter => dateField(pkg, id) ? { field_id: id, preset: "YESTERDAY" } : { field_id: id, operator: "EQ", values: [] };

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><h3 className="text-xs font-medium text-slate-600">筛选条件</h3><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">AND</span><span className="text-xs text-slate-400">聚合前生效</span></div>
      <Button variant="outline" size="sm" disabled={!nextField || filters.length >= 100} onClick={() => { if (nextField) onChange([...filters, initial(nextField.id)]); }}><Plus className="size-3.5" />添加条件</Button>
    </div>
    {config.storage === "FULL_SNAPSHOT" && <p className="flex items-center gap-1.5 text-xs leading-5 text-slate-400"><Info className="size-3.5 shrink-0" />自动读取最新快照，快照日期不可手动筛选。</p>}
    {!filters.length && <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-5 text-center text-xs text-slate-400">尚未添加筛选条件，可按日期、维度或指标缩小查询范围。</div>}
    {filters.map((filter, index) => {
      const field = pkg.fields.find(item => item.id === filter.field_id);
      if (!field) return null;
      const required = index === requiredDateIndex;
      const isDate = "preset" in filter;
      const candidate = field.type === "DIMENSION" || field.type === "LABEL";
      const operators: QueryFilterOperator[] = ["EQ", "NEQ", "IN", "IS_NULL", "IS_NOT_NULL", ...(["INTEGER", "DECIMAL", "DATE", "DATETIME"].includes(field.normalized_type) ? ["GT", "GTE", "LT", "LTE", "BETWEEN"] as QueryFilterOperator[] : []), ...(field.normalized_type === "STRING" ? ["CONTAINS"] as QueryFilterOperator[] : [])];
      return <div key={index} className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Combobox aria-label={`筛选字段 ${index + 1}`} className="h-9 w-full sm:w-44" inputClassName="h-9 border-slate-200 shadow-none" value={filter.field_id} disabled={required} options={fieldOptions} groups={fieldGroups} onValueChange={id => replace(index, initial(id))} />
          {isDate ? <>
            <Combobox aria-label={field.name + "日期范围"} className="h-9 w-36" inputClassName={selectStyle} searchable={false} value={filter.preset} options={presets} onValueChange={value => replace(index, { field_id: field.id, preset: value as DataDateFilter["preset"], days: filter.days ?? 7, start: filter.start, end: filter.end })} />
            {filter.preset === "LAST_N_DAYS" && <div className="flex items-center gap-2"><Input className="h-9 w-24 border-slate-200 shadow-none" type="number" min={1} max={36500} value={filter.days ?? 7} aria-label="近 N 天" onChange={event => replace(index, { ...filter, days: Number(event.target.value) })} /><span className="text-xs text-slate-400">天</span></div>}
            {filter.preset === "CUSTOM" && <DateRangePicker value={filter.start ? { from: new Date(filter.start + "T00:00:00"), to: filter.end ? new Date(filter.end + "T00:00:00") : undefined } : undefined} placeholder="选择日期区间" onChange={range => replace(index, { ...filter, start: format(range.from!, "yyyy-MM-dd"), end: format(range.to!, "yyyy-MM-dd") })} />}
            <span className="inline-flex items-center gap-2 text-xs leading-5 whitespace-nowrap text-slate-400">实际日期：{previewDate(filter)}{required && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">必填</span>}</span>
          </> : <>
            <Combobox aria-label={field.name + "比较方式"} className="h-9 w-28" inputClassName={selectStyle} searchable={false} value={filter.operator} options={operators.map(value => ({ value, label: labels[value] }))} onValueChange={value => replace(index, { ...filter, operator: value as QueryFilterOperator, values: ["IS_NULL", "IS_NOT_NULL"].includes(value) ? [] : filter.values ?? [] })} />
            {!["IS_NULL", "IS_NOT_NULL"].includes(filter.operator) && <Input className="h-9 min-w-36 flex-1 border-slate-200 shadow-none" aria-label={field.name + "筛选值"} placeholder={filter.operator === "IN" ? "多个值用逗号分隔（最多 100 个）" : filter.operator === "BETWEEN" ? "起始值,结束值" : "输入筛选值"} value={(filter.values ?? []).join(",")} onChange={event => replace(index, { ...filter, values: event.target.value === "" ? [] : ["IN", "BETWEEN"].includes(filter.operator) ? event.target.value.split(/[,，]/).map(value => value.trim()) : [event.target.value] })} />}
            {candidate && ["EQ", "IN"].includes(filter.operator) && field.candidate_value_queryable && <CandidateValues tableId={pkg.table.id} fieldId={field.id} filters={filters} values={filter.values ?? []} onChange={values => replace(index, { ...filter, operator: filter.operator === "IN" || values.length > 1 ? "IN" : "EQ", values })} />}
          </>}
          <Button aria-label="删除筛选" title={required ? "默认统计日期为必填条件" : "删除筛选"} className="ml-auto text-slate-400 hover:text-rose-600" variant="ghost" size="icon-sm" disabled={required} onClick={() => onChange(filters.filter((_, i) => i !== index))}><X className="size-4" /></Button>
        </div>
        {!isDate && candidate && !field.candidate_value_queryable && <p className="mt-2 text-xs text-slate-400">未开放候选值查询，请手动输入单值或多值。</p>}
        {isDate && !required && <Button className="mt-2 h-6 px-0 text-xs text-slate-500 hover:bg-transparent" variant="ghost" size="sm" onClick={() => replace(index, { field_id: field.id, operator: "EQ", values: [] })}>其他比较／空值条件</Button>}
        {!isDate && dateField(pkg, field.id) && <Button className="mt-2 h-6 px-0 text-xs text-slate-500 hover:bg-transparent" variant="ghost" size="sm" onClick={() => replace(index, initial(field.id))}>使用日期预设</Button>}
      </div>;
    })}
  </div>;
}
