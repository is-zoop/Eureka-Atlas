"use client";

import type { AskRun, AskSavedQueryResult } from "@eureka-atlas/types";
import { AnswerMarkdown } from "./answer-markdown";
import { ProcessingDetails } from "./processing-details";
import { QueryResult } from "./query-result";
import { buildStepLogs } from "./step-log";
import { StepLogCard } from "./step-log-card";

const labels: Record<AskRun["status"], string> = { RUNNING: "处理中", WAITING_CLARIFICATION: "等待确认", SUCCEEDED: "已完成", FAILED: "失败", CANCELLING: "停止中", CANCELLED: "已停止", INTERRUPTED: "已中断" };
const conditionLabels: Record<string, string> = { table_id: "来源表", metric_ids: "指标", dimension_ids: "分组", filters: "筛选", date_range: "日期", order_by: "排序", limit: "返回行数" };

export function RunAnswer({ run, streamed, results, resultErrors, onRefresh, onDownload }: { run: AskRun; streamed?: string; results: Record<string, AskSavedQueryResult>; resultErrors: Record<string, string>; onRefresh: () => void; onDownload: (queryId: string) => void }) {
  const running = run.status === "RUNNING" || run.status === "CANCELLING";
  const answer = running ? streamed : run.answer;
  const queryIds = [...new Set([...run.queries.map((query) => query.id), ...run.result_summaries.map((result) => result.query_id)])];
  const finalIds = new Set(run.status === "SUCCEEDED" ? run.final_query_ids : []);
  const logs = buildStepLogs(run, results);
  const queryResult = (queryId: string) => <QueryResult key={queryId} saved={results[queryId]} chart={finalIds.has(queryId) ? run.charts.find((chart) => chart.query_id === queryId) : undefined} error={resultErrors[queryId]} status={run.queries.find((query) => query.id === queryId)?.status ?? "SUCCEEDED"} queryError={run.queries.find((query) => query.id === queryId)?.error ?? undefined} onRefresh={onRefresh} onDownload={() => onDownload(queryId)} />;
  return <section className="space-y-4">
    <div className="ml-auto max-w-[88%] rounded-xl bg-blue-100 px-4 py-3 text-sm leading-6 text-blue-950">{run.question}</div>
    <div className="ask-answer">
      <ProcessingDetails run={run} renderStepLog={(step) => {
        const log = logs.get(step.id);
        return <StepLogCard run={run} step={step} log={log}>{log?.queryId && queryResult(log.queryId)}</StepLogCard>;
      }}>
        {running && answer && <AnswerMarkdown>{answer}</AnswerMarkdown>}
        {run.condition_changes.inherited.length > 0 && <p className="mt-3 text-[11px] leading-5 text-slate-400">沿用条件：{run.condition_changes.inherited.map((key) => conditionLabels[key] ?? key).join("、")} · 本轮调整：{run.condition_changes.changed.map((key) => conditionLabels[key] ?? key).join("、") || "无"}</p>}
      </ProcessingDetails>
      <div className="mb-2 mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-400">
        <span title={`模型 ID：${run.model_id}`}>{run.model_display_name || "模型名称未记录"}</span>
        <span className={run.status === "FAILED" ? "text-rose-600" : ""}>{labels[run.status]}</span>
      </div>
      {run.error && <p role="alert" className="mb-3 text-xs leading-5 text-rose-600">{run.error}</p>}
      {!running && answer && <AnswerMarkdown omitTables={finalIds.size > 0}>{answer}</AnswerMarkdown>}
      {queryIds.filter((id) => finalIds.has(id)).map(queryResult)}
    </div>
  </section>;
}
