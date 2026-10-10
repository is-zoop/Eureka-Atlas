"use client";

import { useRef, useState } from "react";
import type { AskClarification, AskClarificationRequest } from "@eureka-atlas/types";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  clarification: AskClarification;
  onSubmit: (answer: AskClarificationRequest) => Promise<void>;
};

/** The parent keys this component by session/run/clarification ID to isolate drafts. */
export function ClarificationCard({ clarification, onSubmit }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const questionId = "clarification-" + clarification.id;
  const inputId = questionId + "-custom";
  const multiple = clarification.selection_mode === "multiple";
  const empty = !selectedIds.length && !customText.trim();

  const submit = async () => {
    if (submittingRef.current || empty) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        clarification_id: clarification.id,
        selected_option_ids: clarification.options.filter((option) => selectedIds.includes(option.id)).map((option) => option.id),
        custom_text: customText.trim(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交澄清失败，请重试");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  const cards = clarification.options.map((option) => (
    <Tooltip key={option.id}>
      <TooltipTrigger asChild>
        <span className="block min-w-0">
          <ToggleGroupItem
            value={option.id}
            aria-label={option.id + "：" + option.summary + "，" + option.description}
            className="h-auto min-h-0 w-full items-start justify-start gap-3 rounded-lg border px-3 py-2 text-left font-normal first:rounded-l-lg last:rounded-r-lg not-first:border-l hover:bg-slate-50 data-[state=on]:border-blue-400 data-[state=on]:bg-blue-50 data-[state=on]:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
          >
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm font-medium text-slate-600">{option.id}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-6 text-slate-900">{option.summary}</span>
              <span className="mt-1 block truncate text-xs leading-[1.6] text-slate-500">{option.description}</span>
            </span>
            <span className="flex size-5 shrink-0 items-center justify-center">
              {selectedIds.includes(option.id) && <Check aria-hidden="true" className="size-4 text-blue-600" />}
            </span>
          </ToggleGroupItem>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap break-words text-xs leading-[1.6]">{option.description}</TooltipContent>
    </Tooltip>
  ));
  const groupClass = "mt-3 grid grid-cols-1 items-stretch gap-2";
  return (
    <TooltipProvider delayDuration={300}>
      <Card className="rounded-xl p-4 shadow-none">
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-labelledby={questionId}>
          <p id={questionId} className="text-sm font-medium leading-[1.6] text-slate-900">需要你确认：{clarification.question}</p>
          <p className="mt-1 text-xs text-slate-500">{multiple ? "可多选" : "单选"}</p>
          {cards.length > 0 && (multiple ? (
            <ToggleGroup type="multiple" value={selectedIds} onValueChange={setSelectedIds} disabled={submitting} aria-labelledby={questionId} className={groupClass}>{cards}</ToggleGroup>
          ) : (
            <ToggleGroup type="single" value={selectedIds[0] ?? ""} onValueChange={(id) => setSelectedIds(id ? [id] : [])} disabled={submitting} aria-labelledby={questionId} className={groupClass}>{cards}</ToggleGroup>
          ))}
          <div className="mt-3">
            <label htmlFor={inputId} className="mb-2 block text-xs text-slate-500">补充说明或输入自己的回答</label>
            <Textarea rows={1} id={inputId} value={customText} onChange={(event) => setCustomText(event.target.value)} disabled={submitting} placeholder="补充说明或输入自己的回答" className="min-h-0 resize-y text-sm leading-5" />
          </div>
          {error && <p role="alert" className="mt-2 text-xs leading-[1.6] text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end">
            <Button type="submit" size="sm" disabled={empty || submitting}>
              {submitting && <Loader2 aria-hidden="true" className="mr-1 size-4 animate-spin" />}
              {submitting ? "提交中…" : "继续"}
            </Button>
          </div>
        </form>
      </Card>
    </TooltipProvider>
  );
}