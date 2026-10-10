import type { AskProcessingDetails, AskProcessingStep } from "@eureka-atlas/types" with { "resolution-mode": "import" };

export const toolLabels: Record<string, string> = {
  search_semantic_assets: "搜索资产",
  get_semantic_package: "读取语义",
  get_dimension_values: "查询候选值",
  query_data: "执行查询",
  present_query_results: "整理最终结果",
  request_clarification: "请求澄清",
};

/** Only fixed labels and scalar counts enter the public processing summary. */
export function toolSummary(name: string, details: unknown, failed: boolean): string {
  if (failed) return "处理失败，请查看运行或查询错误提示";
  const value = details && typeof details === "object" ? details as Record<string, unknown> : {};
  if (name === "search_semantic_assets") return `发现 ${Number(value.total) || 0} 张候选表`;
  if (name === "get_semantic_package") return "已读取正式语义及消费版本";
  if (name === "request_clarification") return "等待用户确认后继续";
  if (name === "present_query_results") return "已选定回答问题的最终结果" + (Array.isArray(value.charts) && value.charts.length ? " · 已生成 " + value.charts.length + " 张图表" : "");
  if (name === "query_data" || name === "get_dimension_values") return `已保存 ${Number(value.row_count_returned) || 0} 行结果${value.result_complete === false ? "（返回结果已截断）" : ""}`;
  return "处理完成";
}

export function finalQueryIds(messages: Array<{ role: string; content: unknown }>, savedQueryIds: string[]): string[] {
  const saved = new Set(savedQueryIds);
  for (const message of [...messages].reverse()) {
    const content = message.content as { toolName?: string; isError?: boolean; details?: { query_ids?: unknown } } | null;
    if (message.role !== "TOOL" || content?.toolName !== "present_query_results" || content.isError) continue;
    const ids = content.details?.query_ids;
    if (Array.isArray(ids)) return [...new Set(ids.filter((id): id is string => typeof id === "string" && saved.has(id)))];
  }
  return [];
}

export function processingDetails(messageCount: number, events: Array<{ type: string; payload: unknown }>, status: string, completedAt: Date | null, messageToolCallIds: string[] = []): AskProcessingDetails {
  const steps = new Map<string, AskProcessingStep>();
  for (const event of events) {
    if (event.type !== "processing") continue;
    const step = (event.payload as { step?: AskProcessingStep })?.step;
    if (step?.id) steps.set(step.id, step);
  }
  const items = [...steps.values()].map((step) => {
    if (step.status !== "RUNNING" || ["RUNNING", "CANCELLING"].includes(status)) return step;
    return { ...step, status: "FAILED" as const, summary: "处理未完成", completed_at: completedAt?.toISOString() ?? null };
  });
  return { message_count: messageCount, tool_count: new Set([...messageToolCallIds, ...items.filter((step) => step.kind === "tool").map((step) => step.tool_call_id!)]).size, steps: items };
}
