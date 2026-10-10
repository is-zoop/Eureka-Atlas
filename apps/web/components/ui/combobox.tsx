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
  menuClassName?: string;
  disabled?: boolean;
  searchable?: boolean;
  checkPosition?: "start" | "end";
  menuPlacement?: "bottom" | "top";
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
  menuClassName,
  disabled = false,
  searchable = true,
  checkPosition = "end",
  menuPlacement = "bottom",
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = searchable ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery)) : options;
  const visibleGroups = groups?.map((group) => ({ ...group, options: searchable ? group.options.filter((option) => option.label.toLowerCase().includes(normalizedQuery)) : group.options })).filter((group) => group.options.length);

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
  const optionRow = (option: ComboboxOption) => {
    const checked = option.value === value;
    const check = checked ? <Check className="size-4 shrink-0 text-blue-600" /> : <span className="size-4 shrink-0" />;
    return (
      <Button
        key={option.value}
        type="button"
        role="option"
        aria-selected={checked}
        disabled={option.disabled}
        onClick={() => choose(option.value)}
        variant="ghost"
        size="sm"
        className={cn("flex w-full gap-2 px-2 py-1.5 text-left text-slate-700", checkPosition === "start" ? "justify-start" : "justify-between")}
      >
        {checkPosition === "start" && check}
        <span className="truncate">{option.label}</span>
        {checkPosition === "end" && check}
      </Button>
    );
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {searchable ? (
        <Input
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel ?? placeholder}
          aria-expanded={open}
          value={open ? query : selected?.label ?? ""}
          placeholder={open ? searchPlaceholder : placeholder}
          disabled={disabled}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); } }}
          className={cn("h-full pr-9 font-sans text-[13px]", inputClassName)}
        />
      ) : (
        <Button
          type="button"
          role="combobox"
          aria-label={ariaLabel ?? placeholder}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          variant="ghost"
          className={cn("h-full w-full justify-start gap-1 rounded-md px-2 text-[13px] font-normal text-slate-700 hover:bg-slate-50", inputClassName)}
        >
          <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span><ChevronDown className="size-4 shrink-0 text-slate-400" />
        </Button>
      )}
      {searchable && <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-slate-400" />}
      {open && (
        <div role="listbox" className={cn("absolute left-0 z-50 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg", menuPlacement === "top" ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]", menuClassName)}>
          {(visibleGroups ? visibleGroups.length : visibleOptions.length) ? (visibleGroups ? visibleGroups.flatMap((group) => [<p key={group.label} className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase text-slate-500">{group.label}</p>, ...group.options.map(optionRow)]) : visibleOptions.map(optionRow)) : <p className="px-2 py-6 text-center text-[13px] text-slate-500">{emptyText}</p>}
        </div>
      )}
    </div>
  );
}