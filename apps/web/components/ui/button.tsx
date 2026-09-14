import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0", {
  variants: { variant: { default: "bg-slate-900 text-white shadow-xs hover:bg-slate-800", destructive: "bg-rose-600 text-white shadow-xs hover:bg-rose-700", outline: "border border-slate-200 bg-white shadow-xs hover:bg-slate-50 hover:text-slate-900", secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200", ghost: "hover:bg-slate-100 hover:text-slate-900", link: "text-slate-900 underline-offset-4 hover:underline" }, size: { default: "h-9 px-4 py-2", xs: "h-6 gap-1 rounded px-2", sm: "h-8 gap-1.5 px-3", lg: "h-10 px-6", icon: "size-9", "icon-xs": "size-6 rounded", "icon-sm": "size-8", "icon-lg": "size-10" } },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});
Button.displayName = "Button";
