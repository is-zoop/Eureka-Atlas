"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export { toTsv } from "./table-copy";

export function TableCopyButton({ text }: { text: () => string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setError(""); setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch { setError("复制失败，请检查浏览器剪贴板权限后重试"); }
  };
  return <div className="ask-table-copy">
    <Button size="icon-sm" variant="ghost" title={copied ? "已复制" : "复制表格"} aria-label={copied ? "已复制表格" : "复制表格"} onClick={() => void copy()}>{copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}</Button>
    {error && <span role="alert" className="ask-copy-error">{error}</span>}
  </div>;
}
