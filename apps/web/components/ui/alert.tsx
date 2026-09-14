"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-slate-200 bg-slate-50 text-slate-800",
        destructive: "border-rose-200 bg-rose-50 text-rose-800",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("col-start-2 text-sm font-medium leading-none tracking-tight", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("col-start-2 text-sm leading-relaxed text-current/75", className)} {...props} />;
}

export function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-action" className={cn("col-start-2 mt-2 flex items-center gap-2", className)} {...props} />;
}

export function FloatingAlert({
  type = "info",
  children,
}: {
  type?: "success" | "error" | "info";
  children: React.ReactNode;
}) {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [children, type]);
  const styles = type === "error"
    ? { variant: "destructive" as const, Icon: CircleAlert, iconClassName: "text-rose-600" }
    : type === "success"
      ? { variant: "default" as const, Icon: CheckCircle2, iconClassName: "text-emerald-600", className: "border-emerald-200 bg-emerald-50 text-emerald-800" }
      : { variant: "default" as const, Icon: Info, iconClassName: "text-slate-600" };
  if (!visible) return null;
  const content = <Alert variant={styles.variant} className={cn("fixed left-1/2 top-6 z-[100] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 shadow-lg", styles.className)}><styles.Icon className={styles.iconClassName} /><AlertDescription>{children}</AlertDescription></Alert>;
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
