import { ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { AuthUser } from "@eureka-atlas/types" with { "resolution-mode": "import" };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ServiceUnavailableException("Haze 登录服务响应异常，请稍后重试。");
  return value as Record<string, unknown>;
}

@Injectable()
export class HazeAuthService {
  private async request(path: string, options: RequestInit, login = false): Promise<unknown> {
    const origin = process.env.HAZE_API_ORIGIN?.trim().replace(/\/+$/, "");
    if (!origin) throw new ServiceUnavailableException("未配置 HAZE_API_ORIGIN，无法连接 Haze 登录服务。");
    let response: Response;
    let payload: Record<string, unknown>;
    try {
      response = await fetch(`${origin}/api/auth/${path}`, { ...options, redirect: "error", signal: AbortSignal.timeout(10_000) });
      payload = object(await response.json());
    } catch {
      throw new ServiceUnavailableException("Haze 登录服务暂时不可用，请稍后重试。");
    }
    if (response.status === 401) throw new UnauthorizedException(login ? "手机号或密码错误，请重试。" : "登录已失效，请重新登录。");
    if (response.status === 403) {
      if (login) throw new ForbiddenException("账号已停用，请联系管理员。");
      throw new UnauthorizedException("登录已失效，请重新登录。");
    }
    if (!response.ok || payload.code !== 0) throw new ServiceUnavailableException("Haze 登录服务响应异常，请稍后重试。");
    return payload.data;
  }

  private user(value: unknown): AuthUser {
    const user = object(value);
    for (const key of ["member_no", "name", "phone", "department", "status"]) {
      if (typeof user[key] !== "string") throw new ServiceUnavailableException("Haze 用户资料响应异常，请稍后重试。");
    }
    if (user.status !== "active") throw new UnauthorizedException("登录已失效，请重新登录。");
    return {
      member_no: user.member_no as string, name: user.name as string, phone: user.phone as string,
      department: user.department as string, status: "active",
      email: typeof user.email === "string" ? user.email : null,
      avatar_url: typeof user.avatar_url === "string" ? user.avatar_url : null,
    };
  }

  async login(phone: string, password: string) {
    const data = object(await this.request("login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password }) }, true));
    if (typeof data.access_token !== "string" || !data.access_token || !Number.isSafeInteger(data.expires_in) || Number(data.expires_in) <= 0 || !Number.isFinite(new Date(Date.now() + Number(data.expires_in) * 1000).getTime())) {
      throw new ServiceUnavailableException("Haze 登录服务响应异常，请稍后重试。");
    }
    return { token: data.access_token, expiresIn: Number(data.expires_in), user: this.user(data.user) };
  }

  async me(token: string): Promise<AuthUser> {
    return this.user(await this.request("me", { headers: { Authorization: `Bearer ${token}` } }));
  }
}
