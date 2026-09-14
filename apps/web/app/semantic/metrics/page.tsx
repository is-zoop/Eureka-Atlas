import { Suspense } from "react";
import { CatalogList } from "@/components/semantic/catalog-list";
export default function MetricsPage() { return <Suspense fallback={<main className="text-sm text-slate-500">正在加载指标中心…</main>}><CatalogList kind="metrics" /></Suspense>; }
