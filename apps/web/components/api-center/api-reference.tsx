"use client";

import { useState } from "react";
import type { ExternalApiOperation } from "@eureka-atlas/types";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { curlExample } from "@/lib/external-api";

export function ApiJson({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2) ?? "null";
  const max = 128 * 1024;
  return <><pre className="shadcn-scrollbar max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">{json.slice(0, max)}</pre>{json.length > max && <p className="mt-1 text-xs text-amber-700">仅截断当前页面预览，接口返回的数据未因此截断。</p>}</>;
}
function Fields({ schema }: { schema: Record<string, unknown> }) {
  const required = new Set(schema.required as string[] ?? []);
  const fields = Object.entries(schema.properties as Record<string, Record<string, unknown>> ?? {});
  if (!fields.length) return <p className="text-xs text-slate-500">无参数。</p>;
  return <Table containerClassName="h-auto"><thead><tr><TableHead>参数</TableHead><TableHead>必填</TableHead><TableHead>类型</TableHead><TableHead>说明</TableHead></tr></thead><tbody>{fields.map(([name, property]) => <tr key={name}><TableCell><code>{name}</code></TableCell><TableCell>{required.has(name) ? "是" : "否"}</TableCell><TableCell>{String(property.type ?? "枚举／联合类型")}</TableCell><TableCell className="max-w-xl whitespace-normal">{String(property.description ?? "详见下方完整 Schema")}</TableCell></tr>)}</tbody></Table>;
}
export function ApiReference({ operation }: { operation: ExternalApiOperation }) {
  const [message, setMessage] = useState("");
  const origin = typeof window === "undefined" ? "https://YOUR_ATLAS_HOST" : window.location.origin;
  const snippet = curlExample(operation, origin);
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); setMessage("示例已复制，凭证使用占位符，请自行替换。"); }
    catch { setMessage("无法复制，请确认 HTTPS 和剪贴板权限。"); }
  };
  return <div className="space-y-5">
    <div><h3 className="mb-2 text-sm font-semibold">使用说明</h3><ul className="list-disc space-y-1 pl-5 text-xs leading-6 text-slate-600">{operation.notes.map(note => <li key={note}>{note}</li>)}</ul></div>
    <div><h3 className="mb-2 text-sm font-semibold">路径参数</h3><Fields schema={operation.params_schema} /></div>
    {operation.method === "POST" && <div><h3 className="mb-2 text-sm font-semibold">JSON 请求体</h3><Fields schema={operation.request_schema} /><div className="mt-3"><ApiJson value={operation.request_example} /></div></div>}
    <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-semibold">完整输入与输出 Schema</summary><div className="mt-3 space-y-3"><p className="text-xs text-slate-500">请求体</p><ApiJson value={operation.request_schema} /><p className="text-xs text-slate-500">成功响应中的 data</p><ApiJson value={operation.response_schema} /></div></details>
    <div><h3 className="mb-2 text-sm font-semibold">成功响应示例 · HTTP {operation.success_status}</h3><p className="mb-2 text-xs text-slate-500">以下 ID、日期和业务数据均为虚构示例。</p><ApiJson value={{ data: operation.response_example, request_id: "example-request-id" }} /></div>
    <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">调用示例</h3><Button size="sm" variant="outline" onClick={() => void copy()}><Copy className="size-3.5" />复制示例</Button></div><pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5">{snippet}</pre>{message && <p role="status" className="mt-2 text-xs text-slate-500">{message}</p>}</div>
  </div>;
}
