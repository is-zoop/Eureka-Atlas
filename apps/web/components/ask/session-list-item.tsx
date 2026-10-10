"use client";

import type { AskSession } from "@eureka-atlas/types";
import { Ellipsis, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SessionListItem({ session, selected, busy, onSelect, onRename, onDelete }: {
  session: AskSession;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return <div className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg px-3 py-2 text-sm transition ${selected ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white"}`}>
    <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className="flex min-w-0 items-center gap-2 text-left">
      {busy && <LoaderCircle className="size-3 shrink-0 animate-spin text-slate-400" aria-label="会话处理中" />}
      <Tooltip>
        <TooltipTrigger asChild><span className="min-w-0 flex-1 truncate">{session.title}</span></TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs break-words">{session.title}</TooltipContent>
      </Tooltip>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={`会话操作：${session.title}`} className="shrink-0"><Ellipsis className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-28 min-w-0">
        <DropdownMenuItem disabled={busy} onSelect={onRename} className="gap-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><Pencil className="size-4" />重命名</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={onDelete} className="gap-2 text-rose-600 focus:text-rose-600 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><Trash2 className="size-4" />删除</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
