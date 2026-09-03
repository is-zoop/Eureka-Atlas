import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PageHeader({
  title,
  description,
  backHref,
  actions,
  showEyebrow = true,
  compact = false,
}: {
  title: string;
  description?: string;
  backHref?: string;
  actions?: React.ReactNode;
  showEyebrow?: boolean;
  compact?: boolean;
}) {
  return (
    <header
      className={`flex flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm md:flex-row md:items-center md:justify-between ${
        compact ? "mb-4 gap-3 px-4 py-3" : "mb-5 gap-4 px-5 py-5"
      }`}
    >
      <div className="flex items-start gap-3">
        {backHref && (
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              返回
            </Link>
          </Button>
        )}
        <div>
          {showEyebrow && (
            <p className="mb-1 text-xs font-medium text-slate-400">
              数据治理中心
            </p>
          )}
          <h1
            className={`${compact ? "text-lg" : "text-xl"} font-semibold tracking-tight text-slate-900`}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
