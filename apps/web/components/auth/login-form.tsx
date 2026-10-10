"use client";

// Adapted from HazeToolPlat/frontend/src/components/LoginForm.tsx.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, Eye, EyeOff, LockKeyhole, Smartphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loginDestination } from "@/lib/login-location";
import { login } from "@/lib/auth";
import styles from "./login.module.css";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!/^1\d{10}$/.test(phone.trim())) { setError("请输入有效的 11 位手机号。"); return; }
    if (password.length < 6 || password.length > 128) { setError("密码长度应为 6 至 128 位。"); return; }
    setSubmitting(true);
    try {
      await login(phone, password);
      router.replace(loginDestination(window.location));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请重试。");
      setSubmitting(false);
    }
  }

  const inputClass = "login-input h-auto rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0";
  const fieldClass = `${styles.field} flex items-center border border-slate-200 bg-white shadow-xs transition-all focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/15`;

  return (
    <div className={styles.form}>
      <div className={styles.formHeader}>
        <p className={styles.eyebrow}>WELCOME BACK</p>
        <h1 className="font-bold tracking-tight text-slate-900">欢迎回来</h1>
        <p className={styles.description}>登录 Eureka Atlas，开启你的数据探索。</p>
      </div>
      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.fieldGroup}>
          <Label htmlFor="phone" className="text-slate-700">手机号</Label>
          <div className={fieldClass}>
            <Smartphone aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
            <Input id="phone" name="phone" type="tel" inputMode="numeric" maxLength={11} autoComplete="username" autoCapitalize="none" spellCheck={false} required value={phone} onChange={event => { setPhone(event.target.value); setError(""); }} placeholder="请输入 Haze 手机号" disabled={submitting} aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} className={inputClass} />
          </div>
        </div>
        <div className={styles.fieldGroup}>
          <Label htmlFor="password" className="text-slate-700">密码</Label>
          <div className={fieldClass}>
            <LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
            <Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" minLength={6} maxLength={128} required value={password} onChange={event => { setPassword(event.target.value); setError(""); }} placeholder="请输入密码" disabled={submitting} aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} className={inputClass} />
            <Button type="button" variant="ghost" size="icon-sm" disabled={submitting} aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="shrink-0 text-slate-400">
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
        </div>
        {error && <Alert id="login-error" variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={submitting} className="mt-2 h-12 w-full rounded-full bg-slate-900 text-sm font-semibold shadow-sm hover:bg-slate-800">
          {submitting ? "正在登录…" : "登录工作区"}<ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </form>
    </div>
  );
}
