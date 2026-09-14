import * as React from "react";
import { cn } from "@/lib/utils";

export function DataTable({
  className,
  children,
  freezeLastColumn = false,
  scrollable = true,
  tableClassName,
}: React.HTMLAttributes<HTMLDivElement> & { freezeLastColumn?: boolean; scrollable?: boolean; tableClassName?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[#eef2f7] bg-white",
        scrollable ? "w-full overflow-x-auto" : "w-max min-w-full overflow-visible",
        className,
      )}
    >
      <table className={cn("eureka-table min-w-[900px] w-full text-left text-[13px]", tableClassName, freezeLastColumn && "[&_thead_th:last-child]:sticky [&_thead_th:last-child]:right-0 [&_thead_th:last-child]:z-30 [&_thead_th:last-child]:shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.35)] [&_tbody_td:last-child]:sticky [&_tbody_td:last-child]:right-0 [&_tbody_td:last-child]:z-20 [&_tbody_td:last-child]:bg-white [&_tbody_td:last-child]:shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.25)] [&_tbody_tr:hover_td:last-child]:bg-slate-50")}>
        {children}
      </table>
    </div>
  );
}
export const DataTableHead = ({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      "sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-4 py-3 text-[13px] font-semibold text-slate-500",
      className,
    )}
    {...props}
  />
);
export const DataTableCell = ({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td
    className={cn(
      "border-b border-slate-100 px-4 py-2 align-middle text-[13px]",
      className,
    )}
    {...props}
  />
);
