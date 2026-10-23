import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { AuthService, SESSION_COOKIE } from "./auth.service";
import type { AuthRequest } from "./auth.types";
import { PUBLIC_ROUTE } from "./public.decorator";
import { EXTERNAL_API } from "./external-api.decorator";
import { REQUIRED_PERMISSION } from "./permission.decorator";
import type { AtlasPermission } from "@eureka-atlas/types" with { "resolution-mode": "import" };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const external = this.reflector.getAllAndOverride<boolean>(EXTERNAL_API, [context.getHandler(), context.getClass()]) === true;
    if (!external && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.get("origin");
      const allowed = (process.env.WEB_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000").split(",").map(value => value.trim());
      const sameOrigin = `${request.protocol}://${request.get("host")}`;
      if (request.get("sec-fetch-site") === "cross-site" || (origin && origin !== sameOrigin && !allowed.includes(origin))) {
        throw new ForbiddenException("不允许跨站提交请求。");
      }
    }
    if (!external && this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    response.setHeader("Cache-Control", "no-store");
    try {
      const authStart = performance.now();
      request.authUser = external ? await this.auth.authenticateCredential(request) : await this.auth.authenticate(request);
      request.authElapsedMs = Math.round((performance.now() - authStart) * 100) / 100;
      const permission = this.reflector.getAllAndOverride<AtlasPermission>(REQUIRED_PERMISSION, [context.getHandler(), context.getClass()]);
      const { hasPermission } = await import("@eureka-atlas/types");
      if (!permission || !hasPermission(request.authUser.role_code, permission)) {
        throw new ForbiddenException("没有权限执行此操作，请联系系统管理员。");
      }
      return true;
    } catch (error) {
      if (!external && error instanceof UnauthorizedException) response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
      throw error;
    }
  }
}
