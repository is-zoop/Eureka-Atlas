"use client";

import * as React from "react";
import { Database, Layers3, RotateCcw, Search } from "lucide-react";
import type { SemanticSelectableTable } from "@eureka-atlas/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Props = {
  tables: SemanticSelectableTable[];
  value: string[];
  onValueChange: (tableIds: string[]) => void;
  disabled?: boolean;
  className?: string;
  fullHeight?: boolean;
  showSourceDetails?: boolean;
};

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
const groupLabel = (table: SemanticSelectableTable) => table.data_domain ?? "未分类";
const groupKey = (table: SemanticSelectableTable) => table.data_domain ?? "__uncategorized__";
const tableLocation = (table: SemanticSelectableTable) =>
  [table.source.project, table.source.catalog, table.source.schema].filter(Boolean).join(" / ");

export function SemanticTableSelector({ tables, value, onValueChange, disabled = false, className, fullHeight = false, showSourceDetails = true }: Props) {
  const [query, setQuery] = React.useState("");
  const selected = React.useMemo(() => new Set(value), [value]);
  const term = normalize(query);
  const filteredTables = React.useMemo(() => tables.filter((table) => {
    if (!term) return true;
    return [
      table.business_name,
      table.physical_name,
      table.data_domain ?? "",
      table.source.name,
      table.source.project,
      table.source.catalog,
      table.source.schema,
    ].some((value) => normalize(value).includes(term));
  }), [tables, term]);
  const groups = React.useMemo(() => Array.from(filteredTables.reduce((result, table) => {
    const key = groupKey(table);
    const group = result.get(key) ?? { key, label: groupLabel(table), tables: [] };
    group.tables.push(table);
    result.set(key, group);
    return result;
  }, new Map<string, { key: string; label: string; tables: SemanticSelectableTable[] }>()).values()), [filteredTables]);

  const setTables = React.useCallback((ids: string[], shouldSelect: boolean) => {
    const target = new Set(ids);
    const next = shouldSelect
      ? [...new Set([...value, ...ids])]
      : value.filter((id) => !target.has(id));
    onValueChange(next);
  }, [onValueChange, value]);

  const allSelected = tables.length > 0 && tables.every((table) => selected.has(table.id));

  return <section className={cn("overflow-hidden bg-white", fullHeight ? "flex h-full min-h-0 flex-col" : "rounded-xl border border-slate-200", className)}>
    <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3">
      <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索业务表、物理表或数据库位置" className="pl-9" disabled={disabled} /></div>
      <Button type="button" size="sm" variant="outline" disabled={disabled || tables.length === 0} onClick={() => setTables(tables.map((table) => table.id), !allSelected)}>{allSelected ? "取消全选" : "全选"}</Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="重置已选表" title="重置已选表" disabled={disabled || value.length === 0} onClick={() => onValueChange([])}><RotateCcw className="size-4" /></Button>
    </div>
    <ScrollArea className={cn(fullHeight ? "min-h-0 flex-1" : "max-h-[30rem]")}>
      <div className="space-y-4">
        {groups.length === 0 ? <div className="py-10 text-center text-sm text-slate-500">没有符合搜索条件的可查询表</div> : groups.map((group) => {
          const groupSelected = group.tables.filter((table) => selected.has(table.id)).length;
          return <div key={group.key} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2"><Layers3 className="size-4 text-slate-500" /><span className="text-sm font-medium text-slate-800">{group.label}</span><span className="text-xs text-slate-500">{groupSelected}/{group.tables.length} 已选</span></div>
            </div>
            <div className="divide-y divide-slate-100">{group.tables.map((table) => <label key={table.id} className={cn("flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-slate-50", disabled && "cursor-not-allowed opacity-60")}>
              <Checkbox checked={selected.has(table.id)} disabled={disabled} onCheckedChange={(checked) => setTables([table.id], checked === true)} className="mt-0.5" />
              <Database className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{table.business_name}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{table.physical_name}{showSourceDetails && <> · {table.source.name} · {tableLocation(table) || "未填写数据库位置"}</>}</span>{table.completeness?.status === "INCOMPLETE" && <span className="mt-1 block text-xs text-amber-700">语义待补充 {table.completeness.issues.length} 项</span>}</span>
            </label>)}</div>
          </div>;
        })}
      </div>
    </ScrollArea>
  </section>;
}
