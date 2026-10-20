import { ConflictException, GoneException, Injectable } from "@nestjs/common";
import type { ExternalDimensionValuesRequest, ExternalQueryRequest, ExternalQueryTask, QueryExecution, SemanticSearchRequest } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { SemanticScopeService } from "../semantic/semantic-scope.service";
import { QueryExecutionService, type QueryAdmission } from "../query/query-execution.service";
import { ExternalLimitsService } from "./external-limits";

@Injectable()
export class ExternalDataService {
  constructor(private readonly scope: SemanticScopeService, private readonly queries: QueryExecutionService, private readonly limits: ExternalLimitsService) {}

  search(input: SemanticSearchRequest) { return this.scope.search(input); }
  package(tableId: string) { return this.scope.queryablePackage(tableId); }

  async replay(memberNo:string,input:ExternalQueryRequest|ExternalDimensionValuesRequest,dimensionValues:boolean,sessionId:string){const replay=await this.queries.replaySemantic(memberNo,{...input,limit:input.limit??(dimensionValues?50:100)},sessionId);return replay?this.task(replay):null;}

  async submit(memberNo: string, input: ExternalQueryRequest | ExternalDimensionValuesRequest, dimensionValues = false, admission?:QueryAdmission) {
    // Persist explicit defaults so limit+1 detection and idempotent retries agree.
    input = { ...input, limit: input.limit ?? (dimensionValues ? 50 : 100) };
    // A retry must return its original task even when the Package later changes.
    const replay = await this.queries.replaySemantic(memberNo, input,admission?.sessionId);
    if (replay) return this.task(replay);
    return this.limits.submission(memberNo, async () => {
      const concurrentReplay = await this.queries.replaySemantic(memberNo, input,admission?.sessionId);
      if (concurrentReplay) return this.task(concurrentReplay);
      const pkg = await this.scope.queryablePackage(input.table_id, input.content_version);
      await this.limits.assertCapacity(memberNo);
      const execution = dimensionValues
        ? await this.queries.dimensionValuesPackage(memberNo, pkg, input as ExternalDimensionValuesRequest,false,admission)
        : await this.queries.submitPackage(memberNo, pkg, input as ExternalQueryRequest,admission);
      return this.task(execution);
    });
  }

  async status(memberNo: string, id: string) { return this.task(await this.queries.semanticGet(memberNo, id)); }
  async cancel(memberNo: string, id: string) { return this.task(await this.queries.semanticCancel(memberNo, id)); }

  async result(memberNo: string, id: string) {
    const execution = await this.queries.semanticGet(memberNo, id);
    if (execution.status !== "SUCCEEDED") throw new ConflictException({ code: "QUERY_NOT_SUCCEEDED", message: "查询尚未成功完成，请先读取任务状态。" });
    if (!execution.result) throw new GoneException({ code: "RESULT_EXPIRED", message: "查询结果已过期，请重新提交查询。" });
    return { ...this.task(execution), result: execution.result };
  }

  private task(execution: QueryExecution): ExternalQueryTask {
    return {
      id: execution.id, status: execution.status, table_id: execution.table_id,
      submitted_at: execution.submitted_at, started_at: execution.started_at, completed_at: execution.completed_at,
      elapsed_ms: execution.elapsed_ms, error: execution.error ? "数据查询执行失败，请检查参数、数据源配置或联系管理员。" : null,
      sql: execution.sql, content_version: execution.content_version, snapshot_date: execution.snapshot_date,
      expires_at: new Date(Date.parse(execution.submitted_at) + 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}
