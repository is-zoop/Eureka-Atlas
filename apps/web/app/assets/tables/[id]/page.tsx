"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Columns3 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { api } from "@/lib/api";

type Detail = { id: string; name: string; type: string; comment?: string; project: string; updatedAt: string };
type Column = { id: string; name: string; dataType: string; comment?: string; ordinal: number; isPartition: boolean };

export default function TableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [table, setTable] = useState<Detail | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [error, setError] = useState("");
  const [tableId, setTableId] = useState("");
  useEffect(() => { void params.then(({ id }) => { setTableId(id); return Promise.all([api<Detail>(`/metadata/tables/${id}`), api<Column[]>(`/metadata/tables/${id}/columns`)]); }).then(([detail, fields]) => { setTable(detail); setColumns(fields); }).catch((cause: Error) => setError(cause.message)); }, [params]);
  if (error) return <main><p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p></main>;
  return <main>
    <PageHeader title={table?.name ?? "加载中"} description={table ? `${table.project} · ${table.type} · ${table.comment ?? "无注释"}` : "正在读取物理表定义…"} backHref="/assets/tables" actions={<Button asChild disabled={!tableId}><Link href={`/governance/tables/${tableId}`}>进入治理工作台<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>} />
    <Card className="mb-5"><CardContent className="grid gap-4 text-sm md:grid-cols-4"><div><p className="text-slate-500">Project</p><p className="mt-1 font-medium">{table?.project ?? "-"}</p></div><div><p className="text-slate-500">类型</p><p className="mt-1 font-medium">{table?.type ?? "-"}</p></div><div><p className="text-slate-500">字段数</p><p className="mt-1 font-medium">{columns.length}</p></div><div><p className="text-slate-500">更新时间</p><p className="mt-1 font-medium">{table ? new Date(table.updatedAt).toLocaleString() : "-"}</p></div></CardContent></Card>
    <Card><CardContent><div className="mb-4 flex items-center gap-2 text-sm font-medium"><Columns3 className="h-4 w-4" />物理字段</div><Table><thead><tr><TableHead>顺序</TableHead><TableHead>字段名</TableHead><TableHead>类型</TableHead><TableHead>注释</TableHead><TableHead>分区字段</TableHead></tr></thead><tbody>{columns.map((column) => <tr key={column.id}><TableCell>{column.ordinal + 1}</TableCell><TableCell className="font-medium">{column.name}</TableCell><TableCell>{column.dataType}</TableCell><TableCell>{column.comment ?? "-"}</TableCell><TableCell>{column.isPartition ? "是" : "否"}</TableCell></tr>)}</tbody></Table></CardContent></Card>
  </main>;
}
