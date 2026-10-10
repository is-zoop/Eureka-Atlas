"use client";

import { useState } from "react";
import type { AskChartSpec, AskSavedQueryResult } from "@eureka-atlas/types";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table } from "@/components/ui/table";
import { QueryVisualization } from "./query-visualization";

const numeric = (type: string) => /^(tinyint|smallint|int|integer|bigint|float|double|decimal|numeric|number|real)/i.test(type);

export function QueryResult({ saved, chart, status, error, queryError, onRefresh, onDownload }: { saved?: AskSavedQueryResult; chart?: AskChartSpec; status: string; error?: string; queryError?: string; onRefresh: () => void; onDownload: () => void }) {
  const [page, setPage] = useState(0);
  if (!saved) return <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
    {!error && !["FAILED", "CANCELLED", "TIMED_OUT"].includes(status) && <LoaderCircle className="size-3 animate-spin" />}
    <span>{error || queryError || (status === "SUCCEEDED" ? "正在读取已保存的查询结果…" : `查询状态：${status}`)}</span>
    {error && <Button variant="ghost" size="sm" onClick={onRefresh}><RefreshCw className="size-3" />重试</Button>}
  </div>;
  const { execution, source, query_definition: definition } = saved;
  const { columns = [], rows = [], truncated = false } = execution.result ?? {};
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pages - 1);
  return <section className="ask-query-result">
    <QueryVisualization saved={saved} preferred={chart} onDownload={onDownload}>
    <div className="ask-table-wrap">
      <Table containerClassName="ask-table-scroll h-auto rounded-none border-0" className="ask-data-table">
        <thead><tr>{columns.map((column, index) => <th key={index} style={{ textAlign: numeric(column.type) ? "right" : "left" }}>{column.name}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.slice(currentPage * 50, (currentPage + 1) * 50).map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column} style={{ textAlign: numeric(columns[column]?.type ?? "") ? "right" : "left" }}>{value === null ? <span className="text-slate-400">NULL</span> : String(value)}</td>)}</tr>) : <tr><td colSpan={Math.max(columns.length, 1)} className="text-center text-slate-400">没有符合条件的数据</td></tr>}</tbody>
      </Table>
    </div>
    {pages > 1 && <div className="flex items-center justify-end gap-2 text-xs text-slate-500"><span>共 {rows.length} 行 · {currentPage + 1}/{pages}</span><Button size="sm" variant="ghost" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</Button><Button size="sm" variant="ghost" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button></div>}
    </QueryVisualization>
    <details className="ask-query-notes">
      <summary>查看 SQL、口径与来源</summary>
      <div className="space-y-1 py-2 text-xs leading-5 text-slate-500">
        <p>来源：{source.business_name}（{source.physical_name}） · {[source.project, source.catalog, source.schema].filter(Boolean).join(" / ")}</p>
        <p>列口径：{columns.map((column) => `${column.name}（${column.type}${column.unit ? `，${column.unit}` : ""}）`).join("、")}</p>
        {"date_range" in definition && definition.date_range && <p>统计日期：{definition.date_range.start} ～ {definition.date_range.end}</p>}
        {execution.snapshot_date && <p>快照日期：{execution.snapshot_date}</p>}
        <p className="break-all">语义版本：{execution.content_version}</p>
        <p>查询时间：{execution.submitted_at} · 耗时：{execution.elapsed_ms === null ? "未记录" : `${(execution.elapsed_ms / 1000).toFixed(1)}s`}</p>
        {truncated && <p>结果已截断；复制及下载仅包含本次已保存的 {rows.length} 行。</p>}
      </div>
      <pre className="ask-sql">{execution.sql}</pre>
    </details>
  </section>;
}
