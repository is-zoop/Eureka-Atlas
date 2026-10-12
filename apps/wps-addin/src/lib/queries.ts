import type { DataQueryExecution, DataQueryResultPage, SavedDataQueryDetail } from "@eureka-atlas/types";
import type { Api } from "./api.ts";

export type PendingTask = { member: string; savedId: string; queryId: string };
const key = (member: string) => `atlas-wps:pending:${member}`;
export function readPending(storage: Pick<Storage, "getItem">, member: string): PendingTask | null {
  try {
    const item = JSON.parse(storage.getItem(key(member)) ?? "null") as PendingTask | null;
    return item?.member === member && typeof item.savedId === "string" && typeof item.queryId === "string" ? item : null;
  } catch { return null; }
}
export function storePending(storage: Pick<Storage, "setItem">, task: PendingTask) { storage.setItem(key(task.member), JSON.stringify(task)); }
export function clearPending(storage: Pick<Storage, "removeItem">, member: string) { storage.removeItem(key(member)); }

export function shouldResume(selectedId: string | undefined, pending: PendingTask | null): boolean {
  return Boolean(pending && (!selectedId || pending.savedId === selectedId));
}

export async function cancelQuery(request: Api, queryId: string, local: AbortController | null): Promise<DataQueryExecution> {
  // Stop reading before awaiting the cloud cancellation; never reuse the aborted signal for the POST.
  local?.abort();
  return request<DataQueryExecution>(`/data-queries/${encodeURIComponent(queryId)}/cancel`, { method: "POST" });
}

export async function submitSaved(request: Api, savedId: string, signal: AbortSignal, onSaved?: (saved: SavedDataQueryDetail) => void): Promise<DataQueryExecution> {
  const saved = await request<SavedDataQueryDetail>(`/saved-data-queries/${encodeURIComponent(savedId)}`, { signal });
  if (saved.validation_errors.length) throw new Error(`查询配置已失效：${saved.validation_errors.join("；")}。请在 Atlas 中修正后再刷新。`);
  onSaved?.(saved);
  return request<DataQueryExecution>("/data-queries", { method: "POST", signal, body: JSON.stringify({ ...saved.config, idempotency_key: crypto.randomUUID() }) });
}

export function pause(signal: AbortSignal, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("已停止等待", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function waitForResult(request: Api, queryId: string, signal: AbortSignal, progress: (item: DataQueryExecution) => void, sleep = pause): Promise<DataQueryExecution> {
  for (;;) {
    signal.throwIfAborted();
    const item = await request<DataQueryExecution>(`/data-queries/${encodeURIComponent(queryId)}`, { signal });
    progress(item);
    if (item.status === "SUCCEEDED") {
      if (Date.parse(item.expires_at) <= Date.now()) throw new Error("查询结果已过期，请重新执行查询");
      return item;
    }
    if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(item.status)) throw new Error(item.error || `查询未完成：${item.status}`);
    await sleep(signal);
  }
}

export async function readResultPages(request: Api, item: DataQueryExecution, signal: AbortSignal, write: (page: DataQueryResultPage, offset: number) => void): Promise<void> {
  if (!Number.isInteger(item.row_count) || item.row_count < 0 || item.row_count > 200000 || !item.columns.length) throw new Error("结果规模或列定义无效");
  let offset = 0;
  for (let page = 1; page <= Math.max(1, Math.ceil(item.row_count / 500)); page++) {
    signal.throwIfAborted();
    const result = await request<DataQueryResultPage>(`/data-queries/${encodeURIComponent(item.id)}/result?page=${page}&pageSize=500`, { signal });
    if (result.page !== page || result.page_size !== 500 || result.total !== item.row_count || JSON.stringify(result.columns) !== JSON.stringify(item.columns) || result.rows.length !== Math.min(500, item.row_count - offset) || result.rows.some(row => row.length !== item.columns.length)) throw new Error("查询分页不完整，未更新原结果表，请重新读取");
    signal.throwIfAborted();
    write(result, offset);
    offset += result.rows.length;
  }
  if (offset !== item.row_count) throw new Error("结果行数不一致，未更新原结果表");
}
