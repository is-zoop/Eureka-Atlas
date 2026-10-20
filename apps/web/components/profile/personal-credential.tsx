"use client";

// Adapted from HazeToolPlat's PersonalCenter credential tab. Secrets are fetched
// only for an explicit copy/reset and disappear when this tab is unmounted.
import { useEffect, useRef, useState } from "react";
import type { PersonalCredential, PersonalCredentialSecret } from "@eureka-atlas/types";
import { Check, CircleAlert, Copy, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPersonalCredential, resetPersonalCredential, revealPersonalCredential } from "@/lib/profile";
import { ProfileInfo } from "./profile-info";

function metadata(value: PersonalCredentialSecret): PersonalCredential {
  return { id: value.id, name: value.name, masked_key: value.masked_key, created_at: value.created_at, updated_at: value.updated_at };
}
const formatTime = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

export function PersonalCredentialPanel() {
  const [credential, setCredential] = useState<PersonalCredential | null>(null), [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [copied, setCopied] = useState(false), [confirm, setConfirm] = useState(false), [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    void getPersonalCredential(controller.signal)
      .then(value => { if (!controller.signal.aborted) setCredential(value); })
      .catch((cause: Error) => { if (!controller.signal.aborted && cause.name !== "AbortError") setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); if (request.current === controller) request.current = null; });
    return () => { controller.abort(); request.current?.abort(); };
  }, [retry]);
  const copy = async () => {
    if (request.current) return;
    if (!navigator.clipboard?.writeText) { setError("复制凭证需要 HTTPS 和浏览器剪贴板权限。"); return; }
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setCopied(false); setError("");
    try {
      const value = await revealPersonalCredential(controller.signal);
      controller.signal.throwIfAborted();
      await navigator.clipboard.writeText(value.key);
      if (!controller.signal.aborted) { setCredential(metadata(value)); setCopied(true); }
    } catch (cause) { if (!controller.signal.aborted && (cause as Error).name !== "AbortError") setError("复制失败，请检查网络、HTTPS 和浏览器剪贴板权限后重试。"); }
    finally { if (!controller.signal.aborted) setLoading(false); if (request.current === controller) request.current = null; }
  };
  const reset = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(""); setCopied(false); setSecret("");
    try {
      const value = await resetPersonalCredential(controller.signal);
      if (!controller.signal.aborted) { setCredential(metadata(value)); setSecret(value.key); setConfirm(false); }
    } catch (cause) { if (!controller.signal.aborted && (cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "重置凭证失败，请重试。"); }
    finally { if (!controller.signal.aborted) setLoading(false); if (request.current === controller) request.current = null; }
  };
  return <>
    <Card className="rounded-xl border-slate-200/70 shadow-none">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4 pb-2"><CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="size-4" />个人服务访问凭证</CardTitle><Button size="sm" variant="outline" disabled={loading || !credential} onClick={() => { setError(""); setConfirm(true); }}><RefreshCw className="size-4" />重置凭证</Button></CardHeader>
      <CardContent className="space-y-4 p-4 pt-2">
        {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
        {!credential ? <div className="space-y-3 py-4 text-sm text-slate-500">{loading ? <p role="status">正在读取 Haze 个人凭证…</p> : <Button variant="outline" onClick={() => setRetry(value => value + 1)}>重新读取</Button>}</div> : <>
          <div className="grid gap-3 md:grid-cols-3"><ProfileInfo label="凭证名称" value={credential.name} /><ProfileInfo label="创建时间" value={formatTime(credential.created_at)} /><ProfileInfo label="最近重置" value={formatTime(credential.updated_at)} /></div>
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs font-semibold text-slate-500">个人服务访问凭证</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"><div aria-label={secret ? "完整个人凭证" : "已隐藏的个人凭证"} className="min-h-9 min-w-0 flex-1 select-all break-all rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[13px] leading-5">{secret || credential.masked_key}</div><Button size="sm" variant="outline" disabled={loading} onClick={() => void copy()}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "已复制" : "复制凭证"}</Button>{secret && <Button size="sm" variant="ghost" onClick={() => setSecret("")}><EyeOff className="size-4" />隐藏</Button>}</div>
            <p className="mt-2 text-xs text-slate-500">{secret ? "新凭证当前可见；离开此页签或刷新后自动隐藏。" : "默认仅显示掩码，点击复制时按需获取完整凭证。重置会使旧凭证立即失效。"}</p>
          </div>
          <p className="text-xs leading-5 text-slate-500">此凭证由 Haze 统一管理，可用于 Haze 个人服务、所有有效角色可用的 Atlas MCP，以及管理员／系统管理员获授权的 Atlas 开放 API（REST）。它不用于延长网页登录时间；退出登录或修改密码不等于撤销凭证，需重置凭证或停用账号。</p>
        </>}
      </CardContent>
    </Card>
    <Dialog open={confirm} onOpenChange={next => { if (!loading) setConfirm(next); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>确认重置个人凭证？</DialogTitle><DialogDescription>旧凭证将立即失效，所有使用它访问 Haze 服务的客户端都需要更新。此操作不会修改你的登录密码。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={loading} onClick={() => setConfirm(false)}>取消</Button><Button disabled={loading} onClick={() => void reset()}>{loading ? "正在重置…" : "确认重置"}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
