import { Injectable, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { ExternalApiCatalog, ExternalApiOperation } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { ExternalApiController } from "../external-api/external-api.controller";
import { ExternalContractService, ExternalOperationId } from "../external-api/external-contract.service";
import { EXTERNAL_LIMITS } from "../external-api/external-limits";
import { examples } from "./api-examples";
const plain = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value));

@Injectable()
export class ApiCenterService {
  constructor(private readonly contracts: ExternalContractService) {}
  async catalog(): Promise<ExternalApiCatalog> {
    const schemas = await this.contracts.schemas();
    const operations: ExternalApiOperation[] = Object.entries(examples).map(([name, example]) => {
      const id = name as ExternalOperationId, handler = ExternalApiController.prototype[id];
      const suffix = Reflect.getMetadata(PATH_METADATA, handler);
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)] as "GET" | "POST";
      const prefix = Reflect.getMetadata(PATH_METADATA, ExternalApiController);
      return { id, title: example.title, description: example.description, method, path: `/api/${prefix}/${suffix}`, success_status: Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? (method === "POST" ? 201 : 200), request_schema: plain(schemas[id].request), params_schema: plain(schemas[id].params), response_schema: plain(schemas[id].response), request_example: example.request, params_example: example.params, response_example: example.response, notes: example.notes };
    });
    return { title: "Atlas External API", version: "v1", base_path: "/api/external/v1", authentication: "Authorization: Bearer <HAZE_PERSONAL_CREDENTIAL>；实时通过 Haze 校验，仅管理员／系统管理员可用。不使用网页登录 Cookie。", workflow: ["搜索资产", "获取 Package 和 content_version", "必要时查询候选值", "提交查询取得任务 ID", "轮询状态", "成功后读取结果；需要时取消"], limits: { ...EXTERNAL_LIMITS }, errors: [
      { status: 400, code: "INVALID_REQUEST", description: "缺少参数、类型／枚举不正确、额外字段、日期或语义配置不符合要求" },
      { status: 401, code: "INVALID_CREDENTIAL", description: "未提供个人凭证、凭证无效／被重置或账号停用" },
      { status: 403, code: "FORBIDDEN", description: "当前 Haze 角色不是管理员或系统管理员" },
      { status: 404, code: "NOT_FOUND", description: "表不可查询、任务不存在或不属于当前用户" },
      { status: 409, code: "SEMANTIC_VERSION_CHANGED", description: "Package 版本变化，重新获取后使用新幂等标识提交" },
      { status: 409, code: "CONFLICT", description: "幂等标识已用于不同请求" },
      { status: 409, code: "QUERY_NOT_SUCCEEDED", description: "尚未成功完成，先读取任务状态" },
      { status: 410, code: "RESULT_EXPIRED", description: "结果保留期结束，需要重新查询" },
      { status: 413, code: "PAYLOAD_TOO_LARGE", description: "请求 JSON 超过 64 KiB" },
      { status: 429, code: "RATE_LIMITED", description: "超过每用户每分钟请求上限，参考 Retry-After" },
      { status: 429, code: "QUERY_LIMIT_REACHED", description: "本人未结束的语义查询达到并发上限（含网页问数查询）" },
      { status: 502, code: "UPSTREAM_ERROR", description: "数据源请求失败，不代表网页登录失效" },
      { status: 503, code: "SERVICE_UNAVAILABLE", description: "Haze 不可用或响应异常，请稍后重试" },
      { status: 504, code: "UPSTREAM_TIMEOUT", description: "上游请求超时" },
      { status: 500, code: "INTERNAL_ERROR", description: "内部错误，请凭 request_id 联系管理员" },
    ], operations };
  }

  async openapi() {
    const catalog = await this.catalog();
    const paths: Record<string, unknown> = {};
    for (const operation of catalog.operations) {
      const parameters = Object.entries((operation.params_schema.properties ?? {}) as Record<string, unknown>).map(([name, schema]) => ({ name, in: "path", required: true, schema, example: operation.params_example[name] }));
      const responses: Record<string, unknown> = { [operation.success_status]: { description: "成功（查询提交为异步任务）", content: { "application/json": { schema: { type: "object", required: ["data", "request_id"], additionalProperties: false, properties: { data: operation.response_schema, request_id: { type: "string" } } }, example: { data: operation.response_example, request_id: "example-request-id" } } } } };
      for (const status of new Set(catalog.errors.map(error => error.status))) responses[status] = { description: catalog.errors.filter(error => error.status === status).map(error => `${error.code}: ${error.description}`).join("；"), content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } };
      paths[operation.path.replace(/:([A-Za-z]+)/g, "{$1}")] = { [operation.method.toLowerCase()]: { operationId: operation.id, summary: operation.title, description: [operation.description, ...operation.notes].join("\n\n"), security: [{ HazePersonalCredential: [] }], parameters, ...(operation.method === "POST" ? { requestBody: { required: operation.id !== "cancel", content: { "application/json": { schema: operation.request_schema, example: operation.request_example } } } } : {}), responses } };
    }
    return { openapi: "3.1.0", info: { title: catalog.title, version: catalog.version, description: catalog.authentication + "\n仅支持服务端调用和同源调试，不默认向其他网站开放跨域；示例均为虚构数据。" }, servers: [{ url: "/" }], paths, components: { securitySchemes: { HazePersonalCredential: { type: "http", scheme: "bearer", bearerFormat: "Haze personal credential" } }, schemas: { ApiError: { type: "object", additionalProperties: false, required: ["error", "request_id"], properties: { error: { type: "object", additionalProperties: false, required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } }, request_id: { type: "string" } } } } }, "x-atlas-limits": catalog.limits };
  }
}
