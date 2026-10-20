// Independent selection authorization: never dispatch workbench login events or use its Cookie helper.
export async function agentSelectionRequest<T>(
  viewId: string,
  suffix = "",
  options: RequestInit = {},
): Promise<T> {
  if (!/^[a-f0-9-]{36}$/i.test(viewId) || !["", "/exchange"].includes(suffix))
    throw new Error("选数窗口标识无效，请从 Agent 重新打开。");
  let response: Response;
  try {
    response = await fetch(
      `/api/integrations/selection-browser/${viewId}${suffix}`,
      {
        ...options,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: options.signal ?? AbortSignal.timeout(20000),
      },
    );
  } catch {
    throw new Error("选数服务连接失败，请重试；不需要重新进行网页登录。");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body?.message === "string" ? body.message : "";
    const messages: Record<number, string> = {
      401: "个人凭证或选数授权已失效，请在客户端更新凭证后让 Agent 重新打开；已保存范围不会清空。",
      403: "当前凭证无权访问此选数范围。",
      409: "选数范围已经修改，请重新读取并确认后保存。",
      429: "请求过于频繁，请稍后重试。",
      503: "身份校验服务暂时不可用，请重试，不需要重新登录。",
    };
    const error = new Error(
      messages[response.status] ??
        (/[^\x00-\x7f]/.test(detail) ? detail : "选数请求失败，请稍后重试。"),
    );
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body as T;
}
