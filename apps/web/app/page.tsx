"use client";

import Link from "next/link";
import { canAccessPage, hasPermission } from "@eureka-atlas/types";
import { useAuth } from "@/lib/auth";
import { ArrowRight, Database, FileJson, ShieldCheck, TableProperties } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const quickLinks = [
  { title: "配置数据源", description: "连接并同步 MaxCompute 元数据", href: "/assets/sources", icon: Database },
  { title: "浏览数据资产", description: "查看已同步的表与字段定义", href: "/assets/tables", icon: TableProperties },
  { title: "治理任务", description: "审核、发布并维护正式语义", href: "/governance/tasks", icon: ShieldCheck },
];

export default function HomePage() {
  const { user } = useAuth();
  const canEdit = hasPermission(user?.role_code, "governance.write");
  const visibleLinks = quickLinks.filter((item) => canAccessPage(user?.role_code, item.href));
  return <main>
    <section className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-800 to-slate-700 px-6 py-8 text-white sm:px-8"><div className="relative z-10 max-w-2xl"><p className="text-sm text-slate-300">Eureka Atlas</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{canEdit ? "欢迎回来，开始治理你的数据资产" : "欢迎回来，探索你的数据资产"}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">从 MaxCompute 元数据接入、字段治理，到发布可被未来 Agent 使用的 Semantic Package。</p><Link href="/assets/tables" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100">查看数据资产 <ArrowRight className="h-4 w-4" /></Link></div><div className="absolute -right-14 -top-16 h-64 w-64 rounded-full border-[28px] border-white/10" /><div className="absolute bottom-[-80px] right-36 h-48 w-48 rounded-full border-[20px] border-sky-300/20" /></section>
    <section className="grid gap-4 md:grid-cols-3">{visibleLinks.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href}><Card className="h-full transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"><CardContent className="flex items-center gap-4"><div className="rounded-xl bg-slate-100 p-3 text-slate-700"><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h2 className="font-medium text-slate-900">{item.title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p></div><ArrowRight className="h-4 w-4 text-slate-300" /></CardContent></Card></Link>; })}</section>
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_1fr]"><Card><CardContent><div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-semibold">治理流程</p><p className="mt-1 text-xs text-slate-500">按步骤完成从物理资产到正式语义的转换。</p></div><FileJson className="h-5 w-5 text-slate-400" /></div><div className="grid gap-3 sm:grid-cols-4">{["同步数据源", "选择字段", "审核发布", "生成 Package"].map((label, index) => <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-xs text-slate-400">0{index + 1}</p><p className="mt-2 text-sm font-medium">{label}</p></div>)}</div></CardContent></Card><Card><CardContent><p className="text-sm font-semibold">工作提示</p><div className="mt-4 space-y-3 text-sm"><p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">数据源按 Project 独立配置与同步。</p><p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">AI 建议需经过人工审核后才会发布。</p><p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600">发布成功后自动更新 Semantic Package。</p></div></CardContent></Card></section>
  </main>;
}
