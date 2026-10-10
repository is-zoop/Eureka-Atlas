"use client";

import { useEffect, useState } from "react";
import { CircleHelp, RefreshCw, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

type PromptSetting = { prompt: string; defaultPrompt: string; customized: boolean };

export function AskPromptSettings() {
  const [setting, setSetting] = useState<PromptSetting | null>(null);
  const [prompt, setPrompt] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void api<PromptSetting>("/settings/ask-prompt")
      .then((next) => { if (!cancelled) { setSetting(next); setPrompt(next.prompt); } })
      .catch((cause: Error) => { if (!cancelled) setMessage({ error: true, text: cause.message }); });
    return () => { cancelled = true; };
  }, [reload]);

  const save = async () => {
    setWorking(true);
    try {
      const next = await api<PromptSetting>("/settings/ask-prompt", { method: "PUT", body: JSON.stringify({ prompt }) });
      setSetting(next); setPrompt(next.prompt); setMessage({ error: false, text: "智能问数提示词已保存，将用于后续问数调用。" });
    } catch (cause) { setMessage({ error: true, text: cause instanceof Error ? cause.message : "保存失败" }); }
    finally { setWorking(false); }
  };
  const reset = async () => {
    setWorking(true);
    try {
      const next = await api<PromptSetting>("/settings/ask-prompt", { method: "DELETE" });
      setSetting(next); setPrompt(next.prompt); setMessage({ error: false, text: "已恢复默认智能问数提示词。" });
    } catch (cause) { setMessage({ error: true, text: cause instanceof Error ? cause.message : "恢复失败" }); }
    finally { setWorking(false); }
  };

  return <section className="mx-auto w-full max-w-5xl p-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <h2 className="text-lg font-semibold">智能问数系统提示词</h2>
        <Dialog>
          <DialogTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="查看提示词说明"><CircleHelp className="size-4 text-slate-400" /></Button></DialogTrigger>
          <DialogContent className="max-w-md"><DialogHeader><DialogTitle>提示词说明</DialogTitle><DialogDescription className="pt-2 leading-6">{"{{current_date}}"} 为运行日期，{"{{table_count}}"} 为本轮已选表数量，由服务端在运行时填入；数据范围和查询校验由后端执行。</DialogDescription></DialogHeader></DialogContent>
        </Dialog>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={working || !setting?.customized} onClick={() => void reset()}><RotateCcw className="size-4" />恢复默认</Button>
        <Button type="button" size="sm" disabled={working || !setting || !prompt.trim()} onClick={() => void save()}><Save className="size-4" />保存提示词</Button>
      </div>
    </div>
    {message && <div role={message.error ? "alert" : "status"} className={`mb-3 flex items-center gap-2 text-sm ${message.error ? "text-rose-600" : "text-emerald-700"}`}>{message.text}{!setting && <Button size="sm" variant="ghost" onClick={() => { setMessage(null); setReload((value) => value + 1); }}><RefreshCw className="size-3" />重试</Button>}</div>}
    <Textarea aria-label="智能问数系统提示词" className="min-h-[28rem] text-sm leading-6" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!setting || working} placeholder={message?.error && !setting ? "系统提示词加载失败" : "正在加载系统提示词…"} />
  </section>;
}
