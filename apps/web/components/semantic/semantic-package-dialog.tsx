"use client";

import { foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { keymap, EditorView, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import * as React from "react";
import { AlertTriangle, Clipboard, Download, FileJson, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api";

export type SemanticPackage = {
  schema_version: number;
  content_version: string;
  updated_at: string;
  fields: unknown[];
  metrics: unknown[];
  completeness: { status: "COMPLETE" | "INCOMPLETE"; issues: Array<{ code: string; object_type: string; path: string; message: string; affects: string }> };
  [key: string]: unknown;
};

const jsonHighlight = HighlightStyle.define([{ tag: tags.propertyName, color: "#334155" }, { tag: tags.string, color: "#c2410c" }, { tag: tags.number, color: "#c2410c" }, { tag: tags.bool, color: "#7c3aed" }, { tag: tags.null, color: "#dc2626" }, { tag: tags.punctuation, color: "#64748b" }]);
const jsonTheme = EditorView.theme({ "&": { height: "100%", backgroundColor: "#ffffff", color: "#334155", fontFamily: "var(--font-sans)", fontSize: "12px" }, "&.cm-focused": { outline: "none" }, ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-sans)", lineHeight: "1.65" }, ".cm-content": { padding: "0.75rem", fontFamily: "var(--font-sans)", caretColor: "transparent" }, ".cm-line": { padding: "0" }, ".cm-gutters": { minWidth: "0", backgroundColor: "#ffffff", borderRight: "1px solid #e2e8f0", color: "#94a3b8" }, ".cm-foldGutter": { width: "14px !important", minWidth: "14px !important", margin: "0 !important" }, ".cm-foldGutter .cm-gutterElement": { width: "14px !important", minWidth: "14px !important", padding: "0 !important", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }, ".semantic-json-fold-marker": { display: "block", width: "12px", height: "12px" }, ".cm-lineNumbers": { margin: "0 !important" }, ".cm-lineNumbers .cm-gutterElement": { minWidth: "28px !important", padding: "0 4px 0 0 !important", textAlign: "right", lineHeight: "1.65" } });

function JsonViewer({ value }: { value: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions: [json(), syntaxHighlighting(jsonHighlight), foldGutter({ markerDOM: (open) => { const marker = document.createElement("span"); marker.setAttribute("aria-hidden", "true"); marker.setAttribute("class", "semantic-json-fold-marker"); marker.innerHTML = open ? "⌄" : "›"; return marker; } }), lineNumbers(), keymap.of(foldKeymap), EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false), jsonTheme] }), parent: host.current });
    return () => view.destroy();
  }, [value]);
  return <div ref={host} className="h-full min-h-0" />;
}

export function SemanticPackageDialog({ tableId, label, className, iconOnly = false }: { tableId: string; label: string; className?: string; iconOnly?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SemanticPackage | null>(null);
  const [error, setError] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const load = React.useCallback(() => {
    setData(null); setError("");
    return api<SemanticPackage>("/packages/" + tableId).then(setData).catch((cause: Error) => setError(cause.message.includes("Package") ? "尚未生成或发布 Semantic Package" : cause.message));
  }, [tableId]);
  const value = React.useMemo(() => data ? JSON.stringify(data, null, 2) : "", [data]);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setError("无法复制 JSON，请检查浏览器权限"); } };
  const download = () => { const blob = new Blob([value], { type: "application/json;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = String((data?.table as { name?: string } | undefined)?.name ?? "semantic-package") + ".json"; link.click(); URL.revokeObjectURL(url); };
  const regenerate = async () => { setWorking(true); setError(""); try { setData(await api<SemanticPackage>("/packages/generate/" + tableId, { method: "POST" })); } catch (cause) { setError(cause instanceof Error ? cause.message : "重新生成 Semantic Package 失败"); } finally { setWorking(false); } };
  const incomplete = data?.completeness.status === "INCOMPLETE";
  return <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) void load(); }}><DialogTrigger asChild><Button variant="outline" size={iconOnly ? "icon-sm" : "sm"} className={className} aria-label={label} title={label}><FileJson className={iconOnly ? "h-3.5 w-3.5" : "mr-1.5 h-3.5 w-3.5"} />{!iconOnly && label}</Button></DialogTrigger><DialogContent className="flex h-[80vh] max-w-5xl flex-col overflow-hidden p-6" showCloseButton><DialogHeader><DialogTitle>Semantic Package JSON</DialogTitle></DialogHeader>{data && <div className={incomplete ? "rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" : "rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"}><div className="flex items-center gap-2 font-medium">{incomplete && <AlertTriangle className="h-4 w-4" />}{incomplete ? "语义信息待补充" : "语义信息完整"}</div><p className="mt-1 text-xs opacity-80">内容版本 {data.content_version.slice(0, 12)} · {data.completeness.issues.length} 个问题</p>{incomplete && <ul className="mt-2 max-h-20 list-disc overflow-auto pl-4 text-xs">{data.completeness.issues.map((issue) => <li key={issue.code + issue.path}>{issue.message}（影响：{issue.affects}）</li>)}</ul>}</div>}<div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 px-3 text-[12px] text-slate-600"><FileJson className="h-3.5 w-3.5" /><span>semantic-package.json</span></div><div className="h-[calc(100%-2.5rem)] min-h-0">{data ? error ? <div className="flex h-full items-center justify-center text-sm text-rose-600">{error}</div> : <JsonViewer value={value} /> : <div className="flex h-full items-center justify-center text-sm text-slate-500">{error || "正在加载 JSON…"}</div>}</div></div>{data && <DialogFooter className="shrink-0"><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />刷新内容</Button><Button size="sm" variant="outline" onClick={() => void copy()}><Clipboard className="mr-1.5 h-3.5 w-3.5" />{copied ? "已复制" : "复制 JSON"}</Button><Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 h-3.5 w-3.5" />下载 JSON</Button><Button size="sm" disabled={working} onClick={() => void regenerate()}><RefreshCw className={"mr-1.5 h-3.5 w-3.5 " + (working ? "animate-spin" : "")} />{working ? "生成中…" : "更新快照"}</Button></DialogFooter>}</DialogContent></Dialog>;
}
