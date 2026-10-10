export const ASK_EXECUTION_LIMITS = {
  segmentModels: 24, segmentTools: 48, totalModels: 60, totalTools: 120,
  timeoutMs: 15 * 60 * 1000,
} as const;

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + stable(object[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
};
const readTools = new Set(["search_semantic_assets", "get_semantic_package", "get_dimension_values", "query_data"]);

export class AskExecutionGuard {
  totalModels: number;
  totalTools: number;
  reason: string | null = null;
  private segmentModels = 0;
  private segmentTools = 0;
  private lastCall = "";
  private lastResult = "";
  private repeats = 0;

  constructor(previousModels = 0, previousTools = 0) {
    this.totalModels = previousModels;
    this.totalTools = previousTools;
  }

  stop(reason: string) { this.reason ??= reason; }
  modelStarted() {
    if (this.reason) return;
    if (++this.totalModels > ASK_EXECUTION_LIMITS.totalModels) this.stop("已停止：达到整轮模型调用上限（60 次，含澄清前后），请缩小查询范围后重新提问。");
    else if (++this.segmentModels > ASK_EXECUTION_LIMITS.segmentModels) this.stop("已停止：达到本次执行段的模型调用上限（24 次），尚未完成查询。");
  }
  toolStarted(name: string, args: unknown) {
    if (this.reason) return;
    if (++this.totalTools > ASK_EXECUTION_LIMITS.totalTools) this.stop("已停止：达到整轮工具调用上限（120 次，含澄清前后）。");
    else if (++this.segmentTools > ASK_EXECUTION_LIMITS.segmentTools) this.stop("已停止：达到本次执行段的工具调用上限（48 次）。");
    else if (this.repeats >= 3 && this.lastCall === stable([name, args])) this.stop(`已停止：工具 ${name} 使用相同参数连续重复且无新进展；已提醒调整，但仍再次重复。`);
  }
  toolFinished(name: string, args: unknown, result: { details?: unknown; content?: unknown }, isError: boolean): string | undefined {
    if (this.reason) return;
    if (!readTools.has(name)) { this.lastCall = ""; this.repeats = 0; return; }
    const details = result.details as Record<string, unknown> | undefined;
    // Query IDs change on each execution; compare actual returned data instead.
    const outcome = isError ? result.content : (name === "query_data" || name === "get_dimension_values") && details
      ? { columns: details.columns, rows: details.rows, row_count_returned: details.row_count_returned,
        result_complete: details.result_complete, content_version: details.content_version, snapshot_date: details.snapshot_date }
      : details ?? result.content;
    const call = stable([name, args]);
    const fingerprint = stable([isError, outcome]);
    this.repeats = call === this.lastCall && fingerprint === this.lastResult ? this.repeats + 1 : 1;
    this.lastCall = call;
    this.lastResult = fingerprint;
    if (this.repeats === 3) return `工具 ${name} 已连续 3 次使用相同参数且没有新进展。请复用已取得的信息，或调整筛选/检索参数；再次原样调用将停止。不要重复搜索已经确定的表。`;
  }
  timedOut() { this.stop("已停止：本次执行段超过 15 分钟查询超时；等待用户澄清的时间不计入此超时。"); }
}
