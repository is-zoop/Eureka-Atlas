import * as React from "react";
import { cn } from "@/lib/utils";

export function Menubar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="menubar"
      role="toolbar"
      className={cn(
        "flex min-h-12 w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
