"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { FloatingAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

type ListKey = "dataDomains" | "permissionRelations";
type OptionRecord = { id: string; value: string; description: string; createdAt: string; updatedAt: string; updatedBy: string };
type GovernanceOptionRecords = Record<ListKey, OptionRecord[]>;
type Editing = { key: ListKey; item?: OptionRecord };
const labels: Record<ListKey, { add: string; type: "DATA_DOMAIN" | "PERMISSION_RELATION" }> = {
  dataDomains: { add: "添加数据域", type: "DATA_DOMAIN" },
  permissionRelations: { add: "添加映射关系", type: "PERMISSION_RELATION" },
};
const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false, timeZone: "UTC" });
const formatDate = (value: string) => dateTime.format(new Date(value));

export default function SettingsPage() {
  const [records, setRecords] = useState<GovernanceOptionRecords | null>(null);
  const [activeKey, setActiveKey] = useState<ListKey>("dataDomains");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<OptionRecord | null>(null);
  const [form, setForm] = useState({ value: "", description: "" });
  const [working, setWorking] = useState(false);
  const load = async () => {
    try { setRecords(await api<GovernanceOptionRecords>("/settings/governance-options")); }
    catch (cause) { setMessage({ error: true, text: cause instanceof Error ? cause.message : "加载配置失败" }); }
  };
  useEffect(() => {
    let cancelled = false;
    void api<GovernanceOptionRecords>("/settings/governance-options")
      .then((value) => { if (!cancelled) setRecords(value); })
      .catch((cause: Error) => { if (!cancelled) setMessage({ error: true, text: cause.message }); });
    return () => { cancelled = true; };
  }, []);
  const openCreate = (key: ListKey) => { setForm({ value: "", description: "" }); setEditing({ key }); };
  const openEdit = (key: ListKey, item: OptionRecord) => { setForm({ value: item.value, description: item.description }); setEditing({ key, item }); };
  const save = async () => {
    if (!editing) return;
    const value = form.value.trim();
    if (!value) { setMessage({ error: true, text: "字段不能为空" }); return; }
    setWorking(true);
    try {
      if (editing.item) await api(`/settings/governance-options/${editing.item.id}`, { method: "PATCH", body: JSON.stringify({ value, description: form.description.trim() }) });
      else await api("/settings/governance-options", { method: "POST", body: JSON.stringify({ type: labels[editing.key].type, value, description: form.description.trim() }) });
      setEditing(null); setMessage({ error: false, text: editing.item ? "配置已更新。" : "配置已添加。" }); await load();
    } catch (cause) { setMessage({ error: true, text: cause instanceof Error ? cause.message : "保存失败" }); }
    finally { setWorking(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setWorking(true);
    try { await api(`/settings/governance-options/${deleting.id}`, { method: "DELETE" }); setDeleting(null); setMessage({ error: false, text: "配置已删除。" }); await load(); }
    catch (cause) { setMessage({ error: true, text: cause instanceof Error ? cause.message : "删除失败" }); }
    finally { setWorking(false); }
  };
  if (!records) return <main className="flex h-[calc(100vh-104px)] min-h-0 flex-col overflow-hidden"><div className="flex h-full min-h-0 flex-1 items-center justify-center p-4 text-sm text-slate-500">正在加载配置…</div></main>;
  return <main className="flex h-[calc(100vh-104px)] min-h-0 flex-col overflow-hidden">
    {message && <FloatingAlert type={message.error ? "error" : "success"}>{message.text}</FloatingAlert>}
    <Tabs value={activeKey} onValueChange={(value) => setActiveKey(value as ListKey)} className="flex h-full min-h-0 flex-1 flex-col p-4">
      <div className="flex items-center justify-between gap-3"><TabsList><TabsTrigger value="dataDomains">数据域配置</TabsTrigger><TabsTrigger value="permissionRelations">权限映射关系配置</TabsTrigger></TabsList><Button type="button" size="sm" onClick={() => openCreate(activeKey)}><Plus className="size-3.5" />{labels[activeKey].add}</Button></div>
      {(Object.keys(labels) as ListKey[]).map((key) => <TabsContent key={key} value={key} className="mt-3 min-h-0 flex-1 overflow-hidden data-[state=active]:flex">
        <div className="min-h-0 flex-1 overflow-hidden"><Table className="min-w-[820px]">
            <thead><tr><TableHead>字段</TableHead><TableHead>描述</TableHead><TableHead>创建时间</TableHead><TableHead>修改时间</TableHead><TableHead>最后修改人</TableHead><TableHead className="w-32">操作</TableHead></tr></thead>
            <tbody>{records[key].length ? records[key].map((item) => <tr key={item.id} className="hover:bg-slate-50"><TableCell className="font-medium text-slate-900">{item.value}</TableCell><TableCell className="max-w-[280px] whitespace-pre-wrap">{item.description || "-"}</TableCell><TableCell className="whitespace-nowrap">{formatDate(item.createdAt)}</TableCell><TableCell className="whitespace-nowrap">{formatDate(item.updatedAt)}</TableCell><TableCell>{item.updatedBy}</TableCell><TableCell><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => openEdit(key, item)}><Pencil className="size-3.5" />编辑</Button><Button type="button" size="sm" variant="outline" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setDeleting(item)}><Trash2 className="size-3.5" />删除</Button></div></TableCell></tr>) : <tr><TableCell colSpan={6} className="py-10 text-center text-slate-500">暂无配置项</TableCell></tr>}</tbody>
          </Table></div>
      </TabsContent>)}
    </Tabs>
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && !working && setEditing(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{editing?.item ? "编辑配置" : "添加配置"}</DialogTitle><DialogDescription>字段不能为空，同一配置类型下不能重复。</DialogDescription></DialogHeader><div className="space-y-4"><Field><FieldLabel>字段</FieldLabel><Input autoFocus value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} placeholder="请输入字段" /></Field><Field><FieldLabel>描述</FieldLabel><Textarea className="min-h-24" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="请输入描述（可选）" /></Field></div><DialogFooter><Button type="button" variant="outline" disabled={working} onClick={() => setEditing(null)}>取消</Button><Button type="button" disabled={working} onClick={() => void save()}><Save className="size-4" />{working ? "保存中…" : "保存"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && !working && setDeleting(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>删除配置</DialogTitle><DialogDescription>删除“{deleting?.value}”后，历史治理记录会保留该值，但不能再用于新的选择或 AI 建议。</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" disabled={working} onClick={() => setDeleting(null)}>取消</Button><Button type="button" variant="destructive" disabled={working} onClick={() => void remove()}>{working ? "删除中…" : "删除"}</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
