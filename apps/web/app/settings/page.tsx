"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Save, Settings2, Trash2 } from "lucide-react";
import { FloatingAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

type GovernanceOptions = { dataDomains: string[]; permissionRelations: string[] };
type ListKey = keyof GovernanceOptions;
const labels: Record<ListKey, { title: string; description: string; add: string }> = {
  dataDomains: { title: "数据域配置", description: "用于表语义中的数据域选择及 AI 建议范围。", add: "添加数据域" },
  permissionRelations: { title: "权限映射关系配置", description: "用于权限字段的映射关系选择及 AI 建议范围。", add: "添加映射关系" },
};
const clone = (value: GovernanceOptions): GovernanceOptions => ({ dataDomains: [...value.dataDomains], permissionRelations: [...value.permissionRelations] });

export default function SettingsPage() {
  const [saved, setSaved] = useState<GovernanceOptions | null>(null);
  const [draft, setDraft] = useState<GovernanceOptions | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void api<GovernanceOptions>("/settings/governance-options").then((options) => { setSaved(options); setDraft(clone(options)); }).catch((error: Error) => setMessage({ error: true, text: error.message })); }, []);
  const validation = useMemo(() => {
    if (!draft) return "";
    for (const key of Object.keys(labels) as ListKey[]) {
      const items = draft[key].map((item) => item.trim());
      if (items.some((item) => !item)) return `${labels[key].title}不能包含空值`;
      if (new Set(items).size !== items.length) return `${labels[key].title}不能包含重复项`;
    }
    return "";
  }, [draft]);
  const changed = Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft));
  const updateItem = (key: ListKey, index: number, value: string) => setDraft((current) => current ? { ...current, [key]: current[key].map((item, itemIndex) => itemIndex === index ? value : item) } : current);
  const addItem = (key: ListKey) => setDraft((current) => current ? { ...current, [key]: [...current[key], ""] } : current);
  const removeItem = (key: ListKey, index: number) => setDraft((current) => current ? { ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) } : current);
  const reset = () => { if (saved) { setDraft(clone(saved)); setMessage(null); } };
  const save = async () => {
    if (!draft || validation) { if (validation) setMessage({ error: true, text: validation }); return; }
    setSaving(true);
    try {
      const options = await api<GovernanceOptions>("/settings/governance-options", { method: "PUT", body: JSON.stringify({ dataDomains: draft.dataDomains.map((item) => item.trim()), permissionRelations: draft.permissionRelations.map((item) => item.trim()) }) });
      setSaved(options); setDraft(clone(options)); setMessage({ error: false, text: "治理配置已保存。" });
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "保存失败" }); } finally { setSaving(false); }
  };
  if (!draft) return <main className="mx-auto max-w-3xl py-12 text-center text-sm text-slate-500">正在加载系统设置…</main>;
  return <main className="mx-auto max-w-3xl py-10">
    {message && <FloatingAlert type={message.error ? "error" : "success"}>{message.text}</FloatingAlert>}
    <div className="mb-6 flex items-start gap-3"><Settings2 className="mt-0.5 size-5 text-slate-500" /><div><h1 className="text-lg font-semibold">系统设置</h1><p className="mt-1 text-sm text-slate-500">维护治理任务中的数据域和权限映射关系。</p></div></div>
    <Tabs defaultValue="dataDomains"><TabsList><TabsTrigger value="dataDomains">数据域配置</TabsTrigger><TabsTrigger value="permissionRelations">权限映射关系配置</TabsTrigger></TabsList>
      {(Object.keys(labels) as ListKey[]).map((key) => <TabsContent key={key} value={key} className="mt-4"><section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{labels[key].title}</h2><p className="mt-1 text-sm text-slate-500">{labels[key].description}</p></div><Button type="button" size="sm" variant="outline" onClick={() => addItem(key)}><Plus className="size-3.5" />{labels[key].add}</Button></div><div className="mt-5 space-y-2">{draft[key].length ? draft[key].map((item, index) => <div key={`${key}-${index}`} className="flex items-center gap-2"><Input value={item} onChange={(event) => updateItem(key, index, event.target.value)} aria-label={`${labels[key].title} ${index + 1}`} /><Button type="button" size="icon-sm" variant="outline" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => removeItem(key, index)} aria-label={`删除${item || labels[key].title}`}><Trash2 className="size-4" /></Button></div>) : <p className="rounded-md bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">暂无配置项</p>}</div></section></TabsContent>)}</Tabs>
    <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-200 pt-5"><Button type="button" variant="outline" disabled={!changed || saving} onClick={reset}><RotateCcw className="size-4" />取消更改</Button><Button type="button" disabled={!changed || Boolean(validation) || saving} onClick={() => void save()}><Save className="size-4" />{saving ? "保存中…" : "保存配置"}</Button></div>
    {validation && <p className="mt-3 text-right text-sm text-rose-600">{validation}</p>}
  </main>;
}
