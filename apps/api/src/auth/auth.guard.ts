import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { AuthService, SESSION_COOKIE } from "./auth.service";
import type { AuthRequest } from "./auth.types";
import { PUBLIC_ROUTE } from "./public.decorator";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.get("origin");
      const allowed = (process.env.WEB_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000").split(",").map(value => value.trim());
      const sameOrigin = `${request.protocol}://${request.get("host")}`;
      if (request.get("sec-fetch-site") === "cross-site" || (origin && origin !== sameOrigin && !allowed.includes(origin))) {
        throw new ForbiddenException("不允许跨站提交请求。");
      }
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    response.setHeader("Cache-Control", "no-store");
    try {
      request.authUser = await this.auth.authenticate(request);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
      throw error;
    }
  }
}
