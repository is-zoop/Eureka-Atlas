import { BadRequestException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { AuthRole, AuthUser, PersonalCredentialSecret } from "@eureka-atlas/types" with { "resolution-mode": "import" };

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
    if (response.status === 401 && path === "me/reset-password" && payload.code === 4012) throw new BadRequestException("当前密码不正确，请重试。");
    if (response.status === 400 || response.status === 422) throw new BadRequestException("提交的信息不符合 Haze 要求，请检查后重试。");
    if (response.status === 429) throw new HttpException("操作过于频繁，请稍后重试。", 429);
    if (response.status === 401) throw new UnauthorizedException(login ? "手机号或密码错误，请重试。" : "登录已失效，请重新登录。");
    if (response.status === 403) {
      if (login) throw new ForbiddenException("账号已停用，请联系管理员。");
      if (path === "me" || payload.code === 4031) throw new UnauthorizedException("登录已失效，请重新登录。");
      throw new ForbiddenException("Haze 拒绝了此操作，请检查账号权限。");
    }
    if (!response.ok || payload.code !== 0) throw new ServiceUnavailableException("Haze 登录服务响应异常，请稍后重试。");
    return payload.data;
  }

  private async user(value: unknown): Promise<AuthUser> {
    const { isAuthRole } = await import("@eureka-atlas/types");
    const user = object(value);
    for (const key of ["member_no", "name", "phone", "department", "status", "role_name"]) {
      if (typeof user[key] !== "string") throw new ServiceUnavailableException("Haze 用户资料响应异常，请稍后重试。");
    }
    if (user.status !== "active") throw new UnauthorizedException("登录已失效，请重新登录。");
    if (!isAuthRole(user.role_code)) {
      throw new ForbiddenException("当前 Haze 角色未获授权，请联系系统管理员。");
    }
    return {
      member_no: user.member_no as string, name: user.name as string, phone: user.phone as string,
      department: user.department as string, status: "active",
      role_code: user.role_code as AuthRole, role_name: user.role_name as string,
      email: typeof user.email === "string" ? user.email : null,
      avatar_url: typeof user.avatar_url === "string" ? user.avatar_url : null,
    };
  }

  async login(phone: string, password: string) {
    const data = object(await this.request("login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password }) }, true));
    if (typeof data.access_token !== "string" || !data.access_token || !Number.isSafeInteger(data.expires_in) || Number(data.expires_in) <= 0 || !Number.isFinite(new Date(Date.now() + Number(data.expires_in) * 1000).getTime())) {
      throw new ServiceUnavailableException("Haze 登录服务响应异常，请稍后重试。");
    }
    return { token: data.access_token, expiresIn: Number(data.expires_in), user: await this.user(data.user) };
  }

  async me(token: string): Promise<AuthUser> {
    return this.user(await this.request("me", { headers: { Authorization: `Bearer ${token}` } }));
  }

  async personalCredentialUser(credential: string): Promise<AuthUser> {
    return this.user(await this.request("personal-credential/me", { headers: { Authorization: `Bearer ${credential}` }, cache: "no-store" }));
  }

  async updateAvatar(token: string, avatarUrl: string | null): Promise<AuthUser> {
    return this.user(await this.request("me/profile", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ avatar_url: avatarUrl }) }));
  }

  async resetPassword(token: string, currentPassword: string, newPassword: string) {
    const data = object(await this.request("me/reset-password", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }));
    if (data.reset !== true) throw new ServiceUnavailableException("Haze 未确认密码修改成功，请稍后重试。");
  }

  async credential(token: string, reset = false): Promise<PersonalCredentialSecret> {
    const data = object(await this.request(reset ? "me/mcp-credential/reset" : "me/mcp-credential", { method: reset ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }));
    if (!Number.isSafeInteger(data.id) || Number(data.id) <= 0 || ["name", "masked_key", "key", "created_at", "updated_at"].some(key => typeof data[key] !== "string" || !data[key]) || !Number.isFinite(Date.parse(String(data.created_at))) || !Number.isFinite(Date.parse(String(data.updated_at)))) {
      throw new ServiceUnavailableException("Haze 个人凭证响应异常，请稍后重试。");
    }
    return { id: Number(data.id), name: data.name as string, masked_key: data.masked_key as string, key: data.key as string, created_at: data.created_at as string, updated_at: data.updated_at as string };
  }
}
