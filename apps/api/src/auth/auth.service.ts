import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { parse } from "cookie";
import type { Request, Response } from "express";
import { prisma } from "@eureka-atlas/database";
import { CredentialCryptoService } from "../datasource/credential-crypto.service";
import { HazeAuthService } from "./haze-auth.service";

export const SESSION_COOKIE = "eureka_atlas_session";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class AuthService {
  constructor(private readonly haze: HazeAuthService, private readonly crypto: CredentialCryptoService) {}

  private cookieOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
  }

  private sessionId(request: Request): string | undefined {
    const value = parse(request.headers.cookie || "")[SESSION_COOKIE];
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : undefined;
  }

  async login(input: unknown, request: Request, response: Response) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!/^1\d{10}$/.test(phone)) throw new BadRequestException("请输入有效的 11 位手机号。");
    if (typeof body.password !== "string" || body.password.length < 6 || body.password.length > 128) throw new BadRequestException("密码长度应为 6 至 128 位。");
    const startedAt = Date.now();
    const result = await this.haze.login(phone, body.password);
    const expiresAt = new Date(startedAt + result.expiresIn * 1000);
    if (expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("登录已失效，请重新登录。");
    const secret = randomBytes(32).toString("base64url");
    const oldId = this.sessionId(request);
    await prisma.authSession.deleteMany({ where: { OR: [{ expiresAt: { lte: new Date() } }, ...(oldId ? [{ id: oldId }] : [])] } });
    await prisma.authSession.create({ data: { id: digest(secret), memberNo: result.user.member_no, tokenEncrypted: this.crypto.encrypt(result.token), expiresAt } });
    response.cookie(SESSION_COOKIE, secret, { ...this.cookieOptions(), maxAge: Math.max(0, expiresAt.getTime() - Date.now()) });
    response.setHeader("Cache-Control", "no-store");
    return result.user;
  }

  async authenticate(request: Request) {
    const id = this.sessionId(request);
    const session = id ? await prisma.authSession.findUnique({ where: { id } }) : null;
    if (!session) throw new UnauthorizedException("请先登录。");
    try {
      if (session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("登录已过期，请重新登录。");
      const user = await this.haze.me(this.crypto.decrypt(session.tokenEncrypted));
      if (user.member_no !== session.memberNo) throw new UnauthorizedException("登录已失效，请重新登录。");
      return user;
    } catch (error) {
      if (error instanceof UnauthorizedException) await prisma.authSession.deleteMany({ where: { id } });
      throw error;
    }
  }

  async logout(request: Request, response: Response) {
    const id = this.sessionId(request);
    if (id) await prisma.authSession.deleteMany({ where: { id } });
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
    response.setHeader("Cache-Control", "no-store");
    return { logged_out: true };
  }
}
