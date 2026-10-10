import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, QueryExecutionKind, prisma } from "@eureka-atlas/database";
import type { DataDimensionValuesRequest, DataQueryExecution, DataQueryRequest, DataQueryResultPage, QueryResultColumn, QueryResult } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { requireMemberNo } from "../auth/member-no";
import { DatasourceService } from "../datasource/datasource.service";
import { PackageService } from "../package/package.service";
import { QueryCompilerService } from "./query-compiler.service";
import { QueryExecutionService } from "./query-execution.service";
import { normalizeDataFilters } from "./data-query-dates";
import { MaxComputeResultReader } from "./maxcompute-result-reader";

const terminal = new Set(["SUCCEEDED","FAILED","CANCELLED","TIMED_OUT"]);
const maxRows = 200000;
const timeoutMs = 600000;
@Injectable()
export class DataQueryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private active = new Map<string,AbortController>();
  private stopped = false;
  private lastCleanup = 0;
  constructor(private readonly packages: PackageService,private readonly compiler: QueryCompilerService,private readonly queries: QueryExecutionService,private readonly datasource: DatasourceService,private readonly reader: MaxComputeResultReader) {}
  onModuleInit() { this.timer = setInterval(() => void this.tick().catch(() => undefined),2000); void this.tick().catch(() => undefined); }
  onModuleDestroy() { this.stopped = true; if(this.timer)clearInterval(this.timer); for(const controller of this.active.values())controller.abort(); }
  async submit(member: string,input: DataQueryRequest) {
    requireMemberNo(member);
    if (!input || typeof input.table_id !== "string") throw new BadRequestException("请选择数据表");
    if (input.idempotency_key !== undefined && (typeof input.idempotency_key !== "string" || !input.idempotency_key.trim() || input.idempotency_key.length>200)) throw new BadRequestException("幂等键无效");
    input = {table_id:input.table_id,mode:input.mode,field_ids:input.field_ids,filters:input.filters ?? [],order_by:input.order_by ?? [],...(input.idempotency_key ? {idempotency_key:input.idempotency_key} : {})};
    const pkg = await this.packages.get(input.table_id);
    const compiled = this.compiler.compileDataQuery(pkg,input,{snapshotDate:await this.queries.resolveSnapshot(pkg)});
    const item = await this.queries.submitData(member,pkg,input,compiled);
    return this.get(member,item.id);
  }
  async dimensionValues(member: string,input: DataDimensionValuesRequest) {
    requireMemberNo(member);
    if (!input || typeof input.table_id !== "string") throw new BadRequestException("请选择数据表");
    const pkg = await this.packages.get(input.table_id);
    if (input.filters !== undefined && (!Array.isArray(input.filters) || input.filters.some(item => !item || typeof item !== "object"))) throw new BadRequestException("筛选条件无效");
    const normalized = normalizeDataFilters(pkg,(input.filters ?? []).filter(item => item.field_id !== input.field_id));
    return this.queries.dimensionValuesPackage(member,pkg,{table_id:input.table_id,field_id:input.field_id,idempotency_key:input.idempotency_key,keyword:input.keyword,filters:normalized.filters,date_range:normalized.dateRange,limit:200},true);
  }
  async get(member: string,id: string): Promise<DataQueryExecution> {
    const item = await this.owned(member,id);
    return {id:item.id,status:item.status,table_id:item.metaTableId,submitted_at:item.submittedAt.toISOString(),started_at:item.startedAt?.toISOString() ?? null,completed_at:item.completedAt?.toISOString() ?? null,elapsed_ms:(item.completedAt ?? new Date()).getTime()-item.submittedAt.getTime(),error:item.error,sql:item.sql,content_version:item.contentVersion,snapshot_date:item.snapshotDate,request:item.request as unknown as DataQueryRequest,columns:item.resultColumns as unknown as QueryResultColumn[],row_count:item.resultRowCount,truncated:item.truncated,expires_at:item.expiresAt.toISOString(),resolved_dates:item.resolvedDates as DataQueryExecution["resolved_dates"]};
  }
  async owned(member: string,id: string) {
    requireMemberNo(member);
    const item = await prisma.queryExecution.findUnique({where:{id}});
    if (!item || item.ownerMemberNo !== member || item.kind !== QueryExecutionKind.DATA_QUERY) throw new NotFoundException("查询任务不存在或无法访问");
    return item;
  }
  async ready(member: string,id: string) {
    const item = await this.owned(member,id);
    if(item.status !== "SUCCEEDED")throw new BadRequestException("完整结果尚未读取完成");
    if(item.expiresAt.getTime() <= Date.now())throw new NotFoundException("结果已过期，请重新查询");
    return item;
  }
  async result(member: string,id: string,page = 1,pageSize = 100): Promise<DataQueryResultPage> {
    const item = await this.ready(member,id);
    if (!Number.isInteger(page) || page < 1 || ![50,100,200,500].includes(pageSize))throw new BadRequestException("分页参数无效");
    const offset = (page-1)*pageSize;
    if (!Number.isSafeInteger(offset))throw new BadRequestException("页码无效");
    const chunks = await prisma.queryResultChunk.findMany({where:{queryExecutionId:id,chunkIndex:{gte:Math.floor(offset/1000),lte:Math.floor((offset+pageSize-1)/1000)}},orderBy:{chunkIndex:"asc"}});
    const rows = chunks.flatMap(chunk => chunk.rows as QueryResult["rows"]).slice(offset%1000,offset%1000+pageSize);
    if(item.expiresAt.getTime()<=Date.now() || rows.length !== Math.min(pageSize,Math.max(0,item.resultRowCount-offset)))throw new NotFoundException("结果已过期或不完整，请重新查询");
    return {columns:item.resultColumns as unknown as QueryResultColumn[],rows,page,page_size:pageSize,total:item.resultRowCount,total_pages:Math.max(1,Math.ceil(item.resultRowCount/pageSize)),truncated:item.truncated};
  }
  async cancel(member: string,id: string) {
    await this.owned(member,id);
    await this.queries.cancel(member,id);
    this.active.get(id)?.abort();
    await this.refresh(id);
    return this.get(member,id);
  }
  async *rows(member: string,id: string) {
    const item = await this.ready(member,id);
    let index = 0, emitted = 0;
    for (;;) {
      const chunks = await prisma.queryResultChunk.findMany({where:{queryExecutionId:id,chunkIndex:{gte:index,lt:index+10}},orderBy:{chunkIndex:"asc"}});
      if(!chunks.length) {if(emitted !== item.resultRowCount)throw new NotFoundException("结果已过期或不完整，请重新查询");return;}
      for(const chunk of chunks)for(const row of chunk.rows as QueryResult["rows"]) {emitted++;if(emitted>item.resultRowCount)throw new Error("结果分块不一致");yield row;}
      index += chunks.length;
    }
  }
  private async tick() {
    const active = await prisma.queryExecution.findMany({where:{kind:QueryExecutionKind.DATA_QUERY,status:{in:["PENDING","RUNNING","CANCELLING"]}},select:{id:true,status:true}});
    for(const item of active) {
      if(item.status === "CANCELLING")this.active.get(item.id)?.abort();
      if(!this.active.has(item.id))void this.refresh(item.id).catch(() => undefined);
    }
    if(Date.now()-this.lastCleanup >= 60000) {
      this.lastCleanup = Date.now();
      await prisma.queryResultChunk.deleteMany({where:{execution:{kind:QueryExecutionKind.DATA_QUERY,expiresAt:{lte:new Date()}}}});
    }
  }
  private async refresh(id: string) {
    if(this.active.has(id) || this.stopped)return;
    const controller = new AbortController(); this.active.set(id,controller);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      const item = await prisma.queryExecution.findUnique({where:{id}});
      if(!item || item.kind !== QueryExecutionKind.DATA_QUERY || terminal.has(item.status))return;
      if(!item.ownerMemberNo)throw new Error("查询未归属账号，无法执行");
      if(item.status === "CANCELLING") { await this.finish(id,"CANCELLED"); return; }
      const remaining = item.submittedAt.getTime()+timeoutMs-Date.now();
      if(remaining<=0) { expired = true; throw new Error("查询超过 10 分钟"); }
      deadline = setTimeout(() => {expired=true;controller.abort();},remaining);
      if(!item.remoteInstanceId)return;
      const client = await this.queries.clientFor(item.dataSourceId,controller.signal);
      const project = await this.queries.projectFor(item.metaTableId);
      const remote = await this.withAbort(client.getInstance(item.remoteInstanceId,project),controller.signal);
      controller.signal.throwIfAborted();
      if(remote.status === "RUNNING" || remote.status === "UNKNOWN")return;
      if(remote.status === "CANCELLED"){await this.finish(id,"CANCELLED");return;}
      if(remote.status !== "SUCCEEDED")throw new Error("MaxCompute 查询执行失败");
      const source = await this.datasource.getWithCredentials(item.dataSourceId);
      const config = source.connectionConfig as Record<string,string>;
      const credentials = source.credentials as {accessKey:string;secretKey:string};
      const columns = item.resultColumns as unknown as QueryResultColumn[];
      await prisma.queryResultChunk.deleteMany({where:{queryExecutionId:id}});
      let count = 0, bytes = 0, index = 0, truncated = false;
      let pending: QueryResult["rows"] = [];
      const flush = async () => {if(!pending.length)return;await prisma.queryResultChunk.create({data:{queryExecutionId:id,chunkIndex:index++,rows:pending as Prisma.InputJsonValue}});pending=[];};
      for await (const batch of this.reader.read({endpoint:config.endpoint,project,instanceId:item.remoteInstanceId,accessKey:credentials.accessKey,secretKey:credentials.secretKey},controller.signal)) {
        const current = await prisma.queryExecution.findUnique({where:{id},select:{status:true}});
        if(current?.status !== "RUNNING") {controller.abort(); controller.signal.throwIfAborted();}
        for(const raw of batch) {
          if(count >= maxRows) {truncated = true; continue;}
          if(raw.length !== columns.length && !(raw.length === columns.length+1 && /AS `__snapshot_date`/.test(item.sql)))throw new Error("结果列定义不一致");
          const row = raw.slice(0,columns.length);
          pending.push(row);count++;bytes+=Buffer.byteLength(JSON.stringify(row));
          if(pending.length === 1000)await flush();
        }
      }
      controller.signal.throwIfAborted();
      await flush();
      controller.signal.throwIfAborted();
      const changed = await prisma.queryExecution.updateMany({where:{id,status:"RUNNING"},data:{status:"SUCCEEDED",resultRowCount:count,resultBytes:Math.min(bytes,2147483647),truncated,completedAt:new Date(),error:null}});
      if(!changed.count)await prisma.queryResultChunk.deleteMany({where:{queryExecutionId:id}});
    } catch(error) {
      if(this.stopped)return; // leave RUNNING: the next process re-reads, replacing partial chunks
      const current = await prisma.queryExecution.findUnique({where:{id}});
      if(!current || terminal.has(current.status))return;
      if(expired) {
        await this.finish(id,"TIMED_OUT","查询超过 10 分钟（包含执行和完整结果读取）");
        if(current.remoteInstanceId)void this.queries.clientFor(current.dataSourceId,AbortSignal.timeout(10000)).then(async client => client.cancelInstance(current.remoteInstanceId!,await this.queries.projectFor(current.metaTableId))).catch(() => undefined);
      } else if(current.status === "CANCELLING" || controller.signal.aborted) {await this.finish(id,"CANCELLED");}
      else await this.finish(id,"FAILED",error instanceof Error ? error.message.slice(0,1000) : "完整结果读取失败");
    } finally {if(deadline)clearTimeout(deadline);this.active.delete(id);}
  }
  private withAbort<T>(operation: Promise<T>,signal: AbortSignal): Promise<T> {
    return new Promise((resolve,reject) => {
      const abort = () => {signal.removeEventListener("abort",abort);reject(new Error("读取已中止"));};
      if(signal.aborted) {void operation.catch(() => undefined);abort();return;}
      signal.addEventListener("abort",abort,{once:true});
      operation.then(value => {signal.removeEventListener("abort",abort);resolve(value);},error => {signal.removeEventListener("abort",abort);reject(error);});
    });
  }
  private async finish(id: string,status:"FAILED"|"CANCELLED"|"TIMED_OUT",error?:string) {
    await prisma.queryResultChunk.deleteMany({where:{queryExecutionId:id}});
    await prisma.queryExecution.updateMany({where:{id,status:{in:["PENDING","RUNNING","CANCELLING"]}},data:{status,error:error ?? null,completedAt:new Date(),resultRowCount:0}});
  }
}
