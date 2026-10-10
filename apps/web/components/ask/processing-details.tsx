"use client";

import { useState, type ReactNode } from "react";
import type { AskRun, AskProcessingStep } from "@eureka-atlas/types";
import { ChevronRight, LoaderCircle, Check, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const active = (status: AskRun["status"]) => status === "RUNNING" || status === "CANCELLING";

export function ProcessingDetails({ run, children, renderStepLog }: { run: AskRun; children?: ReactNode; renderStepLog: (step: AskProcessingStep) => ReactNode }) {
  const [panel, setPanel] = useState({ status: run.status, expanded: active(run.status) });
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  // A status transition controls the outer panel without remounting step state.
  if (panel.status !== run.status) setPanel({ status: run.status, expanded: active(run.status) });
  const expanded = panel.status === run.status ? panel.expanded : active(run.status);
  const toggleStep = (id: string) => setOpened((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <section className="ask-processing">
    <button type="button" className="ask-processing-toggle" aria-expanded={expanded} onClick={() => setPanel({ status: run.status, expanded: !expanded })}>
      <ChevronRight className={"size-3 shrink-0 transition-transform " + (expanded ? "rotate-90" : "")} />
      <span>处理详情 · {run.processing.message_count} 条消息 · {run.processing.tool_count} 次工具调用</span>
      {run.status === "RUNNING" && <LoaderCircle className="size-3 animate-spin" />}
    </button>
    {expanded && <div className="ask-processing-body">
      {!run.processing.steps.length && <p>{run.status === "RUNNING" ? "正在生成处理方案…" : "本轮未记录处理摘要"}</p>}
      {run.processing.steps.map((step) => {
        const isOpen = opened.has(step.id);
        const contentId = run.id + ":log:" + step.id;
        return <div key={step.id} data-step-id={step.id} data-tool-call-id={step.tool_call_id ?? undefined}>
          <Button type="button" variant="ghost" aria-expanded={isOpen} aria-controls={isOpen ? contentId : undefined}
            className="ask-processing-step h-auto w-full justify-start gap-1.5 whitespace-normal rounded-sm px-0 py-[3px] text-left text-xs font-normal leading-[1.6] text-slate-500"
            onClick={() => toggleStep(step.id)}>
            {step.status === "RUNNING" ? <LoaderCircle className="mt-0.5 size-3 shrink-0 animate-spin" /> : step.status === "FAILED" ? <CircleAlert className="mt-0.5 size-3 shrink-0" /> : <Check className="mt-0.5 size-3 shrink-0" />}
            <span className="min-w-0 flex-1"><span>{step.name}</span><span className="ml-2 text-slate-400">{step.status === "FAILED" ? "处理失败，点击查看日志" : step.summary}</span></span>
            {step.elapsed_ms !== null && <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{(step.elapsed_ms / 1000).toFixed(1)}s</span>}
          </Button>
          {isOpen && <div id={contentId}>{renderStepLog(step)}</div>}
        </div>;
      })}
      {children}
    </div>}
  </section>;
}