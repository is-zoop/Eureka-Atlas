import { AlertCircle, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Copied from HazeToolPlat's EmptyState and adapted to Atlas typography.
interface EmptyStateProps {
  title?: string;
  description?: string;
  resetLabel?: string;
  onReset?: () => void;
  icon?: LucideIcon;
}

export function EmptyState({
  title = "没有找到匹配的数据",
  description = "尝试减少筛选条件，或换一个更宽泛的关键词重新检索。",
  resetLabel = "清空筛选",
  onReset,
  icon: Icon = AlertCircle,
}: EmptyStateProps) {
  return (
    <div className="flex w-full flex-1 items-center justify-center p-4 sm:p-8">
      <Card className="w-full rounded-xl border-dashed border-slate-200 bg-white shadow-none">
        <CardContent className="flex min-h-64 flex-col items-center justify-center p-6 text-center sm:p-8">
          <span className="mb-4 flex size-12 items-center justify-center rounded-xl border border-slate-100 bg-slate-50 text-slate-400">
            <Icon className="size-5" />
          </span>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">{description}</p>
          {onReset && <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>{resetLabel}</Button>}
        </CardContent>
      </Card>
    </div>
  );
}
