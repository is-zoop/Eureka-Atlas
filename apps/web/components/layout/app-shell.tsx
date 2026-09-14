"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ClipboardCheck,
  Database,
  LayoutDashboard,
  TableProperties,
  Settings,
  ChartNoAxesCombined,
  PanelsTopLeft,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  {
    href: "/",
    label: "首页",
    icon: LayoutDashboard,
    matches: (path: string) => path === "/",
  },
  {
    href: "/assets/tables",
    label: "数据资产",
    icon: TableProperties,
    matches: (path: string) => path.startsWith("/assets/tables"),
  },
  {
    href: "/governance/tasks",
    label: "治理任务",
    icon: ClipboardCheck,
    matches: (path: string) =>
      path.startsWith("/governance"),
  },
  {
    href: "/semantic/metrics",
    label: "指标中心",
    icon: ChartNoAxesCombined,
    matches: (path: string) => path.startsWith("/semantic/metrics"),
  },
  {
    href: "/semantic/dimensions",
    label: "维度中心",
    icon: PanelsTopLeft,
    matches: (path: string) => path.startsWith("/semantic/dimensions"),
  },
];
const managementNavigation = [
  { href: "/assets/sources", label: "数据源", icon: Database, matches: (path: string) => path.startsWith("/assets/sources") },
  { href: "/models", label: "AI 配置", icon: Bot, matches: (path: string) => path.startsWith("/models") },
  { href: "/settings", label: "系统设置", icon: Settings, matches: (path: string) => path.startsWith("/settings") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = navigation.find((item) => item.matches(pathname));
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-slate-200/80 bg-white px-3 py-5 lg:block">
        <Link href="/" className="mb-8 block px-3">
          <p className="text-lg font-bold tracking-tight">Eureka Atlas</p>
          <p className="mt-1 text-xs text-slate-400">数据语义治理平台</p>
        </Link>
        <nav className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.matches(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-slate-100 font-medium text-slate-950"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-slate-100 pt-5">
          <p className="mb-2 px-3 text-[11px] font-medium tracking-wide text-slate-400">
            管理
          </p>
          <nav className="space-y-1">
            {managementNavigation.map((item) => {
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors", item.matches(pathname) ? "bg-slate-100 font-medium text-slate-950" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900")}><Icon className="h-4 w-4" />{item.label}</Link>;
            })}
          </nav>
        </div>
        <div className="mt-6 border-t border-slate-100 pt-5">
          <p className="px-3 text-[11px] font-medium tracking-wide text-slate-400">数据治理</p>
          <p className="mt-2 px-3 text-xs leading-5 text-slate-400">
            从物理元数据到可供 Agent 消费的正式语义。
          </p>
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-5 lg:px-8">
            <div className="flex items-center gap-3">
              <span className="hidden h-5 w-px bg-slate-200 sm:block" />
              <p className="text-sm text-slate-500">数据治理中心</p>
              <span className="text-slate-300">/</span>
              <p className="text-sm font-medium text-slate-800">
                {current?.label ?? "工作区"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                aria-label="通知"
                variant="ghost"
                size="icon-sm"
                className="text-slate-400 hover:text-slate-700"
              >
                <Bell className="h-4 w-4" />
              </Button>
              <div className="hidden h-8 items-center rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 sm:flex">
                本地工作区
              </div>
            </div>
          </div>
        </header>
        <div className="px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
