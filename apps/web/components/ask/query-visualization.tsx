"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChartNoAxesCombined, Download, Table2 } from "lucide-react";
import type { AskChartSpec, AskChartType, AskSavedQueryResult } from "@eureka-atlas/types";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { chartColors, chartData, chartTypes, isNumericColumn } from "./chart-data";
import { QueryChart } from "./query-chart";
import { downloadChartHtml } from "./chart-export";
import { TableCopyButton, toTsv } from "./table-copy-button";

export function QueryVisualization({ saved, preferred, children, onDownload }: { saved: AskSavedQueryResult; preferred?: AskChartSpec; children: ReactNode; onDownload: () => void }) {
  const [view, setView] = useState(preferred ? "chart" : "table");
  const [configured, setConfigured] = useState<AskChartSpec | undefined>(preferred);
  const [exportError, setExportError] = useState("");
  const chartRef = useRef<HTMLDivElement>(null);
  const result = saved.execution.result!;
  const data = view === "chart" && configured ? chartData(result, configured) : undefined;
  const update = (changes: Partial<AskChartSpec>) => { if (configured) { const next = { ...configured, ...changes }; if (changes.x_column !== undefined || changes.y_columns) next.title = saved.source.business_name + " · " + next.y_columns.map((index) => result.columns[index]?.name ?? "").join("、"); setConfigured(next); setExportError(""); } };
  const metricOptions = result.columns.flatMap((column, index) => isNumericColumn(column.type) && index !== configured?.x_column ? [{ value: String(index), label: column.name + (column.unit ? "（" + column.unit + "）" : "") }] : []);
  const groups = new Map<string, number[]>();
  result.columns.forEach((column, index) => {
    if (index === configured?.x_column || !isNumericColumn(column.type)) return;
    const unit = column.unit ?? "";
    groups.set(unit, [...(groups.get(unit) ?? []), index]);
  });
  for (const indices of groups.values()) if (indices.length > 1) {
    const group = indices.slice(0, 4);
    metricOptions.push({ value: group.join(","), label: group.map((index) => result.columns[index].name).join("、") });
  }
  if (configured && configured.y_columns.length > 1 && !metricOptions.some((option) => option.value === configured.y_columns.join(","))) metricOptions.unshift({ value: configured.y_columns.join(","), label: configured.y_columns.map((index) => result.columns[index]?.name).join("、") });
  const download = () => {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg || !configured || data?.error) return;
    try { downloadChartHtml(saved, configured, svg.outerHTML); } catch { setExportError("HTML 下载失败，请重试。"); }
  };
  return <>
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[13px] font-medium">查询结果{result.truncated ? " · 仅包含本次返回结果" : ""}</h3>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" disabled={view === "chart" && (!data || !!data.error)} onClick={view === "chart" ? download : onDownload}><Download className="size-3.5" />{view === "chart" ? "下载 HTML" : "下载 Excel"}</Button>
        <TableCopyButton text={() => toTsv([result.columns.map((column) => column.name), ...result.rows])} />
      </div>
    </div>
    {configured ? <Tabs value={view} onValueChange={setView} className="mt-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <TabsList className="h-8 border-0">
        <TabsTrigger value="table" className="h-6 gap-1 px-2 text-xs"><Table2 className="size-3.5" />表格</TabsTrigger>
        <TabsTrigger value="chart" className="h-6 gap-1 px-2 text-xs"><ChartNoAxesCombined className="size-3.5" />图表</TabsTrigger>
      </TabsList>

    </div>
    <TabsContent value="table" className="mt-2">{children}</TabsContent>
    <TabsContent value="chart" className="mt-3">
      {configured && data && <>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Combobox aria-label="图表类型" value={configured.type} onValueChange={(value) => update({ type: value as AskChartType })} searchable={false} options={chartTypes} className="w-fit" menuClassName="min-w-28" inputClassName="h-8 border border-slate-200 bg-white" />
          <span>横轴</span><Combobox aria-label="图表横轴" value={String(configured.x_column)} onValueChange={(value) => {
            const x = Number(value);
            const y = configured.y_columns.filter((index) => index !== x);
            update({ x_column: x, y_columns: y.length ? y : result.columns.flatMap((column, index) => index !== x && isNumericColumn(column.type) ? [index] : []).slice(0, 1) });
          }} searchable={false} options={result.columns.map((column, index) => ({ value: String(index), label: column.name }))} className="max-w-52" menuClassName="min-w-40 max-w-64" inputClassName="h-8 border border-slate-200 bg-white" />
          <span>指标</span><Combobox aria-label="图表指标" value={configured.y_columns.join(",")} onValueChange={(value) => update({ y_columns: value.split(",").map(Number) })} searchable={false} options={metricOptions} className="max-w-60" menuClassName="min-w-40 max-w-72" inputClassName="h-8 border border-slate-200 bg-white" />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="mb-2 text-[13px] font-medium text-slate-700">{configured.title}</h4>
          <div ref={chartRef} className="max-w-full overflow-x-auto">{<QueryChart data={data} spec={configured} />}</div>
          {!data.error && configured.type !== "pie" && <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500">{data.names.map((name, index) => <span key={name} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: chartColors[index] }} />{name}{data.unit ? "（" + data.unit + "）" : ""}</span>)}</div>}
          <p className="mt-3 text-[11px] leading-5 text-slate-400">{result.truncated ? "仅包含本次返回结果 · " : ""}基于全部已保存的 {result.rows.length} 行数据；不会自行汇总。{configured.type === "line" ? "NULL 处断开折线。" : ""}图形位置采用近似数值，精确值见悬停提示和表格。</p>
        </div>
        {exportError && <p role="alert" className="mt-2 text-xs text-rose-600">{exportError}</p>}
      </>}
    </TabsContent>
    </Tabs> : <div className="mt-2">{children}</div>}
  </>;
}