"use client";

import { useEffect, useRef, useState } from "react";
import { CircleHelp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";

type CatalogStatus = { enabled: boolean; offline: boolean; refreshing: boolean; lastSuccessAt?: number; error?: boolean };

// Eureka's PiCatalogSync interaction, using Atlas components and server-owned state.
export function PiCatalogSync({ onUpdated }: { onUpdated(): Promise<void> }) {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const callbacks = useRef(onUpdated);
  useEffect(() => { callbacks.current = onUpdated; }, [onUpdated]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let checkedAt: number | undefined;
    const poll = async () => {
      try {
        const next = await api<CatalogStatus>("/models/pi-catalog");
        if (disposed) return;
        setStatus(next);
        setFailure("");
        if (next.lastSuccessAt !== checkedAt) {
          const changed = checkedAt !== undefined || next.lastSuccessAt !== undefined;
          checkedAt = next.lastSuccessAt;
          if (changed) await callbacks.current();
        }
      } catch (error) { if (!disposed) setFailure(error instanceof Error ? error.message : "无法读取目录刷新状态"); }
      if (!disposed) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  const update = async (body: { enabled?: boolean; refresh?: boolean }) => {
    setBusy(true); setFailure("");
    try {
      const next = await api<CatalogStatus>("/models/pi-catalog", { method: "POST", body: JSON.stringify(body) });
      setStatus(next);
      if (!next.refreshing) await callbacks.current();
    } catch (error) { setFailure(error instanceof Error ? error.message : "目录刷新失败"); }
    finally { setBusy(false); }
  };
  const working = busy || status?.refreshing;
  const warning = failure || (status?.error ? "目录刷新未完成，已保留上次有效目录，可稍后重试。" : "");
  return <TooltipProvider><div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 text-xs text-slate-500">
    <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-slate-700">
      <Checkbox aria-label="启用 Pi 联网模型目录刷新" checked={status?.enabled ?? false} disabled={!status || busy || status.offline}
        onCheckedChange={(value) => void update({ enabled: value === true })} />
      启用 Pi 联网模型目录刷新
    </label>
    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!status?.enabled || working || status?.offline} onClick={() => void update({ refresh: true })}>
      <RefreshCw className={working ? "size-3.5 animate-spin" : "size-3.5"} />{working ? "正在刷新…" : "从 pi.dev 立即刷新"}
    </Button>
    <span className="whitespace-nowrap">最近检查：{status?.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未检查"}</span>
    <Tooltip><TooltipTrigger asChild><button type="button" aria-label="模型目录刷新说明" className="text-slate-400 hover:text-slate-600"><CircleHelp className="size-3.5" /></button></TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs leading-5">{status?.offline ? "当前启用了 PI_OFFLINE，无法连接 pi.dev。" : "后台每 15 分钟检查已配置的内置供应商目录。官方目录会新增或更新模型；SDK 内置的下架模型仍可能保留。自定义端点和订阅账号目录使用各自的刷新功能。"}</TooltipContent>
    </Tooltip>
    {warning && <span role="alert" className="basis-full text-right text-red-500">{warning}</span>}
  </div></TooltipProvider>;
}
