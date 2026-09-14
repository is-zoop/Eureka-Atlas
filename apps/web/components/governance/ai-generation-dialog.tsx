"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileText, LoaderCircle, XCircle } from "lucide-react";
import { FloatingAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

export type AiGeneration = {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  step: "SAVING_DRAFT" | "PREPARING_CONTEXT" | "CALLING_LLM" | "VALIDATING_RESULT" | "SAVING_SUGGESTIONS";
  message: string;
  error: string | null;
};

type Reference = { fileName: string; content: string };
const steps: Array<{ id: AiGeneration["step"]; label: string }> = [
  { id: "SAVING_DRAFT", label: "保存当前草稿" },
  { id: "PREPARING_CONTEXT", label: "整理表与字段上下文" },
  { id: "CALLING_LLM", label: "调用 AI 模型" },
  { id: "VALIDATING_RESULT", label: "校验建议结果" },
  { id: "SAVING_SUGGESTIONS", label: "保存 AI 建议" },
];

export function AiGenerationDialog({ open, taskId, generation: initialGeneration, selectedCount, onOpenChange, onStart, onCompleted }: {
  open: boolean;
  taskId: string;
  generation: AiGeneration | null;
  selectedCount: number;
  onOpenChange: (open: boolean) => void;
  onStart: (reference?: Reference) => Promise<{ taskId: string; generation: AiGeneration }>;
  onCompleted: () => Promise<void>;
}) {
  const [generation, setGeneration] = useState<AiGeneration | null>(initialGeneration);
  const [startedTaskId, setStartedTaskId] = useState("");
  const [reference, setReference] = useState<Reference | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const generationTaskId = startedTaskId || taskId;
  useEffect(() => {
    if (generation?.status !== "RUNNING" || !generationTaskId) return;
    const timer = window.setInterval(() => {
      void api<AiGeneration>(`/governance/workspaces/${generationTaskId}/generations/${generation.id}`)
        .then((next) => {
          setGeneration(next);
          if (next.status === "COMPLETED") void onCompleted();
        })
        .catch((cause: Error) => setError(cause.message));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generation?.id, generation?.status, generationTaskId, onCompleted]);

  const choose = async (file?: File) => {
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md") && file.type !== "text/markdown") {
      setError("仅支持导入 Markdown（.md）文件");
      return;
    }
    if (file.size > 1_000_000) {
      setError("Markdown 文件不能超过 1 MB");
      return;
    }
    try {
      setReference({ fileName: file.name, content: await file.text() });
    } catch {
      setError("无法读取该 Markdown 文件");
    }
  };
  const start = async () => {
    setError("");
    setStarting(true);
    try {
      const started = await onStart(reference ?? undefined);
      setStartedTaskId(started.taskId);
      setGeneration(started.generation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法开始生成");
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    if (!generation || !generationTaskId) return;
    setError("");
    try {
      setGeneration(await api<AiGeneration>(`/governance/workspaces/${generationTaskId}/generations/${generation.id}/cancel`, { method: "POST" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消失败");
    }
  };
  const close = () => {
    if (generation?.status === "RUNNING") return;
    onOpenChange(false);
  };
  const current = generation ? steps.findIndex((step) => step.id === generation.step) : -1;
  return <Dialog open={open} onOpenChange={(next) => !next ? close() : onOpenChange(true)}>
    <DialogContent showCloseButton={generation?.status !== "RUNNING"} onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>生成 AI 建议</DialogTitle>
        <DialogDescription>{generation ? generation.message : `将为当前已选择的 ${selectedCount} 个字段生成语义建议。`}</DialogDescription>
      </DialogHeader>
      {!generation ? <div className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <div><p className="text-sm font-medium text-slate-800">导入参考 Markdown（可选）</p><p className="mt-1 text-xs text-slate-500">仅用于本次生成，不会被保存；支持 .md，最大 1 MB。</p></div>
        {reference ? <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><span className="flex min-w-0 items-center gap-2 truncate"><FileText className="h-4 w-4 text-slate-500" />{reference.fileName}</span><Button size="sm" variant="ghost" onClick={() => setReference(null)}>移除</Button></div> : <Button size="sm" variant="outline" onClick={() => input.current?.click()}><FileText className="mr-1.5 h-4 w-4" />选择 Markdown</Button>}
        <input ref={input} type="file" accept=".md,text/markdown" className="hidden" onChange={(event) => void choose(event.target.files?.[0])} />
      </div> : <ol className="space-y-2">{steps.map((step, index) => {
        const done = generation.status === "COMPLETED" || index < current;
        const running = generation.status === "RUNNING" && index === current;
        const stopped = (generation.status === "FAILED" || generation.status === "CANCELLED") && index === current;
        return <li key={step.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"><span className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-700" : running ? "bg-sky-100 text-sky-700" : stopped ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-400"}`}>{done ? <Check className="h-3.5 w-3.5" /> : running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : stopped ? <XCircle className="h-3.5 w-3.5" /> : index + 1}</span><span className={running ? "font-medium text-slate-950" : "text-slate-600"}>{step.label}</span></li>;
      })}</ol>}
      {error && <FloatingAlert type="error">{error}</FloatingAlert>}
      {generation?.status === "FAILED" && generation.error && <FloatingAlert type="error">{generation.error}</FloatingAlert>}
      <DialogFooter>
        {!generation ? <><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={starting || !selectedCount} onClick={() => void start()}>{starting ? "准备中…" : "开始生成"}</Button></> : generation.status === "RUNNING" ? <Button variant="outline" onClick={() => void cancel()}>取消</Button> : generation.status === "FAILED" ? <><Button variant="outline" onClick={close}>关闭</Button><Button onClick={() => setGeneration(null)}>重新开始</Button></> : <Button onClick={close}>完成</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
