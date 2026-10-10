"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AskClarificationRequest, AskEvent, AskRun, AskSavedQueryResult, AskSession, AskCursorPage, AskThinkingLevel, AskProcessingStep, SemanticSelectableTable } from "@eureka-atlas/types";
import { Bot, BrainCircuit, MessageSquarePlus, Send, Square } from "lucide-react";
import { FloatingAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SemanticTableSelector } from "@/components/semantic/semantic-table-selector";
import { RunAnswer } from "./run-answer";
import { ClarificationCard } from "./clarification-card";
import { SessionListItem } from "./session-list-item";
import { useConversationScroll } from "./use-conversation-scroll";
import { api, AUTH_ACCOUNT_CHANGED_EVENT, AUTH_UNAUTHORIZED_EVENT } from "@/lib/api";
import { refreshAuth, useAuth } from "@/lib/auth";

type Model = { id: string; modelId: string; displayName: string; providerName: string; testStatus: string; reasoning: boolean; thinkingLevels: AskThinkingLevel[] };
const terminal = (status: AskRun["status"]) => ["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(status);

export function AskWorkbench({ initialSessionId }: { initialSessionId?: string }) {
  const memberNo = useAuth().user!.member_no;
  const lastSessionKey = `atlas.ask.last-session:${memberNo}`;
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [actionSession, setActionSession] = useState<AskSession | null>(null);
  const [savingAction, setSavingAction] = useState(false);
  const [tables, setTables] = useState<SemanticSelectableTable[]>([]); const [models, setModels] = useState<Model[]>([]); const [sessions, setSessions] = useState<AskSession[]>([]); const [session, setSession] = useState<AskSession | null>(null); const [runs, setRuns] = useState<AskRun[]>([]); const [question, setQuestion] = useState(""); const [answerStream, setAnswerStream] = useState<Record<string, string>>({}); const [results, setResults] = useState<Record<string, AskSavedQueryResult>>({}); const [resultErrors, setResultErrors] = useState<Record<string, string>>({}); const resultRequests = useRef(new Set<string>()); const messageBuffers = useRef(new Map<string, string>()); const [error, setError] = useState(""); const [renameOpen, setRenameOpen] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false); const [title, setTitle] = useState(""); const source = useRef<EventSource | null>(null); const requestVersion = useRef(0); const sessionRef = useRef<AskSession | null>(null); const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { sessionRef.current = session; }, [session]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { scrollRef, contentRef, followLatest } = useConversationScroll(session?.id);
  const current = runs.find((item) => !terminal(item.status)) ?? null; const locked = Boolean(current); const selected = session?.table_ids ?? [];
  const selectedModel = models.find((model) => model.id === session?.model_id); const thinkingLevels = selectedModel?.thinkingLevels ?? ["off"]; const supportsThinking = thinkingLevels.some((level) => level !== "off");
  const modelOptions = models.map((model) => ({ value: model.id, label: model.displayName }));
  const modelGroups = [...models.reduce((groups, model) => {
    const provider = model.providerName || "未分类";
    groups.set(provider, [...(groups.get(provider) ?? []), { value: model.id, label: model.displayName }]);
    return groups;
  }, new Map<string, Array<{ value: string; label: string }>>())].map(([label, options]) => ({ label: label.toUpperCase(), options }));

  const loadSession = async (id: string) => { const ticket = ++requestVersion.current; source.current?.close(); const [next, history] = await Promise.all([api<AskSession>(`/ask/sessions/${id}`), api<AskCursorPage<AskRun>>(`/ask/sessions/${id}/runs`)]); if (ticket !== requestVersion.current) return; sessionRef.current = next; setSession(next); setSessions((old) => old.some((item) => item.id === next.id) ? old.map((item) => item.id === next.id ? next : item) : [next, ...old]); setSessionUnavailable(false); setRuns(history.items); setAnswerStream({}); setResults({}); setResultErrors({}); messageBuffers.current.clear(); localStorage.setItem(lastSessionKey, id); window.history.replaceState(null, "", `/query/ask/${id}`); };
  const createSession = async () => { const ticket = requestVersion.current; const created = await api<AskSession>("/ask/sessions", { method: "POST", body: JSON.stringify({ model_id: models[0]?.id }) }); if (ticket !== requestVersion.current) return; setSessions((old) => [created, ...old]); await loadSession(created.id); };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [tableResult, modelResult, sessionResult] = await Promise.all([
        api<{ items: SemanticSelectableTable[] }>("/semantic/queryable-tables"),
        api<Model[]>("/models/available"),
        api<AskCursorPage<AskSession>>("/ask/sessions"),
      ]);
      if (cancelled) return;
      setTables(tableResult.items); setModels(modelResult); setSessions(sessionResult.items);
      const saved = initialSessionId || localStorage.getItem(lastSessionKey);
      if (saved) {
        try { await loadSession(saved); return; }
        catch (cause) {
          if ((cause as { status?: number }).status !== 404) throw cause;
          if (initialSessionId) { setSessionUnavailable(true); return; }
          localStorage.removeItem(lastSessionKey);
        }
      }
      const id = sessionResult.items[0]?.id;
      if (id) await loadSession(id);
      else if (modelResult[0]) await createSession();
    })().catch((cause: Error) => !cancelled && setError(cause.message));
    // This ref is a request generation counter, not a DOM ref; cleanup invalidates pending responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; requestVersion.current++; source.current?.close(); };
  // Initial page data only; session loading itself guards late responses.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSession = async (sessionId: string, ticket = requestVersion.current) => {
    const next = await api<AskSession>(`/ask/sessions/${sessionId}`);
    const selectedSession = sessionRef.current;
    if (ticket !== requestVersion.current || selectedSession?.id !== sessionId ||
      next.configuration_version < selectedSession.configuration_version) return;
    sessionRef.current = next;
    setSession(next);
    setSessions((old) => old.map((item) => item.id === next.id ? next : item));
  };

  const refreshRun = async (runId: string, ticket = requestVersion.current) => {
    const next = await api<AskRun>(`/ask/runs/${runId}`);
    if (ticket !== requestVersion.current) return;
    setRuns((old) => old.map((item) => item.id === runId && next.event_cursor >= item.event_cursor ? next : item));
    if (terminal(next.status) && next.session_id) await refreshSession(next.session_id, ticket);
  };

  useEffect(() => {
    if (!current?.id) return;
    const runId = current.id;
    const ticket = requestVersion.current;
    source.current?.close();
    const stream = new EventSource(`/api/ask/runs/${runId}/events?after=${current.event_cursor}`);
    source.current = stream;
    const expired = () => { requestVersion.current++; stream.close(); };
    const authExpired = () => { stream.close(); void refreshAuth(); };
    const authUnavailable = () => { stream.close(); void refreshAuth(); };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, expired);
    window.addEventListener(AUTH_ACCOUNT_CHANGED_EVENT, expired);
    stream.addEventListener("auth-expired", authExpired);
    stream.addEventListener("auth-changed", authExpired);
    stream.addEventListener("resource-unavailable", () => { stream.close(); setSessionUnavailable(true); });
    stream.addEventListener("auth-unavailable", authUnavailable);
    let checkingAuth = false;
    stream.addEventListener("error", (event) => {
      if ("data" in event || checkingAuth) return;
      checkingAuth = true;
      void refreshAuth().then(() => refreshRun(runId, ticket)).catch((cause: { status?: number }) => {
        if (cause.status === 404 && ticket === requestVersion.current) { stream.close(); setSessionUnavailable(true); }
      }).finally(() => { checkingAuth = false; });
    });
    const seen = new Set<number>();
    const receive = (event: AskEvent) => {
      if (ticket !== requestVersion.current || seen.has(event.sequence)) return;
      seen.add(event.sequence);
      const messageId = String(event.payload.message_id ?? "");
      if (event.type === "answer" && messageId) {
        if (event.payload.phase === "start") { messageBuffers.current.set(messageId, ""); setAnswerStream((old) => ({ ...old, [runId]: "" })); }
        if (event.payload.phase === "delta" && typeof event.payload.delta === "string") {
          const content = (messageBuffers.current.get(messageId) ?? "") + event.payload.delta;
          messageBuffers.current.set(messageId, content);
          setAnswerStream((old) => ({ ...old, [runId]: content }));
        }
        if (event.payload.phase === "end") {
          const content = messageBuffers.current.get(messageId) ?? "";
          messageBuffers.current.delete(messageId);
          setAnswerStream((old) => ({ ...old, [runId]: event.payload.intermediate ? "" : content }));
        }
      }
      if (event.type === "processing") {
        setRuns((old) => old.map((item) => {
          if (item.id !== runId || event.sequence <= item.event_cursor) return item;
          const step = event.payload.step as AskProcessingStep | undefined;
          const steps = step ? [...item.processing.steps.filter((existing) => existing.id !== step.id), step].sort((a, b) => a.started_at.localeCompare(b.started_at)) : item.processing.steps;
          return { ...item, event_cursor: event.sequence, processing: {
            steps,
            message_count: Math.max(item.processing.message_count, Number(event.payload.message_count) || 0),
            tool_count: steps.filter((detail) => detail.kind === "tool").length,
          } };
        }));
      }
      if (event.type === "status") {
        setRuns((old) => old.map((item) => item.id === runId && event.sequence > item.event_cursor ? { ...item, event_cursor: event.sequence, status: String(event.payload.status) as AskRun["status"] } : item));
      }
      // Persisted final answer and archived queries are authoritative. Also reload
      // on tool completion so results appear even while the model is responding.
      if (["status", "clarification", "error"].includes(event.type) ||
        (event.type === "processing" && (event.payload.step as AskProcessingStep | undefined)?.status !== "RUNNING")) {
        void refreshRun(runId, ticket).catch((cause: Error) => ticket === requestVersion.current && setError(cause.message));
      }
    };
    stream.onopen = () => { void refreshRun(runId, ticket).catch((cause: Error) => ticket === requestVersion.current && setError(cause.message)); };
    const eventKinds = ["status", "progress", "answer", "clarification", "error", "processing"];
    const receiveMessage = (event: Event) => {
      if (ticket !== requestVersion.current) return;
      // EventSource also emits native connection errors without message data.
      // Leave those to its automatic reconnect; business errors contain JSON.
      if (!("data" in event) || typeof event.data !== "string" || !event.data.trim()) return;
      let message: AskEvent;
      try {
        message = JSON.parse(event.data) as AskEvent;
      } catch {
        setError("收到无法解析的问数实时事件，请刷新页面重连");
        return;
      }
      if (!message || typeof message !== "object" || !Number.isSafeInteger(message.sequence) || message.sequence < 1 ||
        !eventKinds.includes(message.type) || !message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) {
        setError("问数实时事件格式无效，请刷新页面重连");
        return;
      }
      receive(message);
    };
    stream.onmessage = receiveMessage;
    eventKinds.forEach((kind) => stream.addEventListener(kind, receiveMessage));
    return () => { window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, expired); window.removeEventListener(AUTH_ACCOUNT_CHANGED_EVENT, expired); stream.close(); };
  // The subscription is bound to a run; status updates keep the same connection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    const ticket = requestVersion.current;
    runs.forEach((run) => {
      const ids = [...new Set([...run.queries.filter((query) => query.status === "SUCCEEDED").map((query) => query.id), ...run.result_summaries.map((result) => result.query_id)])];
      ids.filter((id) => !results[id] && !resultErrors[id]).forEach((queryId) => {
        const requestKey = `${ticket}:${queryId}`;
        if (resultRequests.current.has(requestKey)) return;
        resultRequests.current.add(requestKey);
        void api<AskSavedQueryResult>(`/ask/runs/${run.id}/queries/${queryId}/result`).then((result) => {
          if (ticket === requestVersion.current) setResults((old) => ({ ...old, [queryId]: result }));
        }).catch((cause: Error) => {
          if (ticket === requestVersion.current) setResultErrors((old) => ({ ...old, [queryId]: cause.message }));
        }).finally(() => resultRequests.current.delete(requestKey));
      });
    });
  }, [results, runs, resultErrors]);
  const updateSession = (changes: Partial<Pick<AskSession, "title" | "table_ids" | "model_id" | "thinking_level">>) => { const ticket = requestVersion.current; const sessionId = sessionRef.current?.id; const operation = saveQueue.current.then(async () => { const currentSession = sessionRef.current; if (!currentSession || currentSession.id !== sessionId || ticket !== requestVersion.current) return undefined; const next = await api<AskSession>(`/ask/sessions/${currentSession.id}`, { method: "PATCH", body: JSON.stringify({ ...changes, expected_configuration_version: currentSession.configuration_version }) }); if (ticket !== requestVersion.current) return next; sessionRef.current = next; setSession(next); setSessions((old) => old.map((item) => item.id === next.id ? next : item)); return next; }); saveQueue.current = operation.catch(() => undefined); return operation; };
  const selectTables = (ids: string[]) => { if (locked) return; void updateSession({ table_ids: ids }).catch((cause: Error) => setError(cause.message)); };
  const selectModel = (modelId: string) => { if (locked) return; void updateSession({ model_id: modelId }).catch((cause: Error) => setError(cause.message)); };
  const selectThinkingLevel = (thinkingLevel: AskSession["thinking_level"]) => { if (locked || !supportsThinking) return; void updateSession({ thinking_level: thinkingLevel }).catch((cause: Error) => setError(cause.message)); };
  const send = async () => {
    if (locked || submittingRef.current || !session?.model_id || !question.trim()) return;
    submittingRef.current = true;
    setSubmitting(true);
    const ticket = requestVersion.current;
    setError("");
    try {
      const run = await api<AskRun>(`/ask/sessions/${session.id}/runs`, { method: "POST", body: JSON.stringify({ question: question.trim(), idempotency_key: crypto.randomUUID(), expected_configuration_version: session.configuration_version }) });
      if (ticket !== requestVersion.current) return;
      followLatest();
      setRuns((old) => [...old, run]);
      setQuestion("");
      setAnswerStream((old) => ({ ...old, [run.id]: "" }));
      // The server names new conversations when it accepts their first question.
      // Synchronize both titles immediately, without waiting for model completion.
      await refreshSession(session.id, ticket);
    } catch (cause) {
      if (ticket === requestVersion.current) setError(cause instanceof Error ? cause.message : "提交问数失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  const continueRun = async (response: AskClarificationRequest) => {
    if (!current?.clarification || current.status !== "WAITING_CLARIFICATION" || current.clarification.id !== response.clarification_id) {
      throw new Error("澄清已失效，请查看当前问题");
    }
    const ticket = requestVersion.current;
    const next = await api<AskRun>("/ask/runs/" + current.id + "/clarifications", { method: "POST", body: JSON.stringify(response) });
    if (ticket !== requestVersion.current) return;
    followLatest();
    setRuns((old) => old.map((item) => item.id === next.id && next.event_cursor >= item.event_cursor ? next : item));
  };
  const stop = async () => { if (!current) return; const ticket = requestVersion.current; try { const next = await api<AskRun>(`/ask/runs/${current.id}/cancel`, { method: "POST" }); if (ticket !== requestVersion.current) return; setRuns((old) => old.map((item) => item.id === next.id ? next : item)); } catch (cause) { setError(cause instanceof Error ? cause.message : "停止失败"); } };
  const rename = async () => {
    if (!actionSession || !title.trim() || savingAction) return;
    setSavingAction(true);
    try {
      if (sessionRef.current?.id === actionSession.id) {
        await updateSession({ title: title.trim() });
      } else {
        const next = await api<AskSession>(`/ask/sessions/${actionSession.id}`, { method: "PATCH", body: JSON.stringify({ title: title.trim(), expected_configuration_version: actionSession.configuration_version }) });
        setSessions((old) => old.map((item) => item.id === next.id ? next : item));
      }
      setRenameOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "重命名失败"); }
    finally { setSavingAction(false); }
  };
  const remove = async () => {
    if (!actionSession || savingAction) return;
    setSavingAction(true);
    try {
      await api(`/ask/sessions/${actionSession.id}`, { method: "DELETE" });
      const remaining = sessions.filter((item) => item.id !== actionSession.id);
      setSessions((old) => old.filter((item) => item.id !== actionSession.id));
      setDeleteOpen(false);
      if (sessionRef.current?.id === actionSession.id) {
        setSession(null); setRuns([]);
        if (remaining[0]) await loadSession(remaining[0].id); else await createSession();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除会话失败"); }
    finally { setSavingAction(false); }
  };

  if (sessionUnavailable) return (
    <main className="flex min-h-64 flex-col items-center justify-center gap-4">
      <p role="alert" className="text-sm text-slate-500">会话不存在或无法访问</p>
      <Button asChild variant="outline"><Link href="/query/ask">返回我的问数列表</Link></Button>
    </main>
  );

  return (
    <main className="-mx-4 -my-5 flex h-[calc(100vh-64px)] min-h-[620px] min-w-0 overflow-hidden bg-white sm:-mx-6 lg:-mx-8">
      {error && <FloatingAlert type="error">{error}</FloatingAlert>}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-slate-50/60 md:flex md:flex-col">
        <div className="border-b border-slate-200 p-3"><Button className="w-full" onClick={() => void createSession()}><MessageSquarePlus className="size-4" />新建对话</Button></div>
        <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block"><TooltipProvider delayDuration={300}><nav className="w-full min-w-0 space-y-1 p-2">{sessions.map((item) => <SessionListItem key={item.id} session={item} selected={session?.id === item.id} busy={session?.id === item.id ? locked || submitting : Boolean(item.active_run)} onSelect={() => void loadSession(item.id)} onRename={() => { setActionSession(item); setTitle(item.title); setRenameOpen(true); }} onDelete={() => { setActionSession(item); setDeleteOpen(true); }} />)}</nav></TooltipProvider></ScrollArea>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {session ? <>
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <div className="min-w-0"><h1 className="truncate font-semibold text-slate-900">{session.title}</h1></div>
          </header>
          <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
            <div ref={contentRef} className="mx-auto max-w-4xl space-y-5 p-5">
              {runs.map((run) => <RunAnswer key={run.id} run={run} streamed={answerStream[run.id]} results={results} resultErrors={resultErrors} onRefresh={() => { setResultErrors({}); void refreshRun(run.id).catch((cause: Error) => setError(cause.message)); }} onDownload={(queryId) => window.open(`/api/ask/runs/${run.id}/queries/${queryId}/export`, "_blank", "noopener,noreferrer")} />)}
              {current?.status === "WAITING_CLARIFICATION" && (current.clarification ? (
                <ClarificationCard key={current.session_id + ":" + current.id + ":" + current.clarification.id} clarification={current.clarification} onSubmit={continueRun} />
              ) : (
                <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">旧格式澄清已失效，请停止本轮后重新提问。</p>
              ))}
              {!runs.length && <div className="py-20 text-center text-sm text-slate-500"><Bot className="mx-auto mb-3 size-7 text-slate-300" />在下方输入问题；未选择数据表时默认查询全部可查询表，选择后仅查询所选表。</div>}
            </div>
          </ScrollArea>
          <footer className="bg-white px-4 pb-4 pt-1">
            <div className="mx-auto w-full max-w-4xl">
            <InputGroup className="flex-col rounded-xl p-2">
              <InputGroupTextarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                if (event.ctrlKey) {
                  const input = event.currentTarget;
                  input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
                  setQuestion(input.value);
                } else if (!event.repeat) {
                  void send();
                }
              }} disabled={locked || submitting} placeholder={locked ? "当前问题尚未结束" : "例如：本月各店铺的销售额排行是多少？"} className="min-h-16 resize-none px-2 py-2" />
              <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <div className="flex min-w-0 items-center gap-1">
                  <Combobox menuPlacement="top" menuClassName="w-max min-w-40 max-w-52" className="w-fit min-w-0 max-w-[38vw]" inputClassName="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0" value={session.model_id} onValueChange={selectModel} disabled={locked} placeholder="选择模型" searchable={false} checkPosition="start" options={modelOptions} groups={modelGroups} />
                  <span className="h-4 w-px shrink-0 bg-slate-200" />
                  <BrainCircuit className={`size-4 shrink-0 ${supportsThinking ? "text-slate-500" : "text-slate-300"}`} />
                  <Combobox menuPlacement="top" menuClassName="w-max min-w-24" className="w-fit shrink-0" inputClassName="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0" value={session.thinking_level} onValueChange={(value) => selectThinkingLevel(value as AskSession["thinking_level"])} disabled={locked || !supportsThinking} placeholder="推理" searchable={false} checkPosition="start" options={thinkingLevels.map((level) => ({ value: level, label: ({ off: "关闭", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高" } as Record<AskThinkingLevel, string>)[level] }))} />
                </div>
                {locked ? <Button variant="outline" onClick={() => void stop()}><Square className="size-4" />{current?.status === "CANCELLING" ? "停止中" : "停止"}</Button> : <Button disabled={submitting || !question.trim() || !session.model_id} onClick={() => void send()}><Send className="size-4" />发送</Button>}
              </div>
            </InputGroup>
            </div>
          </footer>
        </> : <div className="m-auto text-center"><Bot className="mx-auto size-8 text-slate-400" /><p className="mt-3 text-sm text-slate-500">正在准备问数会话…</p><Button className="mt-4" onClick={() => void createSession()}>新建对话</Button></div>}
      </section>
      {session && <aside className="hidden w-[370px] shrink-0 flex-col border-l border-slate-200 bg-slate-50/50 lg:flex">
        <div className="border-b border-slate-200 px-4 py-4"><h2 className="font-medium text-slate-900">选择数据</h2></div>
        <div className="min-h-0 flex-1"><SemanticTableSelector tables={tables} value={selected} onValueChange={selectTables} disabled={locked} fullHeight showSourceDetails={false} /></div>
      </aside>}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}><DialogContent><DialogHeader><DialogTitle>重命名会话</DialogTitle><DialogDescription>修改历史列表中的会话名称。</DialogDescription></DialogHeader><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} disabled={savingAction} /><DialogFooter><Button variant="outline" disabled={savingAction} onClick={() => setRenameOpen(false)}>取消</Button><Button disabled={savingAction || !title.trim()} onClick={() => void rename()}>保存</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>删除会话？</DialogTitle><DialogDescription>会话“{actionSession?.title}”中的问题、消息和保存结果将被删除，无法恢复。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={savingAction} onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="destructive" disabled={savingAction} onClick={() => void remove()}>删除</Button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}
