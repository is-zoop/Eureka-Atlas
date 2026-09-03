import * as React from "react";
import { cn } from "@/lib/utils";

export function DataTable({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto rounded-lg border border-slate-200 bg-white",
        className,
      )}
    >
      <table className="min-w-[900px] w-full text-left text-sm">
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
      "sticky top-0 z-10 whitespace-nowrap bg-white px-3 py-2.5 text-xs font-semibold text-slate-600",
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
      "border-t border-slate-100 px-3 py-2 align-middle",
      className,
    )}
    {...props}
  />
);
