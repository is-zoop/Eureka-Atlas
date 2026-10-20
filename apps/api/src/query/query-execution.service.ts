import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { requireMemberNo } from "../auth/member-no";
import { DataSourceType, QueryExecutionKind, Prisma, QueryExecutionStatus, prisma } from "@eureka-atlas/database";
import type { DataDimensionValuesRequest, DataQueryRequest, DimensionValuesRequest, QueryExecution, QueryRequest, QueryResult, QueryResultColumn, SemanticPackage } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { DatasourceService } from "../datasource/datasource.service";
import { MaxComputeClient } from "../metadata/maxcompute.client";
import { PackageService } from "../package/package.service";
import { QueryCompilerService, type CompiledQuery } from "./query-compiler.service";

export type QueryAdmission = {sessionId:string;revision:number;check:(tx:Prisma.TransactionClient)=>Promise<void>};

const resultExpiryMs = 24 * 60 * 60 * 1000;
const timeoutMs = 10 * 60 * 1000;
const resultByteLimit = 5 * 1024 * 1024;
const maxRows = 5000;
const terminal = new Set<QueryExecutionStatus>(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const parseDelimitedRows = (raw: string): string[][] => {
  const delimiter = raw.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (character === '"' && raw[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }
  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
};

@Injectable()
export class QueryExecutionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = new Set<string>();
  constructor(
    private readonly packages: PackageService,
    private readonly datasource: DatasourceService,
    private readonly compiler: QueryCompilerService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.refreshActive(), 3000);
    void this.refreshActive();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async submit(memberNo: string, input: QueryRequest): Promise<QueryExecution> {
    requireMemberNo(memberNo);
    return this.submitPackage(memberNo, await this.packages.get(input.table_id), input);
  }

  async submitPackage(memberNo: string, pkg: SemanticPackage, input: QueryRequest, admission?:QueryAdmission): Promise<QueryExecution> {
    requireMemberNo(memberNo);
    this.assertMaxCompute(pkg.source.type);
    const compiled = this.compiler.compileQuery(pkg, input, { snapshotDate: await this.resolveSnapshot(pkg) });
    return this.createAndSubmit(memberNo, pkg, input, compiled, input.idempotency_key,QueryExecutionKind.SEMANTIC_QUERY,[],admission);
  }

  async dimensionValues(memberNo: string, input: DimensionValuesRequest): Promise<QueryExecution> {
    requireMemberNo(memberNo);
    return this.dimensionValuesPackage(memberNo, await this.packages.get(input.table_id), input);
  }

  async dimensionValuesPackage(memberNo: string, pkg: SemanticPackage, input: DimensionValuesRequest, completeDays = false, admission?:QueryAdmission): Promise<QueryExecution> {
    requireMemberNo(memberNo);
    this.assertMaxCompute(pkg.source.type);
    const compiled = this.compiler.compileDimensionValues(pkg, input, { snapshotDate: await this.resolveSnapshot(pkg),completeDays,candidateSearch:completeDays });
    return this.createAndSubmit(memberNo, pkg, input, compiled, input.idempotency_key,QueryExecutionKind.SEMANTIC_QUERY,[],admission);
  }
  async submitDataDimensionValues(memberNo: string, pkg: SemanticPackage, input: DataDimensionValuesRequest, compiled: CompiledQuery): Promise<QueryExecution> {
    this.assertMaxCompute(pkg.source.type);
    return this.createAndSubmit(memberNo, pkg, { ...input, limit: compiled.limit }, compiled, input.idempotency_key);
  }
  async submitData(memberNo: string, pkg: SemanticPackage, input: DataQueryRequest, compiled: CompiledQuery & {resolvedDates:Array<{field_id:string;start:string;end:string}>}) {
    this.assertMaxCompute(pkg.source.type);
    return this.createAndSubmit(memberNo,pkg,input,compiled,input.idempotency_key,QueryExecutionKind.DATA_QUERY,compiled.resolvedDates);
  }
  async get(memberNo: string, id: string): Promise<QueryExecution> {
    const execution = await this.requireOwned(memberNo, id);
    if (execution.kind !== QueryExecutionKind.DATA_QUERY && !terminal.has(execution.status) && execution.remoteInstanceId) await this.refresh(id);
    return this.toResponse(await this.requireOwned(memberNo, id));
  }

  async result(memberNo: string, id: string): Promise<QueryExecution> {
    const execution = await this.get(memberNo, id);
    if (execution.status !== "SUCCEEDED") throw new BadRequestException("查询尚未成功完成，暂时没有结果");
    if (!execution.result) throw new NotFoundException("查询结果已过期，请重新执行");
    return execution;
  }

  async replaySemantic(memberNo: string, input: QueryRequest | DimensionValuesRequest, agentSessionId?:string): Promise<QueryExecution | null> {
    requireMemberNo(memberNo);
    if (!input.idempotency_key) throw new BadRequestException("缺少幂等标识。");
    const existing = await prisma.queryExecution.findUnique({ where: { ownerMemberNo_idempotencyKey: { ownerMemberNo: memberNo, idempotencyKey: input.idempotency_key } } });
    return existing ? this.replay(existing, input, QueryExecutionKind.SEMANTIC_QUERY,agentSessionId) : null;
  }

  async semanticGet(memberNo: string, id: string) {
    const item = await this.requireOwned(memberNo, id);
    if (item.kind !== QueryExecutionKind.SEMANTIC_QUERY) throw new NotFoundException("查询任务不存在");
    return this.get(memberNo, id);
  }

  async semanticCancel(memberNo: string, id: string) {
    await this.semanticGet(memberNo, id);
    return this.cancel(memberNo, id);
  }

  async assertOwnership(memberNo: string, id: string): Promise<void> {
    await this.requireOwned(memberNo, id);
  }

  async cancel(memberNo: string, id: string): Promise<QueryExecution> {
    await this.requireOwned(memberNo, id);
    return this.cancelInternal(id);
  }

  private async cancelInternal(id: string): Promise<QueryExecution> {
    const execution = await this.require(id);
    if (terminal.has(execution.status)) return this.toResponse(execution);
    if (!execution.remoteInstanceId) {
      await prisma.queryExecution.update({ where: { id }, data: { status: QueryExecutionStatus.CANCELLED, completedAt: new Date() } });
      return this.toResponse(await this.require(id));
    }
    await prisma.queryExecution.update({ where: { id }, data: { status: QueryExecutionStatus.CANCELLING } });
    try {
      const client = await this.clientFor(execution.dataSourceId,execution.kind === QueryExecutionKind.DATA_QUERY ? AbortSignal.timeout(10000) : undefined);
      const project = await this.projectFor(execution.metaTableId);
      await client.cancelInstance(execution.remoteInstanceId, project);
    } catch (error) {
      await prisma.queryExecution.update({ where: { id }, data: { error: this.message(error) } });
    }
    return this.toResponse(await this.require(id));
  }

  private async createAndSubmit(memberNo: string, pkg: Awaited<ReturnType<PackageService["get"]>>, request: QueryRequest | DimensionValuesRequest | DataQueryRequest | DataDimensionValuesRequest, compiled: CompiledQuery, idempotencyKey?: string, kind: QueryExecutionKind = QueryExecutionKind.SEMANTIC_QUERY, resolvedDates: Array<{field_id:string;start:string;end:string}> = [], admission?:QueryAdmission) {
    requireMemberNo(memberNo);
    const replay = (existing: Awaited<ReturnType<QueryExecutionService["require"]>>) => this.replay(existing, request, kind,admission?.sessionId);
    if (idempotencyKey) {
      const existing = await prisma.queryExecution.findUnique({ where: { ownerMemberNo_idempotencyKey: { ownerMemberNo: memberNo, idempotencyKey } } });
      if (existing) return replay(existing);
    }
    let created;
    try {
      const create = async (tx:Prisma.TransactionClient) => {
        if(admission)await admission.check(tx);
        return tx.queryExecution.create({
        data: {
          ...(admission?{agentQuerySessionId:admission.sessionId,agentScopeRevision:admission.revision}:{}),
          kind,
          resolvedDates,
          ownerMemberNo: memberNo,
          metaTableId: pkg.table.id,
          dataSourceId: pkg.source.id,
          idempotencyKey: idempotencyKey || null,
          request: request as Prisma.InputJsonValue,
          sql: compiled.sql,
          contentVersion: pkg.content_version,
          snapshotDate: compiled.snapshotDate,
          resultColumns: compiled.outputs as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + resultExpiryMs),
        },
      });
      };
      created = admission ? await prisma.$transaction(create) : await create(prisma);
    } catch (error) {
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.queryExecution.findUnique({ where: { ownerMemberNo_idempotencyKey: { ownerMemberNo: memberNo, idempotencyKey } } });
        if (existing) return replay(existing);
      }
      throw error;
    }
    try {
      const client = await this.clientFor(pkg.source.id,kind === QueryExecutionKind.DATA_QUERY ? AbortSignal.timeout(Math.max(1,created.submittedAt.getTime()+timeoutMs-Date.now())) : undefined);
      const remoteInstanceId = await client.submitSql(compiled.sql, pkg.source.project, created.id);
      if (kind === QueryExecutionKind.DATA_QUERY) {
        const updated = await prisma.queryExecution.updateMany({ where: { id: created.id, status: QueryExecutionStatus.PENDING }, data: { remoteInstanceId, status: QueryExecutionStatus.RUNNING, startedAt: new Date() } });
        if (!updated.count) await (await this.clientFor(pkg.source.id,AbortSignal.timeout(10000))).cancelInstance(remoteInstanceId,pkg.source.project);
      } else await prisma.queryExecution.update({ where: {id:created.id}, data:{remoteInstanceId,status:QueryExecutionStatus.RUNNING,startedAt:new Date()} });
    } catch (error) {
      if(kind === QueryExecutionKind.DATA_QUERY) await prisma.queryExecution.updateMany({where:{id:created.id,status:{in:[QueryExecutionStatus.PENDING,QueryExecutionStatus.RUNNING]}},data:{status:Date.now()-created.submittedAt.getTime() >= timeoutMs ? QueryExecutionStatus.TIMED_OUT : QueryExecutionStatus.FAILED,error:Date.now()-created.submittedAt.getTime() >= timeoutMs ? "查询超过 10 分钟" : this.message(error),completedAt:new Date()}});
      else await prisma.queryExecution.update({ where: { id: created.id }, data: { status: QueryExecutionStatus.FAILED, error: this.message(error), completedAt: new Date() } });
    }
    return this.toResponse(await this.require(created.id));
  }

  private async refreshActive() {
    const active = await prisma.queryExecution.findMany({ where: { kind: QueryExecutionKind.SEMANTIC_QUERY, status: { in: [QueryExecutionStatus.PENDING, QueryExecutionStatus.RUNNING, QueryExecutionStatus.CANCELLING] } }, select: { id: true } });
    await Promise.all(active.map(({ id }) => this.refresh(id)));
  }

  private async refresh(id: string): Promise<void> {
    if (this.refreshing.has(id)) return;
    this.refreshing.add(id);
    try {
      const execution = await this.require(id);
      if (execution.kind === QueryExecutionKind.DATA_QUERY || terminal.has(execution.status)) return;
      if (Date.now() - execution.submittedAt.getTime() > timeoutMs) {
        await this.cancelInternal(id);
        await prisma.queryExecution.update({ where: { id }, data: { status: QueryExecutionStatus.TIMED_OUT, error: "查询超过 10 分钟未完成", completedAt: new Date() } });
        return;
      }
      if (!execution.remoteInstanceId) return;
      const client = await this.clientFor(execution.dataSourceId);
      const project = await this.projectFor(execution.metaTableId);
      const remote = await client.getInstance(execution.remoteInstanceId, project);
      if (remote.status === "RUNNING" || remote.status === "UNKNOWN") return;
      if (remote.status === "CANCELLED") {
        await prisma.queryExecution.update({ where: { id }, data: { status: QueryExecutionStatus.CANCELLED, completedAt: new Date() } });
        return;
      }
      if (remote.status === "FAILED") {
        const detail = await client.getInstanceResult(execution.remoteInstanceId, project).catch(() => "MaxCompute 查询执行失败");
        await prisma.queryExecution.update({ where: { id }, data: { status: QueryExecutionStatus.FAILED, error: detail.slice(0, 4000), completedAt: new Date() } });
        return;
      }
      const raw = await client.getInstanceResult(execution.remoteInstanceId, project);
      const parsed = this.parseResult(raw, execution.sql, execution.resultColumns as unknown as QueryResultColumn[], this.requestLimit(execution.request));
      await prisma.queryExecution.update({ where: { id }, data: { status: QueryExecutionStatus.SUCCEEDED, result: parsed.result as Prisma.InputJsonValue, snapshotDate: parsed.snapshotDate, resultBytes: parsed.result.result_bytes, truncated: parsed.result.truncated, completedAt: new Date() } });
    } catch (error) {
      await prisma.queryExecution.update({ where: { id }, data: { status: QueryExecutionStatus.FAILED, error: this.message(error), completedAt: new Date() } }).catch(() => undefined);
    } finally {
      this.refreshing.delete(id);
    }
  }

  private parseResult(raw: string, sql: string, columns: QueryResultColumn[], limit = maxRows) : { result: QueryResult; snapshotDate: string | null } {
    const byteLength = Buffer.byteLength(raw, "utf8");
    const truncated = byteLength > resultByteLimit;
    const usable = truncated ? Buffer.from(raw, "utf8").subarray(0, resultByteLimit).toString("utf8") : raw;
    const aliases = [...sql.matchAll(/AS\s+`([^`]+)`/gi)].map((match) => match[1]);
    const parsedRows = parseDelimitedRows(usable);
    const header = parsedRows[0] ?? aliases;
    const skipHeader = header.length === aliases.length && header.every((value, index) => value.toLowerCase() === aliases[index].toLowerCase());
    const hasSnapshot = aliases.at(-1) === "__snapshot_date";
    const rawRows = parsedRows.slice(skipHeader ? 1 : 0, (skipHeader ? 1 : 0) + limit + 1).map((row) => row.map((value) => value === "NULL" || value === "\\N" ? null : value));
    const snapshotDate = hasSnapshot && rawRows[0]?.at(-1) !== null && rawRows[0]?.at(-1) !== undefined ? String(rawRows[0].at(-1)) : null;
    const rows = hasSnapshot ? rawRows.map((row) => row.slice(0, -1)) : rawRows;
    const visibleHeader = hasSnapshot ? header.slice(0, -1) : header;
    const resultColumns = columns.length === visibleHeader.length ? columns : visibleHeader.map((name) => ({ id: null, name, type: "STRING", unit: null }));
    return { result: { columns: resultColumns, rows: rows.slice(0, limit), truncated: truncated || rows.length > limit, result_bytes: byteLength }, snapshotDate };
  }

  private replay(existing: Awaited<ReturnType<QueryExecutionService["require"]>>, request: unknown, kind: QueryExecutionKind, agentSessionId?:string) {
    if(agentSessionId&&existing.agentQuerySessionId!==agentSessionId)throw new ConflictException("幂等标识已用于其他会话或普通查询，请使用新的请求标识。");
    if ((existing.kind && existing.kind !== kind) || !isDeepStrictEqual(existing.request, JSON.parse(JSON.stringify(request)))) throw new ConflictException("幂等标识已用于其他请求");
    return this.toResponse(existing);
  }

  private requestLimit(request: unknown) {
    if (!request || typeof request !== "object") return maxRows;
    const limit = Number((request as { limit?: unknown }).limit);
    return Number.isInteger(limit) && limit > 0 && limit <= maxRows ? limit : maxRows;
  }
  async resolveSnapshot(pkg: Awaited<ReturnType<PackageService["get"]>>) {
    if (pkg.table.query_config.storage !== "FULL_SNAPSHOT") return null;
    const fieldId = pkg.table.query_config.default_stat_date.field_id;
    const field = fieldId ? pkg.fields.find((item) => item.id === fieldId) : undefined;
    if (!field?.is_partition) throw new BadRequestException("全量快照表需要把默认统计日期配置为有效分区字段");
    const client = await this.clientFor(pkg.source.id);
    const partitions = await client.listPartitions(pkg.table.name, pkg.source.project);
    const candidates = partitions.map((spec) => this.partitionValue(spec, field.column)).filter((value): value is string => Boolean(value)).map((value) => ({ value, date: this.parseSnapshotDate(value, field.normalized_type, pkg.table.query_config.default_stat_date.format) })).filter((item): item is { value: string; date: number } => item.date !== null).sort((left, right) => right.date - left.date || right.value.localeCompare(left.value));
    if (!candidates.length) throw new BadRequestException(`未找到可解析的 ${field.name} 快照分区`);
    return candidates[0].value;
  }

  private partitionValue(spec: string, column: string) {
    const pair = spec.split(",").map((item) => item.trim()).find((item) => item.startsWith(`${column}=`));
    const value = pair?.slice(column.length + 1).replace(/^['"]|['"]$/g, "").trim();
    return value || null;
  }

  private parseSnapshotDate(value: string, type: string, format: string) {
    const normalized = type === "DATE" || type === "DATETIME" ? value.slice(0, 10) : format === "yyyyMMdd" ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : format === "yyyy/MM/dd" ? value.replaceAll("/", "-") : value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
    const date = Date.parse(`${normalized}T00:00:00Z`);
    return Number.isNaN(date) ? null : date;
  }
  async clientFor(dataSourceId: string, signal: AbortSignal = AbortSignal.timeout(10_000)) {
    const source = await this.datasource.getWithCredentials(dataSourceId);
    this.assertMaxCompute(source.type);
    const config = source.connectionConfig as Record<string, unknown>;
    const credentials = source.credentials as { accessKey?: unknown; secretKey?: unknown };
    const endpoint = text(config.endpoint);
    const region = text(config.region);
    const project = text(config.project);
    if (!endpoint || !region || !project || !text(credentials.accessKey) || !text(credentials.secretKey)) throw new BadRequestException("MaxCompute 数据源配置或凭据不完整");
    return new MaxComputeClient({ signal, endpoint, region, defaultProject: project, accessKey: text(credentials.accessKey), secretKey: text(credentials.secretKey) });
  }

  async projectFor(tableId: string) {
    const table = await prisma.metaTable.findUnique({ where: { id: tableId }, include: { metaProject: true } });
    if (!table || table.status !== "ACTIVE" || table.metaProject.status !== "ACTIVE") throw new NotFoundException("可查询表已失效");
    return table.metaProject.name;
  }

  private async requireOwned(memberNo: string, id: string) {
    requireMemberNo(memberNo);
    const item = await this.require(id);
    if (item.ownerMemberNo !== memberNo) throw new NotFoundException("查询任务不存在");
    return item;
  }

  private async require(id: string) {
    const item = await prisma.queryExecution.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("查询任务不存在");
    return item;
  }

  private assertMaxCompute(type: string) {
    if (type !== DataSourceType.MAXCOMPUTE) throw new BadRequestException("当前仅支持 MaxCompute 数据源执行查询");
  }

  private toResponse(item: Awaited<ReturnType<QueryExecutionService["require"]>>): QueryExecution {
    const result = item.result as unknown as QueryResult | null;
    return { id: item.id, status: item.status, table_id: item.metaTableId, submitted_at: item.submittedAt.toISOString(), started_at: item.startedAt?.toISOString() ?? null, completed_at: item.completedAt?.toISOString() ?? null, elapsed_ms: item.completedAt ? item.completedAt.getTime() - item.submittedAt.getTime() : null, error: item.error, sql: item.sql, content_version: item.contentVersion, snapshot_date: item.snapshotDate, result: item.expiresAt < new Date() ? null : result };
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 4000) : "查询执行失败";
  }
}
