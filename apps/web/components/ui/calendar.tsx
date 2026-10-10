"use client";

import { DayPicker, type DayPickerProps } from "react-day-picker";
import { cn } from "@/lib/utils";
import "react-day-picker/style.css";

function Calendar({ className, ...props }: DayPickerProps) {
  return <DayPicker className={cn("p-3 text-xs [&_.rdp-month_caption]:!text-xs [&_.rdp-caption_label]:!text-xs [&_.rdp-weekday]:!text-xs [&_.rdp-day_button]:!text-xs [&_.rdp-range_start_.rdp-day_button]:!size-8 [&_.rdp-range_end_.rdp-day_button]:!size-8", className)} {...props} />;
}

export { Calendar };
