"use client";

import { useEffect } from "react";
import Link from "next/link";
import { canAccessPage } from "@eureka-atlas/types";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { clearAuth, refreshAuth, useAuth, watchAuthChanges } from "@/lib/auth";
import { AUTH_REVALIDATE_EVENT, AUTH_UNAUTHORIZED_EVENT } from "@/lib/api";
import { loginDestination, loginLocation } from "@/lib/login-location";
import { Button } from "@/components/ui/button";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const authenticated = auth.status === "authenticated";
  const isLoginPage = pathname === "/login";
  const isAgentSelector = pathname.startsWith("/integrations/plugins/agent-selector/");

  useEffect(() => {
    if (isAgentSelector) return;
    const stopWatching = watchAuthChanges();
    const refresh = () => { void refreshAuth(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, clearAuth);
    window.addEventListener(AUTH_REVALIDATE_EVENT, refresh);
    refresh();
    return () => {
      stopWatching();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, clearAuth);
      window.removeEventListener(AUTH_REVALIDATE_EVENT, refresh);
    };
  }, [isAgentSelector]);

  useEffect(() => {
    if (isAgentSelector) return;
    if (auth.status === "loading" || auth.status === "unavailable") return;
    if (!authenticated && !isLoginPage) router.replace(loginLocation(window.location));
    if (authenticated && isLoginPage) {
      const destination = loginDestination(window.location);
      const allowed = canAccessPage(auth.user?.role_code, new URL(destination, window.location.origin).pathname);
      router.replace(allowed ? destination : "/");
    }
  }, [auth.status, auth.user?.role_code, authenticated, isLoginPage, isAgentSelector, router]);

  if (isAgentSelector) return <div className="min-h-dvh bg-slate-50 px-4 py-6 sm:px-6"><div className="mx-auto max-w-6xl">{children}</div></div>;
  if (auth.status === "unavailable") {
    return <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white text-sm text-slate-500"><p>{auth.error}</p><Button variant="outline" onClick={() => { void refreshAuth(); }}>重试</Button></div>;
  }
  if (auth.status === "loading" || authenticated === isLoginPage) {
    return <div role="status" className="flex min-h-dvh items-center justify-center bg-white text-sm text-slate-500">正在进入工作区…</div>;
  }
  if (isLoginPage) return children;
  const key = `${auth.user!.member_no}:${auth.user!.role_code}`;
  const content = canAccessPage(auth.user?.role_code, pathname) ? children : <main className="space-y-4"><Alert variant="destructive"><CircleAlert /><AlertTitle>无权访问此页面</AlertTitle><AlertDescription>当前 Haze 角色没有此页面的访问权限，请联系系统管理员。</AlertDescription></Alert><Button asChild variant="outline"><Link href="/">返回首页</Link></Button></main>;
  if (pathname === "/integrations/plugins/data-selector") {
    return <div key={key} className="min-h-dvh bg-slate-50 px-4 py-6 sm:px-6"><div className="mx-auto max-w-6xl">{content}</div></div>;
  }
  return <AppShell key={key} user={auth.user!}>{content}</AppShell>;
}
