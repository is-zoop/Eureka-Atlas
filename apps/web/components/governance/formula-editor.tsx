"use client";

import { acceptCompletion, autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

export type FormulaEditorField = { id: string; name: string; dataType?: string; comment?: string | null };
export type FormulaInsertion = { revision: number; field: string } | null;
const functions = ["SUM", "COUNT", "AVG", "MIN", "MAX", "IF", "NULLIF", "COALESCE", "ROUND", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST"];

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
        sql(),
        history(),
        keymap.of([{ key: "Tab", run: acceptCompletion }, ...defaultKeymap, ...historyKeymap]),
        autocompletion({ override: [complete], activateOnTyping: true }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) cursorPosition.current = update.state.selection.main.head;
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { minHeight: "2rem", fontFamily: "inherit", fontSize: "13px" },
          ".cm-content": { padding: "6px 8px", fontFamily: "inherit" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-focused": { outline: "none" },
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
    const prefix = position > 0 && !/\s$/.test(current.state.doc.sliceString(0, position)) ? " " : "";
    const nextPosition = position + prefix.length + insertion.field.length;
    current.dispatch({ changes: { from: position, to: position, insert: `${prefix}${insertion.field}` }, selection: { anchor: nextPosition } });
    cursorPosition.current = nextPosition;
    current.focus();
  }, [insertion]);
  return <div className={`min-w-72 rounded-lg border bg-white ${error ? "border-rose-400" : "border-slate-300"}`}><div ref={host} />{error && <p className="border-t border-rose-100 bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}</div>;
}
