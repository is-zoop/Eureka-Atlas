"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[1px]", className)} {...props} />);
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }
>(({ className, children, showCloseButton = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content ref={ref} className={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl outline-none", className)} {...props}>
      {children}
      {showCloseButton && <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /><span className="sr-only">关闭</span></DialogPrimitive.Close>}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;
export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("space-y-1.5", className)} {...props} />;
export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex items-center justify-end gap-2", className)} {...props} />;
export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold text-slate-950", className)} {...props} />);
DialogTitle.displayName = DialogPrimitive.Title.displayName;
export const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn("text-sm text-slate-500", className)} {...props} />);
DialogDescription.displayName = DialogPrimitive.Description.displayName;
