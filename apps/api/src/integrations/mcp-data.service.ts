import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { buildResultPresentation } from "@eureka-atlas/result-format";
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
import { timed, type McpTimings } from "./mcp-timing";
import { waitForMcpQuery } from "./mcp-query-wait";
import type { ExternalQueryTask } from "@eureka-atlas/types" with {
  "resolution-mode": "import",
};

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
    "提交真实候选值查询并短时等待，完成时直接带结果和presentation；未完成沿用任务ID调用get_query_result等待，不执行终端sleep。",
  ],
  [
    "query_data",
    "query",
    "按正式语义提交指标查询并短时等待，完成时直接带结果和presentation；未完成沿用原任务ID读取结果，不执行终端sleep。",
  ],
  [
    "get_query_status",
    "status",
    "按需检查本会话任务状态。常规等待使用get_query_result的有界等待，避免状态/结果分离轮询。",
  ],
  [
    "get_query_result",
    "result",
    "读取本会话任务并有界等待，成功直接返回真实结果和格式化presentation；未完成返回原任务ID及retry_after_ms，不运行终端sleep，不重新提交。",
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
          properties: {
            ...base.properties,
            ...contextProperties,
            ...(["query", "dimensionValues", "result"].includes(id)
              ? {
                  wait_ms: {
                    type: "integer",
                    minimum: 0,
                    maximum: 10000,
                    default: 8000,
                    description:
                      "服务端等待上限，默认8000毫秒，最大10000；0立即返回当前状态。等待不重提任务，结果未完成仍用原任务ID。",
                  },
                }
              : {}),
          },
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
  async call(
    memberNo: string,
    name: string,
    args: Record<string, unknown>,
    timings: McpTimings = {},
  ) {
    const operation = operations.find(([tool]) => tool === name);
    if (!operation) throw new BadRequestException("未知工具。");
    const id = operation[1] as ExternalOperationId,
      ctx = readContext(args, !lifecycle(id));
    const { session_id, scope_revision, wait_ms, ...input } = args;
    if (
      wait_ms !== undefined &&
      (!["query", "dimensionValues", "result"].includes(id) ||
        !Number.isInteger(wait_ms) ||
        Number(wait_ms) < 0 ||
        Number(wait_ms) > 10000)
    )
      throw new BadRequestException(
        "wait_ms 必须是0到10000的整数，且仅用于提交查询或读取结果。",
      );
    const waitMs = wait_ms === undefined ? 8000 : Number(wait_ms);
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
      if (id === "result")
        return this.waitResult(
          memberNo,
          await this.external.snapshot(memberNo, row.id),
          waitMs,
          timings,
        );
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
      if (replay) return this.waitResult(memberNo, replay, waitMs, timings);
    }
    const scope = await timed(timings, "scope", () =>
      this.sessions.resolve(memberNo, ctx.id, ctx.revision),
    );
    if (id === "search")
      return this.semantic.search(
        input as SemanticSearchRequest,
        scope.tableIds.length
          ? await timed(timings, "packages", () =>
              this.semantic.loadPackages(scope.tableIds),
            )
          : { tableIds: [], packages: new Map() },
      );
    if (!scope.tableIds.includes(String(input.table_id)))
      throw new NotFoundException("该表不在当前会话的选数范围内。");
    if (id === "package")
      return timed(timings, "packages", () =>
        this.external.package(String(input.table_id)),
      );
    const task = await timed(timings, "submit", () =>
      this.external.submit(
        memberNo,
        input as ExternalQueryRequest | ExternalDimensionValuesRequest,
        id === "dimensionValues",
        {
          sessionId: scope.id,
          revision: scope.revision,
          check: (tx) =>
            this.sessions.lockAdmission(tx, scope, String(input.table_id)),
        },
      ),
    );
    return this.waitResult(memberNo, task, waitMs, timings);
  }
  private async waitResult(
    memberNo: string,
    initial: ExternalQueryTask,
    waitMs: number,
    timings: McpTimings,
  ) {
    const task = await timed(timings, "wait", () =>
      waitForMcpQuery(
        initial,
        () => this.external.snapshot(memberNo, initial.id),
        waitMs,
      ),
    );
    if (task.status === "SUCCEEDED") {
      const value = await timed(timings, "result", () =>
        this.external.result(memberNo, task.id),
      );
      return { ...value, presentation: buildResultPresentation(value.result) };
    }
    return {
      ...task,
      retry_after_ms: ["PENDING", "RUNNING", "CANCELLING"].includes(task.status)
        ? 1000
        : null,
      next_action: ["PENDING", "RUNNING", "CANCELLING"].includes(task.status)
        ? "READ_SAME_QUERY_RESULT"
        : "TERMINAL",
    };
  }
}
