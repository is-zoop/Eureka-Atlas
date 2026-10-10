"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, LogIn, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export type SubscriptionModel = { id: string; name: string; api: string; contextWindow: number; maxTokens: number; reasoning: boolean };
type AuthEvent = { type: string; url?: string; instructions?: string; message?: string; verificationUri?: string; userCode?: string };
type Login = { id: string; status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"; events: AuthEvent[]; error: string | null; prompt: { id: string; type: string; message: string; placeholder?: string; options?: { id: string; label: string }[] } | null };

export function SubscriptionSettings({ providerId, connected, catalogRevision, onChanged, onCatalog }: {
  providerId: string; connected: boolean; catalogRevision: number; onChanged(): Promise<void>; onCatalog(models: SubscriptionModel[]): void;
}) {
  const [login, setLogin] = useState<Login | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownedLogin = useRef<string | null>(null);
  const mounted = useRef(true);
  const callbacks = useRef({ onChanged, onCatalog });
  useEffect(() => { callbacks.current = { onChanged, onCatalog }; }, [onChanged, onCatalog]);
  const base = "/models/providers/" + providerId + "/subscription";
  const loginId = login?.id;
  const loginStatus = login?.status;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (ownedLogin.current) void api(base + "/login/" + ownedLogin.current, { method: "DELETE" }).catch(() => undefined); };
  }, [base]);
  useEffect(() => {
    let disposed = false;
    if (connected) void api<SubscriptionModel[]>(base + "/catalog")
      .then((models) => { if (!disposed) callbacks.current.onCatalog(models); })
      .catch((failure: Error) => { if (!disposed) setError(failure.message); });
    return () => { disposed = true; };
  }, [base, connected, catalogRevision]);
  useEffect(() => {
    if (!loginId || loginStatus !== "RUNNING") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await api<Login>(base + "/login/" + loginId);
        if (disposed) return;

        if (latest.status === "RUNNING") { setLogin(latest); timer = setTimeout(() => void poll(), 800); }
        else {
          ownedLogin.current = null;
          if (latest.status === "SUCCEEDED") {
            await callbacks.current.onChanged();
            const models = await api<SubscriptionModel[]>(base + "/catalog");
            if (!disposed) callbacks.current.onCatalog(models);
          } else if (latest.error) setError(latest.error);
          if (!disposed) setLogin(latest);
        }
      } catch (failure) {
        if (!disposed) {
          const message = failure instanceof Error ? failure.message : "无法读取登录状态";
          setError(message);
          if ((failure as { statusCode?: number }).statusCode === 404) {
            ownedLogin.current = null;
            setLogin((current) => current ? { ...current, status: "FAILED", error: message } : current);
          } else timer = setTimeout(() => void poll(), 2000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 300);
    return () => { disposed = true; clearTimeout(timer); };
  }, [base, loginId, loginStatus]); // Polling observes one login; event updates never create a second flow.
  const start = async () => {
    setBusy(true); setError(""); setInput("");
    try {
      const next = await api<Login>(base + "/login", { method: "POST" });
      if (!mounted.current) { await api(base + "/login/" + next.id, { method: "DELETE" }); return; }
      ownedLogin.current = next.id; setLogin(next);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "登录失败"); }
    finally { if (mounted.current) setBusy(false); }
  };
  const cancel = async () => {
    if (!login) return;
    await api(base + "/login/" + login.id, { method: "DELETE" }); ownedLogin.current = null; setLogin(null);
  };
  const answer = async (value: string) => {
    if (!login?.prompt) return;
    setBusy(true); setError("");
    try { await api(base + "/login/" + login.id + "/input", { method: "POST", body: JSON.stringify({ promptId: login.prompt.id, value }) }); setInput(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "授权码提交失败"); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setError("");
    try { await api(base, { method: "DELETE" }); setLogin(null); callbacks.current.onCatalog([]); await callbacks.current.onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "退出失败"); }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError("");
    try { callbacks.current.onCatalog(await api<SubscriptionModel[]>(base + "/refresh", { method: "POST" })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "刷新失败"); }
    finally { setBusy(false); }
  };
  const running = login?.status === "RUNNING";
  const auth = login?.events.findLast((event) => event.type === "auth_url" || event.type === "device_code");
  const url = auth?.url ?? auth?.verificationUri;
  const validUrl = url && /^https?:\/\//i.test(url) ? url : undefined;
  return <section className="space-y-3 rounded-lg border border-slate-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><b className="text-sm">订阅账号</b><p className="mt-1 text-xs text-slate-500">{connected ? "已登录 · 凭据由服务端加密保存，调用时自动刷新" : "未登录 · 使用供应商账号授权，无需填写 API Key"}</p></div>
      <div className="flex gap-2">{running ? <Button type="button" size="sm" variant="outline" onClick={() => void cancel().catch(() => setError("取消失败"))}>取消登录</Button> : <>
        <Button type="button" size="sm" disabled={busy} onClick={() => void start()}><LogIn className="size-4" />{connected ? "重新登录" : "登录订阅"}</Button>
        {connected && <><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw className="size-4" />刷新模型</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void logout()}><LogOut className="size-4" />退出</Button></>}
      </>}</div>
    </div>
    {running && <div className="space-y-3 border-t border-slate-100 pt-3 text-sm">
      <p className="flex items-center gap-2 text-slate-500"><LoaderCircle className="size-4 animate-spin" />等待完成账号授权</p>
      {validUrl && <a href={validUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">打开授权页面<ExternalLink className="size-3.5" /></a>}
      {auth?.userCode && <p>设备验证码：<code className="select-all rounded bg-slate-100 px-2 py-1 font-mono">{auth.userCode}</code></p>}
      {auth?.instructions && <p className="text-xs leading-5 text-slate-500">{auth.instructions}</p>}
      {login.events.findLast((event) => event.message)?.message && <p className="text-xs text-slate-500">{login.events.findLast((event) => event.message)?.message}</p>}
      {login.prompt && <div className="space-y-2"><p className="text-xs text-slate-500">{login.prompt.message}</p>{login.prompt.options ? <div className="flex flex-wrap gap-2">{login.prompt.options.map((option) => <Button type="button" size="sm" variant="outline" key={option.id} disabled={busy} onClick={() => void answer(option.id)}>{option.label}</Button>)}</div> : <div className="flex gap-2"><Input aria-label="授权码或回调地址" type={login.prompt.type === "secret" ? "password" : "text"} placeholder={login.prompt.placeholder ?? "粘贴授权码或回调地址"} value={input} onChange={(event) => setInput(event.target.value)} /><Button type="button" size="sm" disabled={busy || !input.trim()} onClick={() => void answer(input)}>提交</Button></div>}</div>}
    </div>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </section>;
}
