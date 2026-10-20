import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@eureka-atlas/database";
import type {
  SemanticSearchRequest,
  ExternalQueryRequest,
  ExternalDimensionValuesRequest,
} from "@eureka-atlas/types" with { "resolution-mode": "import" };
import {
  ExternalContractService,
  ExternalOperationId,
} from "../external-api/external-contract.service";
import { ExternalDataService } from "../external-api/external-data.service";
import { SemanticScopeService } from "../semantic/semantic-scope.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { contextProperties, readContext } from "./mcp-context";

const operations = [
  [
    "search_semantic_assets",
    "search",
    "在当前会话范围内按业务词、中文指标、维度和别名检索表。",
  ],
  [
    "get_semantic_package",
    "package",
    "读取当前选数范围内一张表的最新正式Package。",
  ],
  [
    "get_dimension_values",
    "dimensionValues",
    "在当前范围内提交真实候选值查询，返回异步任务，不是立即返回值列表。",
  ],
  [
    "query_data",
    "query",
    "在当前范围内按正式语义提交指标查询，返回异步任务；只能使用Package中的ID。",
  ],
  [
    "get_query_status",
    "status",
    "读取本人当前业务会话的任务状态；建议至少间隔3秒轮询。",
  ],
  [
    "get_query_result",
    "result",
    "读取本人本会话成功任务的真实保存结果，检查truncated和过期时间。",
  ],
  [
    "cancel_query",
    "cancel",
    "请求取消本人本会话的任务；断开连接、重新选表均不自动取消。",
  ],
] as const;
const lifecycle = (id: string) => ["status", "result", "cancel"].includes(id);
@Injectable()
export class McpDataService {
  constructor(
    private readonly sessions: AgentSessionsService,
    private readonly contracts: ExternalContractService,
    private readonly external: ExternalDataService,
    private readonly semantic: SemanticScopeService,
  ) {}
  async definitions() {
    const schemas = await this.contracts.schemas();
    return operations.map(([name, id, description]) => {
      const base = JSON.parse(JSON.stringify(schemas[id].request));
      if (id === "package") {
        base.properties = {
          table_id: JSON.parse(JSON.stringify(schemas.package.params))
            .properties.tableId,
        };
        base.required = ["table_id"];
      }
      if (lifecycle(id)) {
        base.properties = {
          query_id: JSON.parse(JSON.stringify(schemas.status.params)).properties
            .queryId,
        };
        base.required = ["query_id"];
      }
      return {
        name,
        description,
        inputSchema: {
          ...base,
          properties: { ...base.properties, ...contextProperties },
          required: [
            ...(base.required ?? []),
            "session_id",
            ...(!lifecycle(id) ? ["scope_revision"] : []),
          ],
        },
        annotations: {
          readOnlyHint: !["query", "dimensionValues", "cancel"].includes(id),
          destructiveHint: id === "cancel",
          openWorldHint: true,
        },
      };
    });
  }
  async call(memberNo: string, name: string, args: Record<string, unknown>) {
    const operation = operations.find(([tool]) => tool === name);
    if (!operation) throw new BadRequestException("未知工具。");
    const id = operation[1] as ExternalOperationId,
      ctx = readContext(args, !lifecycle(id));
    const { session_id, scope_revision, ...input } = args;
    if (id === "package")
      await this.contracts.validate(id, {}, { tableId: input.table_id });
    else if (lifecycle(id))
      await this.contracts.validate(id, {}, { queryId: input.query_id });
    else await this.contracts.validate(id, input);
    if (
      (id === "package" && Object.keys(input).some((k) => k !== "table_id")) ||
      (lifecycle(id) && Object.keys(input).some((k) => k !== "query_id"))
    )
      throw new BadRequestException("工具参数包含额外字段。");
    if (lifecycle(id)) {
      await this.sessions.touch(memberNo, ctx.id);
      const row = await prisma.queryExecution.findUnique({
        where: { id: String(input.query_id) },
      });
      if (
        !row ||
        row.ownerMemberNo !== memberNo ||
        row.kind !== "SEMANTIC_QUERY" ||
        row.agentQuerySessionId !== ctx.id
      )
        throw new NotFoundException("查询任务不存在或不属于当前业务会话。");
      if (id === "status") return this.external.status(memberNo, row.id);
      if (id === "result") return this.external.result(memberNo, row.id);
      return this.external.cancel(memberNo, row.id);
    }
    if (id === "query" || id === "dimensionValues") {
      await this.sessions.touch(memberNo, ctx.id);
      const replay = await this.external.replay(
        memberNo,
        input as ExternalQueryRequest | ExternalDimensionValuesRequest,
        id === "dimensionValues",
        ctx.id,
      );
      if (replay) return replay;
    }
    const scope = await this.sessions.resolve(memberNo, ctx.id, ctx.revision);
    if (id === "search")
      return this.semantic.search(
        input as SemanticSearchRequest,
        scope.tableIds.length
          ? await this.semantic.resolve(scope.tableIds)
          : { tableIds: [], packages: new Map() },
      );
    if (!scope.tableIds.includes(String(input.table_id)))
      throw new NotFoundException("该表不在当前会话的选数范围内。");
    if (id === "package") return this.external.package(String(input.table_id));
    return this.external.submit(
      memberNo,
      input as ExternalQueryRequest | ExternalDimensionValuesRequest,
      id === "dimensionValues",
      {
        sessionId: scope.id,
        revision: scope.revision,
        check: (tx) =>
          this.sessions.lockAdmission(tx, scope, String(input.table_id)),
      },
    );
  }
}
