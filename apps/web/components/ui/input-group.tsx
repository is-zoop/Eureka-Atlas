import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AddonAlign = "inline-start" | "inline-end" | "block-start" | "block-end";

export const InputGroup = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="input-group"
    className={cn(
      "relative flex w-full rounded-lg border border-slate-300 bg-white shadow-sm transition-[border-color,box-shadow] focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20",
      className,
    )}
    {...props}
  />
);

export const InputGroupInput = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      data-slot="input-group-control"
      className={cn("relative z-10 border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0", className)}
      {...props}
    />
  ),
);
InputGroupInput.displayName = "InputGroupInput";

export const InputGroupTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<typeof Textarea>>(
  ({ className, ...props }, ref) => (
    <Textarea
      ref={ref}
      data-slot="input-group-control"
      className={cn("relative z-10 border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0", className)}
      {...props}
    />
  ),
);
InputGroupTextarea.displayName = "InputGroupTextarea";

export const InputGroupAddon = ({ align = "inline-start", className, ...props }: React.HTMLAttributes<HTMLDivElement> & { align?: AddonAlign }) => (
  <div
    data-slot="input-group-addon"
    data-align={align}
    className={cn(
      "pointer-events-none absolute z-20 flex items-center gap-1.5 text-sm text-slate-500 [&_svg]:size-4",
      align === "inline-start" && "inset-y-0 left-3",
      align === "inline-end" && "inset-y-0 right-3",
      align === "block-start" && "left-3 right-3 top-2",
      align === "block-end" && "bottom-2 left-3 right-3",
      className,
    )}
    {...props}
  />
);

export const InputGroupText = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span data-slot="input-group-text" className={cn("whitespace-nowrap text-[13px] text-slate-500", className)} {...props} />
);
