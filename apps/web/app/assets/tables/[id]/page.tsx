"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Columns3, FileJson, FileStack, Layers3, TableProperties } from "lucide-react";
import { FormulaDisplay } from "@/components/governance/formula-editor";
import { StatusBadge } from "@/components/common/status-badge";
import { FloatingAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SemanticPackageDialog } from "@/components/semantic/semantic-package-dialog";
import { api } from "@/lib/api";

type Detail = { id: string; name: string; type: string; comment?: string | null; space: string; catalog: string; schema: string; updatedAt: string; governanceStatus: "UNGOVERNED" | "DRAFT" | "COMPLETED" };
type Column = { id: string; name: string; dataType: string; normalizedType: string; comment?: string | null; ordinal: number; isNullable: boolean | null; defaultValue: string | null; isPrimaryKey: boolean; isPartition: boolean; length: number | null; precision: number | null; scale: number | null };
type SemanticType = "METRIC" | "DIMENSION" | "LABEL" | "PARTITION";
type ColumnDraft = { metaColumnId: string; metricName: string; semanticType: SemanticType; aggregation: string; unit: string; groupable: boolean; candidateValueQueryable: boolean; labelDescription: string };
type MetricDraft = { id: string; name: string; formula: string; unit: string };
type Workspace = { id: string; allColumns: Column[]; selectedColumns: string[]; draft: { table: { dataDomain: string | null; businessName: string; description: string; grain: string; permissionColumnId: string | null; permissionRelation: string | null }; columns: ColumnDraft[]; metrics: MetricDraft[] }; published: { table: { publishedAt: string } | null } };
type SemanticPackage = { fields: Array<{ column: string }>; metrics: Array<{ name: string }>; updatedAt: string };

const semanticLabels: Record<SemanticType, string> = { METRIC: "指标", DIMENSION: "维度", LABEL: "标签", PARTITION: "分区" };
function SummaryItem({ label, value }: { label: string; value: string }) { return <div><p className="text-[13px] text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-medium text-slate-800">{value || "-"}</p></div>; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function FieldList({ columns, selectedIds }: { columns: Column[]; selectedIds: Set<string> }) {
  return columns.length ? <div className="space-y-1.5">{columns.map((column) => { const selected = selectedIds.has(column.id); return <div key={column.id} className={`flex items-center gap-2 px-1 py-1 text-[13px] ${selected ? "text-slate-700" : "text-slate-400"}`}><Checkbox checked={selected} disabled aria-label={`${column.name}${selected ? "已勾选" : "未勾选"}`} className={selected ? "opacity-100" : "border-slate-300 text-slate-400 opacity-100"} /><span className="min-w-0 flex-1 truncate font-medium" title={column.name}>{column.name}</span><span className="shrink-0 whitespace-nowrap text-xs">{column.dataType}</span>{column.isPartition && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">分区</span>}</div>; })}</div> : <p className="py-3 text-center text-xs text-slate-400">暂无字段</p>;
}

function ReadonlyColumns({ type, rows }: { type: SemanticType; rows: Array<{ column: Column; draft: ColumnDraft }> }) {
  const nameLabel = type === "METRIC" ? "指标名称" : type === "DIMENSION" ? "维度名称" : type === "LABEL" ? "标签名称" : "分区名称";
  return <Table containerClassName="h-auto overflow-visible rounded-none border-0"><thead><tr><TableHead>物理字段</TableHead><TableHead>类型</TableHead><TableHead>注释</TableHead><TableHead>{nameLabel}</TableHead>{type === "METRIC" && <><TableHead>聚合方式</TableHead><TableHead>单位</TableHead></>}{type === "LABEL" && <TableHead>标签说明</TableHead>}{(type === "DIMENSION" || type === "LABEL") && <><TableHead>是否可以分组</TableHead><TableHead>候选值查询</TableHead></>}</tr></thead><tbody>{rows.length ? rows.map(({ column, draft }) => <tr key={column.id}><TableCell className="font-medium text-slate-800">{column.name}</TableCell><TableCell>{column.dataType}</TableCell><TableCell className="max-w-48 truncate" title={column.comment ?? ""}>{column.comment || "-"}</TableCell><TableCell>{draft.metricName || "-"}</TableCell>{type === "METRIC" && <><TableCell>{draft.aggregation || "-"}</TableCell><TableCell>{draft.unit || "-"}</TableCell></>}{type === "LABEL" && <TableCell>{draft.labelDescription || "-"}</TableCell>}{(type === "DIMENSION" || type === "LABEL") && <><TableCell>{draft.groupable ? "是" : "否"}</TableCell><TableCell>{draft.candidateValueQueryable ? "是" : "否"}</TableCell></>}</tr>) : <tr><TableCell colSpan={type === "METRIC" ? 6 : type === "LABEL" ? 7 : type === "DIMENSION" ? 6 : 4} className="py-12 text-center text-slate-500">暂无{semanticLabels[type]}</TableCell></tr>}</tbody></Table>;
}

export default function TableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const searchParams = useSearchParams();
  const [table, setTable] = useState<Detail | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [semanticPackage, setSemanticPackage] = useState<SemanticPackage | null>(null);
  const [error, setError] = useState("");
  const [tableId, setTableId] = useState("");

  useEffect(() => { let cancelled = false; void params.then(async ({ id }) => { const [detail, fields, semantic] = await Promise.all([api<Detail>(`/metadata/tables/${id}`), api<Column[]>(`/metadata/tables/${id}/columns`), api<Workspace | null>(`/governance/workspaces/by-table/${id}`)]); if (cancelled) return; setTableId(id); setTable(detail); setColumns(fields); setWorkspace(semantic); try { const currentPackage = await api<SemanticPackage>(`/packages/${id}`); if (!cancelled) setSemanticPackage(currentPackage); } catch (cause) { if (!cancelled && !(cause instanceof Error && cause.message.includes("Semantic package not found"))) setError(cause instanceof Error ? cause.message : "无法加载 Semantic Package"); } }).catch((cause: Error) => { if (!cancelled) setError(cause.message); }); return () => { cancelled = true; }; }, [params]);

  const isPublished = Boolean(workspace?.published.table);
  const tableDraft = workspace?.draft.table;
  const selectedSet = useMemo(() => new Set(workspace?.selectedColumns ?? []), [workspace]);
  const selectedFields = columns.filter((column) => selectedSet.has(column.id));
  const typedRows = useMemo(() => {
    const byId = new Map(columns.map((column) => [column.id, column]));
    const result: Record<SemanticType, Array<{ column: Column; draft: ColumnDraft }>> = { METRIC: [], DIMENSION: [], LABEL: [], PARTITION: [] };
    workspace?.draft.columns.forEach((draft) => { const column = byId.get(draft.metaColumnId); if (column) result[draft.semanticType].push({ column, draft }); });
    return result;
  }, [columns, workspace]);
  const permissionField = tableDraft?.permissionColumnId ? columns.find((column) => column.id === tableDraft.permissionColumnId)?.name ?? "-" : "-";
  const returnTo = searchParams.get("returnTo");
  const listHref = returnTo?.startsWith("/assets/tables") ? returnTo : "/assets/tables";
  const governanceQuery = new URLSearchParams({ returnTo: listHref });
  if (workspace) governanceQuery.set("task", workspace.id);
  const governanceHref = tableId ? `/governance/tables/${tableId}?${governanceQuery}` : "#";
  const dependencies = (formula: string) => selectedFields.filter((column) => new RegExp(`\\b${escapeRegExp(column.name)}\\b`, "i").test(formula)).map((column) => column.name);

  if (error) return <main><FloatingAlert type="error">{error}</FloatingAlert></main>;
  return <main className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-4"><Button asChild variant="outline"><Link href={listHref}><ArrowLeft className="mr-2 h-4 w-4" />返回</Link></Button><Button asChild disabled={!tableId}><Link href={governanceHref}>开始治理</Link></Button></div>
    <Tabs defaultValue="assets"><TabsList><TabsTrigger value="assets">资产信息</TabsTrigger><TabsTrigger value="metrics">指标详情</TabsTrigger></TabsList>
      <TabsContent value="assets" className="space-y-6"><section><div className="mb-3 flex items-center gap-2"><Columns3 className="h-4 w-4 text-slate-600" /><h2 className="font-semibold text-slate-900">表信息</h2></div><Card><CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-[13px] text-slate-500">表名称</p><div className="mt-1 flex flex-wrap items-center gap-2"><p className="break-all font-medium text-slate-800">{table?.name ?? "-"}</p>{table && <StatusBadge status={table.governanceStatus} />}</div></div><SummaryItem label="表注释" value={table?.comment ?? ""} /><SummaryItem label="数据空间" value={table?.space ?? "-"} /><SummaryItem label="对象类型" value={table?.type ?? "-"} /><SummaryItem label="字段数量" value={columns.length ? `${columns.length} 个` : "-"} /><SummaryItem label="更新时间" value={table ? new Date(table.updatedAt).toLocaleString() : "-"} /></CardContent></Card></section><Separator />
        <section><div className="mb-3 flex flex-wrap items-center gap-2"><Layers3 className="h-4 w-4 text-slate-600" /><h2 className="font-semibold text-slate-900">治理结果</h2>{workspace && <Badge className={isPublished ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>{isPublished ? "已发布" : "草稿，尚未发布"}</Badge>}</div>{!workspace ? <Card><CardContent className="py-10 text-center"><TableProperties className="mx-auto mb-3 h-7 w-7 text-slate-400" /><p className="font-medium text-slate-700">尚未开始治理</p><p className="mt-1 text-sm text-slate-500">开始治理后，可在指标详情中查看字段语义。</p><Button asChild className="mt-4" size="sm"><Link href={governanceHref}>开始治理</Link></Button></CardContent></Card> : <Card><CardContent className="space-y-5"><div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3"><SummaryItem label="业务名称" value={tableDraft?.businessName ?? ""} /><SummaryItem label="数据域" value={tableDraft?.dataDomain ?? ""} /><SummaryItem label="粒度" value={tableDraft?.grain ?? ""} /><SummaryItem label="权限字段" value={permissionField} /><SummaryItem label="权限关系" value={tableDraft?.permissionRelation ?? ""} /><SummaryItem label="业务描述" value={tableDraft?.description ?? ""} /></div><div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-5">{(Object.keys(semanticLabels) as SemanticType[]).map((type) => <div key={type} className="rounded-lg bg-slate-50 px-3 py-3"><p className="text-[13px] text-slate-500">{semanticLabels[type]}</p><p className="mt-1 text-lg font-semibold text-slate-800">{typedRows[type].length}</p></div>)}<div className="rounded-lg bg-slate-50 px-3 py-3"><p className="text-[13px] text-slate-500">计算指标</p><p className="mt-1 text-lg font-semibold text-slate-800">{workspace.draft.metrics.length}</p></div></div></CardContent></Card>}</section><Separator />
        <section><div className="mb-3 flex items-center gap-2"><FileStack className="h-4 w-4 text-slate-600" /><h2 className="font-semibold text-slate-900">语义 Package</h2></div>{semanticPackage ? <Card><CardContent className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /><div><p className="font-medium text-slate-800">Semantic Package 已生成</p><p className="mt-1 text-sm text-slate-500">{semanticPackage.fields.length} 个字段 · {semanticPackage.metrics.length} 个计算指标 · 更新于 {new Date(semanticPackage.updatedAt).toLocaleString()}</p></div></div><SemanticPackageDialog tableId={tableId} label="查看 JSON" /></CardContent></Card> : <Card><CardContent className="flex flex-wrap items-center gap-3 py-6"><FileJson className="h-5 w-5 text-slate-400" /><div><p className="font-medium text-slate-700">尚未生成 Semantic Package</p><p className="mt-1 text-sm text-slate-500">发布表语义和至少一个字段语义后，可在 Package 页面生成。</p></div></CardContent></Card>}</section>
      </TabsContent>
      <TabsContent value="metrics"><div className="grid min-h-[36rem] gap-4 xl:h-[calc(100vh-220px)] xl:grid-cols-[minmax(360px,.8fr)_minmax(0,1.7fr)]"><Card className="min-h-0 overflow-hidden"><CardContent className="flex h-full min-h-0 flex-col p-4"><div className="mb-3"><h2 className="font-semibold text-slate-900">物理字段</h2><p className="mt-1 text-xs text-slate-500">已勾选 {selectedFields.length} / {columns.length} 个</p></div><ScrollArea className="min-h-0 flex-1 pr-3"><FieldList columns={columns} selectedIds={selectedSet} /></ScrollArea></CardContent></Card><Card className="min-h-0 overflow-hidden"><CardContent className="flex h-full min-h-0 flex-col p-4">{!workspace ? <div className="flex h-full flex-col items-center justify-center text-center"><TableProperties className="mb-3 h-7 w-7 text-slate-400" /><p className="font-medium text-slate-700">尚未开始治理</p><p className="mt-1 text-sm text-slate-500">开始治理后可查看详细语义。</p></div> : <Tabs defaultValue="METRIC" className="flex h-full min-h-0 flex-col"><TabsList className="max-w-full shrink-0 overflow-x-auto"><TabsTrigger value="METRIC">指标（{typedRows.METRIC.length}）</TabsTrigger><TabsTrigger value="DIMENSION">维度（{typedRows.DIMENSION.length}）</TabsTrigger><TabsTrigger value="LABEL">标签（{typedRows.LABEL.length}）</TabsTrigger><TabsTrigger value="CALCULATED">计算指标（{workspace.draft.metrics.length}）</TabsTrigger><TabsTrigger value="PARTITION">分区（{typedRows.PARTITION.length}）</TabsTrigger></TabsList>{(["METRIC", "DIMENSION", "LABEL", "PARTITION"] as SemanticType[]).map((type) => <TabsContent key={type} value={type} className="min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full"><ReadonlyColumns type={type} rows={typedRows[type]} /></ScrollArea></TabsContent>)}<TabsContent value="CALCULATED" className="min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full"><Table containerClassName="h-auto overflow-visible rounded-none border-0"><thead><tr><TableHead>指标名称</TableHead><TableHead>计算公式</TableHead><TableHead>单位</TableHead><TableHead>依赖字段</TableHead></tr></thead><tbody>{workspace.draft.metrics.length ? workspace.draft.metrics.map((metric) => <tr key={metric.id}><TableCell className="font-medium text-slate-800">{metric.name || "-"}</TableCell><TableCell className="min-w-[18rem]"><FormulaDisplay value={metric.formula} /></TableCell><TableCell>{metric.unit || "-"}</TableCell><TableCell>{dependencies(metric.formula).join("、") || "-"}</TableCell></tr>) : <tr><TableCell colSpan={4} className="py-12 text-center text-slate-500">暂无计算指标</TableCell></tr>}</tbody></Table></ScrollArea></TabsContent></Tabs>}</CardContent></Card></div></TabsContent>
    </Tabs>
  </main>;
}
