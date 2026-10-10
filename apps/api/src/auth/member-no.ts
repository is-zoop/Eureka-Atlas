import { UnauthorizedException } from "@nestjs/common";
import type { AuthRequest } from "./auth.types";

export function requireMemberNo(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new UnauthorizedException("请先登录。");
  return value;
}

export function requestMemberNo(request: AuthRequest): string {
  return requireMemberNo(request.authUser?.member_no);
}
