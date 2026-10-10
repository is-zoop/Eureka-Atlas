"use client";

import { useState } from "react";
import type { SemanticSelectableTablesResponse } from "@eureka-atlas/types";
import { Check, ChevronDown, Database, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function DatasetSelector({ tables, value, onChange }: { tables: SemanticSelectableTablesResponse; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = tables.items.find(table => table.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-label="选择数据集" aria-expanded={open} className="h-10 w-full justify-between gap-2 rounded-lg px-3 font-normal">
          <Database className="size-4 text-slate-400" />
          <span className={cn("min-w-0 flex-1 truncate text-left", !selected && "text-slate-500")}>{selected?.business_name ?? "选择已发布的数据集"}</span>
          <ChevronDown className="size-4 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-slate-200 bg-white p-0 text-slate-700 shadow-lg sm:w-96">
        <Command label="选择数据集" defaultValue={value} loop>
          <CommandInput aria-label="搜索数据集" className="text-[13px]" placeholder="搜索数据域、业务名称或表名" />
          <CommandList className="shadcn-scrollbar max-h-80 p-1.5">
            <CommandEmpty className="py-8 text-center text-xs text-slate-500">{tables.items.length ? "没有匹配的数据集" : "暂无已发布的可查询数据集"}</CommandEmpty>
            {tables.groups.filter(group => group.tables.length).map(group => {
              const label = group.data_domain ?? "未分类";
              return <CommandGroup key={label} value={label} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-slate-400" heading={<span className="flex items-center gap-2"><Layers className="size-3.5" />{label}</span>}>
                {group.tables.map(table => <CommandItem key={table.id} value={table.id} keywords={[label, table.business_name, table.physical_name]} className={cn("my-0.5 cursor-pointer gap-3 rounded-lg px-3 py-2.5", value === table.id && "bg-slate-50")} onSelect={() => { onChange(table.id); setOpen(false); }}>
                  <Database className="size-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{table.business_name}</span><span className="mt-0.5 block truncate text-xs font-normal text-slate-400">{table.physical_name}</span></span>
                  {value === table.id && <Check className="size-4 shrink-0 text-slate-700" />}
                </CommandItem>)}
              </CommandGroup>;
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
