"use client";

import { useRef, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Table } from "@/components/ui/table";
import { TableCopyButton, toTsv } from "./table-copy-button";

function MarkdownTable({ children, ...props }: ComponentPropsWithoutRef<"table">) {
  const table = useRef<HTMLTableElement>(null);
  return <div className="ask-table-wrap">
    <TableCopyButton text={() => toTsv(Array.from(table.current?.rows ?? [], (row) => Array.from(row.cells, (cell) => cell.textContent ?? "")))} />
    <Table {...props} ref={table} containerClassName="ask-table-scroll h-auto rounded-none border-0" className="ask-data-table">{children}</Table>
  </div>;
}

export function AnswerMarkdown({ children, omitTables = false }: { children: string; omitTables?: boolean }) {
  return <div className="ask-markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={omitTables ? ["table"] : undefined} components={{
      table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
      a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
    }}>{children}</ReactMarkdown>
  </div>;
}
