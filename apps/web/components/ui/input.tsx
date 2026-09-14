import * as React from "react";
import { cn } from "@/lib/utils";
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, ...props }, ref) => <input ref={ref} className={cn("flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />);
Input.displayName = "Input";
