"use client";

import { useEffect, useRef, useState } from "react";
import type { SavedDataQuery, SavedDataQueryList } from "@eureka-atlas/types";
import { FolderOpen, LoaderCircle, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/common/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function SavedQueriesSheet({ open, onOpenChange, refresh, currentId, onSelect, onDeleted }: {
  open: boolean; onOpenChange: (open: boolean) => void; refresh: number; currentId?: string;
  onSelect: (id: string) => void; onDeleted: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState(""), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [list, setList] = useState<SavedDataQueryList | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [deleting, setDeleting] = useState<SavedDataQuery | null>(null), [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState("");
  const deletion = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError(""); setList(null);
      void api<SavedDataQueryList>(`/saved-data-queries?keyword=${encodeURIComponent(keyword)}&page=${page}&pageSize=20`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) { setList(result); if (result.total_pages && page > result.total_pages) setPage(result.total_pages); } })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "加载失败"); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, keyword ? 250 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, keyword, page, retry, refresh]);
  useEffect(() => () => deletion.current?.abort(), []);
  const remove = async () => {
    if (!deleting) return;
    const controller = new AbortController(); deletion.current = controller; setDeleteBusy(true); setDeleteError("");
    try {
      await api(`/saved-data-queries/${encodeURIComponent(deleting.id)}`, { method: "DELETE", signal: controller.signal });
      controller.signal.throwIfAborted(); onDeleted(deleting.id); setDeleting(null); setRetry(value => value + 1);
    } catch (cause) { if (!controller.signal.aborted) setDeleteError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { if (!controller.signal.aborted) setDeleteBusy(false); }
  };
  return <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 bg-white p-5 text-slate-900 sm:max-w-[420px]">
        <SheetHeader className="text-left"><SheetTitle className="text-base font-semibold tracking-normal">我的查询</SheetTitle><SheetDescription className="text-slate-500">打开已保存的配置进行查看和编辑，点击查询后才执行。</SheetDescription></SheetHeader>
        <InputGroup className="h-9 shrink-0"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput className="h-full pl-9" aria-label="搜索我的查询" placeholder="搜索查询名称" value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1); setBusy(true); setList(null); }} /></InputGroup>
        <div className="shadcn-scrollbar min-h-0 flex-1 overflow-y-auto">
          {busy ? <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><LoaderCircle className="size-4 animate-spin" />正在加载…</div> : error ? <div role="alert" className="space-y-3 py-8 text-center text-sm text-rose-600"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>重试</Button></div> : !list?.items.length ? <EmptyState icon={FolderOpen} title={keyword.trim() ? "没有匹配的查询" : "还没有保存的查询"} description={keyword.trim() ? "试试其他查询名称。" : "配置字段和筛选条件后，点击「保存查询」。"} /> : <div className="space-y-2">
            {list.items.map(item => <div key={item.id} className={`flex items-start gap-1 rounded-lg border p-3 ${currentId === item.id ? "border-slate-300 bg-slate-50" : "border-slate-100"}`}>
              <Button variant="ghost" className="h-auto min-w-0 flex-1 flex-col items-start gap-2 whitespace-normal p-0 text-left hover:bg-transparent" onClick={() => { onOpenChange(false); onSelect(item.id); }}>
                <span className="w-full truncate text-sm font-medium" title={item.name}>{item.name}</span><span className="w-full truncate text-xs font-normal text-slate-500">{item.table_name}</span>
                <span className="flex items-center gap-2"><Badge className="bg-slate-100 text-slate-600">{item.config.mode === "DETAIL" ? "明细" : "汇总"}</Badge><span className="text-xs font-normal text-slate-400">{item.config.field_ids.length} 个字段</span></span>
                <span className="text-xs font-normal text-slate-400">更新于 {new Date(item.updated_at).toLocaleString("zh-CN")}</span>
              </Button>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`查询 ${item.name} 的更多操作`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="text-rose-600 focus:text-rose-600" onSelect={() => { setDeleting(item); setDeleteError(""); }}><Trash2 className="mr-2 size-4" />删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            </div>)}
          </div>}
        </div>
        {list && list.total > 0 && <div className="border-t border-slate-100 pt-3"><p className="mb-2 text-xs text-slate-400">共 {list.total} 条查询</p><Pagination currentPage={page} totalPages={Math.max(1, list.total_pages)} onPageChange={value => { setPage(value); setBusy(true); setList(null); }} /></div>}
      </SheetContent>
    </Sheet>
    <Dialog open={!!deleting} onOpenChange={value => { if (!value && !deleteBusy) setDeleting(null); }}><DialogContent className="max-w-sm" showCloseButton={!deleteBusy}><DialogHeader><DialogTitle>删除保存的查询？</DialogTitle><DialogDescription>将删除“{deleting?.name}”的配置，不影响执行记录、查询结果或后台任务。</DialogDescription></DialogHeader>{deleteError && <p role="alert" className="text-sm text-rose-600">{deleteError}</p>}<DialogFooter><Button variant="outline" disabled={deleteBusy} onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy && <LoaderCircle className="size-4 animate-spin" />}确认删除</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
