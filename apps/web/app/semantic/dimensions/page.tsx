import { Suspense } from "react";
import { CatalogList } from "@/components/semantic/catalog-list";
export default function DimensionsPage() { return <Suspense fallback={<main className="text-sm text-slate-500">正在加载维度中心…</main>}><CatalogList kind="dimensions" /></Suspense>; }
