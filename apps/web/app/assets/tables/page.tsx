"use client";

import Link from "next/link";
import { hasPermission } from "@eureka-atlas/types";
import { useAuth } from "@/lib/auth";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Play, RotateCcw, Search, TableProperties } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { FloatingAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { SemanticPackageDialog } from "@/components/semantic/semantic-package-dialog";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useListView } from "@/lib/use-list-view";

type AssetTable = { id: string; name: string; type: string; comment?: string; businessName: string | null; businessDescription: string | null; space: string; source: string; columnCount: number; updatedAt: string; lastUpdatedBy: string | null; governanceStatus: "UNGOVERNED" | "DRAFT" | "COMPLETED"; hasPackage: boolean };
type TableResponse = { items: AssetTable[]; total: number; page: number; pageSize: number; totalPages: number; filters: { spaces: string[]; sources: Array<{id:string;name:string}>; types: string[] } };
const objectTypeLabels: Record<string, string> = { MANAGED_TABLE: "数据表" };

export default function TablesPage() { return <Suspense fallback={<main className="p-4 text-sm text-slate-500">正在加载数据资产…</main>}><TablesPageContent /></Suspense>; }

function TablesPageContent() {
  const { user } = useAuth();
  const canEdit = hasPermission(user?.role_code, "governance.write");
  const pathname = usePathname();
  const { search, setSearch, query: queryString, params, field: filterField, setField: setFilterField, update, reset, canReset } = useListView("assets");
  const space = params.get("space") ?? ""; const sourceId = params.get("sourceId") ?? ""; const type = params.get("type") ?? ""; const governanceStatus = params.get("governanceStatus") ?? "";
  const [data, setData] = useState<TableResponse | null>(null); const [error, setError] = useState("");
  useEffect(() => { let cancelled = false; void api<TableResponse>(`/metadata/tables${queryString ? `?${queryString}` : ""}`).then((result) => { if (!cancelled) setData(result); }).catch((cause: Error) => !cancelled && setError(cause.message)); return () => { cancelled = true; }; }, [queryString]);
  const pages = useMemo(() => { const total = data?.totalPages ?? 1; const start = Math.max(1, Math.min((data?.page ?? 1) - 2, total - 4)); return Array.from({ length: Math.min(total, 5) }, (_, index) => start + index); }, [data]);
  const filterOptions = filterField === "space" ? [{ value: "", label: "全部数据空间" }, ...(data?.filters.spaces ?? []).map((item) => ({ value: item, label: item }))] : filterField === "sourceId" ? [{value:"",label:"全部数据源"},...(data?.filters.sources??[]).map(item=>({value:item.id,label:item.name}))] : filterField === "type" ? [{ value: "", label: "全部类型" }, ...(data?.filters.types ?? []).map((item) => ({ value: item, label: item }))] : [{ value: "", label: "全部治理状态" }, { value: "UNGOVERNED", label: "未治理" }, { value: "DRAFT", label: "草稿" }, { value: "COMPLETED", label: "已治理" }];
  const filterValue = filterField === "space" ? space : filterField === "sourceId" ? sourceId : filterField === "type" ? type : governanceStatus;
  return <main className="flex h-[calc(100vh-104px)] min-h-0 flex-col overflow-hidden">
    {error && <FloatingAlert type="error">{error}</FloatingAlert>}
    <div className="flex h-full min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <InputGroup className="h-9 w-[320px]">
          <InputGroupInput value={search} onChange={(event) => setSearch(event.target.value)} className="h-full pl-9 pr-16 text-[13px]" placeholder="搜索表名、业务名称、注释或业务描述" />
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupAddon align="inline-end"><InputGroupText className="text-[13px]">{data ? `${data.total} 条` : "…"}</InputGroupText></InputGroupAddon>
        </InputGroup>
        <div className="grid h-9 w-[280px] grid-cols-[3fr_5fr] rounded-lg border border-slate-300 bg-white shadow-sm transition-[border-color,box-shadow] focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20">
          <Combobox className="h-[34px]" inputClassName="rounded-r-none border-0 border-r border-slate-300 py-1.5 text-[13px] leading-5 shadow-none focus-visible:border-r focus-visible:border-slate-300 focus-visible:ring-0" value={filterField} onValueChange={setFilterField} placeholder="筛选字段" options={[{ value: "space", label: "数据空间" }, {value:"sourceId",label:"数据源"}, { value: "type", label: "类型" }, { value: "governanceStatus", label: "治理状态" }]} />
          <Combobox className="h-[34px]" inputClassName="rounded-l-none border-0 py-1.5 text-[13px] leading-5 shadow-none focus-visible:border-0 focus-visible:ring-0" value={filterValue} onValueChange={(value) => update({ [filterField]: value })} placeholder="选择筛选条件" options={filterOptions} />
        </div>
        <Button variant="outline" size="sm" className="h-9 px-3 text-[13px]" disabled={!canReset} onClick={reset}><RotateCcw className="h-4 w-4" />重置筛选</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TooltipProvider delayDuration={300}>
        <Table freezeLastColumn className="min-w-[1280px] table-fixed">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
            <col className="w-[14%]" />
            <col className="w-[9%]" />
            <col className="w-[8%]" />
            <col className="w-[156px]" />
          </colgroup>
          <thead>
            <tr>
              <TableHead className="whitespace-nowrap">表名称</TableHead><TableHead className="whitespace-nowrap">业务描述</TableHead><TableHead className="whitespace-nowrap">数据空间</TableHead><TableHead className="whitespace-nowrap">对象类型</TableHead><TableHead className="whitespace-nowrap">字段数量</TableHead><TableHead className="whitespace-nowrap">更新时间</TableHead><TableHead className="whitespace-nowrap">最近更新人</TableHead><TableHead className="whitespace-nowrap">治理状态</TableHead>
              <TableHead className="sticky right-0 z-30 whitespace-nowrap shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.35)]">操作</TableHead>
            </tr>
          </thead>
          <tbody>
            {!data ? <tr><TableCell colSpan={9} className="py-12 text-center text-slate-500">正在加载数据资产…</TableCell></tr> : data.items.length === 0 ? <tr><TableCell colSpan={9} className="py-12 text-center text-slate-500"><TableProperties className="mx-auto mb-2 h-6 w-6" />没有符合当前筛选条件的数据表</TableCell></tr> : data.items.map((item) => <tr key={item.id} className="group"><TableCell><Link href={`/assets/tables/${item.id}?returnTo=${encodeURIComponent(`${pathname}${queryString ? `?${queryString}` : ""}`)}`} title={item.name} className="block truncate text-[13px] font-medium text-[#27364b] hover:underline">{item.name}</Link><div title={item.businessName || item.comment || "无注释"} className="mt-1 truncate whitespace-nowrap text-[13px] text-slate-400">{item.businessName || item.comment || "无注释"}</div></TableCell><TableCell>{item.businessDescription ? <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="block w-full truncate whitespace-nowrap">{item.businessDescription}</span></TooltipTrigger><TooltipContent className="max-w-[min(32rem,calc(100vw-2rem))] whitespace-pre-wrap break-words">{item.businessDescription}</TooltipContent></Tooltip> : <span className="text-slate-400">—</span>}</TableCell><TableCell><span title={item.space} className="block truncate whitespace-nowrap">{item.space}</span></TableCell><TableCell><span className="block truncate whitespace-nowrap">{objectTypeLabels[item.type] ?? item.type}</span></TableCell><TableCell className="whitespace-nowrap">{item.columnCount}</TableCell><TableCell><span title={new Date(item.updatedAt).toLocaleString()} className="block truncate whitespace-nowrap">{new Date(item.updatedAt).toLocaleString()}</span></TableCell><TableCell><span title={item.lastUpdatedBy ?? undefined} className="block truncate whitespace-nowrap">{item.lastUpdatedBy || "—"}</span></TableCell><TableCell className="whitespace-nowrap"><StatusBadge status={item.governanceStatus} /></TableCell><TableCell className="whitespace-nowrap"><div className="flex gap-2">{canEdit && <Button asChild size="sm" className="rounded-lg"><Link href={`/governance/tables/${item.id}?returnTo=${encodeURIComponent(`${pathname}${queryString ? `?${queryString}` : ""}`)}`}><Play className="h-3.5 w-3.5" />开始治理</Link></Button>}{item.hasPackage && <SemanticPackageDialog tableId={item.id} label="查看 Package" iconOnly />}</div></TableCell></tr>)}
          </tbody>
        </Table>
        </TooltipProvider>
      </div>
      {data && data.total > 0 && <footer className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-slate-500">共 {data.total} 张表 · 第 {data.page} / {data.totalPages} 页</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => update({ page: String(data.page - 1) }, false)}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>{pages.map((page) => <Button key={page} variant={page === data.page ? "default" : "outline"} size="sm" onClick={() => update({ page: String(page) }, false)}>{page}</Button>)}<Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => update({ page: String(data.page + 1) }, false)}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button></div></footer>}
    </div>
  </main>;
}
