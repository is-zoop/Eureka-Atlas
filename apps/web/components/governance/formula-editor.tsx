"use client";

import { acceptCompletion, autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type FormulaEditorField = { id: string; name: string; dataType?: string; comment?: string | null };
export type FormulaInsertion = { revision: number; field: string } | null;
const functions = ["SUM", "COUNT", "AVG", "MIN", "MAX", "IF", "NULLIF", "COALESCE", "ROUND", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST"];
const formulaHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#7c3aed" },
  { tag: tags.standard(tags.name), color: "#2563eb" },
  { tag: tags.string, color: "#15803d" },
  { tag: tags.number, color: "#b45309" },
  { tag: tags.operator, color: "#475569" },
  { tag: tags.paren, color: "#64748b" },
]);

const formulaTheme = EditorView.theme({
  "&": { height: "2rem", minHeight: "2rem", boxSizing: "border-box", fontFamily: "var(--font-sans)", fontSize: "13px" },
  "&.cm-focused": { outline: "none !important" },
  ".cm-content": { padding: "6px 12px", fontFamily: "var(--font-sans)", outline: "none" },
  ".cm-content:focus": { outline: "none" },
  ".cm-scroller": { overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" },
  ".cm-scroller::-webkit-scrollbar": { display: "none" },
  ".cm-focused": { outline: "none" },
  ".cm-tooltip": { border: "1px solid #e2e8f0", borderRadius: "0.5rem", backgroundColor: "#fff", boxShadow: "0 10px 15px -3px rgb(15 23 42 / 0.12)", overflow: "hidden" },
  ".cm-tooltip-autocomplete": { maxHeight: "280px !important", overflowY: "auto !important", fontFamily: "var(--font-sans) !important", fontSize: "13px !important", scrollbarWidth: "thin", scrollbarColor: "#cbd5e1 transparent" },
  ".cm-tooltip-autocomplete > ul": { maxHeight: "none !important", padding: "0.25rem", fontFamily: "var(--font-sans) !important", fontSize: "13px !important", lineHeight: "1rem" },
  ".cm-tooltip-autocomplete > ul::-webkit-scrollbar": { width: "8px" },
  ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-track": { backgroundColor: "transparent" },
  ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb": { backgroundColor: "#cbd5e1", border: "2px solid transparent", borderRadius: "9999px", backgroundClip: "content-box" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "0.375rem 0.5rem", borderRadius: "0.25rem", color: "#334155", fontFamily: "var(--font-sans) !important", fontSize: "13px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#f1f5f9", color: "#0f172a" },
  ".cm-tooltip-autocomplete .cm-completionDetail": { color: "#94a3b8", fontStyle: "normal", fontSize: "12px !important", lineHeight: "1rem", marginLeft: "0.5rem" },
});

const formulaDisplayTheme = EditorView.theme({
  "&": { height: "1.25rem", minHeight: "0", fontFamily: "var(--font-sans)", fontSize: "13px" },
  "&.cm-focused": { outline: "none !important" },
  ".cm-content, .cm-line": { padding: "0", whiteSpace: "pre", fontFamily: "var(--font-sans)", fontSize: "13px !important", lineHeight: "1.25rem" },
  ".cm-scroller": { overflow: "hidden" },
  ".cm-focused": { outline: "none" },
});

export function FormulaEditor({ value, onChange, fields, insertion, error }: { value: string; onChange: (value: string) => void; fields: FormulaEditorField[]; insertion: FormulaInsertion; error?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const fieldsRef = useRef(fields);
  const initialValue = useRef(value);
  const cursorPosition = useRef(0);
  useEffect(() => {
    onChangeRef.current = onChange;
    fieldsRef.current = fields;
  }, [fields, onChange]);
  useEffect(() => {
    if (!host.current) return;
    const complete = (context: CompletionContext) => {
      const before = context.matchBefore(/[A-Za-z_]*/);
      if (!before || (before.from === before.to && !context.explicit)) return null;
      return {
        from: before.from,
        options: [
          ...functions.map((name) => ({ label: name, type: "function", apply: `${name}()` })),
          ...fieldsRef.current.map((field) => ({ label: field.name, type: "variable", detail: field.dataType, info: field.comment || "当前已选物理字段" })),
        ],
      };
    };
    const state = EditorState.create({
      doc: initialValue.current,
      extensions: [
        sql({ dialect: PostgreSQL }),
        syntaxHighlighting(formulaHighlight),
        history(),
        keymap.of([{ key: "Tab", run: acceptCompletion }, ...defaultKeymap, ...historyKeymap]),
        autocompletion({ override: [complete], activateOnTyping: true }),
        formulaTheme,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) cursorPosition.current = update.state.selection.main.head;
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    cursorPosition.current = state.selection.main.head;
    view.current = new EditorView({ state, parent: host.current });
    return () => { view.current?.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value)
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    const current = view.current;
    if (!current || !insertion) return;
    const position = Math.min(cursorPosition.current, current.state.doc.length);
    const nextPosition = position + insertion.field.length;
    current.dispatch({ changes: { from: position, to: position, insert: insertion.field }, selection: { anchor: nextPosition } });
    cursorPosition.current = nextPosition;
    current.focus();
  }, [insertion]);
  return <TooltipProvider delayDuration={0}><Tooltip open={Boolean(error)}><TooltipTrigger asChild><div className="min-w-72"><div className={`h-8 rounded-lg border bg-white shadow-sm transition-[border-color,box-shadow] focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20 ${error ? "border-rose-400" : "border-slate-300"}`}><div ref={host} /></div></div></TooltipTrigger>{error && <TooltipContent side="bottom" align="start" className="border border-rose-200 bg-rose-50 text-rose-700">{error}</TooltipContent>}</Tooltip></TooltipProvider>;
}

export function FormulaDisplay({ value }: { value: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [sql({ dialect: PostgreSQL }), syntaxHighlighting(formulaHighlight), EditorState.readOnly.of(true), EditorView.editable.of(false), formulaDisplayTheme],
      }),
      parent: host.current,
    });
    return () => view.destroy();
  }, [value]);
  return <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><div className="max-w-[48rem] overflow-hidden"><div ref={host} /></div></TooltipTrigger><TooltipContent side="top" align="start" className="break-all">{value}</TooltipContent></Tooltip></TooltipProvider>;
}
