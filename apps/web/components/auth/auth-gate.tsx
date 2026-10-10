"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { clearAuth, refreshAuth, useAuth, watchAuthChanges } from "@/lib/auth";
import { AUTH_UNAUTHORIZED_EVENT } from "@/lib/api";
import { loginDestination, loginLocation } from "@/lib/login-location";
import { Button } from "@/components/ui/button";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const authenticated = auth.status === "authenticated";
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    const stopWatching = watchAuthChanges();
    const refresh = () => { void refreshAuth(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, clearAuth);
    refresh();
    return () => {
      stopWatching();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, clearAuth);
    };
  }, []);

  useEffect(() => {
    if (auth.status === "loading" || auth.status === "unavailable") return;
    if (!authenticated && !isLoginPage) router.replace(loginLocation(window.location));
    if (authenticated && isLoginPage) router.replace(loginDestination(window.location));
  }, [auth.status, authenticated, isLoginPage, router]);

  if (auth.status === "unavailable") {
    return <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white text-sm text-slate-500"><p>{auth.error}</p><Button variant="outline" onClick={() => { void refreshAuth(); }}>重试</Button></div>;
  }
  if (auth.status === "loading" || authenticated === isLoginPage) {
    return <div role="status" className="flex min-h-dvh items-center justify-center bg-white text-sm text-slate-500">正在进入工作区…</div>;
  }
  return isLoginPage ? children : <AppShell key={auth.user!.member_no} user={auth.user!}>{children}</AppShell>;
}
