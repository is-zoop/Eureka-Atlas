"use client";

import { useEffect, useRef, useState } from "react";
import type { ExternalApiOperation } from "@eureka-atlas/types";
import { CircleAlert, Play, RefreshCw, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callExternalApi, externalPath, waitForPoll, type ApiTestResult } from "@/lib/external-api";
import { ApiJson } from "./api-reference";

const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
function taskFrom(result: ApiTestResult): { id?: string; status?: string } {
  const body = result.body as { data?: { id?: string; status?: string } } | null;
  return body && typeof body === "object" && body.data && typeof body.data === "object" ? body.data : {};
}
export function ApiTestPanel({ operation, credential }: { operation: ExternalApiOperation; credential: string }) {
  const [params, setParams] = useState<Record<string, string>>(operation.params_example);
  const [body, setBody] = useState(JSON.stringify(operation.request_example, null, 2));
  const [result, setResult] = useState<ApiTestResult | null>(null), [taskId, setTaskId] = useState(""), [error, setError] = useState(""), [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false), [confirmCancel, setConfirmCancel] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current?.abort(); active.current = null; setBusy(false); setResult(null); setError(""); setInfo("");
    setBody(JSON.stringify(operation.request_example, null, 2));
    setParams({ ...operation.params_example, ...(operation.params_example.queryId && taskId ? { queryId: taskId } : {}) });
    // Keep the last query ID when selecting its status/result/cancel API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation.id]);
  useEffect(() => { active.current?.abort(); active.current = null; setBusy(false); setResult(null); setTaskId(""); setError(""); setInfo(""); setConfirmCancel(false); }, [credential]);
  useEffect(() => {
    const hide = () => { active.current?.abort(); active.current = null; setBusy(false); setResult(null); setTaskId(""); setError(""); setInfo(""); };
    window.addEventListener("pagehide", hide);
    return () => { window.removeEventListener("pagehide", hide); active.current?.abort(); };
  }, []);

  const run = async (action: "request" | "status" | "result" | "track" | "cancel") => {
    if (active.current) return;
    setError(""); setInfo("");
    let path: string, method: "GET" | "POST", payload: unknown;
    try {
      if (action === "request") {
        path = externalPath(operation, params); method = operation.method;
        payload = method === "POST" ? JSON.parse(body || "{}") : undefined;
      } else {
        path = externalPath({ path: `/api/external/v1/queries/:queryId${action === "result" ? "/result" : action === "cancel" ? "/cancel" : ""}` }, { queryId: taskId });
        method = action === "cancel" ? "POST" : "GET"; payload = method === "POST" ? {} : undefined;
      }
    } catch (cause) { setError(cause instanceof SyntaxError ? "请求体不是有效 JSON。" : (cause as Error).message); return; }
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      do {
        const next = await callExternalApi(path, method, credential, payload, controller.signal);
        controller.signal.throwIfAborted(); setResult(next);
        const task = taskFrom(next);
        if (typeof task.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(task.id)) setTaskId(task.id);
        if (action !== "track" || next.status >= 400 || !task.status || terminal.has(task.status)) break;
        setInfo("每 3 秒跟踪一次状态；停止等待不会取消后台查询。");
        await waitForPoll(controller.signal);
      } while (!controller.signal.aborted);
      if (!controller.signal.aborted) { setInfo(action === "track" ? "状态跟踪已结束。可读取成功结果或检查任务错误。" : ""); setConfirmCancel(false); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "调用失败，请重试。");
    } finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  };
  const stop = () => { active.current?.abort(); active.current = null; setBusy(false); setInfo("已停止本地等待，后台任务不会自动取消；可用原幂等标识重试确认，或显式取消任务。"); };
  const newId = () => {
    try { const parsed = JSON.parse(body); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); setBody(JSON.stringify({ ...parsed, idempotency_key: crypto.randomUUID() }, null, 2)); setError(""); }
    catch { setError("请先填写有效的 JSON 对象。"); }
  };
  const currentTask = result ? taskFrom(result) : {};
  return <div className="space-y-4">
    <Alert><CircleAlert /><AlertDescription>这里调用真实开放 API，会读取实际数据并可能产生 MaxCompute 查询费用。使用个人凭证，不借用网页登录身份；返回 401／403 不会退出当前网页。</AlertDescription></Alert>
    {Object.keys(operation.params_example).map(name => <div key={name} className="space-y-1.5"><Label htmlFor={`api-param-${name}`}>{name}</Label><Input id={`api-param-${name}`} value={params[name] ?? ""} disabled={busy} onChange={event => { setParams(current => ({ ...current, [name]: event.target.value })); if (name === "queryId") setTaskId(event.target.value); }} className="font-mono text-xs" /></div>)}
    {operation.method === "POST" && <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="api-request-json">JSON 请求体</Label>{["query", "dimensionValues"].includes(operation.id) && <Button size="sm" variant="outline" disabled={busy} onClick={newId}><RefreshCw className="size-3.5" />新请求标识</Button>}</div><Textarea id="api-request-json" spellCheck={false} value={body} disabled={busy} onChange={event => setBody(event.target.value)} className="min-h-64 font-mono text-xs leading-5" /><p className="text-xs text-slate-500">示例 ID／版本需替换成搜索和 Package 返回的真实值；重试同一请求不要更换幂等标识。</p></div>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !credential.trim()} onClick={() => void run("request")}><Play className="size-4" />{busy ? "调用中…" : "发送请求"}</Button>{busy && <Button variant="outline" onClick={stop}><Square className="size-4" />停止等待</Button>}</div>
    {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
    {info && <p role="status" className="text-xs text-slate-500">{info}</p>}
    {taskId && <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="break-all font-mono text-xs">任务 ID：{taskId}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("status")}>读取状态</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("track")}>跟踪状态</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("result")}>读取结果</Button><Button size="sm" variant="outline" disabled={busy || !!currentTask.status && terminal.has(currentTask.status)} onClick={() => setConfirmCancel(true)}>取消查询</Button></div></div>}
    {result && <section className="space-y-2"><div className="flex flex-wrap gap-4 text-xs"><span className={result.status < 400 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>HTTP {result.status}</span><span>{result.elapsed_ms} ms</span>{result.request_id && <span className="break-all">request_id: {result.request_id}</span>}{result.retry_after && <span>Retry-After: {result.retry_after} 秒</span>}</div><ApiJson value={result.body} /></section>}
    <Dialog open={confirmCancel} onOpenChange={next => { if (!busy) setConfirmCancel(next); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>确认取消查询？</DialogTitle><DialogDescription>这会通过真实外部接口请求取消后台任务，不只是停止页面等待。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmCancel(false)}>返回</Button><Button disabled={busy} onClick={() => void run("cancel")}>{busy ? "正在取消…" : "确认取消"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
