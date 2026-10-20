// Adapted from Haze's PersonalCenter InfoItem.
export function ProfileInfo({ label, value }: { label: string; value?: string | null }) {
  return <div className="rounded-lg border border-slate-200/70 bg-slate-50/60 px-3 py-2.5">
    <p className="text-xs font-semibold text-slate-500">{label}</p>
    <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={value || "—"}>{value || "—"}</p>
  </div>;
}
