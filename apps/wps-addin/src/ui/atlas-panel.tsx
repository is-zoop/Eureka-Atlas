import { useEffect, useRef, useState } from "react";
import type { AuthUser, DataQueryExecution, SavedDataQuery, SavedDataQueryList } from "@eureka-atlas/types";
import { CircleAlert, CircleHelp, Compass, Database, Loader2, LogIn, LogOut, Play, RefreshCw, Search, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError } from "../lib/api.ts";
import { getApplication } from "../lib/host.ts";
import { cancelQuery, shouldResume, clearPending, readPending, storePending, type PendingTask } from "../lib/queries.ts";
import { discardImport, finishImport, rectangle, replacementRange, type Application, type Binding, type StagedImport } from "../lib/workbook.ts";
import { prepareImport, refreshAll } from '../lib/import-query.ts';
import { consumeUpdateAll, overwriteEnabled } from '../lib/ribbon-state.ts';

const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
const announce = () => {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("eureka-atlas:auth");
  channel.postMessage("changed"); channel.close();
};

export function AtlasPanel() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const loggingIn = useRef(false);

  const check = async (invalidate = false) => {
    const ticket = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    if (invalidate) { setUser(null); setEpoch(value => value + 1); setStatus("loading"); }
    try {
      const next = await api<AuthUser>(import.meta.env.MODE === 'desktop' ? '/auth/restore' : '/auth/me', { signal: request.signal, ...(import.meta.env.MODE === 'desktop' ? { method: 'POST', body: '{}' } : {}) });
      if (ticket !== generation.current) return;
      setUser(next); setStatus("ready"); setError("");
    } catch (cause) {
      if (ticket !== generation.current || request.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) { setUser(null); setStatus("ready"); setError(""); }
      else { setStatus("unavailable"); setError(message(cause)); }
    }
  };
  useEffect(() => {
    void check();
    const focus = () => { if (!loggingIn.current) void check(); };
    const visibility = () => { if (!document.hidden && !loggingIn.current) void check(); };
    const expired = () => { generation.current++; controller.current?.abort(); setUser(null); setStatus("ready"); setError("登录已失效，请重新登录"); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("eureka-atlas:auth") : null;
    if (channel) channel.onmessage = () => void check(true);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility); window.addEventListener("atlas-wps:unauthorized", expired);
    return () => { generation.current++; controller.current?.abort(); channel?.close(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("atlas-wps:unauthorized", expired); };
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault(); loggingIn.current = true; setBusy(true); setError("");
    const ticket = ++generation.current;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    try {
      const next = await api<AuthUser>("/auth/login", { method: "POST", signal: request.signal, body: JSON.stringify({ phone: phone.trim(), password }) });
      if (ticket !== generation.current) return;
      setPassword(""); setUser(next); setStatus("ready"); announce();
    } catch (cause) { if (ticket === generation.current) setError(message(cause)); }
    finally { loggingIn.current = false; setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try { await api("/auth/logout", { method: "POST" }); setUser(null); setPassword(""); setEpoch(value => value + 1); announce(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  return <main className="space-y-4 p-4">
    <header className="flex items-center gap-3"><Compass className="size-8 shrink-0 text-primary" strokeWidth={2} /><div><h1 className="text-base font-semibold">Atlas 数据助手</h1><p className="text-xs text-muted-foreground">我的查询 · 0.4.1</p></div></header>
    {status === "loading" ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />正在校验登录…</p> : null}
    {error ? <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700"><CircleAlert className="size-4 shrink-0" />{error}</p> : null}
    {status === "unavailable" ? <Button variant="outline" className="w-full" onClick={() => void check()}><RefreshCw />重试连接</Button> : null}
    {!user && status !== "loading" ? <Card><CardHeader className="p-4"><CardTitle>登录 Atlas</CardTitle></CardHeader><CardContent className="p-4 pt-0"><form onSubmit={event => void login(event)} className="space-y-3"><label className="block space-y-1 text-xs">手机号<Input aria-label="手机号" type="tel" autoComplete="username" required pattern="1[0-9]{10}" maxLength={11} value={phone} onChange={event => setPhone(event.target.value)} /></label><label className="block space-y-1 text-xs">密码<Input aria-label="密码" type="password" autoComplete="current-password" required minLength={6} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label><Button className="w-full" disabled={busy} type="submit">{busy ? <Loader2 className="animate-spin" /> : <LogIn />}登录</Button></form></CardContent></Card> : null}
    {user ? <><div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-xs"><span>{user.name}<span className="ml-2 text-muted-foreground">{user.department}</span></span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void logout()}><LogOut />退出</Button></div><QueryWorkspace key={`${user.member_no}:${epoch}`} user={user} available={status === "ready"} /></> : null}
  </main>;
}

function QueryWorkspace({ user, available }: { user: AuthUser; available: boolean }) {
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SavedDataQueryList | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<SavedDataQuery | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancellingRef = useRef(false);
  const [phase, setPhase] = useState("");
  const [task, setTask] = useState<DataQueryExecution | null>(null);
  const [pending, setPending] = useState<PendingTask | null>(() => { try { return readPending(localStorage, user.member_no); } catch { return null; } });
  const [stage, setStage] = useState<StagedImport | null>(null);
  const [binding, setBinding] = useState<Binding | null>(null);
  const controller = useRef<AbortController | null>(null);
  const stageRef = useRef<StagedImport | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const nameRef = useRef<string | undefined>(undefined);
  const batchConfirmation = useRef<((accepted: boolean) => void) | null>(null);
  const request = async <T,>(path: string, options?: RequestInit) => {
    try { return await api<T>(path, options); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401 && alive.current) window.dispatchEvent(new Event("atlas-wps:unauthorized")); throw cause; }
  };
  useEffect(() => () => {
    alive.current = false; generation.current++; controller.current?.abort();
    if (stageRef.current) { try { discardImport(getApplication() as Application, stageRef.current); } catch { /* No host on teardown. */ } }
  }, []);
  useEffect(() => {
    const stop = () => {
      controller.current?.abort();
      if (!controller.current && stageRef.current) {
        try { discardImport(getApplication() as Application, stageRef.current); } catch { /* Host may already be closing. */ }
        stageRef.current = null; setStage(null); setPhase("已停止本地读取，后台任务仍保留，可继续读取。");
      }
    };
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener("pagehide", stop); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", stop); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void request<SavedDataQueryList>(`/saved-data-queries?keyword=${encodeURIComponent(keyword.trim())}&page=${page}&pageSize=20`, { signal: abort.signal })
        .then(value => { if (!abort.signal.aborted) { setList(value); setError(""); } })
        .catch(cause => { if (!abort.signal.aborted) setError(message(cause)); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [keyword, page, reload]);
  useEffect(() => {
    if (!available) return;
    const timer = setInterval(() => { try { if (!document.hidden && consumeUpdateAll(getApplication())) void runAll(); } catch (cause) { setError(message(cause)); } }, 500);
    return () => clearInterval(timer);
  }, [available, busy, pending, stage]);

  function savePending(next: PendingTask) {
    setPending(next);
    try { storePending(localStorage, next); } catch { /* In-memory task ID still remains; no tokens or results are stored. */ }
  }
  function removePending() { setPending(null); try { clearPending(localStorage, user.member_no); } catch { /* Storage may be disabled. */ } }
  function succeeded(value: Binding, item: DataQueryExecution) {
    setBinding(value); setStage(null); stageRef.current = null; removePending();
    setPhase(`已更新 ${value.s}!${rectangle(value.r, value.c)}：${item.row_count.toLocaleString()} 行${item.truncated ? "（结果超过 20 万行，仅保存前 20 万行）" : ""}。请手动保存工作簿。`);
  }
  function taskProgress(item: DataQueryExecution, savedId: string) {
    setTask(item);
    if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(item.status) || (item.status === 'SUCCEEDED' && Date.parse(item.expires_at) <= Date.now())) removePending();
    else savePending({ member: user.member_no, savedId, queryId: item.id });
  }
  async function runAll() {
    if (controller.current || cancellingRef.current || stage || !available) { setError('当前正在查询或等待确认，请完成后再全部更新'); return; }
    if (pending) { setError('请先继续读取或取消上次任务，再执行全部更新'); return; }
    const abort = new AbortController(); controller.current = abort;
    const ticket = ++generation.current; setBusy(true); setError(''); setBinding(null); setTask(null);
    try {
      const report = await refreshAll(getApplication() as Application, request, user.member_no, abort.signal, {
        overwrite: () => overwriteEnabled(getApplication()),
        onTask: (item, savedId) => { if (ticket === generation.current && !abort.signal.aborted) taskProgress(item, savedId); },
        onProgress: text => { if (ticket === generation.current && !abort.signal.aborted) setPhase(text); },
        onSuccess: succeeded,
        confirm: (prepared, name) => new Promise<boolean>((resolve, reject) => {
          const stop = () => { batchConfirmation.current = null; reject(new DOMException('已停止全部更新', 'AbortError')); };
          abort.signal.addEventListener('abort', stop, { once: true });
          batchConfirmation.current = accepted => { abort.signal.removeEventListener('abort', stop); batchConfirmation.current = null; resolve(accepted); };
          stageRef.current = prepared; nameRef.current = name; setStage(prepared); setPhase('完整结果已就绪，请确认刷新范围');
          if (abort.signal.aborted) stop();
        }),
      });
      if (ticket !== generation.current || !alive.current) return;
      const success = report.filter(item => item.success).length;
      setPhase(`全部更新完成：${success}/${report.length} 个查询已更新。请手动保存工作簿。${report.filter(item => !item.success).map(item => `\n${item.sheet}：${item.error}`).join('')}`);
    } catch (cause) {
      if (ticket === generation.current && alive.current && !abort.signal.aborted) { setError(message(cause)); setPhase('全部更新已停止；已完成的结果保留，未完成任务可继续读取。'); }
      if (ticket === generation.current && abort.signal.aborted && !cancellingRef.current) setPhase('已停止本地全部更新，已提交的后台任务保留。');
    } finally {
      if (controller.current === abort) controller.current = null;
      batchConfirmation.current = null; stageRef.current = null;
      if (ticket === generation.current && alive.current) { setStage(null); setBusy(false); }
    }
  }
  async function run(resume = false) {
    if (controller.current || cancellingRef.current || !available || (!resume && !selected) || (resume && !pending)) return;
    const abort = new AbortController(); controller.current = abort;
    const ticket = ++generation.current;
    setBusy(true); setError(""); setPhase("正在准备查询…"); setBinding(null); setTask(null);
    let temporary: StagedImport | null = null;
    try {
      const savedId = resume ? pending!.savedId : selected!.id;
      nameRef.current = selected?.id === savedId ? selected.name : undefined;
      const app = getApplication() as Application;
      const prepared = await prepareImport(app, request, user.member_no, savedId, abort.signal, {
        onTask: (item, id) => { if (ticket === generation.current && !abort.signal.aborted) taskProgress(item, id); },
        onProgress: text => { if (ticket === generation.current && !abort.signal.aborted) setPhase(text); },
      }, resume ? pending!.queryId : undefined);
      temporary = prepared.stage; stageRef.current = temporary; nameRef.current = prepared.name ?? nameRef.current;
      if (ticket !== generation.current) throw new Error('工作区已变化，未更新原表');
      if (temporary.target.binding && !overwriteEnabled(app)) { setStage(temporary); setPhase("完整结果已就绪，请确认刷新范围"); temporary = null; }
      else { const value = finishImport(app, temporary, nameRef.current); succeeded(value, temporary.item); temporary = null; }
    } catch (cause) {
      if (ticket === generation.current && alive.current && !abort.signal.aborted) setError(message(cause));
      if (resume && cause instanceof ApiError && cause.status === 404 && ticket === generation.current && alive.current) removePending();
      if (ticket === generation.current && abort.signal.aborted && !cancellingRef.current) setPhase("已停止本地读取；再次点击查询按钮可继续读取任务。");
    } finally {
      if (temporary) { try { discardImport(getApplication() as Application, temporary); } catch { /* Workbook closed by user. */ } stageRef.current = null; }
      if (controller.current === abort) controller.current = null;
      if (ticket === generation.current && alive.current) setBusy(false);
    }
  }
  async function confirmRefresh() {
    if (batchConfirmation.current) { batchConfirmation.current(true); setStage(null); return; }
    if (!stage || controller.current || !available) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError("");
    try {
      const current = await request<AuthUser>("/auth/me", { signal: abort.signal });
      abort.signal.throwIfAborted();
      if (current.member_no !== user.member_no) throw new Error("账号已变化，未更新原表");
      succeeded(finishImport(getApplication() as Application, stage, nameRef.current), stage.item);
    } catch (cause) { if (alive.current && !abort.signal.aborted) setError(message(cause)); }
    finally { if (controller.current === abort) controller.current = null; if (alive.current) setBusy(false); }
  }
  function dismissStage() {
    if (!stage) return;
    if (batchConfirmation.current) { batchConfirmation.current(false); stageRef.current = null; setStage(null); removePending(); return; }
    if (busy) return;
    discardImport(getApplication() as Application, stage); stageRef.current = null; setStage(null); setPhase("已取消写入，原结果表未更新。可以继续读取此任务。");
  }
  async function cancelTask() {
    const id = pending?.queryId ?? task?.id;
    if (!id || !available || cancellingRef.current) return;
    cancellingRef.current = true; setCancelling(true); setError(""); setPhase("正在取消查询…");
    controller.current?.abort();
    try {
      if (stage) { discardImport(getApplication() as Application, stage); stageRef.current = null; setStage(null); }
      const result = await cancelQuery(request, id, controller.current);
      if (!alive.current) return;
      removePending(); setTask(null); setPhase(result.status === "SUCCEEDED" ? "已取消本地读取；后台查询已完成，原结果表未更新。" : "已请求取消查询");
    }
    catch (cause) { if (alive.current) { setPhase("本地读取已停止，后台取消尚未确认"); setError(`取消查询失败：${message(cause)}。任务信息已保留，请重试。`); } }
    finally { cancellingRef.current = false; if (alive.current) setCancelling(false); }
  }

  return <>
    <Card><CardHeader className="flex-row items-center justify-between p-4"><CardTitle className="flex items-center gap-2"><Database className="size-4" />我的查询</CardTitle><Button size="icon" variant="ghost" aria-label="刷新我的查询" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw /></Button></CardHeader><CardContent className="space-y-3 p-4 pt-0">
      <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="搜索查询名称" className="pl-9" placeholder="搜索查询名称" value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); }} /></div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {loading ? <p className="text-xs text-muted-foreground">正在加载…</p> : list?.items.length ? list.items.map(item => <Button key={item.id} variant="outline" aria-pressed={selected?.id === item.id} disabled={busy || cancelling || Boolean(stage)} className={`h-auto w-full justify-start border-border p-3 text-left ${selected?.id === item.id ? "bg-secondary" : ""}`} onClick={() => { setSelected(item); setError(""); setPhase(""); setBinding(null); }}><span className="min-w-0 space-y-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{item.table_name} · {item.config.mode === "DETAIL" ? "明细" : "汇总"} · {item.config.field_ids.length} 个字段</span></span></Button>) : <p className="py-3 text-xs text-muted-foreground">{keyword ? "没有匹配的查询" : "尚无保存查询，请先在 Atlas 数据查询页面保存配置"}</p>}
      </div>
      {list && list.total_pages > 1 ? <div className="flex items-center justify-between text-xs"><Button size="sm" variant="outline" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><span>{page} / {list.total_pages}</span><Button size="sm" variant="outline" disabled={page >= list.total_pages || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></div> : null}
    </CardContent></Card>
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button className="min-w-0 flex-1" disabled={(!selected && !pending) || busy || cancelling || Boolean(stage) || !available} onClick={() => void run(shouldResume(selected?.id, pending))}>{busy ? <Loader2 className="animate-spin" /> : <Play />}查询／刷新工作表</Button>
        <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label="查询与刷新说明" className="shrink-0"><CircleHelp /></Button></TooltipTrigger><TooltipContent side="bottom" collisionPadding={16} className="max-w-[280px] border border-border bg-card text-left text-xs font-normal leading-5 text-foreground">首次导入新建专用结果表，从 A1 写入中文表头和数据。刷新会覆盖确认范围，请勿在该范围维护其他数据。NULL 写为空白，文本与高精度数值按原文保留；不自动保存文件。</TooltipContent></Tooltip></TooltipProvider>
      </div>
      {pending ? <Button className="w-full" variant="destructive" disabled={!available || cancelling} onClick={() => void cancelTask()}>{cancelling ? <Loader2 className="animate-spin" /> : <Square />}{cancelling ? "正在取消…" : "取消查询"}</Button> : null}
      {task || pending ? <p className="break-all text-xs text-muted-foreground">任务 ID：{task?.id ?? pending?.queryId}</p> : null}
      {phase ? <p role="status" className="rounded-lg bg-secondary p-3 text-xs leading-5">{phase}</p> : null}
      {binding ? <p className="text-xs text-muted-foreground">绑定已保存在工作簿属性中，保存文件后下次打开可继续刷新。</p> : null}
      {error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}
    </div>
    <Dialog open={Boolean(stage)} onOpenChange={open => { if (!open) dismissStage(); }}><DialogContent className="max-w-[calc(100%-2rem)]"><DialogHeader><DialogTitle>确认刷新结果表</DialogTitle><DialogDescription>将覆盖 {stage?.target.binding?.s}!{stage ? replacementRange(stage) : ""}，清除旧结果多出的行列，并更新为 {stage?.item.row_count.toLocaleString()} 行。范围内的手动内容也会被覆盖，范围外不修改。{stage?.item.truncated ? "本次结果超过上限，仅有前 20 万行。" : ""}</DialogDescription></DialogHeader>{error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}<DialogFooter><Button variant="outline" disabled={busy && !batchConfirmation.current} onClick={dismissStage}>取消写入</Button><Button disabled={(busy && !batchConfirmation.current) || !available} onClick={() => void confirmRefresh()}>{busy && !batchConfirmation.current ? <Loader2 className="animate-spin" /> : <RefreshCw />}确认刷新</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
