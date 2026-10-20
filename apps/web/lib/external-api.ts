import type { ExternalApiOperation } from "@eureka-atlas/types";

export type ApiTestResult = { status: number; elapsed_ms: number; body: unknown; request_id: string | null; retry_after: string | null };
export function externalPath(operation: Pick<ExternalApiOperation, "path">, params: Record<string, string>) {
  if (!operation.path.startsWith("/api/external/v1/") || /[?#\\]/.test(operation.path)) throw new Error("只能调用 API 目录中的固定开放接口。");
  return operation.path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name] ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`${name} 必须为有效 ID，不是名称或 URL。`);
    return encodeURIComponent(value);
  });
}
export async function callExternalApi(path: string, method: "GET" | "POST", credential: string, body: unknown, signal: AbortSignal): Promise<ApiTestResult> {
  if (!path.startsWith("/api/external/v1/") || /[?#\\]/.test(path) || new URL(path, "https://atlas.invalid").pathname !== path) throw new Error("开放接口地址无效。");
  const key = credential.trim();
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new Error("请填写 Haze 个人凭证，不需要添加 Bearer 前缀。");
  const started = performance.now();
  const timeout = AbortSignal.timeout(20000);
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}), credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, timeout]) });
  } catch (cause) {
    if (signal.aborted) throw new DOMException("已停止等待", "AbortError");
    if (timeout.aborted) throw new Error("HTTP 请求超过 20 秒。后台任务可能仍在执行，请使用原幂等标识重试确认。");
    throw new Error("无法连接开放 API，请检查网络和反向代理配置。");
  }
  let data: unknown;
  try { data = await response.json(); }
  catch {
    if (signal.aborted) throw new DOMException("已停止等待", "AbortError");
    if (timeout.aborted) throw new Error("读取 HTTP 响应超时，请检查任务状态或使用原幂等标识重试。");
    data = { error: { code: "INVALID_RESPONSE", message: "接口未返回 JSON，请检查代理配置。" } };
  }
  signal.throwIfAborted();
  // Deliberately do not use the web api() helper or dispatch login events here.
  const redact = (value: string) => value.replaceAll(key, "[REDACTED]");
  const sanitized = JSON.parse(JSON.stringify(data), (_name, value) => typeof value === "string" ? redact(value) : value);
  return { status: response.status, elapsed_ms: Math.round(performance.now() - started), body: sanitized, request_id: redact(response.headers.get("x-request-id") ?? "") || null, retry_after: redact(response.headers.get("retry-after") ?? "") || null };
}
export function waitForPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("已停止等待", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("已停止等待", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 3000);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function curlExample(operation: ExternalApiOperation, origin: string) {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const url = new URL(externalPath(operation, operation.params_example), origin).href;
  return `curl -X ${operation.method} ${quote(url)} \\\n  -H 'Authorization: Bearer <HAZE_PERSONAL_CREDENTIAL>' \\\n  -H 'Content-Type: application/json'${operation.method === "POST" ? " \\\n  --data " + quote(JSON.stringify(operation.request_example)) : ""}`;
}
