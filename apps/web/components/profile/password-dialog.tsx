"use client";

// Adapted from Haze's PersonalCenter password dialog.
import { useEffect, useRef, useState } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetOwnPassword } from "@/lib/profile";

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [visible, setVisible] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => { if (!open) { setPasswords({ current: "", next: "", confirm: "" }); setError(""); setVisible(false); } }, [open]);
  useEffect(() => () => request.current?.abort(), []);
  const submit = async () => {
    if (request.current) return;
    setError("");
    if ([passwords.current, passwords.next].some(value => value.length < 6 || value.length > 128)) { setError("当前密码和新密码长度应为 6 至 128 位。"); return; }
    if (passwords.next !== passwords.confirm) { setError("两次输入的新密码不一致。"); return; }
    const controller = new AbortController(); request.current = controller; setSaving(true);
    try {
      await resetOwnPassword(passwords.current, passwords.next, controller.signal);
      if (!controller.signal.aborted) onOpenChange(false);
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "密码修改失败，请重试。");
    } finally {
      if (!controller.signal.aborted) setSaving(false);
      if (request.current === controller) request.current = null;
    }
  };
  return <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
    <DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>修改密码</DialogTitle><DialogDescription>修改的是 Haze 账号密码。成功后原有登录会话将失效，需要重新登录。</DialogDescription></DialogHeader>
      <form id="profile-password-form" onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3">
        {([{ key: "current", label: "当前密码", autoComplete: "current-password" }, { key: "next", label: "新密码", autoComplete: "new-password" }, { key: "confirm", label: "确认新密码", autoComplete: "new-password" }] as const).map(field => <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`profile-password-${field.key}`} className="text-xs text-slate-500">{field.label}</Label>
          <div className="relative"><Input id={`profile-password-${field.key}`} type={visible ? "text" : "password"} autoComplete={field.autoComplete} minLength={6} maxLength={128} required disabled={saving} value={passwords[field.key]} onChange={event => setPasswords(current => ({ ...current, [field.key]: event.target.value }))} className="pr-10" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => setVisible(!visible)} className="absolute right-1 top-1">{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
          </div>
        </div>)}
        {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      </form>
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form="profile-password-form" disabled={saving}>{saving ? "正在修改…" : "确认修改"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
