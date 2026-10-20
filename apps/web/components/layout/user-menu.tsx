"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@eureka-atlas/types";
import { LogOut, MoreHorizontal, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { loginLocation } from "@/lib/login-location";
import { logout } from "@/lib/auth";

// Adapted from Haze's Dashboard sidebar footer.
export function UserMenu({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      const destination = loginLocation(window.location);
      await logout();
      router.replace(destination);
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : "退出失败，请重试。");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="shrink-0 border-t border-slate-100 pt-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={loggingOut ? "正在退出登录" : "用户菜单"}
            disabled={loggingOut}
            className="flex w-full cursor-pointer items-center justify-between rounded-xl px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-wait disabled:opacity-60"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar className="h-8 w-8 border border-neutral-200/80">
                {user.avatar_url && <AvatarImage src={user.avatar_url} alt={user.name} />}
                <AvatarFallback className="bg-neutral-900 text-xs font-bold text-white">
                  {user.name.substring(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium text-slate-900" title={user.name}>
                  {user.name}
                </p>
                <p className="truncate text-xs text-slate-500" title={user.email ?? undefined}>
                  {user.email || "未设置邮箱"}
                </p>
              </div>
            </div>
            <MoreHorizontal size={14} className="ml-1 shrink-0 text-slate-500" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" sideOffset={8} collisionPadding={12} className="w-56 rounded-xl p-1">
          <div className="mb-1 flex items-center gap-2.5 border-b border-slate-100 p-2.5">
            <Avatar className="h-8 w-8 border border-neutral-200/80">
              {user.avatar_url && <AvatarImage src={user.avatar_url} alt={user.name} />}
              <AvatarFallback className="bg-neutral-900 text-xs font-bold text-white">
                {user.name.substring(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium text-slate-900" title={user.name}>
                {user.name}
              </p>
              <p className="truncate text-xs text-slate-500" title={user.email ?? undefined}>
                {user.email || "未设置邮箱"}
              </p>
            </div>
          </div>
          <DropdownMenuItem asChild disabled={loggingOut} className="gap-2.5 p-2">
            <Link href="/profile"><UserRound size={14} aria-hidden="true" /><span>个人中心</span></Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={loggingOut}
            onSelect={() => { void signOut(); }}
            className="gap-2.5 p-2 text-rose-600 focus:bg-rose-50 focus:text-rose-600 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            <LogOut size={14} aria-hidden="true" />
            <span>退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {logoutError && <p role="alert" className="px-1 pt-2 text-xs text-rose-600">{logoutError}</p>}
    </div>
  );
}
