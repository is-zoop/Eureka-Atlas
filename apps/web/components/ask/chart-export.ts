import type { AskChartSpec, AskSavedQueryResult } from "@eureka-atlas/types";

import { chartColors } from "./chart-data";

const escape = (value: unknown) => String(value === null ? "NULL" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** svg comes only from our QueryChart DOM, never from model-produced markup. */
export function buildChartHtml(saved: AskSavedQueryResult, spec: AskChartSpec, svg: string): string {
  const result = saved.execution.result!;
  const date = "date_range" in saved.query_definition ? saved.query_definition.date_range : undefined;
  const note = result.truncated ? "仅包含本次返回结果，已保存 " + result.rows.length + " 行；不能视为完整数据。" : "使用全部已保存的 " + result.rows.length + " 行查询结果。";
  const headers = result.columns.map((column) => "<th>" + escape(column.name) + (column.unit ? "（" + escape(column.unit) + "）" : "") + "</th>").join("");
  const rows = result.rows.map((row) => "<tr>" + row.map((cell) => "<td>" + escape(cell) + "</td>").join("") + "</tr>").join("");
  const metrics = spec.y_columns.map((index) => escape(result.columns[index].name) + (result.columns[index].unit ? "（" + escape(result.columns[index].unit) + "）" : "")).join("、");
  const legend = spec.type === "pie" ? "" : "<p>" + spec.y_columns.map((index, series) => '<span style="color:' + chartColors[series] + '">● ' + escape(result.columns[index].name) + "</span>").join("　") + "</p>";
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>' + escape(spec.title) + '</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#334155;margin:32px auto;padding:0 24px;max-width:1100px}h1{font-size:20px}h2{font-size:16px;margin-top:24px}p{margin:8px 0}.chart,.data{overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:12px}.chart svg{width:100%;display:block}table{border-collapse:collapse;min-width:100%;white-space:nowrap}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f8fafc}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;padding:12px}small{color:#64748b}</style></head><body><h1>' + escape(spec.title) + "</h1><p>指标：" + metrics + '</p><div class="chart">' + svg + "</div>" + legend + "<p>" + escape(note) + "</p><small>图形位置采用近似数值；精确值见悬停提示及下方数据。NULL 表示空值，空字符串保持为空；折线图空值处断开。</small><h2>口径与来源</h2><p>来源：" + escape(saved.source.business_name) + "（" + escape(saved.source.physical_name) + "） · " + escape([saved.source.project, saved.source.catalog, saved.source.schema].filter(Boolean).join(" / ")) + "</p><p>日期：" + escape(date ? date.start + " ～ " + date.end : saved.execution.snapshot_date ?? "未指定") + "</p><p>语义版本：" + escape(saved.execution.content_version) + " · 查询时间：" + escape(saved.execution.submitted_at) + "</p><p>列口径：" + result.columns.map((column) => escape(column.name + "（" + column.type + (column.unit ? "，" + column.unit : "") + "）")).join("、") + "</p><h2>SQL</h2><pre>" + escape(saved.execution.sql) + '</pre><h2>保存的数据</h2><div class="data"><table><thead><tr>' + headers + "</tr></thead><tbody>" + rows + "</tbody></table></div></body></html>";
}

export function downloadChartHtml(saved: AskSavedQueryResult, spec: AskChartSpec, svg: string) {
  const url = URL.createObjectURL(new Blob([buildChartHtml(saved, spec, svg)], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = spec.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) + ".html";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}