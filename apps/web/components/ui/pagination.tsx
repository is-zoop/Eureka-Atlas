"use client";

import type { ComponentProps } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";

// Copied from HazeToolPlat's Pagination; uses Atlas's Button and Combobox APIs.
export interface PaginationProps extends ComponentProps<"nav"> {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: { value: number; label: string }[];
}

export function Pagination({ currentPage, totalPages, onPageChange, pageSize, onPageSizeChange, pageSizeOptions, className, ...props }: PaginationProps) {
  const total = Math.max(1, totalPages);
  const pages: (number | string)[] = [1];
  const range = 2;
  if (currentPage > range + 2) pages.push("ellipsis-start");
  for (let page = Math.max(2, currentPage - range); page <= Math.min(total - 1, currentPage + range); page++) pages.push(page);
  if (currentPage < total - range - 1) pages.push("ellipsis-end");
  if (total > 1) pages.push(total);

  return (
    <nav aria-label="查询结果分页" className={cn("flex flex-wrap items-center gap-3 text-xs", className)} {...props}>
      {pageSize !== undefined && onPageSizeChange && pageSizeOptions && (
        <Combobox className="h-8 w-28" inputClassName="justify-between border border-slate-200 bg-white px-2.5" searchable={false} menuPlacement="top" aria-label="每页行数" value={String(pageSize)} onValueChange={value => onPageSizeChange(Number(value))} options={pageSizeOptions.map(option => ({ value: String(option.value), label: option.label }))} />
      )}
      <ul className="flex items-center gap-1">
        <li><Button variant="outline" size="icon-sm" aria-label="上一页" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft className="size-4" /></Button></li>
        {pages.map(page => <li key={page}>{typeof page === "string" ? <span className="flex size-8 items-center justify-center text-slate-400"><MoreHorizontal className="size-4" /></span> : <Button variant={page === currentPage ? "default" : "outline"} size="icon-sm" aria-label={`第 ${page} 页`} aria-current={page === currentPage ? "page" : undefined} onClick={() => onPageChange(page)}>{page}</Button>}</li>)}
        <li><Button variant="outline" size="icon-sm" aria-label="下一页" disabled={currentPage >= total} onClick={() => onPageChange(currentPage + 1)}><ChevronRight className="size-4" /></Button></li>
      </ul>
    </nav>
  );
}
