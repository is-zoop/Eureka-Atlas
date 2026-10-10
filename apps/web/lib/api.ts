// Browser requests stay on the current origin; Next.js proxies them to the API.
const API_BASE_URL = "/api";
export const AUTH_UNAUTHORIZED_EVENT = "eureka-atlas:unauthorized";
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
      const error = new Error(body.message ?? `Request failed (${response.status})`);
      Object.assign(error, body, { status: response.status });
      if (response.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
      throw error;
    }
    const body = await response.text();
    assertCurrent();
    return (body ? JSON.parse(body) : null) as T;
  } finally {
    active.delete(controller);
  }
}
