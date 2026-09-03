"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, DataTableCell, DataTableHead } from "@/components/ui/data-table";
import { FormulaEditor, type FormulaEditorField, type FormulaInsertion } from "@/components/governance/formula-editor";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export type MetricDraft = { id: string; name: string; formula: string; unit: string };
export type FormulaField = FormulaEditorField;
type FormulaCheck = { formula: string; dependencies: Array<{ meta_column_id: string; column: string }>; warnings: string[] };

export function CalculatedMetrics({ tableId, selectedColumns, metrics, fields, insertion, onChange, onEditingChange }: { tableId: string; selectedColumns: string[]; metrics: MetricDraft[]; fields: FormulaField[]; insertion: FormulaInsertion; onChange: (metrics: MetricDraft[]) => void; onEditingChange: (id: string | null) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [originals, setOriginals] = useState<Record<string, MetricDraft | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<Record<string, string[]>>({});
  const dependencyCount = (formula: string) => new Set(fields.filter((field) => new RegExp(`\\b${escapeRegExp(field.name)}\\b`, "i").test(formula)).map((field) => field.id)).size;
  const begin = (metric: MetricDraft, original: MetricDraft | null) => { setOriginals((current) => ({ ...current, [metric.id]: original })); setErrors((current) => ({ ...current, [metric.id]: "" })); setEditingId(metric.id); onEditingChange(metric.id); };
  const add = () => { const metric = { id: crypto.randomUUID(), name: "", formula: "", unit: "" }; onChange([...metrics, metric]); begin(metric, null); };
  const update = (id: string, key: keyof MetricDraft, value: string) => onChange(metrics.map((metric) => metric.id === id ? { ...metric, [key]: value } : metric));
  const save = async (metric: MetricDraft) => {
    if (!metric.name.trim() || !metric.formula.trim()) { setErrors((current) => ({ ...current, [metric.id]: "请填写指标名称和计算公式" })); return; }
    try {
      const result = await api<FormulaCheck>("/governance/workspaces/formulas/validate", { method: "POST", body: JSON.stringify({ tableId, selectedColumns, formula: metric.formula }) });
      onChange(metrics.map((item) => item.id === metric.id ? { ...item, formula: result.formula } : item));
      setWarnings((current) => ({ ...current, [metric.id]: result.warnings }));
      setErrors((current) => ({ ...current, [metric.id]: "" }));
      setEditingId(null); onEditingChange(null);
    } catch (cause) {
      const detail = cause as Error & { position?: number };
      const message = cause instanceof Error ? detail.message : "公式校验失败";
      setErrors((current) => ({ ...current, [metric.id]: typeof detail.position === "number" ? `第 ${detail.position + 1} 个字符：${message}` : message }));
    }
  };
  const cancel = (id: string) => { const original = originals[id]; onChange(original ? metrics.map((metric) => metric.id === id ? original : metric) : metrics.filter((metric) => metric.id !== id)); setEditingId(null); onEditingChange(null); };
  return <Card className="h-full overflow-hidden"><CardContent className="h-full"><DataTable className="h-full"><thead><tr><DataTableHead>指标名称</DataTableHead><DataTableHead>计算公式</DataTableHead><DataTableHead>单位</DataTableHead><DataTableHead>依赖字段</DataTableHead><DataTableHead><div className="flex items-center justify-between"><span>操作</span><Button size="sm" onClick={add}><Plus className="mr-1 h-3.5 w-3.5" />新增指标</Button></div></DataTableHead></tr></thead><tbody>{metrics.map((metric) => { const editing = metric.id === editingId; return <tr key={metric.id}><DataTableCell>{editing ? <Input className="h-8 min-w-32" value={metric.name} onChange={(event) => update(metric.id, "name", event.target.value)} placeholder="指标名称" /> : <span className="font-medium">{metric.name}</span>}</DataTableCell><DataTableCell>{editing ? <FormulaEditor value={metric.formula} onChange={(value) => update(metric.id, "formula", value)} fields={fields} insertion={insertion} error={errors[metric.id]} /> : <><span className="block max-w-96 truncate" title={metric.formula}>{metric.formula}</span>{warnings[metric.id]?.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-600">{warning}</p>)}</>}</DataTableCell><DataTableCell>{editing ? <Input className="h-8 min-w-20" value={metric.unit} onChange={(event) => update(metric.id, "unit", event.target.value)} placeholder="可选" /> : metric.unit || "-"}</DataTableCell><DataTableCell>{dependencyCount(metric.formula)}</DataTableCell><DataTableCell><div className="flex gap-1">{editing ? <><Button size="sm" onClick={() => void save(metric)}><Check className="mr-1 h-3.5 w-3.5" />保存</Button><Button size="sm" variant="outline" onClick={() => cancel(metric.id)}><X className="h-3.5 w-3.5" /></Button></> : <><Button size="sm" variant="outline" onClick={() => begin(metric, metric)}><Pencil className="mr-1 h-3.5 w-3.5" />编辑</Button><Button size="sm" variant="outline" onClick={() => onChange(metrics.filter((item) => item.id !== metric.id))}><Trash2 className="h-3.5 w-3.5" /></Button></>}</div></DataTableCell></tr>; })}</tbody></DataTable></CardContent></Card>;
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
