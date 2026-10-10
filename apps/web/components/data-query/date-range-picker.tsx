"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { enUS, es, ja, zhCN } from "date-fns/locale";
import { type DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: Required<DateRange>) => void;
  placeholder: string;
  langCode?: "ZH" | "EN" | "JA" | "ES";
}

const locales = { ZH: zhCN, EN: enUS, JA: ja, ES: es };

export function DateRangePicker({ value, onChange, placeholder, langCode = "ZH" }: DateRangePickerProps) {
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(value);
  const locale = locales[langCode];
  const label = value?.from && value.to ? `${format(value.from, "yyyy/MM/dd", { locale })} - ${format(value.to, "yyyy/MM/dd", { locale })}` : placeholder;


  return (
    <Popover onOpenChange={(open) => { if (open) setDraftRange(value); }}>
      <PopoverTrigger asChild><Button variant="outline" className="h-9 min-w-[248px] justify-start border-slate-200 px-2.5 text-xs font-normal shadow-xs hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-0"><CalendarIcon className="size-4 text-slate-400" /><span>{label}</span></Button></PopoverTrigger>
      <PopoverContent className="z-[60] w-auto max-w-[calc(100vw-2rem)] overflow-auto border-slate-200 bg-white p-0 text-slate-700 shadow-lg" align="start"><Calendar mode="range" defaultMonth={draftRange?.from} selected={draftRange} onSelect={(range) => { setDraftRange(range); if (range?.from && range.to) onChange({ from: range.from, to: range.to }); }} numberOfMonths={2} locale={locale} /></PopoverContent>
    </Popover>
  );
}
