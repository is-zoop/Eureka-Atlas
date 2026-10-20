"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ExternalApiCatalog } from "@eureka-atlas/types";
import { CircleAlert, CircleHelp, Download, KeyRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { IntegrationsTabs } from "@/components/integrations/integrations-tabs";
import { ApiReference } from "./api-reference";
import { ApiTestPanel } from "./api-test-panel";

export function ApiCenter() {
  const [catalog, setCatalog] = useState<ExternalApiCatalog | null>(null), [selected, setSelected] = useState("search"), [error, setError] = useState("");
  const [credential, setCredential] = useState(""), [retry, setRetry] = useState(0);
  const credentialInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const clear = () => { setCredential(""); if (credentialInput.current) credentialInput.current.value = ""; };
    window.addEventListener("pagehide", clear);
    return () => { window.removeEventListener("pagehide", clear); if (credentialInput.current) credentialInput.current.value = ""; };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setError("");
    void api<ExternalApiCatalog>("/api-center", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setCatalog(value); }).catch((cause: Error) => { if (!controller.signal.aborted && cause.name !== "AbortError") setError(cause.message); });
    return () => controller.abort();
  }, [retry]);
  const operation = catalog?.operations.find(item => item.id === selected) ?? catalog?.operations[0];
  return <main className="flex min-h-0 flex-col lg:h-[calc(100dvh-105px)]">
    <IntegrationsTabs help={<TooltipProvider delayDuration={150}><Tooltip><TooltipTrigger asChild><Button type="button" size="icon-sm" variant="ghost" aria-label="开放 API 使用说明" className="size-6 text-slate-400 hover:text-slate-700"><CircleHelp className="size-4" /></Button></TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="shadcn-scrollbar max-h-[70dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto p-4 text-xs font-normal leading-6">
          <div className="space-y-3"><p>使用 Haze 个人凭证访问 Atlas 开放数据接口；仅管理员及系统管理员可用。</p>
            {catalog && <><p className="font-semibold">Atlas External API · {catalog.version}</p><p className="break-all font-mono">{catalog.authentication}</p><p>{catalog.workflow.join(" → ")}</p><p>每分钟 {catalog.limits.requests_per_minute} 次／用户；最多 {catalog.limits.concurrent_queries_per_user} 个未结束语义查询；结果最多 {catalog.limits.query_rows} 行、{catalog.limits.result_bytes / 1024 / 1024} MiB，保留 {catalog.limits.result_retention_seconds / 3600} 小时。当前查询仅支持 MaxCompute。</p></>}
          </div>
        </TooltipContent>
      </Tooltip></TooltipProvider>} actions={catalog && <Button asChild size="sm" variant="outline"><a href="/api/api-center/openapi" download="atlas-openapi.json"><Download className="size-4" />下载 OpenAPI</a></Button>}>
    {error && <Alert variant="destructive" className="mb-4 shrink-0"><CircleAlert /><AlertDescription>{error}<Button size="sm" variant="outline" className="ml-3" onClick={() => setRetry(value => value + 1)}>重新读取</Button></AlertDescription></Alert>}
    {!catalog ? !error && <p role="status" className="py-8 text-center text-sm text-slate-500">正在读取 API 目录…</p> : <>
      <div className="grid min-h-0 min-w-0 gap-4 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <nav aria-label="开放接口列表" tabIndex={0} className="shadcn-scrollbar max-h-72 min-h-0 min-w-0 space-y-2 overflow-y-auto overscroll-contain pr-1 lg:max-h-none">{catalog.operations.map(item => <Button key={item.id} variant={operation?.id === item.id ? "secondary" : "ghost"} className="h-auto w-full justify-start whitespace-normal rounded-lg border border-slate-100 px-3 py-3 text-left" onClick={() => setSelected(item.id)}><span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block font-mono text-[11px] text-slate-500">{item.method} · {item.id}</span></span></Button>)}
          <details className="rounded-lg border border-slate-200 p-3 text-xs"><summary className="cursor-pointer font-semibold">错误码与处理</summary><ul className="mt-3 space-y-3 text-slate-500">{catalog.errors.map(item => <li key={`${item.status}:${item.code}`}><p className="break-all font-mono text-slate-700">{item.status} · {item.code}</p><p className="mt-1 leading-5">{item.description}</p></li>)}</ul></details>
        </nav>
        {operation && <Card role="region" aria-label="API 详情" tabIndex={0} className="shadcn-scrollbar max-h-[70dvh] min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-xl shadow-none lg:max-h-none"><CardContent className="space-y-4 p-4 sm:p-5">
          <div className="space-y-2"><h2 className="text-base font-semibold">{operation.title}</h2><p className="text-xs leading-6 text-slate-500">{operation.description}</p><div className="flex items-start gap-2"><Badge className={operation.method === "GET" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}>{operation.method}</Badge><code className="min-w-0 break-all text-xs leading-6">{operation.path}</code></div></div>
          <Tabs defaultValue="docs" className="space-y-4"><TabsList><TabsTrigger value="docs">接口说明</TabsTrigger><TabsTrigger value="test">在线测试</TabsTrigger></TabsList><TabsContent value="docs" className="mt-0"><ApiReference key={operation.id} operation={operation} /></TabsContent><TabsContent value="test" className="mt-0 space-y-4">
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><Label htmlFor="api-personal-credential" className="flex items-center gap-2 text-xs"><KeyRound className="size-3.5" />Haze 个人凭证</Label><Input ref={credentialInput} id="api-personal-credential" type="password" autoComplete="off" spellCheck={false} value={credential} onChange={event => setCredential(event.target.value)} placeholder="从个人中心复制本人凭证，不带 Bearer 前缀" className="font-mono text-xs" /><p className="text-xs leading-5 text-slate-500">凭证仅用于当前页面，不自动读取、不持久保存。可在 <Link href="/profile" className="underline">个人中心</Link> 复制或重置；复制调用示例不包含这里的真实凭证。</p></div>
            <ApiTestPanel operation={operation} credential={credential} />
          </TabsContent></Tabs>
        </CardContent></Card>}
      </div>
    </>}
    </IntegrationsTabs>
  </main>;
}
