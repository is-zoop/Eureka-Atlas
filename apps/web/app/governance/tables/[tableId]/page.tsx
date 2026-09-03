"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Save, Sparkles, Upload } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DataTable,
  DataTableCell,
  DataTableHead,
} from "@/components/ui/data-table";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  businessName: string;
  description: string;
  grain: string;
  permissionColumnId: string | null;
};
type ColumnDraft = {
  metaColumnId: string;
  metricName: string;
  semanticType: "METRIC" | "DIMENSION" | "LABEL" | "PARTITION";
  aggregation: string;
  unit: string;
};
type Workspace = {
  id: string;
  status: "PENDING" | "PROCESSING" | "REVIEWING" | "COMPLETED";
  table: TableInfo;
  allColumns: Field[];
  selectedColumns: string[];
  draft: { table: TableDraft; columns: ColumnDraft[] };
  ai: null | {
    table: Omit<TableDraft, "permissionColumnId">;
    columns: Array<
      ColumnDraft & { columnName: string; confidence: number; reason: string }
    >;
  };
  published: {
    table: { publishedAt: string; permissionColumnId?: string | null } | null;
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
const labels = {
  METRIC: "指标",
  DIMENSION: "维度",
  LABEL: "标签",
  PARTITION: "分区",
};
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
          <PageHeader title="治理工作台" description="正在加载治理工作台…" />
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
  const [taskId, setTaskId] = useState(initialTask);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [allColumns, setAllColumns] = useState<Field[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [draft, setDraft] = useState<{
    table: TableDraft;
    columns: ColumnDraft[];
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<
    Set<ColumnDraft["semanticType"]>
  >(new Set());
  const [working, setWorking] = useState<"save" | "generate" | "publish" | "">(
    "",
  );
  const apply = (result: Workspace) => {
    setWorkspace(result);
    setTaskId(result.id);
    setTable(result.table);
    setAllColumns(result.allColumns);
    setSelectedColumns(result.selectedColumns);
    setDraft(result.draft);
  };
  useEffect(() => {
    let cancelled = false;
    if (initialTask) {
      void api<Workspace>(`/governance/workspaces/${initialTask}`)
        .then((result) => {
          if (!cancelled) apply(result);
        })
        .catch((cause: Error) => !cancelled && setError(cause.message));
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      api<Detail>(`/metadata/tables/${tableId}`),
      api<Field[]>(`/metadata/tables/${tableId}/columns`),
    ])
      .then(([detail, columns]) => {
        if (cancelled) return;
        setTable(detail);
        setAllColumns(columns);
        setDraft({
          table: {
            businessName: detail.name,
            description: detail.comment ?? "",
            grain: "",
            permissionColumnId: null,
          },
          columns: [],
        });
      })
      .catch((cause: Error) => !cancelled && setError(cause.message));
    return () => {
      cancelled = true;
    };
  }, [initialTask, tableId]);
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
  const updateColumn = (id: string, key: keyof ColumnDraft, next: string) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            columns: current.columns.map((column) =>
              column.metaColumnId === id ? { ...column, [key]: next } : column,
            ),
          }
        : current,
    );
  const toggle = (column: Field) => {
    setSelectedColumns((current) => {
      const selected = current.includes(column.id);
      const next = selected
        ? current.filter((id) => id !== column.id)
        : [...current, column.id];
      setDraft((draftValue) =>
        draftValue
          ? {
              ...draftValue,
              columns: selected
                ? draftValue.columns.filter(
                    (item) => item.metaColumnId !== column.id,
                  )
                : [
                    ...draftValue.columns,
                    {
                      metaColumnId: column.id,
                      metricName: column.name,
                      semanticType: classify(column),
                      aggregation: "",
                      unit: "",
                    },
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
      setDraft((current) => (current ? { ...current, columns: [] } : current));
      return;
    }
    setSelectedColumns(allColumns.map((column) => column.id));
    setDraft((current) =>
      current
        ? {
            ...current,
            columns: allColumns.map(
              (column) =>
                columnById.get(column.id) ?? {
                  metaColumnId: column.id,
                  metricName: column.name,
                  semanticType: classify(column),
                  aggregation: "",
                  unit: "",
                },
            ),
          }
        : current,
    );
  };
  const payload = () => ({
    selectedColumns,
    table: draft?.table,
    columns: draft?.columns,
  });
  const saveWorkspace = async () => {
    if (!draft) return null;
    if (!selectedColumns.length) throw new Error("请先从左侧选择至少一个字段");
    if (!taskId) {
      const result = await api<Workspace>("/governance/workspaces", {
        method: "POST",
        body: JSON.stringify({ tableId, ...payload() }),
      });
      apply(result);
      router.replace(`/governance/tables/${tableId}?task=${result.id}`, {
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
  const perform = async (action: "save" | "generate" | "publish") => {
    setError("");
    setNotice("");
    setWorking(action);
    try {
      const saved = await saveWorkspace();
      const id = saved?.id ?? taskId;
      if (!id) return;
      if (action === "save") setNotice("草稿已保存");
      else {
        const result = await api<Workspace>(
          `/governance/workspaces/${id}/${action === "generate" ? "generate" : "publish"}`,
          { method: "POST", body: JSON.stringify(payload()) },
        );
        apply(result);
        setNotice(
          action === "generate"
            ? "AI 建议已生成，可逐项采用"
            : "正式语义和 Semantic Package 已发布",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setWorking("");
    }
  };
  const adoptTable = (key: keyof Omit<TableDraft, "permissionColumnId">) => {
    const ai = workspace?.ai?.table;
    if (ai) updateTable(key, ai[key]);
  };
  const adoptColumn = (
    id: string,
    key: keyof Omit<ColumnDraft, "metaColumnId">,
  ) => {
    const ai = aiById.get(id);
    if (ai) updateColumn(id, key, ai[key]);
  };
  if (error && !draft)
    return (
      <main>
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      </main>
    );
  return (
    <main className="flex h-[calc(100vh-104px)] min-h-0 flex-col overflow-hidden">
      <PageHeader
        title={table ? `${table.name} · 治理工作台` : "治理工作台"}
        backHref="/assets/tables"
        showEyebrow={false}
        compact
        actions={
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
              disabled={Boolean(working)}
              onClick={() => void perform("generate")}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              {working === "generate" ? "生成中…" : "生成 AI 建议"}
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
        }
      />
      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {workspace && (
        <Card className="mb-5">
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span>
              任务 <b>{workspace.id.slice(-6)}</b>
            </span>
            <span>
              状态 <StatusBadge status={workspace.status} />
            </span>
            <span className="text-slate-500">
              已选 {selectedColumns.length} 个字段
            </span>
            {workspace.published.table && (
              <span className="text-emerald-700">
                <Check className="mr-1 inline h-4 w-4" />
                已发布
              </span>
            )}
          </CardContent>
        </Card>
      )}
      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(320px,.8fr)_minmax(0,1.7fr)]">
        <Card className="min-h-0 overflow-hidden">
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
                        className="min-h-9 gap-2 py-1.5"
                      >
                        <Checkbox
                          checked={selectedColumns.includes(column.id)}
                          onCheckedChange={() => toggle(column)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`选择 ${column.name}`}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
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
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </ScrollArea>
            </Command>
          </CardContent>
        </Card>
        <section className="min-h-0 overflow-hidden">
          {draft && (
            <Tabs defaultValue="table" className="flex h-full min-h-0 flex-col">
              <TabsList>
                <TabsTrigger value="table">表语义</TabsTrigger>
                <TabsTrigger value="columns">
                  字段语义（{selectedColumns.length}）
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="table"
                className="min-h-0 flex-1 overflow-hidden"
              >
                <Card className="h-full">
                  <CardContent className="h-full overflow-auto">
                    <FieldGroup className="grid-cols-1 md:grid-cols-2">
                      <Field>
                        <FieldLabel>业务名称</FieldLabel>
                        <div className="flex gap-2">
                          <Input
                            value={draft.table.businessName}
                            onChange={(event) =>
                              updateTable("businessName", event.target.value)
                            }
                          />
                          {workspace?.ai && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => adoptTable("businessName")}
                            >
                              采用 AI
                            </Button>
                          )}
                        </div>
                      </Field>
                      <Field>
                        <FieldLabel>粒度</FieldLabel>
                        <div className="flex gap-2">
                          <Input
                            value={draft.table.grain}
                            onChange={(event) =>
                              updateTable("grain", event.target.value)
                            }
                          />
                          {workspace?.ai && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => adoptTable("grain")}
                            >
                              采用 AI
                            </Button>
                          )}
                        </div>
                      </Field>
                      <Field className="md:col-span-2">
                        <FieldLabel>业务描述</FieldLabel>
                        <div className="flex gap-2">
                          <Textarea
                            value={draft.table.description}
                            onChange={(event) =>
                              updateTable("description", event.target.value)
                            }
                          />
                          {workspace?.ai && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => adoptTable("description")}
                            >
                              采用 AI
                            </Button>
                          )}
                        </div>
                      </Field>
                      <Field>
                        <FieldLabel>权限字段（可选）</FieldLabel>
                        <select
                          value={draft.table.permissionColumnId ?? ""}
                          onChange={(event) =>
                            updateTable(
                              "permissionColumnId",
                              event.target.value || null,
                            )
                          }
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3"
                        >
                          <option value="">不设置</option>
                          {allColumns.map((column) => (
                            <option key={column.id} value={column.id}>
                              {column.name} · {column.dataType}
                            </option>
                          ))}
                        </select>
                        <FieldDescription>
                          仅可选择当前表中的有效字段。
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent
                value="columns"
                className="min-h-0 flex-1 overflow-hidden"
              >
                {selectedColumns.length === 0 ? (
                  <Card className="h-full">
                    <CardContent className="py-16 text-center text-sm text-slate-500">
                      请从左侧选择字段后在此编辑字段语义。
                    </CardContent>
                  </Card>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="space-y-3 pr-2">
                      {groupedColumns
                        .filter((group) => group.items.length)
                        .map((group) => (
                          <section
                            key={group.type}
                            className="overflow-hidden rounded-lg border border-slate-200"
                          >
                            <button
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
                              className="flex w-full items-center justify-between bg-white px-3 py-2 text-sm font-semibold"
                            >
                              <span>
                                {labels[group.type]}（{group.items.length}）
                              </span>
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${collapsedGroups.has(group.type) ? "-rotate-90" : ""}`}
                              />
                            </button>
                            {!collapsedGroups.has(group.type) && (
                              <DataTable className="rounded-none border-x-0 border-b-0">
                                <thead>
                                  <tr>
                                    <DataTableHead>物理字段</DataTableHead>
                                    <DataTableHead>类型</DataTableHead>
                                    <DataTableHead>注释</DataTableHead>
                                    <DataTableHead>指标名称</DataTableHead>
                                    <DataTableHead>字段类型</DataTableHead>
                                    <DataTableHead>聚合方式</DataTableHead>
                                    <DataTableHead>单位</DataTableHead>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map(
                                    ({ column, draft: item }) => {
                                      const ai = aiById.get(column.id);
                                      return (
                                        <tr key={column.id}>
                                          <DataTableCell className="font-medium">
                                            {column.name}
                                          </DataTableCell>
                                          <DataTableCell>
                                            {column.dataType}
                                          </DataTableCell>
                                          <DataTableCell
                                            className="max-w-40 truncate"
                                            title={column.comment ?? ""}
                                          >
                                            {column.comment || "-"}
                                          </DataTableCell>
                                          <DataTableCell>
                                            <div className="flex gap-1">
                                              <Input
                                                className="h-8 min-w-36"
                                                value={item.metricName}
                                                onChange={(event) =>
                                                  updateColumn(
                                                    column.id,
                                                    "metricName",
                                                    event.target.value,
                                                  )
                                                }
                                              />
                                              {ai && (
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() =>
                                                    adoptColumn(
                                                      column.id,
                                                      "metricName",
                                                    )
                                                  }
                                                >
                                                  AI
                                                </Button>
                                              )}
                                            </div>
                                          </DataTableCell>
                                          <DataTableCell>
                                            <select
                                              value={item.semanticType}
                                              onChange={(event) =>
                                                updateColumn(
                                                  column.id,
                                                  "semanticType",
                                                  event.target.value,
                                                )
                                              }
                                              className="h-8 min-w-24 rounded border border-slate-200 bg-white px-2"
                                            >
                                              {types.map((type) => (
                                                <option key={type} value={type}>
                                                  {labels[type]}
                                                </option>
                                              ))}
                                            </select>
                                          </DataTableCell>
                                          <DataTableCell>
                                            {item.semanticType === "METRIC" ? (
                                              <div className="flex gap-1">
                                                <Input
                                                  className="h-8 min-w-24"
                                                  value={item.aggregation}
                                                  onChange={(event) =>
                                                    updateColumn(
                                                      column.id,
                                                      "aggregation",
                                                      event.target.value,
                                                    )
                                                  }
                                                  placeholder="必填"
                                                />
                                                {ai && (
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                      adoptColumn(
                                                        column.id,
                                                        "aggregation",
                                                      )
                                                    }
                                                  >
                                                    AI
                                                  </Button>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="text-slate-400">
                                                -
                                              </span>
                                            )}
                                          </DataTableCell>
                                          <DataTableCell>
                                            <div className="flex gap-1">
                                              <Input
                                                className="h-8 min-w-24"
                                                value={item.unit}
                                                onChange={(event) =>
                                                  updateColumn(
                                                    column.id,
                                                    "unit",
                                                    event.target.value,
                                                  )
                                                }
                                              />
                                              {ai && (
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() =>
                                                    adoptColumn(
                                                      column.id,
                                                      "unit",
                                                    )
                                                  }
                                                >
                                                  AI
                                                </Button>
                                              )}
                                            </div>
                                          </DataTableCell>
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
                  </ScrollArea>
                )}
              </TabsContent>
            </Tabs>
          )}
        </section>
      </div>
    </main>
  );
}
