"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type MultiComboboxProps = {
  value: string[];
  onValueChange: (value: string[]) => void;
  options: Option[];
  placeholder: string;
  multiple?: boolean;
  className?: string;
};

export function MultiCombobox({
  value,
  onValueChange,
  options,
  placeholder,
  multiple = true,
  className,
}: MultiComboboxProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const labels = options
    .filter((option) => value.includes(option.value))
    .map((option) => option.label);

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <Button
        type="button"
        variant="outline"
        className="h-full w-full min-w-0 justify-between overflow-hidden px-3 font-normal"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={cn("min-w-0 flex-1 truncate text-left", !labels.length && "text-slate-400")}>
          {labels.length ? labels.join(", ") : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </Button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {options.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-slate-500">
              未找到匹配选项
            </p>
          ) : options.map((option) => {
            const selected = value.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100"
              >
                <Checkbox
                  checked={selected}
                  onCheckedChange={(checked) =>
                    onValueChange(
                      checked
                        ? multiple
                          ? [...value, option.value]
                          : [option.value]
                        : value.filter((item) => item !== option.value),
                    )
                  }
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
