export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

// Same-origin only. Cookies stay HttpOnly; no access token enters the add-in.
export const api: Api = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("接口路径无效");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      credentials: "include", cache: "no-store", redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: unknown } | null;
      const message = typeof body?.message === "string" ? body.message : response.status === 401 ? "登录已失效，请重新登录" : response.status === 503 ? "Atlas 或登录服务暂时不可用，请重试" : "请求失败，请重试";
      throw new ApiError(response.status, message);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiError || options.signal?.aborted) throw error;
    throw new ApiError(503, "无法连接 Atlas，请确认 API 和加载项服务正在运行后重试");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
};
