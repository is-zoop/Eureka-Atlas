import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { map } from "rxjs";

type TracedRequest = Request & { externalRequestId?: string };
export function trace(request: TracedRequest, response: Response) {
  request.externalRequestId ??= randomUUID();
  response.setHeader("X-Request-Id", request.externalRequestId);
  response.setHeader("Cache-Control", "no-store");
  return request.externalRequestId;
}
const codes: Record<number, string> = { 400: "INVALID_REQUEST", 401: "INVALID_CREDENTIAL", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 410: "RESULT_EXPIRED", 413: "PAYLOAD_TOO_LARGE", 429: "RATE_LIMITED", 502: "UPSTREAM_ERROR", 503: "SERVICE_UNAVAILABLE", 504: "UPSTREAM_TIMEOUT" };
const messages: Record<number, string> = { 400: "请求参数不符合要求。", 401: "Haze 个人凭证无效或已失效。", 403: "没有权限执行此操作，请检查账号权限。", 404: "资源不存在或无权访问。", 409: "请求与当前状态冲突。", 410: "结果已过期，请重新查询。", 413: "请求体超过大小限制。", 429: "请求过于频繁或并发查询过多，请稍后重试。", 502: "数据源服务请求失败，请检查配置或联系管理员。", 503: "服务暂时不可用，请稍后重试。", 504: "上游请求超时，请稍后重试。" };
const specificCodes = new Set(["SEMANTIC_VERSION_CHANGED", "QUERY_NOT_SUCCEEDED", "RESULT_EXPIRED", "INVALID_REQUEST", "RATE_LIMITED", "QUERY_LIMIT_REACHED", "SCOPE_CHANGED", "SCOPE_INVALID"]);

export function safeExternalError(cause:unknown) {
  const middlewareType=cause&&typeof cause==="object"&&"type" in cause?cause.type:undefined;
  const status=cause instanceof HttpException?cause.getStatus():middlewareType==="entity.too.large"?413:middlewareType==="entity.parse.failed"?400:500;
  const detail=cause instanceof HttpException?cause.getResponse():null;
  const body=detail&&typeof detail==="object"?detail as Record<string,unknown>:{};
  const code=typeof body.code==="string"&&specificCodes.has(body.code)?body.code:codes[status]??"INTERNAL_ERROR";
  const domainMessage=[400,409,410].includes(status)&&typeof body.message==="string"&&/[\u3400-\u9fff]/u.test(body.message)?body.message:null;
  const message=(domainMessage??messages[status]??"服务内部错误，请凭请求编号联系管理员。").replace(/haze_[A-Za-z0-9_-]+/g,"[REDACTED]").replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]");
  return {status,code,message};
}

@Catch()
@Injectable()
export class ExternalExceptionFilter implements ExceptionFilter {
  constructor(private readonly adapter: HttpAdapterHost) {}
  catch(cause: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<TracedRequest>(), response = host.switchToHttp().getResponse<Response>();
    if(/^\/api\/mcp\/?$/.test(request.path)) {
      const requestId=trace(request,response),error=safeExternalError(cause);
      if(error.status===401)response.setHeader("WWW-Authenticate",'Bearer realm="Atlas"');
      if(error.status===429&&!response.hasHeader("Retry-After"))response.setHeader("Retry-After","3");
      return response.status(error.status).json({jsonrpc:"2.0",id:null,error:{code:-32000,message:error.message,data:{code:error.code,request_id:requestId}}});
    }
    if (!/^\/api\/external\/v1(?:\/|$)/.test(request.path)) return new BaseExceptionFilter(this.adapter.httpAdapter).catch(cause, host);
    const requestId = trace(request, response);
    const {status,code,message}=safeExternalError(cause);
    if (status === 429 && !response.hasHeader("Retry-After")) response.setHeader("Retry-After", "3");
    response.status(status).json({ error: { code, message }, request_id: requestId });
  }
}

@Injectable()
export class ExternalResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const requestId = trace(context.switchToHttp().getRequest(), context.switchToHttp().getResponse());
    return next.handle().pipe(map(data => ({ data, request_id: requestId })));
  }
}
