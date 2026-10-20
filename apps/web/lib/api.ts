// Browser requests stay on the current origin; Next.js proxies them to the API.
const API_BASE_URL = "/api";
export const AUTH_UNAUTHORIZED_EVENT = "eureka-atlas:unauthorized";
export const AUTH_REVALIDATE_EVENT = "eureka-atlas:revalidate-auth";
export const AUTH_ACCOUNT_CHANGED_EVENT = "eureka-atlas:account-changed";
let generation = 0;
const active = new Set<AbortController>();

export function invalidateApiRequests() {
  generation++;
  active.forEach(controller => controller.abort());
  active.clear();
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const ticket = generation;
  const controller = new AbortController();
  const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  active.add(controller);
  const assertCurrent = () => {
    if (ticket !== generation || signal.aborted) throw new DOMException("请求已失效", "AbortError");
  };
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, { ...options, signal, headers, credentials: "same-origin", cache: "no-store" });
    } catch (cause) {
      assertCurrent();
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw new Error("网络连接失败，请稍后重试。");
    }
    assertCurrent();
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      assertCurrent();
      const detail = Array.isArray(body.message) ? body.message.filter((item: unknown) => typeof item === "string").join("；") : typeof body.message === "string" ? body.message : "";
      const messages: Record<number, string> = {
        400: "提交的信息不符合要求，请检查后重试。",
        401: "登录已失效，请重新登录。",
        403: "没有权限执行此操作。",
        404: "请求的数据不存在或已失效。",
        409: "当前状态已发生变化，请重新加载后重试。",
        429: "请求过于频繁，请稍后重试。",
        502: "上游服务暂时不可用，请稍后重试。",
        503: "服务暂时不可用，请稍后重试。",
        504: "请求超时，请稍后重试。",
      };
      const message = /[\u3400-\u9fff]/u.test(detail) ? detail : messages[response.status] ?? `请求失败（HTTP ${response.status}），请稍后重试。`;
      const error = new Error(message);
      Object.assign(error, body, { message, status: response.status });
      if (response.status === 401 && path !== "/auth/login") {
        // A business/upstream 401 does not prove that the Atlas session expired.
        // Only the dedicated session endpoint can confirm it.
        window.dispatchEvent(new Event(path === "/auth/me" ? AUTH_UNAUTHORIZED_EVENT : AUTH_REVALIDATE_EVENT));
      }
      throw error;
    }
    const body = await response.text();
    assertCurrent();
    return (body ? JSON.parse(body) : null) as T;
  } finally {
    active.delete(controller);
  }
}
