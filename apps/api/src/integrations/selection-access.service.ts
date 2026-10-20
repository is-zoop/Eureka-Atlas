import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { prisma, Prisma } from "@eureka-atlas/database";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parse } from "cookie";
import type { Request, Response } from "express";
import { AuthService } from "../auth/auth.service";
import { CredentialCryptoService } from "../datasource/credential-crypto.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { integrationOrigin } from "./public-origin";

export const SELECTION_COOKIE = "atlas_selection";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const denied = () =>
  new UnauthorizedException(
    "请从 Agent 重新打开当前对话的选数界面；不会切换到网页登录或扩大范围。",
  );
const grantLifetime = 5 * 60000;
@Injectable()
export class SelectionAccessService {
  constructor(
    private readonly sessions: AgentSessionsService,
    private readonly auth: AuthService,
    private readonly crypto: CredentialCryptoService,
  ) {}
  async open(memberNo: string, sessionId: string, credential: string) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(credential)) throw denied();
    const grant = randomBytes(32).toString("base64url"),
      digest = hash(credential);
    const view = await prisma.$transaction(async (tx) => {
      await this.sessions.owned(memberNo, sessionId, tx);
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM agent_query_session WHERE id=${sessionId} FOR UPDATE`,
      );
      const previous = await tx.agentSelectionAccess.findUnique({
        where: { agentQuerySessionId: sessionId },
      });
      const data = {
        credentialEncrypted: this.crypto.encrypt(credential),
        credentialDigest: digest,
        grantHash: hash(grant),
        grantExpiresAt: new Date(Date.now() + grantLifetime),
      };
      return tx.agentSelectionAccess.upsert({
        where: { agentQuerySessionId: sessionId },
        create: { id: randomUUID(), agentQuerySessionId: sessionId, ...data },
        update: {
          ...data,
          epoch: {
            increment:
              previous?.credentialDigest && previous.credentialDigest !== digest
                ? 1
                : 0,
          },
        },
      });
    });
    const scope = await this.sessions.owned(memberNo, sessionId);
    return {
      session_id: sessionId,
      scope_revision: scope.revision,
      view_id: view.id,
      browser_url: `${integrationOrigin()}/integrations/plugins/agent-selector/${view.id}#launch=${grant}`,
    };
  }
  private path(id: string) {
    return `/api/integrations/selection-browser/${id}`;
  }
  private setCookie(response: Response, view: { id: string; epoch: number }) {
    const token = this.crypto.encrypt(
      JSON.stringify({
        purpose: "atlas-selection-v1",
        view: view.id,
        epoch: view.epoch,
        nonce: randomBytes(32).toString("base64url"),
      }),
    );
    response.cookie(SELECTION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: this.path(view.id),
      maxAge: 365 * 86400000,
    });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
  }
  private async view(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw denied();
    const view = await prisma.agentSelectionAccess.findUnique({
      where: { id },
      include: { agentQuerySession: true },
    });
    if (!view?.credentialEncrypted) throw denied();
    return view;
  }
  private checkCookie(request: Request, view: { id: string; epoch: number }) {
    try {
      const value = parse(request.headers.cookie || "")[SELECTION_COOKIE];
      const body = JSON.parse(this.crypto.decrypt(value || ""));
      if (
        body.purpose !== "atlas-selection-v1" ||
        body.view !== view.id ||
        body.epoch !== view.epoch ||
        typeof body.nonce !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(body.nonce)
      )
        throw Error();
    } catch {
      throw denied();
    }
  }
  private async identity(view: {
    credentialEncrypted: string | null;
    agentQuerySession: { ownerMemberNo: string };
  }) {
    let credential: string;
    try {
      credential = this.crypto.decrypt(view.credentialEncrypted!);
    } catch {
      throw denied();
    }
    const user = await this.auth.authenticatePersonalCredential(credential);
    const { hasPermission } = await import("@eureka-atlas/types");
    if (!hasPermission(user.role_code, "query.use"))
      throw new ForbiddenException("当前身份不能使用选数功能。");
    if (user.member_no !== view.agentQuerySession.ownerMemberNo) throw denied();
    return user;
  }
  async authorize(id: string, request: Request, response: Response) {
    const view = await this.view(id);
    this.checkCookie(request, view);
    const user = await this.identity(view);
    this.setCookie(response, view);
    return { user, view };
  }
  async exchange(
    id: string,
    input: unknown,
    request: Request,
    response: Response,
  ) {
    const body = input as { launch?: unknown };
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => k !== "launch")
    )
      throw denied();
    const view = await this.view(id);
    let existing = false;
    try {
      this.checkCookie(request, view);
      existing = true;
    } catch {}
    const code =
      typeof body.launch === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.launch)
        ? body.launch
        : "";
    if (
      !existing &&
      (!code ||
        view.grantHash !== hash(code) ||
        !view.grantExpiresAt ||
        view.grantExpiresAt.getTime() <= Date.now())
    )
      throw denied();
    const user = await this.identity(view);
    const consumed = code
      ? await prisma.agentSelectionAccess.updateMany({
          where: {
            id,
            grantHash: hash(code),
            grantExpiresAt: { gt: new Date() },
            epoch: view.epoch,
          },
          data: { grantHash: null, grantExpiresAt: null },
        })
      : { count: 0 };
    if (!existing && !consumed.count) throw denied();
    this.setCookie(response, view);
    return this.describe(user.member_no, view.id, view.agentQuerySessionId);
  }
  async describe(memberNo: string, viewId: string, sessionId: string) {
    return {
      view_id: viewId,
      member_no: memberNo,
      session: await this.sessions.describe(memberNo, sessionId),
    };
  }
  async revoke(id: string, request: Request, response: Response) {
    const view = await this.view(id);
    this.checkCookie(request, view);
    await prisma.agentSelectionAccess.update({
      where: { id },
      data: {
        credentialEncrypted: null,
        credentialDigest: null,
        grantHash: null,
        grantExpiresAt: null,
        epoch: { increment: 1 },
      },
    });
    response.clearCookie(SELECTION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: this.path(id),
    });
    response.setHeader("Cache-Control", "no-store");
    return { revoked: true };
  }
}
