"use client";

import type { ReactNode } from "react";
import type { AskProcessingStep, AskRun } from "@eureka-atlas/types";
import { Card, CardContent } from "@/components/ui/card";
import { stepStatusLabel, type LogEntry, type StepLog } from "./step-log";

function Entries({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) return <p className="text-slate-400">未记录</p>;
  return <dl className="space-y-1">{entries.map((entry, index) => <div key={index} className="flex min-w-0 flex-wrap gap-x-2">
    <dt className="shrink-0 text-slate-400">{entry.label}：</dt><dd className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.value}</dd>
  </div>)}</dl>;
}

function RawParameters({ value }: { value: unknown }) {
  return <details className="mt-2">
    <summary className="cursor-pointer text-slate-500">查看原始参数</summary>
    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs leading-[1.6]">{value === undefined ? "未记录" : JSON.stringify(value, null, 2)}</pre>
  </details>;
}

function Failure({ error }: { error: string }) {
  return <section><h4 className="mb-1 font-medium text-rose-700">失败详情</h4><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-rose-50 p-3 font-mono text-xs leading-[1.6] text-rose-700">{error}</pre></section>;
}

const date = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "未记录";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
};

export function StepLogCard({ run, step, log, children }: { run: AskRun; step: AskProcessingStep; log?: StepLog; children?: ReactNode }) {
  return <Card className="my-2 ml-5 min-w-0 rounded-lg shadow-none">
    <CardContent className="space-y-3 p-4 text-xs leading-[1.6] text-slate-500 [&_.ask-query-result]:mt-0">
      <Entries entries={[
        { label: "状态", value: stepStatusLabel(step) },
        { label: "开始时间", value: date(step.started_at) },
        { label: "结束时间", value: step.completed_at ? date(step.completed_at) : step.status === "RUNNING" ? "尚未结束" : "未记录" },
        { label: "耗时", value: step.elapsed_ms === null ? "未记录" : step.elapsed_ms + " ms" },
        { label: "消息 ID", value: log?.messageId || "未记录" },
        ...(step.kind === "tool" ? [{ label: "工具", value: log?.toolName || "未记录" }, { label: "工具调用 ID", value: step.tool_call_id || "未记录" }] : [{ label: "模型", value: run.model_display_name || "模型名称未记录" }]),
      ]} />
      {step.kind === "message" ? <>
        <section><h4 className="mb-1 font-medium">模型输出</h4><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{log?.text || (step.status === "RUNNING" ? "等待模型返回" : log?.calls.length ? "本次仅安排工具调用，没有文本输出。" : "未记录")}</p></section>
        {log?.error && <Failure error={log.error} />}
        <section><h4 className="mb-1 font-medium">安排的工具 · {log?.hasOutput ? log.calls.length : "未记录"}</h4>
          {log?.calls.map((call) => <div key={call.id} className="mt-2 rounded-md border border-slate-100 p-3">
            <p className="font-medium">{call.name || "未记录"}</p><p className="mb-2 break-all text-[11px] text-slate-400">工具调用 ID：{call.id || "未记录"}</p>
            <Entries entries={call.request} /><RawParameters value={call.arguments} />
          </div>)}
        </section>
      </> : <>
        <section><h4 className="mb-1 font-medium">请求内容</h4><Entries entries={log?.request ?? []} /><RawParameters value={log?.hasArguments ? log.arguments : undefined} /></section>
        {log?.error ? <Failure error={log.error} />
          : !log?.hasOutput ? <p className="text-slate-400">{step.status === "RUNNING" ? "等待工具返回" : "输出未记录"}</p>
            : log.output.map((section, index) => <section key={index}><h4 className="mb-1 font-medium">{section.title}</h4><div className={section.entries.length > 8 ? "max-h-80 overflow-auto" : undefined}><Entries entries={section.entries} /></div></section>)}
        {children}
      </>}
    </CardContent>
  </Card>;
}