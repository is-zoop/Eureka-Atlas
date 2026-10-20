"use client";

// Adapted from HazeToolPlat's PersonalCenter settings tab.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { AuthUser } from "@eureka-atlas/types";
import { Camera, CircleAlert, LockKeyhole, Save, Shield, UserRound } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeAvatar } from "@/lib/profile-avatar";
import { updateProfileAvatar } from "@/lib/profile";
import { updateAuthUser } from "@/lib/auth";
import { PasswordDialog } from "./password-dialog";
import { ProfileInfo } from "./profile-info";

export function PersonalSettings({ user }: { user: AuthUser }) {
  const [avatar, setAvatar] = useState(user.avatar_url ?? ""), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [saving, setSaving] = useState(false), [processing, setProcessing] = useState(false), [passwordOpen, setPasswordOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null), imageJob = useRef(0), request = useRef<AbortController | null>(null);
  useEffect(() => { setAvatar(user.avatar_url ?? ""); }, [user.avatar_url]);
  useEffect(() => () => { imageJob.current++; request.current?.abort(); }, []);
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    const ticket = ++imageJob.current;
    setProcessing(true); setMessage(""); setError("");
    try {
      const result = await normalizeAvatar(file);
      if (ticket === imageJob.current) { setAvatar(result); setMessage("头像已处理，点击“保存头像”后生效。"); }
    } catch (cause) { if (ticket === imageJob.current) setError(cause instanceof Error ? cause.message : "无法处理图片，请选择其他头像。"); }
    finally { if (ticket === imageJob.current) setProcessing(false); }
  };
  const save = async () => {
    if (request.current || processing) return;
    const controller = new AbortController(); request.current = controller;
    setSaving(true); setMessage(""); setError("");
    try {
      const updated = await updateProfileAvatar(avatar || null, controller.signal);
      if (!controller.signal.aborted) { updateAuthUser(updated); setAvatar(updated.avatar_url ?? ""); setMessage("头像已同步到 Haze。"); }
    } catch (cause) { if (!controller.signal.aborted && (cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "保存头像失败，请重试。"); }
    finally { if (!controller.signal.aborted) setSaving(false); if (request.current === controller) request.current = null; }
  };
  return <div className="grid gap-3 xl:grid-cols-[360px_1fr]">
    <Card className="rounded-xl border-slate-200/70 shadow-none">
      <CardHeader className="p-4 pb-2"><CardTitle className="flex items-center gap-2 text-sm"><UserRound className="size-4" />头像设置</CardTitle></CardHeader>
      <CardContent className="space-y-4 p-4 pt-2">
        <div className="flex items-center gap-3">
          <button type="button" aria-label="选择头像图片" disabled={saving || processing} onClick={() => input.current?.click()} className="group relative size-16 shrink-0 overflow-hidden rounded-full border border-slate-200 disabled:opacity-50">
            <Avatar className="size-full">{avatar && <AvatarImage src={avatar} alt={user.name} className="object-cover" />}<AvatarFallback className="bg-slate-900 text-white">{user.name.substring(0, 1).toUpperCase()}</AvatarFallback></Avatar>
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Camera className="size-4" /></span>
          </button>
          <input ref={input} aria-label="上传头像" type="file" accept="image/jpeg,image/png,image/webp" disabled={saving || processing} className="hidden" onChange={event => void choose(event)} />
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{user.name}</p><p className="mt-1 truncate text-xs text-slate-500">{user.email || "未设置邮箱"}</p><p className="mt-1 text-xs text-slate-500">JPG / PNG / WebP，最大 5 MB；128–4096 像素，居中裁剪保存为 256×256。</p></div>
        </div>
        {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
        {message && <p role="status" className="text-xs text-slate-600">{message}</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" disabled={saving || processing || avatar === (user.avatar_url ?? "")} onClick={() => void save()}><Save className="size-4" />{saving ? "正在保存…" : processing ? "处理头像中…" : "保存头像"}</Button><Button size="sm" variant="outline" onClick={() => setPasswordOpen(true)}><LockKeyhole className="size-4" />修改密码</Button></div>
      </CardContent>
    </Card>
    <Card className="rounded-xl border-slate-200/70 shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Shield className="size-4" />个人信息</CardTitle><Badge className="bg-emerald-50 text-emerald-700">启用</Badge></CardHeader>
      <CardContent className="p-4 pt-2"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><ProfileInfo label="姓名" value={user.name} /><ProfileInfo label="工号" value={user.member_no} /><ProfileInfo label="手机号" value={user.phone} /><ProfileInfo label="邮箱" value={user.email} /><ProfileInfo label="部门" value={user.department} /><ProfileInfo label="角色" value={user.role_name} /></div><p className="mt-3 text-xs text-slate-500">个人资料由 Haze 统一维护；如需修改其他信息，请联系管理员。</p></CardContent>
    </Card>
    <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
  </div>;
}
