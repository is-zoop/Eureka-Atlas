"use client";
import { useParams } from "next/navigation";
import { CatalogDetail } from "@/components/semantic/catalog-detail";
export default function MetricPage() { const params = useParams<{ id: string }>(); return <CatalogDetail kind="metrics" id={params.id} />; }
