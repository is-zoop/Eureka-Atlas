import type { ReactNode } from "react";

// Adapted from HazeToolPlat/frontend/src/components/common/PageHeader.tsx.
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: string; actions?: ReactNode }) {
  return <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-5 py-4">
    <div className="min-w-0 space-y-1">
      <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
      {description && <p className="text-xs leading-relaxed text-slate-500">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>;
}
