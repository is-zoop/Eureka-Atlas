"use client";

import { foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { keymap, EditorView, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import * as React from "react";
import { Clipboard, Download, FileJson, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api";

type SemanticPackage = {
  table: Record<string, unknown>;
  fields: unknown[];
  metrics: unknown[];
};

const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "#334155" },
  { tag: tags.string, color: "#c2410c" },
  { tag: tags.number, color: "#c2410c" },
  { tag: tags.bool, color: "#7c3aed" },
  { tag: tags.null, color: "#dc2626" },
  { tag: tags.punctuation, color: "#64748b" },
]);
const jsonTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#ffffff", color: "#334155", fontFamily: "var(--font-sans)", fontSize: "12px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-sans)", lineHeight: "1.65" },
  ".cm-content": { padding: "0.75rem", fontFamily: "var(--font-sans)", caretColor: "transparent" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { minWidth: "0", backgroundColor: "#ffffff", borderRight: "1px solid #e2e8f0", color: "#94a3b8" },
  ".cm-foldGutter": { width: "14px !important", minWidth: "14px !important", margin: "0 !important" },
  ".cm-foldGutter .cm-gutterElement": { width: "14px !important", minWidth: "14px !important", padding: "0 !important", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  ".semantic-json-fold-marker": { display: "block", width: "12px", height: "12px" },
  ".cm-lineNumbers": { margin: "0 !important" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "28px !important", padding: "0 4px 0 0 !important", textAlign: "right", lineHeight: "1.65" },
});

function JsonViewer({ value }: { value: string }) {
  const host = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          json(),
          syntaxHighlighting(jsonHighlight),
          foldGutter({ markerDOM: (open) => { const marker = document.createElement("span"); marker.setAttribute("aria-hidden", "true"); marker.setAttribute("class", "semantic-json-fold-marker"); marker.style.position = "relative"; marker.style.top = "0.5px"; marker.style.left = "3px"; marker.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true">${open ? '<path d="M2.5 4.25 6 7.75l3.5-3.5" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />' : '<path d="m4.25 2.5 3.5 3.5-3.5 3.5" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />'}</svg>`; return marker; } }),
          lineNumbers(),
          keymap.of(foldKeymap),
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          jsonTheme,
        ],
      }),
      parent: host.current,
    });
    return () => view.destroy();
  }, [value]);
  return <div ref={host} className="h-full min-h-0" />;
}

export function SemanticPackageDialog({ tableId, label, className }: { tableId: string; label: string; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SemanticPackage | null>(null);
  const [error, setError] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!open || !tableId) return;
    let cancelled = false;
    setData(null);
    setError("");
    void api<SemanticPackage>(`/packages/${tableId}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message.includes("Semantic package not found") ? "尚未生成 Semantic Package" : cause.message); });
    return () => { cancelled = true; };
  }, [open, tableId]);
  const value = React.useMemo(() => data ? JSON.stringify({ table: data.table, fields: data.fields, metrics: data.metrics ?? [] }, null, 2) : "", [data]);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setError("无法复制 JSON，请检查浏览器权限"); } };
  const download = () => { const blob = new Blob([value], { type: "application/json;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${String(data?.table.name ?? "semantic-package")}.json`; link.click(); URL.revokeObjectURL(url); };
  const regenerate = async () => { setWorking(true); setError(""); try { const result = await api<SemanticPackage>(`/packages/generate/${tableId}`, { method: "POST" }); setData(result); } catch (cause) { setError(cause instanceof Error ? cause.message : "重新生成 Semantic Package 失败"); } finally { setWorking(false); } };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" size="sm" className={className}><FileJson className="mr-1.5 h-3.5 w-3.5" />{label}</Button></DialogTrigger><DialogContent className="flex h-[80vh] max-w-5xl flex-col overflow-hidden p-6" showCloseButton><DialogHeader><DialogTitle>Semantic Package JSON</DialogTitle></DialogHeader><div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 px-3 text-[12px] text-slate-600"><FileJson className="h-3.5 w-3.5" /><span>semantic-package.json</span></div><div className="min-h-0 h-[calc(100%-2.5rem)]">{data ? error ? <div className="flex h-full items-center justify-center text-sm text-rose-600">{error}</div> : <JsonViewer value={value} /> : <div className="flex h-full items-center justify-center text-sm text-slate-500">{error || "正在加载 JSON…"}</div>}</div></div>{data && <DialogFooter className="shrink-0"><Button size="sm" variant="outline" onClick={() => void copy()}><Clipboard className="mr-1.5 h-3.5 w-3.5" />{copied ? "已复制" : "复制 JSON"}</Button><Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 h-3.5 w-3.5" />下载 JSON</Button><Button size="sm" disabled={working} onClick={() => void regenerate()}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${working ? "animate-spin" : ""}`} />{working ? "生成中…" : "重新生成"}</Button></DialogFooter>}</DialogContent></Dialog>;
}
