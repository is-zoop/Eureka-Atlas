import * as React from "react";
import { cn } from "@/lib/utils";
export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => <div className="w-full overflow-auto"><table ref={ref} className={cn("w-full text-left text-sm", className)} {...props} /></div>);
Table.displayName = "Table";
export const TableHead = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("h-10 bg-slate-50 px-3 text-xs font-semibold text-slate-600", className)} {...props} />;
export const TableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("border-t border-slate-100 px-3 py-3 text-slate-700", className)} {...props} />;
