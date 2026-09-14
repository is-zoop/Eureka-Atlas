"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, Plus, Save, Sparkles, Upload } from "lucide-react";
import { FloatingAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Menubar } from "@/components/ui/menubar";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
} from "@/components/ui/data-table";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CalculatedMetrics, type AiMetricSuggestion, type MetricDraft } from "@/components/governance/calculated-metrics";
import { AiGenerationDialog, type AiGeneration } from "@/components/governance/ai-generation-dialog";
import { api } from "@/lib/api";

type Field = {
  id: string;
  name: string;
  dataType: string;
  comment?: string | null;
  ordinal: number;
  isPartition: boolean;
};
type TableInfo = {
  id: string;
  name: string;
  project: string;
  type: string;
  comment?: string | null;
};
type TableDraft = {
  dataDomain: string | null;
  businessName: string;
  description: string;
  grain: string;
  permissionColumnId: string | null;
  permissionRelation: string | null;
};
type ColumnDraft = {
  metaColumnId: string;
  metricName: string;
  semanticType: "METRIC" | "DIMENSION" | "LABEL" | "PARTITION";
  aggregation: string;
  unit: string;
  groupable: boolean;
  candidateValueQueryable: boolean;
  labelDescription: string;
};
type Workspace = {
  id: string;
  status: "PENDING" | "PROCESSING" | "REVIEWING" | "COMPLETED";
  table: TableInfo;
  allColumns: Field[];
  selectedColumns: string[];
  draft: { table: TableDraft; columns: ColumnDraft[]; metrics: MetricDraft[] };
  ai: null | {
    table: TableDraft;
    columns: Array<
      Omit<ColumnDraft, "labelDescription"> & { labelDescription: string | null; columnName: string; confidence: number; reason: string }
    >;
    metrics: AiMetricSuggestion[];
  };
  published: {
    table: { publishedAt: string; dataDomain?: string | null; permissionColumnId?: string | null; permissionRelation?: string | null } | null;
    columns: number;
  };
};
type Detail = TableInfo;
const types: ColumnDraft["semanticType"][] = [
  "METRIC",
  "DIMENSION",
  "LABEL",
  "PARTITION",
];
type GovernanceOptions = { dataDomains: string[]; permissionRelations: string[] };
const labels = {
  METRIC: "指标",
  DIMENSION: "维度",
  LABEL: "标签",
  PARTITION: "分区",
};
const nameLabels = {
  METRIC: "指标名称",
  DIMENSION: "维度名称",
  LABEL: "标签名称",
  PARTITION: "分区名称",
};
const semanticTableMinWidths: Record<ColumnDraft["semanticType"], string> = {
  METRIC: "min-w-[1152px]",
  DIMENSION: "min-w-[1168px]",
  LABEL: "min-w-[1072px]",
  PARTITION: "min-w-[848px]",
};
const supportsGrouping = (type: ColumnDraft["semanticType"]) =>
  type === "DIMENSION" || type === "LABEL";
const initialColumnDraft = (column: Field): ColumnDraft => {
  const semanticType = classify(column);
  return {
    metaColumnId: column.id,
    metricName: semanticType === "PARTITION" ? column.name : column.comment?.trim() ?? "",
    semanticType,
    aggregation: "",
    unit: "",
    groupable: supportsGrouping(semanticType),
    candidateValueQueryable: supportsGrouping(semanticType),
    labelDescription: "",
  };
};
const normalizeColumnDraft = (column: ColumnDraft): ColumnDraft => ({
  ...column,
  aggregation: column.semanticType === "METRIC" ? column.aggregation : "",
  unit: column.semanticType === "METRIC" ? column.unit : "",
  groupable: supportsGrouping(column.semanticType) ? column.groupable !== false : false,
  candidateValueQueryable: supportsGrouping(column.semanticType) ? column.candidateValueQueryable !== false : false,
  labelDescription: column.semanticType === "LABEL" ? column.labelDescription : "",
});
function AiHint({ value, onAdopt, emptyText }: { value?: string | boolean | null; onAdopt?: () => void; emptyText?: string }) {
  if (value === null || value === undefined || value === "") return emptyText ? <p className="text-xs text-slate-400">{emptyText}</p> : null;
  const text = typeof value === "boolean" ? (value ? "是" : "否") : value;
  return <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-1"><p className="min-w-0 break-all text-xs leading-5 text-sky-700" title={`AI 建议：${text}`}>AI 建议：{text}</p>{onAdopt && <Button variant="outline" size="sm" className="mt-0.5 h-6 px-2 text-[11px]" onClick={onAdopt}>采用</Button>}</div>;
}
const numericType =
  /^(tinyint|smallint|int|integer|bigint|float|double|real|decimal|numeric)(\b|\()/i;
const classify = (column: Field): ColumnDraft["semanticType"] =>
  column.isPartition
    ? "PARTITION"
    : numericType.test(column.dataType.trim())
      ? "METRIC"
      : /(label|tag|标签)/i.test(`${column.name} ${column.comment ?? ""}`)
        ? "LABEL"
        : "DIMENSION";
export default function GovernanceWorkspacePage() {
  return (
    <Suspense
      fallback={
        <main>
          <p className="text-sm text-slate-500">正在加载治理工作台…</p>
        </main>
      }
    >
      <WorkspaceContent />
    </Suspense>
  );
}

function WorkspaceContent() {
  const { tableId } = useParams<{ tableId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const initialTask = search.get("task") ?? "";
  const requestedReturnTo = search.get("returnTo") ?? "";
  const returnHref = requestedReturnTo.startsWith("/assets/tables")
    ? requestedReturnTo
    : "/assets/tables";
  const [taskId, setTaskId] = useState(initialTask);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [allColumns, setAllColumns] = useState<Field[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [draft, setDraft] = useState<{
    table: TableDraft;
    columns: ColumnDraft[];
    metrics: MetricDraft[];
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<
    Set<ColumnDraft["semanticType"]>
  >(new Set());
  const [working, setWorking] = useState<"save" | "publish" | "">(
    "",
  );
  const [generationOpen, setGenerationOpen] = useState(false);
  const [activeGeneration, setActiveGeneration] = useState<AiGeneration | null>(null);
  const [showAiSuggestions, setShowAiSuggestions] = useState(true);
  const [permissionRelationOpen, setPermissionRelationOpen] = useState(false);
  const [editingMetricId, setEditingMetricId] = useState<string | null>(null);
  const [activeSemanticTab, setActiveSemanticTab] = useState("table");
  const [metricAddSignal, setMetricAddSignal] = useState(0);
  const [governanceOptions, setGovernanceOptions] = useState<GovernanceOptions>({ dataDomains: [], permissionRelations: [] });
  const [formulaInsertion, setFormulaInsertion] = useState<{
    revision: number;
    field: string;
  } | null>(null);
  const apply = (result: Workspace) => {
    setWorkspace(result);
    setTaskId(result.id);
    setAllColumns(result.allColumns);
    setSelectedColumns(result.selectedColumns);
    setDraft(result.draft);
  };
  useEffect(() => {
    void api<GovernanceOptions>("/settings/governance-options")
      .then(setGovernanceOptions)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;
    void api<Workspace | null>(`/governance/workspaces/by-table/${tableId}${initialTask ? `?task=${encodeURIComponent(initialTask)}` : ""}`)
      .then(async (result) => {
        if (cancelled) return;
        if (result) { apply(result); return; }
        const [detail, columns] = await Promise.all([api<Detail>(`/metadata/tables/${tableId}`), api<Field[]>(`/metadata/tables/${tableId}/columns`)]);
        if (cancelled) return;
        setAllColumns(columns);
        setDraft({
          table: {
            dataDomain: null,
            businessName: "",
            description: detail.comment ?? "",
            grain: "",
            permissionColumnId: null,
            permissionRelation: null,
          },
          columns: [],
          metrics: [],
        });
      })
      .catch((cause: Error) => !cancelled && setError(cause.message));
    return () => {
      cancelled = true;
    };
  }, [initialTask, tableId]);
  useEffect(() => {
    if (!taskId) return;
    void api<AiGeneration | null>(`/governance/workspaces/${taskId}/generations/active`)
      .then((generation) => {
        if (!generation) return;
        setActiveGeneration(generation);
        setGenerationOpen(true);
      })
      .catch(() => undefined);
  }, [taskId]);
  const columnById = useMemo(
    () =>
      new Map(
        draft?.columns.map((column) => [column.metaColumnId, column]) ?? [],
      ),
    [draft],
  );
  const aiById = useMemo(
    () =>
      new Map(
        workspace?.ai?.columns.map((column) => [column.metaColumnId, column]) ??
          [],
      ),
    [workspace],
  );
  const groupedColumns = useMemo(
    () =>
      types.map((type) => ({
        type,
        items: selectedColumns
          .map((id) => ({
            column: allColumns.find((item) => item.id === id),
            draft: columnById.get(id),
          }))
          .filter((item): item is { column: Field; draft: ColumnDraft } =>
            Boolean(item.column && item.draft),
          )
          .filter((item) => item.draft.semanticType === type),
      })),
    [allColumns, columnById, selectedColumns],
  );
  const updateTable = (key: keyof TableDraft, next: string | null) =>
    setDraft((current) =>
      current
        ? { ...current, table: { ...current.table, [key]: next } }
        : current,
    );
  const updateColumn = (id: string, key: keyof ColumnDraft, next: string | boolean) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            columns: current.columns.map((column) =>
              column.metaColumnId === id
                ? normalizeColumnDraft({
                    ...column,
                    [key]: next,
                    ...(key === "semanticType" && supportsGrouping(next as ColumnDraft["semanticType"]) && !supportsGrouping(column.semanticType)
                      ? { groupable: true, candidateValueQueryable: true }
                      : {}),
                  } as ColumnDraft)
                : column,
            ),
          }
        : current,
    );
  };
  const toggle = (column: Field) => {
    if (draft?.table.permissionColumnId === column.id)
      setPermissionRelationOpen(false);
    setSelectedColumns((current) => {
      const selected = current.includes(column.id);
      const next = selected
        ? current.filter((id) => id !== column.id)
        : [...current, column.id];
      setDraft((draftValue) =>
        draftValue
          ? {
              ...draftValue,
              table: selected
                ? {
                    ...draftValue.table,
                    grain: draftValue.table.grain.split(",").map((item) => item.trim()).filter((item) => item && item !== column.name).join(", "),
                    permissionColumnId: draftValue.table.permissionColumnId === column.id ? null : draftValue.table.permissionColumnId,
                    permissionRelation: draftValue.table.permissionColumnId === column.id ? null : draftValue.table.permissionRelation,
                  }
                : draftValue.table,
              columns: selected
                ? draftValue.columns.filter(
                    (item) => item.metaColumnId !== column.id,
                  )
                : [
                    ...draftValue.columns,
                    initialColumnDraft(column),
                  ],
            }
          : draftValue,
      );
      return next;
    });
  };
  const toggleAll = () => {
    if (selectedColumns.length === allColumns.length) {
      setSelectedColumns([]);
      setPermissionRelationOpen(false);
      setDraft((current) => (current ? { ...current, table: { ...current.table, grain: "", permissionColumnId: null, permissionRelation: null }, columns: [] } : current));
      return;
    }
    setSelectedColumns(allColumns.map((column) => column.id));
    setDraft((current) =>
      current
        ? {
            ...current,
            columns: allColumns.map(
              (column) =>
                columnById.get(column.id) ?? initialColumnDraft(column),
            ),
          }
        : current,
    );
  };
  const payload = () => ({
    selectedColumns,
    table: draft?.table,
    columns: draft?.columns,
    metrics: draft?.metrics,
  });
  const formulaFields = useMemo(
    () =>
      selectedColumns.flatMap((id) => {
        const field = allColumns.find((column) => column.id === id);
        return field
          ? [{ id: field.id, name: field.name, dataType: field.dataType, comment: field.comment }]
          : [];
      }),
    [allColumns, selectedColumns],
  );
  const selectedFieldOptions = useMemo(
    () => selectedColumns.flatMap((id) => {
      const field = allColumns.find((column) => column.id === id);
      return field ? [{ value: field.id, label: field.name }] : [];
    }),
    [allColumns, selectedColumns],
  );
  const insertFormulaField = (field: Field) => {
    if (!editingMetricId) return;
    setFormulaInsertion((current) => ({
      revision: (current?.revision ?? 0) + 1,
      field: field.name,
    }));
  };
  const saveWorkspace = async () => {
    if (!draft) return null;
    if (!selectedColumns.length) throw new Error("请先从左侧选择至少一个字段");
    if (!taskId) {
      const result = await api<Workspace>("/governance/workspaces", {
        method: "POST",
        body: JSON.stringify({ tableId, ...payload() }),
      });
      apply(result);
      const nextSearch = new URLSearchParams({ task: result.id });
      if (requestedReturnTo) nextSearch.set("returnTo", requestedReturnTo);
      router.replace(`/governance/tables/${tableId}?${nextSearch}`, {
        scroll: false,
      });
      return result;
    }
    const result = await api<Workspace>(`/governance/workspaces/${taskId}`, {
      method: "PUT",
      body: JSON.stringify(payload()),
    });
    apply(result);
    return result;
  };
  const perform = async (action: "save" | "publish") => {
    setError("");
    setNotice("");
    setWorking(action);
    try {
      const saved = await saveWorkspace();
      const id = saved?.id ?? taskId;
      if (!id) return;
      if (action === "save")
        setNotice(`草稿已保存，已选 ${selectedColumns.length} 个字段`);
      else {
        const result = await api<Workspace>(
          `/governance/workspaces/${id}/publish`,
          { method: "POST", body: JSON.stringify(payload()) },
        );
        apply(result);
        setNotice(
          `正式语义和 Semantic Package 已发布，已选 ${selectedColumns.length} 个字段`,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setWorking("");
    }
  };
  const adoptTable = (key: keyof Omit<TableDraft, "permissionColumnId" | "permissionRelation">) => {
    const ai = workspace?.ai?.table;
    if (ai && ai[key] !== null && ai[key] !== "") updateTable(key, ai[key]);
  };
  const adoptColumn = (
    id: string,
    key: keyof Omit<ColumnDraft, "metaColumnId">,
  ) => {
    const ai = aiById.get(id);
    if (ai && ai[key] !== null && ai[key] !== "") updateColumn(id, key, ai[key] as string | boolean);
  };
  const adoptPermissionSuggestion = () => {
    const ai = workspace?.ai?.table;
    if (!ai?.permissionColumnId || !ai.permissionRelation) return;
    setDraft((current) => current ? { ...current, table: { ...current.table, permissionColumnId: ai.permissionColumnId, permissionRelation: ai.permissionRelation } } : current);
    setPermissionRelationOpen(false);
  };
  const adoptAllAi = () => {
    const ai = workspace?.ai;
    if (!ai) return;
    const aiColumns = new Map(ai.columns.map((column) => [column.metaColumnId, column]));
    setDraft((current) => current ? {
      ...current,
      table: {
        ...current.table,
        ...(ai.table.dataDomain ? { dataDomain: ai.table.dataDomain } : {}),
        ...(ai.table.businessName ? { businessName: ai.table.businessName } : {}),
        ...(ai.table.description ? { description: ai.table.description } : {}),
        ...(ai.table.grain ? { grain: ai.table.grain } : {}),
        ...(ai.table.permissionColumnId && ai.table.permissionRelation ? { permissionColumnId: ai.table.permissionColumnId, permissionRelation: ai.table.permissionRelation } : {}),
      },
      columns: current.columns.map((column) => {
        const suggestion = aiColumns.get(column.metaColumnId);
        return suggestion
          ? normalizeColumnDraft({ ...column, metricName: suggestion.metricName || column.metricName, semanticType: suggestion.semanticType, aggregation: suggestion.aggregation || column.aggregation, unit: suggestion.unit || column.unit, groupable: suggestion.groupable, candidateValueQueryable: suggestion.candidateValueQueryable, labelDescription: suggestion.labelDescription ?? column.labelDescription })
          : column;
      }),
      metrics: [...current.metrics, ...ai.metrics.filter((suggestion) => !current.metrics.some((metric) => metric.name === suggestion.name)).map((suggestion) => ({ id: `ai-${suggestion.id}`, name: suggestion.name, formula: suggestion.formula, unit: suggestion.unit }))],
    } : current);
  };
  const adoptMetricSuggestion = (suggestion: AiMetricSuggestion) => setDraft((current) => !current || current.metrics.some((metric) => metric.name === suggestion.name) ? current : { ...current, metrics: [...current.metrics, { id: `ai-${suggestion.id}`, name: suggestion.name, formula: suggestion.formula, unit: suggestion.unit }] });
  if (error && !draft)
    return (
      <main>
        <FloatingAlert type="error">{error}</FloatingAlert>
      </main>
    );
  return (
    <main className="flex h-[calc(100vh-104px)] min-h-0 min-w-0 flex-col overflow-hidden">
      <Menubar className="mb-4 min-h-0 rounded-none border-0 bg-transparent px-0 py-0 shadow-none">
        <Button asChild size="sm" variant="outline"><Link href={returnHref}><ArrowLeft className="mr-1.5 h-4 w-4" />返回</Link></Button>
        <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(working)}
              onClick={() => void perform("save")}
            >
              <Save className="mr-1.5 h-4 w-4" />
              {working === "save" ? "保存中…" : "保存草稿"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(working) || !draft}
              onClick={() => setGenerationOpen(true)}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              生成 AI 建议
            </Button>
            <Button
              size="sm"
              disabled={Boolean(working)}
              onClick={() => void perform("publish")}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {working === "publish" ? "发布中…" : "发布正式语义"}
            </Button>
        </div>
      </Menubar>
      {error && (
        <FloatingAlert type="error">{error}</FloatingAlert>
      )}
      {notice && (
        <FloatingAlert type="success">{notice}</FloatingAlert>
      )}
      <AiGenerationDialog
        key={activeGeneration?.id ?? "new"}
        open={generationOpen}
        taskId={taskId}
        generation={activeGeneration}
        selectedCount={selectedColumns.length}
        onOpenChange={(open) => {
          setGenerationOpen(open);
          if (!open) setActiveGeneration(null);
        }}
        onStart={async (reference) => {
          const saved = await saveWorkspace();
          const id = saved?.id ?? taskId;
          if (!id) throw new Error("无法创建治理任务");
          const generation = await api<AiGeneration>(`/governance/workspaces/${id}/generations`, {
            method: "POST",
            body: JSON.stringify({ ...payload(), reference }),
          });
          setActiveGeneration(generation);
          return { taskId: id, generation };
        }}
        onCompleted={async () => {
          const id = taskId;
          if (!id) return;
          const result = await api<Workspace>(`/governance/workspaces/${id}`);
          apply(result);
          setNotice("AI 建议已生成，可逐项采用");
        }}
      />
      <div className="grid min-h-0 min-w-0 flex-1 gap-5 xl:grid-cols-[minmax(320px,.8fr)_minmax(0,1.7fr)]">
        <Card className="min-h-0 overflow-hidden rounded-lg">
          <CardContent className="flex h-full min-h-0 flex-col">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">选择字段</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedColumns.length} / {allColumns.length} 已选择
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {selectedColumns.length === allColumns.length
                  ? "取消全选"
                  : "全选"}
              </Button>
            </div>
            <Command className="min-h-0 flex-1 rounded-lg border border-slate-200">
              <CommandInput placeholder="搜索字段、类型或注释" />
              <ScrollArea className="min-h-0 flex-1">
                <CommandList className="max-h-none">
                  <CommandEmpty>没有匹配的字段</CommandEmpty>
                  <CommandGroup>
                    {allColumns.map((column) => (
                      <CommandItem
                        key={column.id}
                        value={`${column.name} ${column.dataType} ${column.comment ?? ""}`}
                        onSelect={() => toggle(column)}
                        className="min-h-6 gap-2 py-1.5"
                      >
                        <Checkbox
                          checked={selectedColumns.includes(column.id)}
                          onCheckedChange={() => toggle(column)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`选择 ${column.name}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {column.name}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {column.dataType}
                        </span>
                        <span className="max-w-32 shrink truncate text-xs text-slate-400">
                          {column.comment || "无注释"}
                        </span>
                        {column.isPartition && (
                          <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                            分区
                          </span>
                        )}
                        {editingMetricId && selectedColumns.includes(column.id) && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              insertFormulaField(column);
                            }}
                          >
                            引用
                          </Button>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </ScrollArea>
            </Command>
          </CardContent>
        </Card>
        <Card className="min-h-0 min-w-0 overflow-hidden rounded-lg">
          <CardContent className="flex h-full min-h-0 min-w-0 flex-col p-4">
          {draft && (
            <Tabs value={activeSemanticTab} onValueChange={setActiveSemanticTab} className="flex h-full min-h-0 min-w-0 flex-col">
              <div className="flex items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="table">表语义</TabsTrigger>
                  <TabsTrigger value="columns">字段语义（{selectedColumns.length}）</TabsTrigger>
                  <TabsTrigger value="metrics">计算指标（{draft.metrics.length}）</TabsTrigger>
                </TabsList>
                <div className="flex shrink-0 gap-2">
                  {activeSemanticTab === "metrics" && <Button size="sm" variant="outline" className="bg-white text-slate-900 hover:bg-slate-50" onClick={() => setMetricAddSignal((current) => current + 1)}><Plus className="mr-1 h-3.5 w-3.5" />新增指标</Button>}
                  {workspace?.ai && <><Button size="sm" variant="outline" onClick={() => setShowAiSuggestions((current) => !current)}>{showAiSuggestions ? "隐藏 AI 建议" : "显示 AI 建议"}</Button><Button size="sm" onClick={adoptAllAi}>全部采用</Button></>}
                </div>
              </div>
              <TabsContent
                value="table"
                className="min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                <div className="h-full overflow-auto">
                    <FieldGroup className="grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <Field>
                        <FieldLabel>数据域</FieldLabel>
                        <div className="space-y-1"><MultiCombobox className="h-10 w-full min-w-0" multiple={false} value={draft.table.dataDomain ? [draft.table.dataDomain] : []} onValueChange={(value) => updateTable("dataDomain", value[0] ?? null)} placeholder="选择数据域" options={governanceOptions.dataDomains.map((value) => ({ value, label: value }))} />{showAiSuggestions && workspace?.ai && <AiHint value={workspace.ai.table.dataDomain} emptyText="AI 未能判断，请人工选择" onAdopt={() => adoptTable("dataDomain")} />}</div>
                      </Field>
                      <Field>
                        <FieldLabel>业务名称</FieldLabel>
                        <div className="space-y-1">
                          <div className="flex gap-2">
                            <Input value={draft.table.businessName} onChange={(event) => updateTable("businessName", event.target.value)} />
                          </div>
                          {showAiSuggestions && <AiHint value={workspace?.ai?.table.businessName} onAdopt={() => adoptTable("businessName")} />}
                        </div>
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel>粒度</FieldLabel>
                        <div className="min-w-0 space-y-1">
                          <div className="flex min-w-0 gap-2">
                            <MultiCombobox className="h-10 min-w-0 flex-1" value={draft.table.grain ? draft.table.grain.split(",").map((item) => item.trim()).filter(Boolean).flatMap((name) => selectedFieldOptions.filter((option) => option.label === name).map((option) => option.value)) : []} onValueChange={(value) => updateTable("grain", value.map((id) => selectedFieldOptions.find((option) => option.value === id)?.label).filter(Boolean).join(", "))} placeholder="选择粒度字段" options={selectedFieldOptions} />
                          </div>
                          {showAiSuggestions && workspace?.ai && <AiHint value={workspace.ai.table.grain} emptyText="AI 未能识别已选粒度字段，请人工选择" onAdopt={() => adoptTable("grain")} />}
                        </div>
                      </Field>
                      <Field className="min-w-0">
                        <FieldLabel>权限字段</FieldLabel>
                        <div className="min-w-0 space-y-1"><div className="flex h-10 min-w-0 rounded-md border border-slate-300 bg-white shadow-sm">
                          <Combobox
                            className="h-full min-w-0 flex-1"
                            inputClassName={`h-full border-0 shadow-none ${draft.table.permissionRelation ? "rounded-l-md rounded-r-none" : "rounded-md"}`}
                            value={draft.table.permissionColumnId ?? ""}
                            onValueChange={(value) => {
                              updateTable("permissionColumnId", value || null);
                              updateTable("permissionRelation", null);
                              setPermissionRelationOpen(Boolean(value));
                            }}
                            placeholder="选择权限字段"
                            searchPlaceholder="选择权限字段"
                            options={selectedFieldOptions}
                          />
                          {draft.table.permissionRelation && (
                            <button
                              type="button"
                              className="rounded-r-md border-l border-slate-200 bg-slate-50 px-3 text-left text-[13px] text-slate-700 hover:bg-slate-100"
                              onClick={() => setPermissionRelationOpen(true)}
                            >
                              {draft.table.permissionRelation}
                            </button>
                          )}
                        </div>{showAiSuggestions && workspace?.ai && <AiHint value={workspace?.ai?.table.permissionColumnId && workspace?.ai?.table.permissionRelation ? `${selectedFieldOptions.find((option) => option.value === workspace?.ai?.table.permissionColumnId)?.label ?? ""} · ${workspace?.ai?.table.permissionRelation}` : null} emptyText="AI 未能判断，请人工维护" onAdopt={adoptPermissionSuggestion} />}</div>
                      </Field>
                      <Field className="md:col-span-2">
                        <FieldLabel>业务描述</FieldLabel>
                        <div className="space-y-1">
                          <div className="flex gap-2">
                            <Textarea value={draft.table.description} onChange={(event) => updateTable("description", event.target.value)} />
                          </div>
                          {showAiSuggestions && <AiHint value={workspace?.ai?.table.description} onAdopt={() => adoptTable("description")} />}
                        </div>
                      </Field>
                    </FieldGroup>
                </div>
              </TabsContent>
              <TabsContent
                value="columns"
                className="min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                {selectedColumns.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      请从左侧选择字段后在此编辑字段语义。
                  </div>
                ) : (
                  <div className="semantic-groups-scroll h-full min-w-0 overflow-y-auto">
                    <div className="space-y-3 pr-2">
                      {groupedColumns
                        .filter((group) => group.items.length)
                        .map((group) => (
                          <section
                            key={group.type}
                            className="min-w-0 overflow-hidden rounded-lg border border-slate-200"
                          >
                            <Button
                              type="button"
                              onClick={() =>
                                setCollapsedGroups((current) => {
                                  const next = new Set(current);
                                  if (next.has(group.type))
                                    next.delete(group.type);
                                  else next.add(group.type);
                                  return next;
                                })
                              }
                              variant="ghost"
                              className="flex h-auto w-full justify-between rounded-none bg-white px-3 py-2 text-sm font-semibold"
                            >
                              <span>
                                {labels[group.type]}（{group.items.length}）
                              </span>
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${collapsedGroups.has(group.type) ? "-rotate-90" : ""}`}
                              />
                            </Button>
                            {!collapsedGroups.has(group.type) && (
                              <DataTable tableClassName={`table-fixed w-full ${semanticTableMinWidths[group.type]}`} className="semantic-fields-table-scroll h-[420px] rounded-none border-x-0 border-b-0">
                                <colgroup>
                                  <col className="w-36" />
                                  <col className="w-36" />
                                  <col className="w-40" />
                                  <col className="w-56" />
                                  <col className="w-44" />
                                  {group.type === "LABEL" && <col className="w-56" />}
                                  {supportsGrouping(group.type) && <><col className="w-40" /><col className="w-40" /></>}
                                  {group.type === "METRIC" && <><col className="w-40" /><col className="w-36" /></>}
                                </colgroup>
                                <thead>
                                  <tr>
                                    <DataTableHead className="sticky left-0 z-30 w-36 min-w-36 bg-slate-50">物理字段</DataTableHead>
                                    <DataTableHead className="sticky left-36 z-30 w-36 min-w-36 bg-slate-50">类型</DataTableHead>
                                    <DataTableHead className="sticky left-72 z-30 w-40 min-w-40 border-r border-slate-200 bg-slate-50 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.5)]">注释</DataTableHead>
                                    <DataTableHead>{group.type !== "PARTITION" && <span className="mr-1 text-rose-500">*</span>}{nameLabels[group.type]}</DataTableHead>
                                    <DataTableHead>{group.type !== "PARTITION" && <span className="mr-1 text-rose-500">*</span>}字段类型</DataTableHead>
                                    {group.type === "LABEL" && <DataTableHead>标签说明</DataTableHead>}
                                    {supportsGrouping(group.type) && <><DataTableHead><span className="mr-1 text-rose-500">*</span>是否可以分组</DataTableHead><DataTableHead><span className="mr-1 text-rose-500">*</span>候选值查询</DataTableHead></>}
                                    {group.type === "METRIC" && <><DataTableHead><span className="mr-1 text-rose-500">*</span>聚合方式</DataTableHead><DataTableHead>单位</DataTableHead></>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map(
                                    ({ column, draft: item }) => {
                                      const ai = aiById.get(column.id);
                                      return (
                                        <tr key={column.id}>
                                          <DataTableCell className="sticky left-0 z-20 w-36 min-w-36 bg-white font-medium">
                                            {column.name}
                                          </DataTableCell>
                                          <DataTableCell className="sticky left-36 z-20 w-36 min-w-36 bg-white">
                                            {column.dataType}
                                          </DataTableCell>
                                          <DataTableCell
                                            className="sticky left-72 z-20 w-40 min-w-40 max-w-40 truncate border-r border-slate-200 bg-white shadow-[6px_0_8px_-8px_rgba(15,23,42,0.35)]"
                                            title={column.comment ?? ""}
                                          >
                                            {column.comment || "-"}
                                          </DataTableCell>
                                          <DataTableCell>
                                            <div className="space-y-1">
                                              <div className="flex gap-1">
                                                <Input className="h-8 min-w-36" value={item.metricName} onChange={(event) => updateColumn(column.id, "metricName", event.target.value)} />
                                              </div>
                                              {showAiSuggestions && <AiHint value={ai?.metricName} onAdopt={() => adoptColumn(column.id, "metricName")} />}
                                            </div>
                                          </DataTableCell>
                                          <DataTableCell>
                                            <div className="space-y-1">
                                              <div className="flex gap-1">
                                                <Combobox className="h-8 min-w-24" value={item.semanticType} onValueChange={(value) => updateColumn(column.id, "semanticType", value)} placeholder="选择字段类型" options={types.map((type) => ({ value: type, label: labels[type] }))} />
                                              </div>
                                              {showAiSuggestions && <AiHint value={ai ? labels[ai.semanticType] : undefined} onAdopt={() => adoptColumn(column.id, "semanticType")} />}
                                            </div>
                                          </DataTableCell>
                                          {group.type === "LABEL" && (
                                            <DataTableCell>
                                              <div className="space-y-1"><Input className="h-8 min-w-36" value={item.labelDescription} onChange={(event) => updateColumn(column.id, "labelDescription", event.target.value)} />{showAiSuggestions && <AiHint value={ai?.labelDescription} onAdopt={() => adoptColumn(column.id, "labelDescription")} />}</div>
                                            </DataTableCell>
                                          )}
                                          {supportsGrouping(group.type) && (
                                            <DataTableCell>
                                              <div className="space-y-1"><ToggleGroup
                                                type="single"
                                                value={item.groupable ? "yes" : "no"}
                                                onValueChange={(value) => value && updateColumn(column.id, "groupable", value === "yes")}
                                              >
                                                <ToggleGroupItem value="yes">是</ToggleGroupItem>
                                                <ToggleGroupItem value="no">否</ToggleGroupItem>
                                              </ToggleGroup>{showAiSuggestions && <AiHint value={ai?.groupable} onAdopt={() => adoptColumn(column.id, "groupable")} />}</div>
                                            </DataTableCell>
                                          )}
                                          {supportsGrouping(group.type) && (
                                            <DataTableCell>
                                              <div className="space-y-1"><ToggleGroup
                                                type="single"
                                                value={item.candidateValueQueryable ? "yes" : "no"}
                                                onValueChange={(value) => value && updateColumn(column.id, "candidateValueQueryable", value === "yes")}
                                              >
                                                <ToggleGroupItem value="yes">是</ToggleGroupItem>
                                                <ToggleGroupItem value="no">否</ToggleGroupItem>
                                              </ToggleGroup>{showAiSuggestions && <AiHint value={ai?.candidateValueQueryable} onAdopt={() => adoptColumn(column.id, "candidateValueQueryable")} />}</div>
                                            </DataTableCell>
                                          )}
                                          {group.type === "METRIC" && <DataTableCell>
                                            <div className="space-y-1">
                                              <div className="flex gap-1">
                                                <Combobox className="h-8 min-w-28" value={item.aggregation} onValueChange={(value) => updateColumn(column.id, "aggregation", value)} placeholder="选择聚合方式" options={["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX"].map((aggregation) => ({ value: aggregation, label: aggregation }))} />
                                              </div>
                                              {showAiSuggestions && <AiHint value={ai?.aggregation} onAdopt={() => adoptColumn(column.id, "aggregation")} />}
                                            </div>
                                          </DataTableCell>}
                                          {group.type === "METRIC" && <DataTableCell>
                                            <div className="space-y-1">
                                              <div className="flex gap-1">
                                                <Input className="h-8 min-w-24" value={item.unit} onChange={(event) => updateColumn(column.id, "unit", event.target.value)} />
                                              </div>
                                              {showAiSuggestions && <AiHint value={ai?.unit} onAdopt={() => adoptColumn(column.id, "unit")} />}
                                            </div>
                                          </DataTableCell>}
                                        </tr>
                                      );
                                    },
                                  )}
                                </tbody>
                              </DataTable>
                            )}
                          </section>
                        ))}
                    </div>
                  </div>
                )}
              </TabsContent>
              <TabsContent
                value="metrics"
                className="min-h-0 flex-1 overflow-hidden"
              >
                <CalculatedMetrics
                  tableId={tableId}
                  selectedColumns={selectedColumns}
                  metrics={draft.metrics}
                  fields={formulaFields}
                  insertion={formulaInsertion}
                  addSignal={metricAddSignal}
                  suggestions={showAiSuggestions ? workspace?.ai?.metrics : []}
                  onAdoptSuggestion={adoptMetricSuggestion}
                  onChange={(metrics) =>
                    setDraft((current) =>
                      current ? { ...current, metrics } : current,
                    )
                  }
                  onEditingChange={(id) => {
                    setEditingMetricId(id);
                    if (!id) setFormulaInsertion(null);
                  }}
                />
              </TabsContent>
            </Tabs>
          )}
          </CardContent>
        </Card>
      </div>
      {draft && (
        <Dialog
          open={permissionRelationOpen}
          onOpenChange={setPermissionRelationOpen}
        >
          <DialogContent showCloseButton={false} className="max-w-sm rounded-lg p-5">
            <DialogHeader>
              <DialogTitle>选择权限映射关系</DialogTitle>
              <DialogDescription>
                勾选一项后将立即保存并关闭窗口。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1" role="group" aria-label="权限映射关系">
              {governanceOptions.permissionRelations.map((relation) => (
                <label
                  key={relation}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                >
                  <Checkbox
                    checked={draft.table.permissionRelation === relation}
                    onCheckedChange={(checked) => {
                      if (!checked) return;
                      updateTable("permissionRelation", relation);
                      setPermissionRelationOpen(false);
                    }}
                  />
                  <span>{relation}</span>
                </label>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
