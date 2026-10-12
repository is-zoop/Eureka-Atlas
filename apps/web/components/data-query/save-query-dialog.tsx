"use client";

import { LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SaveQueryDialog({ open, onOpenChange, name, onNameChange, existing, saving, error, onSave }: {
  open: boolean; onOpenChange: (open: boolean) => void; name: string; onNameChange: (name: string) => void;
  existing: boolean; saving: boolean; error: string; onSave: (asNew: boolean) => void;
}) {
  const length = Array.from(name.trim()).length;
  const valid = length > 0 && length <= 60;
  return <Dialog open={open} onOpenChange={value => { if (!saving) onOpenChange(value); }}>
    <DialogContent className="max-w-md" showCloseButton={!saving}>
      <DialogHeader><DialogTitle>保存查询</DialogTitle><DialogDescription>保存数据集、字段、筛选和排序配置，不执行查询或保存结果。</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (valid && !saving) onSave(false); }} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="saved-query-name">查询名称</Label><Input id="saved-query-name" autoFocus value={name} disabled={saving} onChange={event => onNameChange(event.target.value)} placeholder="例如：近 7 天销售汇总" aria-invalid={length > 60} /><p className={length > 60 ? "text-xs text-rose-600" : "text-xs text-slate-400"}>名称为 1～60 个字符；相对日期将在每次查询时重新计算。</p></div>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <DialogFooter className="flex-wrap"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button>{existing && <Button type="button" variant="outline" disabled={!valid || saving} onClick={() => onSave(true)}>另存为新查询</Button>}<Button type="submit" disabled={!valid || saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{existing ? "保存修改" : "保存"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
