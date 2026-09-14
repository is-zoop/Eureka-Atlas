"use client";
import { useParams } from "next/navigation";
import { CatalogDetail } from "@/components/semantic/catalog-detail";
export default function DimensionPage() { const params = useParams<{ id: string }>(); return <CatalogDetail kind="dimensions" id={params.id} />; }
