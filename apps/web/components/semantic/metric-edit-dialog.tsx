"use client";

import { useEffect, useState } from "react";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

type MetricDetail = { id: string; name: string; description: string; aliases: string[]; dataSource: string; type: string; unit: string | null };
type Form = { description: string; aliases: string; dataSource: string };
const emptyForm: Form = { description: "", aliases: "", dataSource: "" };
const typeLabel: Record<string, string> = { ATOMIC: "原子指标", DERIVED: "派生指标", MIXED: "原子 + 派生" };

export function MetricEditDialog({ metricId, onSaved }: { metricId: string; onSaved: (metric: MetricDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<MetricDetail | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setMetric(null);
    void api<MetricDetail>(`/semantic/metrics/${metricId}`).then((value) => {
      if (cancelled) return;
      setMetric(value);
      setForm({ description: value.description, aliases: value.aliases.join(", "), dataSource: value.dataSource });
    }).catch((cause: Error) => !cancelled && setError(cause.message));
    return () => { cancelled = true; };
  }, [metricId, open]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const value = await api<MetricDetail>(`/semantic/metrics/${metricId}`, { method: "PATCH", body: JSON.stringify({ description: form.description, aliases: form.aliases.split(",").map((item) => item.trim()).filter(Boolean), dataSource: form.dataSource }) });
      onSaved(value);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline"><Pencil className="h-3.5 w-3.5" />编辑</Button></DialogTrigger>
    <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b border-slate-100 px-6 py-5"><DialogTitle>编辑指标</DialogTitle><DialogDescription>维护指标的业务定义、检索别名和数据来源。</DialogDescription></DialogHeader>
      <div className="max-h-[calc(100vh-15rem)] space-y-5 overflow-y-auto px-6 py-5">
        {!metric && !error && <p className="py-8 text-center text-sm text-slate-500">正在加载指标信息…</p>}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {metric && <>
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3"><div><p className="text-xs text-slate-500">指标名称</p><p className="mt-1 font-semibold text-slate-900">{metric.name}</p></div><div><p className="text-xs text-slate-500">类型</p><p className="mt-1 text-slate-800">{typeLabel[metric.type] ?? metric.type}</p></div><div><p className="text-xs text-slate-500">单位</p><p className="mt-1 text-slate-800">{metric.unit || "-"}</p></div></div>
          <label className="block text-sm font-medium text-slate-700">指标说明<Textarea className="mt-2 min-h-24 font-normal" placeholder="描述指标的业务含义。例如“GMV（扣内购）是剔除内部购买订单后的商品成交金额”。" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="block text-sm font-medium text-slate-700">别名（逗号分隔）<Input className="mt-2 font-normal" placeholder="填写常用简称、同义名称或英文名。例如“成交额, Gross Merchandise Value”。" value={form.aliases} onChange={(event) => setForm((current) => ({ ...current, aliases: event.target.value }))} /></label>
          <label className="block text-sm font-medium text-slate-700">数据来源<Input className="mt-2 font-normal" placeholder="填写指标的数据来源。例如“订单明细表、支付流水表”。" value={form.dataSource} onChange={(event) => setForm((current) => ({ ...current, dataSource: event.target.value }))} /></label>
        </>}
      </div>
      <DialogFooter className="border-t border-slate-100 px-6 py-4"><DialogClose asChild><Button variant="outline">取消</Button></DialogClose><Button disabled={!metric || saving} onClick={() => void save()}><Save className="h-4 w-4" />{saving ? "保存中…" : "保存"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
