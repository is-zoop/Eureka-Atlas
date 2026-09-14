import * as React from "react";
import { cn } from "@/lib/utils";
type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  freezeLastColumn?: boolean;
  containerClassName?: string;
};
export const Table = React.forwardRef<HTMLTableElement, TableProps>(({ className, containerClassName, freezeLastColumn = false, ...props }, ref) => <div className={cn("shadcn-scrollbar h-full w-full overflow-auto rounded-xl border border-[#eef2f7] bg-white", containerClassName)}><table ref={ref} className={cn("eureka-table w-full text-left text-[13px]", freezeLastColumn && "[&_thead_th:last-child]:sticky [&_thead_th:last-child]:right-0 [&_thead_th:last-child]:z-30 [&_thead_th:last-child]:shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.35)] [&_tbody_td:last-child]:sticky [&_tbody_td:last-child]:right-0 [&_tbody_td:last-child]:z-20 [&_tbody_td:last-child]:bg-white [&_tbody_td:last-child]:shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.25)] [&_tbody_tr:hover_td:last-child]:bg-slate-50", className)} {...props} /></div>);
Table.displayName = "Table";
export const TableHead = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("sticky top-0 z-10 h-10 bg-slate-50 px-4 text-[13px] font-semibold text-slate-500", className)} {...props} />;
export const TableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("border-b border-slate-100 px-4 py-2 align-middle text-[13px] text-slate-700", className)} {...props} />;
