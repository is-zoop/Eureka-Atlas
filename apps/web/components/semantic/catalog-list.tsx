"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import { DimensionEditDialog } from "@/components/semantic/dimension-edit-dialog";
import { MetricEditDialog } from "@/components/semantic/metric-edit-dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useListView } from "@/lib/use-list-view";

type Item = { id: string; name: string; description: string; aliases: string[]; sourceCount: number; type?: "ATOMIC" | "DERIVED" | "MIXED"; unit?: string | null; editStatus: "EDITED" | "UNEDITED" };
type Response = { items: Item[]; total: number; page: number; totalPages: number; filters: { types?: string[]; dataSources?: string[] } };
type Source = { table: { id: string; name: string; project: string }; field?: string | null; formula?: string | null; comment?: string | null; kind?: "ATOMIC" | "DERIVED"; aggregation?: string | null; unit?: string | null };
const types: Record<string, string> = { ATOMIC: "原子指标", DERIVED: "派生指标", MIXED: "原子 + 派生" };
const status = { EDITED: "已编辑", UNEDITED: "未编辑" } as const;

function Sources({ kind, sources }: { kind: "metrics" | "dimensions"; sources: Source[] }) {
  const metric = kind === "metrics";
  if (!sources.length) return <p className="py-2 text-sm text-slate-500">暂无关联表信息</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13px]">
    <thead><tr className="border-b border-slate-200/70 text-[12px] text-slate-400">
      <th className="px-3 py-1.5">关联表</th><th className="px-3 py-1.5">Project</th>{metric && <th className="px-3 py-1.5">来源类型</th>}<th className="px-3 py-1.5">{metric ? "字段 / 计算公式" : "物理字段"}</th>{metric ? <><th className="px-3 py-1.5">聚合方式</th><th className="px-3 py-1.5">单位</th></> : <th className="px-3 py-1.5">字段注释</th>}
    </tr></thead>
    <tbody>{sources.map((source, index) => <tr key={`${source.table.id}-${index}`} className="border-b border-slate-200/50 last:border-0">
      <td className="px-3 py-2"><Link className="font-medium text-slate-700 hover:underline" href={`/assets/tables/${source.table.id}?returnTo=${encodeURIComponent("/assets/tables")}`}>{source.table.name}</Link></td>
      <td className="px-3 py-2 text-slate-500">{source.table.project}</td>
      {metric && <td className="px-3 py-2 text-slate-500">{source.kind === "DERIVED" ? "计算指标" : "物理字段"}</td>}
      <td className="px-3 py-2"><code className="text-[12px] text-slate-600">{source.formula || source.field || "-"}</code></td>
      {metric ? <><td className="px-3 py-2 text-slate-500">{source.aggregation || "-"}</td><td className="px-3 py-2 text-slate-500">{source.unit || "-"}</td></> : <td className="px-3 py-2 text-slate-500">{source.comment || "-"}</td>}
    </tr>)}</tbody>
  </table></div>;
}

function ExpandedSources({ kind, id }: { kind: "metrics" | "dimensions"; id: string }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api<{ sources: Source[] }>(`/semantic/${kind}/${id}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSources(result.sources); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [kind, id]);
  if (error) return <p className="text-rose-700">{error}</p>;
  if (!sources) return <>正在加载关联表信息…</>;
  return <Sources kind={kind} sources={sources} />;
}

export function CatalogList({ kind }: { kind: "metrics" | "dimensions" }) {
  const metric = kind === "metrics";
  const { search, setSearch, query: qs, params, field, setField, expanded, setExpanded, update, reset, canReset } = useListView(kind);
  const type = params.get("type") ?? "", editStatus = params.get("editStatus") ?? "", dataSource = params.get("dataSource") ?? "";
  const [data, setData] = useState<Response | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void api<Response>(`/semantic/${kind}${qs ? `?${qs}` : ""}`)
      .then(value => { if (!cancelled) { setData(value); setError(""); } })
      .catch((cause: Error) => !cancelled && setError(cause.message));
    return () => { cancelled = true; };
  }, [kind, qs]);
  const pages = useMemo(() => {
    const total = data?.totalPages ?? 1, start = Math.max(1, Math.min((data?.page ?? 1) - 2, total - 4));
    return Array.from({ length: Math.min(5, total) }, (_, index) => start + index);
  }, [data]);
  const options = field === "type"
    ? [{ value: "", label: "全部类型" }, ...(data?.filters.types ?? []).map(value => ({ value, label: types[value] ?? value }))]
    : field === "dataSource"
      ? [{ value: "", label: "全部数据来源" }, ...(data?.filters.dataSources ?? []).map(value => ({ value, label: value }))]
      : [{ value: "", label: "全部状态" }, { value: "EDITED", label: "已编辑" }, { value: "UNEDITED", label: "未编辑" }];
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const saved = (item: { id: string; description: string; aliases: string[] }) => setData(current => current ? {
    ...current,
    items: current.items.map(value => value.id === item.id ? { ...value, description: item.description, aliases: item.aliases, editStatus: "EDITED" } : value),
  } : current);
  const columns = metric ? 9 : 7;

  return <main className="flex h-[calc(100vh-104px)] min-h-0 flex-col overflow-hidden">
    <div className="flex h-full min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <InputGroup className="h-9 w-[320px]">
          <InputGroupInput className="h-full pl-9 pr-16 text-[13px]" value={search} onChange={event => setSearch(event.target.value)} placeholder={`搜索${metric ? "指标" : "维度"}名称、说明或别名`} />
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupAddon align="inline-end"><InputGroupText>{data ? `${data.total} 条` : "…"}</InputGroupText></InputGroupAddon>
        </InputGroup>
        <div className="grid h-9 w-[280px] grid-cols-[3fr_5fr] rounded-lg border border-slate-300 bg-white">
          <Combobox className="h-[34px]" inputClassName="rounded-r-none border-0 border-r border-slate-300 text-[13px] shadow-none focus-visible:ring-0" value={field} onValueChange={setField} placeholder="筛选字段" options={metric ? [{ value: "type", label: "类型" }, { value: "editStatus", label: "状态" }, { value: "dataSource", label: "数据来源" }] : [{ value: "editStatus", label: "状态" }, { value: "dataSource", label: "数据来源" }]} />
          <Combobox className="h-[34px]" inputClassName="rounded-l-none border-0 text-[13px] shadow-none focus-visible:ring-0" value={field === "type" ? type : field === "editStatus" ? editStatus : dataSource} onValueChange={value => update({ [field]: value })} placeholder="选择筛选条件" options={options} />
        </div>
        <Button variant="outline" size="sm" className="h-9" disabled={!canReset} onClick={reset}><RotateCcw className="h-4 w-4" />重置筛选</Button>
      </div>
      {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TooltipProvider delayDuration={300}>
          <Table freezeLastColumn className={`table-fixed ${metric ? "min-w-[1280px]" : "min-w-[1024px]"}`}>
            {/* Keep 44px for expansion, 240px for aliases and 96px for actions.
                Share the remaining width instead of putting it all in the description. */}
            <colgroup>
              <col className="w-11" />
              <col style={{ width: metric ? "24%" : "30%" }} />
              {metric && <col style={{ width: "12%" }} />}
              <col style={{ width: metric ? "22%" : "30%" }} />
              <col className="w-[240px]" />
              {metric && <col style={{ width: "10%" }} />}
              <col style={{ width: metric ? "18%" : "22%" }} />
              <col style={{ width: metric ? "14%" : "18%" }} />
              <col className="w-24" />
            </colgroup>
            <thead><tr>
              <TableHead className="px-2" />
              <TableHead>{metric ? "指标名称" : "维度名称"}</TableHead>
              {metric && <TableHead>类型</TableHead>}
              <TableHead>{metric ? "指标说明" : "维度说明"}</TableHead>
              <TableHead>别名</TableHead>
              {metric && <TableHead>单位</TableHead>}
              <TableHead>关联表数量</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead>
            </tr></thead>
            <tbody>
              {data?.items.map(item => <Fragment key={item.id}>
                <tr>
                  <TableCell className="px-2"><Button variant="ghost" size="icon-sm" className="h-7 w-7" onClick={() => toggle(item.id)}>{expanded.has(item.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Button></TableCell>
                  <TableCell><Link className="block truncate font-medium hover:underline" title={item.name} href={`/semantic/${kind}/${item.id}`}>{item.name}</Link></TableCell>
                  {metric && <TableCell>{types[item.type ?? ""] ?? "-"}</TableCell>}
                  <TableCell className="truncate" title={item.description}>{item.description || "-"}</TableCell>
                  <TableCell>{item.aliases.length ? <Tooltip>
                    <TooltipTrigger asChild><span tabIndex={0} className="block w-full truncate whitespace-nowrap">{item.aliases.join("、")}</span></TooltipTrigger>
                    <TooltipContent className="max-w-[min(32rem,calc(100vw-2rem))] whitespace-pre-wrap break-words">{item.aliases.join("、")}</TooltipContent>
                  </Tooltip> : <span className="text-slate-400">—</span>}</TableCell>
                  {metric && <TableCell>{item.unit || "-"}</TableCell>}
                  <TableCell>{item.sourceCount}</TableCell><TableCell>{status[item.editStatus]}</TableCell>
                  <TableCell>{metric ? <MetricEditDialog metricId={item.id} onSaved={saved} /> : <DimensionEditDialog dimensionId={item.id} onSaved={saved} />}</TableCell>
                </tr>
                {expanded.has(item.id) && <tr><TableCell colSpan={columns} className="bg-slate-50 px-6 py-3"><div className="pl-5"><ExpandedSources key={`${kind}:${item.id}`} kind={kind} id={item.id} /></div></TableCell></tr>}
              </Fragment>)}
              {data && !data.items.length && <tr><TableCell colSpan={columns} className="py-12 text-center text-slate-500">暂无已发布{metric ? "指标" : "维度"}</TableCell></tr>}
            </tbody>
          </Table>
        </TooltipProvider>
      </div>
      {data && data.total > 0 && <footer className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">共 {data.total} 条 · 第 {data.page} / {data.totalPages} 页</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => update({ page: String(data.page - 1) }, false)}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
          {pages.map(page => <Button key={page} size="sm" variant={page === data.page ? "default" : "outline"} onClick={() => update({ page: String(page) }, false)}>{page}</Button>)}
          <Button size="sm" variant="outline" disabled={data.page >= data.totalPages} onClick={() => update({ page: String(data.page + 1) }, false)}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
        </div>
      </footer>}
    </div>
  </main>;
}
