import { BadRequestException, CanActivate, ExecutionContext, HttpException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { prisma, QueryExecutionKind } from "@eureka-atlas/database";
import type { Response } from "express";
import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";

export const EXTERNAL_LIMITS = { requests_per_minute: 60, concurrent_queries_per_user: 3, request_bytes: 65536, query_rows: 5000, dimension_rows: 200, result_bytes: 5 * 1024 * 1024, execution_timeout_seconds: 600, result_retention_seconds: 86400, upstream_timeout_seconds: 10 } as const;

@Injectable()
export class ExternalLimitsService {
  private windows = new Map<string, { reset: number; count: number }>();
  private queues = new Map<string, Promise<void>>();
  consume(memberNo: string, response: Response) {
    const now = Date.now();
    for (const [key, value] of this.windows) if (value.reset <= now) this.windows.delete(key);
    const window = this.windows.get(memberNo) ?? { reset: now + 60000, count: 0 };
    this.windows.set(memberNo, window);
    response.setHeader("RateLimit-Limit", EXTERNAL_LIMITS.requests_per_minute);
    response.setHeader("RateLimit-Remaining", Math.max(0, EXTERNAL_LIMITS.requests_per_minute - window.count - 1));
    response.setHeader("RateLimit-Reset", Math.ceil(window.reset / 1000));
    if (window.count >= EXTERNAL_LIMITS.requests_per_minute) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil((window.reset - now) / 1000)));
      throw new HttpException({ code: "RATE_LIMITED", message: "每位用户每分钟最多调用 60 次，请稍后重试。" }, 429);
    }
    window.count++;
  }
  async assertCapacity(memberNo: string) {
    const count = await prisma.queryExecution.count({ where: { ownerMemberNo: memberNo, kind: QueryExecutionKind.SEMANTIC_QUERY, status: { in: ["PENDING", "RUNNING", "CANCELLING"] } } });
    if (count >= EXTERNAL_LIMITS.concurrent_queries_per_user) throw new HttpException({ code: "QUERY_LIMIT_REACHED", message: "每位用户最多有 3 个未结束的语义查询，请等待完成或取消后重试。" }, 429);
  }
  // The application is deployed as one API instance. Serialize admission per
  // user so concurrent submissions cannot race the persisted active-task count.
  async submission<T>(memberNo: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(memberNo) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(memberNo, current);
    await previous;
    try { return await action(); }
    finally { release(); if (this.queues.get(memberNo) === current) this.queues.delete(memberNo); }
  }
}

@Injectable()
export class ExternalLimitsGuard implements CanActivate {
  constructor(private readonly limits: ExternalLimitsService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    this.limits.consume(requestMemberNo(request), context.switchToHttp().getResponse());
    if (Object.keys(request.query).length) throw new BadRequestException({ code: "INVALID_REQUEST", message: "请使用接口定义的路径参数或 JSON 请求体，不支持额外 URL 查询参数。" });
    let bytes: number;
    try { bytes = Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8"); } catch { throw new PayloadTooLargeException(); }
    if (Number(request.get("content-length")) > EXTERNAL_LIMITS.request_bytes || bytes > EXTERNAL_LIMITS.request_bytes) throw new PayloadTooLargeException();
    return true;
  }
}
