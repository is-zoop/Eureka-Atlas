import Link from "next/link";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  return <main className="mx-auto max-w-3xl py-12 text-center"><Settings2 className="mx-auto mb-4 size-8 text-slate-400" /><h1 className="text-lg font-semibold">系统设置</h1><p className="mt-2 text-sm text-slate-500">AI 模型、当前 AI 建议模型和系统提示词已统一移至 AI 配置。</p><Button className="mt-6" asChild><Link href="/models">打开 AI 配置</Link></Button></main>;
}
