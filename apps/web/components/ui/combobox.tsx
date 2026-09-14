"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  disabled?: boolean;
};
export type ComboboxGroup = {
  label: string;
  options: ComboboxOption[];
};

type ComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  groups?: ComboboxGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

export function Combobox({
  value,
  onValueChange,
  options,
  groups,
  placeholder = "请选择",
  searchPlaceholder = "搜索选项…",
  emptyText = "未找到匹配选项。",
  className,
  inputClassName,
  disabled = false,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleGroups = groups?.map((group) => ({ ...group, options: group.options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase())) })).filter((group) => group.options.length);

  React.useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const choose = (nextValue: string) => {
    onValueChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open}
        aria-controls=""
        value={open ? query : selected?.label ?? ""}
        placeholder={open ? searchPlaceholder : placeholder}
        disabled={disabled}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.blur();
          }
        }}
        className={cn("h-full pr-9 font-sans text-[13px]", inputClassName)}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {open && (
        <div role="listbox" className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {(visibleGroups ? visibleGroups.length : visibleOptions.length) ? (visibleGroups ? visibleGroups.flatMap((group) => [<p key={group.label} className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase text-slate-500">{group.label}</p>, ...group.options.map((option) => (
            <Button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => choose(option.value)}
              variant="ghost"
              size="sm"
              className="flex w-full justify-between px-2 py-1.5 text-left text-slate-700"
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Check className="ml-2 h-4 w-4 shrink-0 text-blue-600" />}
            </Button>
          ))]) : visibleOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => choose(option.value)}
              variant="ghost"
              size="sm"
              className="flex w-full justify-between px-2 py-1.5 text-left text-slate-700"
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Check className="ml-2 h-4 w-4 shrink-0 text-blue-600" />}
            </Button>
          ))) : <p className="px-2 py-6 text-center text-[13px] text-slate-500">{emptyText}</p>}
        </div>
      )}
    </div>
  );
}
