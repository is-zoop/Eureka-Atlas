/* eslint-disable @typescript-eslint/no-explicit-any -- Pi Agent and persisted protocol messages are ESM runtime values. */
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { AskRunStatus, Prisma, QueryExecutionStatus, prisma } from "@eureka-atlas/database";
import type { AskProcessingStep, AskClarificationRequest, AskConditionChanges, AskCursorPage, AskThinkingLevel, AskRun, AskRunCreateRequest, AskSavedQueryResult, AskSession, AskSessionCreateRequest, AskSessionUpdateRequest, DimensionValuesRequest, QueryExecution, QueryRequest, SemanticPackage } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { requireMemberNo } from "../auth/member-no";
import { searchSemanticPackages } from "../semantic/semantic-asset-search";
import { ModelConfigService } from "../model-config/model-config.service";
import { QueryExecutionService } from "../query/query-execution.service";
import { finalQueryIds, processingDetails, toolLabels, toolSummary } from "./ask-processing";
import { finalCharts, validateCharts } from "./ask-chart";
import { AskEventService } from "./ask-event.service";
import { buildAskSystemPrompt } from "./ask-prompt";
import { SystemSettingsService } from "../system-settings/system-settings.service";
import { AskScope, AskScopeService } from "./ask-scope.service";
import { completeToolHistory, type AskHistory } from "./ask-history";
import { AskContextCompactor } from "./ask-compaction";
import { askQueryParameters, askSearchParameters, scopeDataDomains } from "./ask-query-schema";
import { AskExecutionGuard, ASK_EXECUTION_LIMITS } from "./ask-execution-guard";
import { answerClarification, clarificationParameters, createClarification, readClarification } from "./ask-clarification";

const terminalStatuses = new Set<AskRunStatus>(["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const unfinishedStatuses: AskRunStatus[] = ["RUNNING", "CANCELLING", "WAITING_CLARIFICATION"];
const queryTerminal = new Set<QueryExecutionStatus>(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
const asStringList = (value: unknown) => Array.isArray(value) ? value.map(string).filter(Boolean) : [];
const esm = (specifier: string): Promise<any> => new Function("specifier", "return import(specifier)")(specifier) as Promise<any>;
const defaultChanges = (): AskConditionChanges => ({ inherited: [], changed: [] });
const thinkingLevels = new Set<AskThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const thinkingLevel = (value: unknown): AskThinkingLevel => { const candidate = string(value).toLowerCase() || "off"; if (!thinkingLevels.has(candidate as AskThinkingLevel)) throw new BadRequestException("推理强度无效"); return candidate as AskThinkingLevel; };
type LiveRun = { finished: Promise<void>; abort: AbortController; agent?: any; guard: AskExecutionGuard };

@Injectable()
export class AskRunService implements OnModuleInit {
  private live = new Map<string, LiveRun>();
  constructor(
    private readonly scopeService: AskScopeService,
    private readonly models: ModelConfigService,
    private readonly queries: QueryExecutionService,
    private readonly events: AskEventService,
    private readonly settings: SystemSettingsService,
  ) {}

  async onModuleInit() {
    await prisma.askRun.updateMany({ where: { status: { in: ["RUNNING", "CANCELLING"] } }, data: { status: "INTERRUPTED", error: "服务已重启，未完成的模型运行没有自动重放", completedAt: new Date() } });
  }

  async listSessions(memberNo: string, cursor?: string, limit = 20): Promise<AskCursorPage<AskSession>> {
    requireMemberNo(memberNo);
    if (cursor) await this.session(memberNo, cursor);
    const take = Math.min(Math.max(Number(limit) || 20, 1), 20);
    const rows = await prisma.askSession.findMany({ where: { ownerMemberNo: memberNo }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { runs: { where: { status: { in: unfinishedStatuses } }, select: { id: true, status: true, question: true }, take: 1, orderBy: { startedAt: "desc" } } } });
    const items = rows.slice(0, take).map((session) => this.sessionResponse(session));
    return { items, next_cursor: rows.length > take ? rows[take - 1]?.id ?? null : null };
  }

  async createSession(memberNo: string, input: AskSessionCreateRequest = {}): Promise<AskSession> {
    requireMemberNo(memberNo);
    const runtime = await this.models.agentRuntime(string(input.model_id) || undefined);
    const selectedThinkingLevel = thinkingLevel(input.thinking_level ?? runtime.defaultThinkingLevel);
    if (!runtime.thinkingLevels.includes(selectedThinkingLevel)) throw new BadRequestException("当前模型不支持所选推理强度");
    const tableIds = asStringList(input.table_ids);
    if (tableIds.length) await this.scopeService.resolve(tableIds);
    const session = await prisma.askSession.create({ data: { ownerMemberNo: memberNo, title: string(input.title) || "新对话", tableIds: tableIds as Prisma.InputJsonValue, modelConfigId: runtime.modelConfigId, thinkingLevel: selectedThinkingLevel } });
    return this.sessionResponse({ ...session, runs: [] });
  }
  async session(memberNo: string, sessionId: string): Promise<AskSession> {
    const item = await prisma.askSession.findUnique({ where: { id: sessionId, ownerMemberNo: requireMemberNo(memberNo) }, include: { runs: { where: { status: { in: unfinishedStatuses } }, select: { id: true, status: true, question: true }, take: 1, orderBy: { startedAt: "desc" } } } });
    if (!item || item.ownerMemberNo !== memberNo) throw new NotFoundException("问数会话不存在");
    return this.sessionResponse(item);
  }

  async updateSession(memberNo: string, sessionId: string, input: AskSessionUpdateRequest): Promise<AskSession> {
    await this.session(memberNo, sessionId);
    const expected = Number(input?.expected_configuration_version);
    if (!Number.isInteger(expected)) throw new BadRequestException("缺少会话配置版本");
    const current = await prisma.askSession.findUnique({ where: { id: sessionId, ownerMemberNo: requireMemberNo(memberNo) }, include: { runs: { where: { status: { in: unfinishedStatuses } }, select: { id: true } } } });
    if (!current || current.ownerMemberNo !== memberNo) throw new NotFoundException("问数会话不存在");
    if (current.configurationVersion !== expected) throw new ConflictException("会话配置已被更新，请刷新后再试");
    if (current.runs.length) throw new ConflictException("当前问题尚未结束，不能修改数据选择、模型或推理强度");
    const tableIds = input.table_ids === undefined ? asStringList(current.tableIds) : asStringList(input.table_ids);
    if (input.table_ids !== undefined && tableIds.length) await this.scopeService.resolve(tableIds);
    const runtime = await this.models.agentRuntime(input.model_id === undefined ? current.modelConfigId : string(input.model_id) || undefined);
    const inheritedThinkingLevel = thinkingLevel(current.thinkingLevel);
    const modelChanged = runtime.modelConfigId !== current.modelConfigId;
    const selectedThinkingLevel = input.thinking_level === undefined
      ? modelChanged && !runtime.thinkingLevels.includes(inheritedThinkingLevel)
        ? thinkingLevel(runtime.defaultThinkingLevel)
        : inheritedThinkingLevel
      : thinkingLevel(input.thinking_level);
    if (!runtime.thinkingLevels.includes(selectedThinkingLevel)) throw new BadRequestException("当前模型不支持所选推理强度");
    const title = input.title === undefined ? current.title : string(input.title);
    if (!title || title.length > 100) throw new BadRequestException("会话名称为 1 到 100 个字符");
    const updated = await prisma.askSession.update({ where: { id: sessionId, ownerMemberNo: memberNo }, data: { title, tableIds: tableIds as Prisma.InputJsonValue, modelConfigId: runtime.modelConfigId, thinkingLevel: selectedThinkingLevel, configurationVersion: { increment: 1 } }, include: { runs: { where: { status: { in: unfinishedStatuses } }, select: { id: true, status: true, question: true }, take: 1 } } });
    return this.sessionResponse(updated);
  }
  async deleteSession(memberNo: string, sessionId: string) {
    const item = await prisma.askSession.findUnique({ where: { id: sessionId, ownerMemberNo: requireMemberNo(memberNo) }, include: { runs: { where: { status: { in: unfinishedStatuses } }, select: { id: true } } } });
    if (!item || item.ownerMemberNo !== memberNo) throw new NotFoundException("问数会话不存在");
    if (item.runs.length) throw new ConflictException("会话存在未结束的问题，请先停止并等待查询状态确认");
    await prisma.askSession.delete({ where: { id: sessionId, ownerMemberNo: memberNo } });
    return null;
  }

  async listRuns(memberNo: string, sessionId: string, cursor?: string, limit = 20): Promise<AskCursorPage<AskRun>> {
    await this.session(memberNo, sessionId);
    if (cursor) {
      const previous = await prisma.askRun.findUnique({ where: { id: cursor } });
      if (!previous || previous.askSessionId !== sessionId) throw new NotFoundException("问数运行不存在");
    }
    const take = Math.min(Math.max(Number(limit) || 20, 1), 20);
    const rows = await prisma.askRun.findMany({ where: { askSessionId: sessionId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: this.runIncludes() });
    const saved = await prisma.askSavedQueryResult.findMany({ where: { askRunId: { in: rows.map((run) => run.id) } }, select: { askRunId: true, queryExecutionId: true, createdAt: true } });
    const byRun = new Map<string, Array<{ queryExecutionId: string; createdAt: Date }>>();
    saved.forEach((item) => byRun.set(item.askRunId, [...(byRun.get(item.askRunId) ?? []), item]));
    return { items: rows.slice(0, take).map((run) => this.runResponse(run, byRun.get(run.id))), next_cursor: rows.length > take ? rows[take - 1]?.id ?? null : null };
  }

  async create(memberNo: string, sessionId: string, input: AskRunCreateRequest): Promise<AskRun> {
    await this.session(memberNo, sessionId);
    const question = string(input?.question); const idempotencyKey = string(input?.idempotency_key); const expected = Number(input?.expected_configuration_version);
    if (!question) throw new BadRequestException("请输入问题");
    if (!idempotencyKey) throw new BadRequestException("缺少幂等标识");
    if (!Number.isInteger(expected)) throw new BadRequestException("缺少会话配置版本");
    const existing = await prisma.askRun.findUnique({ where: { askSessionId_idempotencyKey: { askSessionId: sessionId, idempotencyKey } } });
    if (existing) {
      if (existing.askSessionId !== sessionId || existing.question !== question) throw new ConflictException("幂等标识已用于其他请求");
      return this.detail(memberNo, existing.id);
    }
    const sessionSnapshot = await prisma.askSession.findUnique({ where: { id: sessionId, ownerMemberNo: memberNo } });
    if (!sessionSnapshot || sessionSnapshot.ownerMemberNo !== memberNo) throw new NotFoundException("问数会话不存在");
    if (sessionSnapshot.configurationVersion !== expected) throw new ConflictException("会话配置已更新，请刷新后再发送");
    const selectedThinkingLevel = thinkingLevel(sessionSnapshot.thinkingLevel);
    const runtime = await this.models.agentRuntime(sessionSnapshot.modelConfigId);
    if (!runtime.thinkingLevels.includes(selectedThinkingLevel)) throw new BadRequestException("当前模型不支持所选推理强度");
    const preparedScope = await this.scopeService.resolve(sessionSnapshot.tableIds);
    let run;
    try {
      run = await prisma.$transaction(async (tx) => {
        const session = await tx.askSession.findUnique({ where: { id: sessionId, ownerMemberNo: memberNo } });
        if (!session || session.ownerMemberNo !== memberNo) throw new NotFoundException("问数会话不存在");
        if (session.configurationVersion !== expected) throw new ConflictException("会话配置已更新，请刷新后再发送");
        const active = await tx.askRun.findFirst({ where: { askSessionId: sessionId, status: { in: unfinishedStatuses } }, select: { id: true } });
        if (active) throw new ConflictException("当前会话已有未结束的问题");
        const tableIds = preparedScope.tableIds;
        const title = session.title === "新对话" ? question.slice(0, 30) : undefined;
        if (title) await tx.askSession.update({ where: { id: sessionId }, data: { title } });
        return tx.askRun.create({ data: { askSessionId: sessionId, idempotencyKey, question, modelConfigId: session.modelConfigId, modelDisplayName: runtime.displayName, modelProviderName: runtime.providerName, thinkingLevel: selectedThinkingLevel, tableIds: tableIds as Prisma.InputJsonValue, packageVersions: {} } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof ConflictException || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code));
      if (retryable) {
        const existing = await prisma.askRun.findUnique({ where: { askSessionId_idempotencyKey: { askSessionId: sessionId, idempotencyKey } } });
        if (existing) {
          if (existing.question !== question) throw new ConflictException("幂等标识已用于其他请求");
          return this.detail(memberNo, existing.id);
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new ConflictException("会话正在更新，请重试");
      }
      throw error;
    }
    const packageVersions = Object.fromEntries([...preparedScope.packages.entries()].map(([id, pkg]) => [id, pkg.content_version]));
    await prisma.askRun.update({ where: { id: run.id }, data: { packageVersions: packageVersions as Prisma.InputJsonValue } });
    await this.events.publish(run.id, "status", { status: "RUNNING" });
    void this.run(run.id, question, run.loopVersion);
    return this.detail(memberNo, run.id);
  }
  async detail(memberNo: string, runId: string): Promise<AskRun> {
    await this.assertRunOwnership(memberNo, runId);
    const run = await prisma.askRun.findUnique({ where: { id: runId }, include: this.runIncludes() });
    if (!run) throw new NotFoundException("问数运行不存在");
    const saved = await prisma.askSavedQueryResult.findMany({ where: { askRunId: runId }, select: { queryExecutionId: true, createdAt: true } });
    return this.runResponse(run, saved);
  }

  async clarify(memberNo: string, runId: string, input: AskClarificationRequest) {
    await this.assertRunOwnership(memberNo, runId);
    const clarificationId = string(input?.clarification_id);
    if (!clarificationId) throw new BadRequestException("澄清 ID 不能为空");
    const run = await prisma.askRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException("问数运行不存在");
    if (run.status !== "WAITING_CLARIFICATION" || run.clarificationId !== clarificationId) throw new ConflictException("澄清已被处理或已失效");
    const clarification = readClarification(run.clarification, clarificationId);
    if (!clarification) throw new ConflictException("旧格式澄清已失效，请停止本轮后重新提问");
    const { response, answer } = answerClarification(clarification, input);
    await this.live.get(runId)?.finished;
    const changed = await prisma.askRun.updateMany({ where: { id: runId, status: "WAITING_CLARIFICATION", clarificationId }, data: { status: "RUNNING", loopVersion: { increment: 1 }, clarification: { ...clarification, response, answer } as unknown as Prisma.InputJsonValue, error: null, completedAt: null } });
    if (!changed.count) throw new ConflictException("澄清已被处理或已失效");
    await this.events.publish(runId, "status", { status: "RUNNING" });
    void this.run(runId, `用户对澄清问题「${string(clarification.question)}」的回答：${answer}\n请接着本轮已完成的步骤执行，保留此前已确认的表、日期、店铺真实名称和指标，不要重新搜索已确定的表。`, run.loopVersion + 1);
    return this.detail(memberNo, runId);
  }

  async cancel(memberNo: string, runId: string) {
    await this.assertRunOwnership(memberNo, runId);
    const run = await prisma.askRun.findUnique({ where: { id: runId }, include: { queries: true } });
    if (!run) throw new NotFoundException("问数运行不存在");
    if (terminalStatuses.has(run.status)) return this.detail(memberNo, runId);
    await prisma.askRun.update({ where: { id: runId }, data: { status: "CANCELLING" } });
    await this.events.publish(runId, "status", { status: "CANCELLING" });
    this.live.get(runId)?.abort.abort(); this.live.get(runId)?.agent?.abort();
    await Promise.all(run.queries.map(({ queryExecutionId }) => this.queries.cancel(memberNo, queryExecutionId).catch(() => undefined)));
    void this.finishCancellation(runId);
    return this.detail(memberNo, runId);
  }

  async queryResult(memberNo: string, runId: string, queryId: string): Promise<AskSavedQueryResult> {
    await this.assertRunOwnership(memberNo, runId);
    const saved = await prisma.askSavedQueryResult.findFirst({ where: { askRunId: runId, queryExecutionId: queryId } });
    if (saved) return saved.snapshot as unknown as AskSavedQueryResult;
    await this.queries.assertOwnership(memberNo, queryId);
    const link = await prisma.askRunQuery.findFirst({ where: { askRunId: runId, queryExecutionId: queryId }, include: { queryExecution: true } });
    const run = await prisma.askRun.findUnique({ where: { id: runId } });
    if (!link || !run?.askSessionId) throw new NotFoundException("该查询不属于当前问数运行");
    const execution = await this.queries.result(memberNo, queryId);
    const table = await prisma.metaTable.findUnique({ where: { id: execution.table_id }, include: { metaProject: true, semantic: true } });
    const request = link.queryExecution.request as unknown as QueryRequest | DimensionValuesRequest;
    const snapshot: AskSavedQueryResult = { query_id: queryId, execution, source: { business_name: table?.semantic?.businessName ?? table?.name ?? "已删除表", physical_name: table?.name ?? "已删除表", project: table?.metaProject.name ?? "", catalog: table?.metaProject.catalog ?? "", schema: table?.metaProject.schema ?? "" }, query_definition: request, condition_changes: defaultChanges(), saved_at: new Date().toISOString() };
    await prisma.askSavedQueryResult.create({ data: { askSessionId: run.askSessionId, askRunId: runId, queryExecutionId: queryId, snapshot: snapshot as unknown as Prisma.InputJsonValue } }).catch(async (error) => { if (!String(error).includes("Unique constraint")) throw error; });
    return (await prisma.askSavedQueryResult.findUniqueOrThrow({ where: { queryExecutionId: queryId } })).snapshot as unknown as AskSavedQueryResult;
  }

  async assertRunOwnership(memberNo: string, runId: string): Promise<void> {
    requireMemberNo(memberNo);
    const run = await prisma.askRun.findUnique({ where: { id: runId }, include: { session: { select: { ownerMemberNo: true } } } });
    if (!run?.session || run.session.ownerMemberNo !== memberNo) throw new NotFoundException("问数运行不存在");
  }

  private async finishCancellation(runId: string) {
    for (let attempts = 0; attempts < 200; attempts += 1) {
      const run = await prisma.askRun.findUnique({ where: { id: runId }, include: { queries: { include: { queryExecution: true } } } });
      if (!run || run.status !== "CANCELLING") return;
      if (!this.live.has(runId) && run.queries.every((item) => queryTerminal.has(item.queryExecution.status))) {
        await prisma.askRun.update({ where: { id: runId }, data: { status: "CANCELLED", completedAt: new Date() } });
        await this.events.publish(runId, "status", { status: "CANCELLED" });
        return;
      }
      await sleep(1500);
    }
  }

  private async run(runId: string, prompt: string, loopVersion: number) {
    const abort = new AbortController();
    const previous = await prisma.askRunMessage.findMany({ where: { askRunId: runId }, orderBy: { sequence: "asc" }, select: { role: true, content: true, sequence: true } });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const guard = new AskExecutionGuard(previous.filter((item) => item.role === "ASSISTANT").length, previous.filter((item) => item.role === "TOOL").length);
    const live: LiveRun = { finished, abort, guard };
    this.live.set(runId, live);
    const timeout = setTimeout(() => { guard.timedOut(); abort.abort(); live.agent?.abort(); }, ASK_EXECUTION_LIMITS.timeoutMs);
    try {
      const run = await prisma.askRun.findUniqueOrThrow({ where: { id: runId }, include: { session: { select: { ownerMemberNo: true } } } });
      const memberNo = requireMemberNo(run.session?.ownerMemberNo);
      const resumedClarification = readClarification(run.clarification, string(run.clarificationId));
      const scope = await this.scopeService.resolve(run.tableIds);
      const [core, { Type }, runtime] = await Promise.all([esm("@earendil-works/pi-agent-core"), esm("typebox"), this.models.agentRuntime(run.modelConfigId)]);
      const { Agent } = core;
      const tools = this.tools(runId, memberNo, live, Type, scope);
      const history = await this.messageHistory(run, scope);
      // A clarification resumes this same run. Its earlier tool results are not
      // in completed-session history and must be replayed with their calls.
      if (previous.length) {
        const messages = previous.map((item) => item.content as any);
        if (!completeToolHistory(messages)) throw new BadRequestException("本轮澄清上下文中的工具调用记录不完整，请重新提问。");
        history.messages.push(...messages);
        history.references.push(...previous.map((item) => ({ runId, sequence: item.sequence })));
      }
      const systemPrompt = await this.systemPrompt(scope);
      let eventQueue = Promise.resolve();
      const compactor = new AskContextCompactor(core, {
        model: runtime.model, models: runtime.runtime, apiKey: runtime.apiKey, headers: runtime.headers,
        systemPrompt, tools, checkpoint: history.checkpoint,
        onStart: async () => { await this.events.publish(runId, "progress", { step: "正在自动压缩上下文" }); },
        onComplete: async (checkpoint) => {
          const through = history.references[checkpoint.coveredCount - 1] ?? {
            runId, sequence: previous.length + checkpoint.coveredCount - history.messages.length,
          };
          await this.events.publish(runId, "progress", {
            step: "上下文自动压缩完成", compaction: {
              summary: checkpoint.summary, through_run_id: through.runId, through_sequence: through.sequence,
              table_ids: [...scope.tableIds].sort(), tokens_before: checkpoint.tokensBefore,
              tokens_after: checkpoint.tokensAfter, usage: checkpoint.usage,
            },
          });
        },
      });
      const agent = new Agent({ initialState: { systemPrompt, model: runtime.model, thinkingLevel: thinkingLevel(run.thinkingLevel), tools, messages: history.messages }, streamFn: (...args: any[]) => {
        if (guard.reason) throw new Error(guard.reason);
        abort.signal.throwIfAborted();
        return runtime.runtime.streamSimple(...args);
      }, getApiKey: async () => runtime.apiKey,
        transformContext: async (messages: any[]) => { await eventQueue; return compactor.transform(messages, abort.signal); },
        toolExecution: "sequential", beforeToolCall: async () => {
        if (guard.reason) return { block: true, reason: guard.reason, terminate: true };
        if (abort.signal.aborted) return { block: true, reason: "当前运行已停止", terminate: true };
        const state = await prisma.askRun.findUniqueOrThrow({ where: { id: runId } });
        if (state.status !== "RUNNING" || state.loopVersion !== loopVersion) return { block: true, reason: "当前运行已停止或已被新的澄清继续替代", terminate: true };
      } });
      live.agent = agent;
      // Pi notifies synchronously. Drain persistence before publishing success.
      let eventError: unknown;
      let assistantIndex = 0;
      let assistantId: string | null = null;
      let assistantStarted = new Date();
      const toolSteps = new Map<string, AskProcessingStep>();
      const toolArguments = new Map<string, unknown>();
      agent.subscribe((event: any) => {
        const timestamp = new Date();
        if (event.type === "turn_start") { guard.modelStarted(); if (guard.reason) { abort.abort(); agent.abort(); } }
        if (event.type === "tool_execution_start") {
          toolArguments.set(event.toolCallId, event.args);
          guard.toolStarted(event.toolName, event.args);
        }
        if (event.type === "tool_execution_end") {
          const warning = guard.toolFinished(event.toolName, toolArguments.get(event.toolCallId), event.result, event.isError);
          toolArguments.delete(event.toolCallId);
          if (warning) agent.steer({ role: "user", content: warning, timestamp: Date.now() });
        }
        eventQueue = eventQueue.then(async () => {
          if (event.type === "message_start" && event.message?.role === "assistant") {
            assistantId = `${runId}:${loopVersion}:assistant:${++assistantIndex}`;
            assistantStarted = timestamp;
            await this.events.publish(runId, "answer", { message_id: assistantId, phase: "start" });
          }
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            await this.events.publish(runId, "answer", { message_id: assistantId, phase: "delta", delta: event.assistantMessageEvent.delta });
          }
          if (event.type === "message_end") {
            const clarification = event.message?.role === "user" ? resumedClarification : null;
            const userText = typeof event.message?.content === "string" ? event.message.content
              : (event.message?.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("");
            const recordedMessage = clarification?.response && userText === prompt ? {
              ...event.message, clarification_response: { clarification_id: clarification.id, ...clarification.response },
            } : event.message;
            const messageCount = await this.recordMessage(runId, recordedMessage, event.message?.role === "assistant" ? assistantId ?? undefined : undefined);
            if (event.message?.role === "assistant") {
              const calls = (event.message.content ?? []).filter((part: any) => part.type === "toolCall");
              const step: AskProcessingStep = { id: assistantId!, message_id: assistantId, tool_call_id: null, kind: "message", name: "模型响应", status: event.message.stopReason === "error" || event.message.stopReason === "aborted" ? "FAILED" : "SUCCEEDED", summary: calls.length ? `已安排 ${calls.length} 项工具调用` : "已生成回答", started_at: assistantStarted.toISOString(), completed_at: timestamp.toISOString(), elapsed_ms: timestamp.getTime() - assistantStarted.getTime() };
              await this.events.publish(runId, "processing", { step, message_count: messageCount });
              await this.events.publish(runId, "answer", { message_id: assistantId, phase: "end", intermediate: calls.length > 0 });
            } else {
              await this.events.publish(runId, "processing", { message_count: messageCount });
            }
          }
          if (event.type === "tool_execution_start") {
            const step: AskProcessingStep = { id: `${runId}:${loopVersion}:tool:${event.toolCallId}`, message_id: assistantId, tool_call_id: event.toolCallId, kind: "tool", name: toolLabels[event.toolName] ?? "数据处理", status: "RUNNING", summary: "正在处理", started_at: timestamp.toISOString(), completed_at: null, elapsed_ms: null };
            toolSteps.set(event.toolCallId, step);
            await this.events.publish(runId, "processing", { step });
          }
          if (event.type === "tool_execution_end") {
            const original = toolSteps.get(event.toolCallId);
            if (original) await this.events.publish(runId, "processing", { step: { ...original, status: event.isError ? "FAILED" : "SUCCEEDED", summary: toolSummary(event.toolName, event.result?.details, event.isError), completed_at: timestamp.toISOString(), elapsed_ms: timestamp.getTime() - Date.parse(original.started_at) } });
          }
        }).catch((error) => { eventError = error; abort.abort(); agent.abort(); });
      });
      await this.events.publish(runId, "progress", { step: "调用 Pi Agent" });
      try { await agent.prompt(prompt); } finally { await eventQueue; }
      if (eventError) throw eventError;
      if (guard.reason) throw new Error(guard.reason);
      const finalMessage = [...agent.state.messages].reverse().find((item: any) => item.role === "assistant");
      if (finalMessage?.stopReason === "error" || finalMessage?.stopReason === "aborted") throw new Error(finalMessage.errorMessage || "模型生成未完成");
      const current = await prisma.askRun.findUniqueOrThrow({ where: { id: runId } });
      if (current.loopVersion !== loopVersion || current.status === "WAITING_CLARIFICATION" || current.status === "CANCELLING" || current.status === "CANCELLED") return;
      const answer = this.textFromAgent(agent);
      await prisma.askRun.update({ where: { id: runId }, data: { status: "SUCCEEDED", answer: answer || "查询已完成。", completedAt: new Date() } });
      await this.events.publish(runId, "status", { status: "SUCCEEDED" });
    } catch (error) {
      const current = await prisma.askRun.findUnique({ where: { id: runId } });
      if (current?.loopVersion !== loopVersion || current?.status === "CANCELLING" || current?.status === "CANCELLED") return;
      const message = guard.reason ?? (error instanceof Error ? error.message : "智能问数运行失败");
      // Only the cancel endpoint represents a user cancellation. Automatic
      // budget/timeout stops must surface their reason as failures, not CANCELLED.
      await prisma.askRun.update({ where: { id: runId }, data: { status: "FAILED", error: message.slice(0, 2000), completedAt: new Date() } }).catch(() => undefined);
      await this.events.publish(runId, "error", { message: message.slice(0, 1000) }).catch(() => undefined);
      await this.events.publish(runId, "status", { status: "FAILED" }).catch(() => undefined);
    } finally { clearTimeout(timeout); if (this.live.get(runId) === live) this.live.delete(runId); finish(); }
  }

  private tools(runId: string, memberNo: string, live: LiveRun, Type: any, scope: AskScope) {
    const queryParameters = askQueryParameters(Type);
    const searchParameters = askSearchParameters(Type, scopeDataDomains(scope.packages.values()));
    const textResult = (value: unknown, terminate = false) => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: value, ...(terminate ? { terminate: true } : {}) });
    const scopeFor = async () => {
      await this.assertRunOwnership(memberNo, runId);
      const run = await prisma.askRun.findUniqueOrThrow({ where: { id: runId } });
      return { run, scope: await this.scopeService.resolve(run.tableIds) };
    };
    const freshPackage = async (tableId: string) => {
      const { run, scope } = await scopeFor();
      const pkg = await this.scopeService.package(scope, tableId);
      const versions = run.packageVersions as Record<string, string>;
      if (versions[tableId] && versions[tableId] !== pkg.content_version) throw new BadRequestException("该表的正式语义已更新，请先重新读取语义并确认口径");
      return pkg;
    };
    return [
      { name: "present_query_results", description: "选择最终查询结果，默认展示表格。仅当当前用户问题明确要求生成或修改图表时才提供 charts；否则省略 charts 或传空数组。查询趋势、对比、同比、环比、排行、占比不等于要求图表；上一轮的绘图意图不自动沿用，明确要求不画图时不提供 charts。图表类型：line 折线图、bar 柱状图、pie 饼图。x_column 和 y_columns 为查询结果 columns 的零基列索引，不是字段 ID；只能引用本轮已保存且已选入 query_ids 的指标查询。横轴分类必须唯一，不自行汇总；同图指标单位一致。饼图单指标、非负、最多 20 个分类。图表使用全部已保存行，不能提供 HTML 或自造数据。纯文字回答可传空数组。", parameters: Type.Object({ query_ids: Type.Array(Type.String()), charts: Type.Optional(Type.Array(Type.Object({ query_id: Type.String(), type: Type.Union([Type.Literal("line"), Type.Literal("bar"), Type.Literal("pie")]), title: Type.String({ minLength: 1, maxLength: 120 }), x_column: Type.Integer({ minimum: 0 }), y_columns: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 4 }) }), { maxItems: 4 })) }), execute: async (_: string, input: any) => {
        const ids = [...new Set(asStringList(input.query_ids))];
        const saved = await prisma.askSavedQueryResult.findMany({ where: { askRunId: runId, queryExecutionId: { in: ids } }, select: { queryExecutionId: true, snapshot: true } });
        if (saved.length !== ids.length) throw new BadRequestException("只能展示本轮已成功保存的查询结果");
        const charts = validateCharts(input.charts, ids, saved.map((item) => item.snapshot as unknown as AskSavedQueryResult));
        return textResult({ query_ids: ids, charts });
      } },
      { name: "search_semantic_assets", description: "在本次已选表内按业务词、指标和维度搜索正式语义资产。", parameters: searchParameters, execute: async (_: string, input: any) => { const { scope } = await scopeFor(); const domains = scopeDataDomains(scope.packages.values()); if (input.data_domain && !domains.includes(input.data_domain)) throw new BadRequestException("数据域不在当前可查询表中；请使用真实数据域或省略 data_domain。"); const result = searchSemanticPackages([...scope.packages.values()], input); await this.events.publish(runId, "progress", { step: "搜索语义资产", total: result.total }); return textResult(result); } },
      { name: "get_semantic_package", description: "读取某张候选表的正式语义 Package。table_id 必须来自搜索结果或已选表。", parameters: Type.Object({ table_id: Type.String() }), execute: async (_: string, input: any) => { const { run, scope } = await scopeFor(); const pkg = await this.scopeService.package(scope, string(input.table_id)); await prisma.askRun.update({ where: { id: runId }, data: { packageVersions: { ...(run.packageVersions as object), [pkg.table.id]: pkg.content_version } as Prisma.InputJsonValue } }); await this.events.publish(runId, "progress", { step: "读取正式语义", table_id: pkg.table.id }); return textResult(pkg); } },
      { name: "get_dimension_values", description: "查询已开启候选值的维度真实取值，用于消除名称歧义。", parameters: queryParameters.dimensionValues, execute: async (_: string, input: any) => { const pkg = await freshPackage(string(input.table_id)); const request = { ...input, idempotency_key: `${runId}:dimension:${live.guard.totalTools}`, table_id: string(input.table_id), field_id: string(input.field_id), keyword: string(input.keyword) || undefined, limit: Number(input.limit) || 50 } as DimensionValuesRequest; const execution = await this.queries.dimensionValuesPackage(memberNo, pkg, request); await this.linkQuery(runId, execution.id); const done = await this.waitForQuery(memberNo, runId, execution.id, live.abort.signal); await this.saveResult(memberNo, runId, pkg, request, done); return textResult(this.querySummary(done)); } },
      { name: "query_data", description: "按正式语义执行一张表的聚合、分组、趋势或排行查询。只能提交字段和指标 ID，不能提交 SQL。", parameters: queryParameters.query, execute: async (_: string, input: any) => { const pkg = await freshPackage(string(input.table_id)); const request = { ...input, idempotency_key: `${runId}:query:${live.guard.totalTools}`, table_id: string(input.table_id) } as QueryRequest; const execution = await this.queries.submitPackage(memberNo, pkg, request); await this.linkQuery(runId, execution.id); await this.events.publish(runId, "progress", { step: "执行数据查询", query_id: execution.id }); const done = await this.waitForQuery(memberNo, runId, execution.id, live.abort.signal); await this.saveResult(memberNo, runId, pkg, request, done); return textResult(this.querySummary(done)); } },
      {
        name: "request_clarification",
        description: "信息不唯一时提出一个清晰的问题，停止并等待用户确认。必须指定 selection_mode 和 options；互斥选项 single，可合并选项 multiple，混合条件拆成连续问题。每项用简短 summary 和解释范围差异的 description，不臆造表、指标或日期；纯文字澄清用空 options。用户可以选择、输入自己的回答或同时补充。",
        parameters: clarificationParameters(Type),
        execute: async (_: string, input: unknown) => {
          const clarificationId = crypto.randomUUID();
          const clarification = createClarification(clarificationId, input);
          await prisma.askRun.update({ where: { id: runId }, data: {
            status: "WAITING_CLARIFICATION", clarificationId,
            clarification: clarification as unknown as Prisma.InputJsonValue,
          } });
          await this.events.publish(runId, "clarification", { ...clarification });
          return textResult({ waiting_for_user: true, clarification_id: clarificationId }, true);
        },
      },
    ];
  }

  private async linkQuery(runId: string, queryExecutionId: string) { await prisma.askRunQuery.upsert({ where: { queryExecutionId }, create: { askRunId: runId, queryExecutionId }, update: {} }); }

  private async saveResult(memberNo: string, runId: string, pkg: SemanticPackage, request: QueryRequest | DimensionValuesRequest, execution: QueryExecution) {
    await this.assertRunOwnership(memberNo, runId);
    await this.queries.assertOwnership(memberNo, execution.id);
    if (!execution.result) throw new BadRequestException("查询结果未返回，无法保存到会话");
    const run = await prisma.askRun.findUniqueOrThrow({ where: { id: runId } });
    const changes = await this.conditionChanges(run.askSessionId, request);
    const snapshot: AskSavedQueryResult = { query_id: execution.id, execution, source: { business_name: pkg.table.business_name, physical_name: pkg.table.name, project: pkg.source.project, catalog: pkg.source.catalog, schema: pkg.source.schema }, query_definition: request, condition_changes: changes, saved_at: new Date().toISOString() };
    await prisma.$transaction(async (tx) => {
      await tx.askSavedQueryResult.upsert({ where: { queryExecutionId: execution.id }, create: { askSessionId: run.askSessionId!, askRunId: runId, queryExecutionId: execution.id, snapshot: snapshot as unknown as Prisma.InputJsonValue }, update: {} });
      await tx.askRun.update({ where: { id: runId }, data: { queryDefinition: request as Prisma.InputJsonValue, conditionChanges: changes as unknown as Prisma.InputJsonValue } });
    });
  }

  private async conditionChanges(sessionId: string | null, request: QueryRequest | DimensionValuesRequest): Promise<AskConditionChanges> {
    if (!sessionId) return defaultChanges();
    const previous = await prisma.askRun.findFirst({ where: { askSessionId: sessionId, status: "SUCCEEDED", queryDefinition: { not: Prisma.JsonNull } }, orderBy: { completedAt: "desc" } });
    if (!previous?.queryDefinition || typeof previous.queryDefinition !== "object") return defaultChanges();
    const old = previous.queryDefinition as Record<string, unknown>; const inherited: string[] = []; const changed: string[] = [];
    for (const key of ["table_id", "metric_ids", "dimension_ids", "filters", "date_range", "order_by", "limit"]) {
      if (JSON.stringify(old[key]) === JSON.stringify((request as unknown as Record<string, unknown>)[key])) inherited.push(key);
      else changed.push(key);
    }
    return { inherited, changed };
  }

  private async messageHistory(run: { askSessionId: string | null; tableIds: unknown }, scope: AskScope): Promise<AskHistory> {
    if (!run.askSessionId) return { messages: [], references: [] };
    const historical = await prisma.askRun.findMany({
      where: { askSessionId: run.askSessionId, status: "SUCCEEDED" }, orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      include: {
        messages: { orderBy: { sequence: "asc" } },
        events: { where: { type: "progress", payload: { path: ["compaction"], not: Prisma.AnyNull } }, orderBy: { sequence: "asc" } },
      },
    });
    const permitted = new Set(scope.tableIds);
    const history: AskHistory = { messages: [], references: [] };
    const usable = [];
    for (const item of historical) {
      if (!asStringList(item.tableIds).every((id) => permitted.has(id))) continue;
      const group: any[] = item.messages.map((message) => message.content).filter((message) => message && typeof message === "object") as any[];
      if (!completeToolHistory(group)) continue;
      usable.push(item);
      for (const message of item.messages) {
        if (!message.content || typeof message.content !== "object") continue;
        history.messages.push(message.content as any);
        history.references.push({ runId: item.id, sequence: message.sequence });
      }
    }
    const scopeKey = JSON.stringify([...scope.tableIds].sort());
    for (const item of usable) {
      for (const event of item.events) {
        const checkpoint = (event.payload as any)?.compaction;
        if (!checkpoint || typeof checkpoint.summary !== "string" || !checkpoint.summary.trim()) continue;
        if (JSON.stringify(asStringList(checkpoint.table_ids).sort()) !== scopeKey) continue;
        const boundary = history.references.findIndex((ref) => ref.runId === checkpoint.through_run_id && ref.sequence === checkpoint.through_sequence);
        if (boundary >= 0 && boundary + 1 >= (history.checkpoint?.coveredCount ?? 0) && completeToolHistory(history.messages.slice(boundary + 1))) {
          history.checkpoint = { summary: checkpoint.summary, coveredCount: boundary + 1 };
        }
      }
    }
    return history;
  }

  private async recordMessage(runId: string, message: any, messageId?: string) {
    const role = message?.role === "assistant" ? "ASSISTANT" : message?.role === "toolResult" ? "TOOL" : message?.role === "user" ? "USER" : null;
    if (!role) return 0;
    return prisma.$transaction(async (tx) => {
      const run = await tx.askRun.update({ where: { id: runId }, data: { nextMessageSequence: { increment: 1 } }, select: { nextMessageSequence: true } });
      await tx.askRunMessage.create({ data: { id: messageId, askRunId: runId, sequence: run.nextMessageSequence, role, content: message as Prisma.InputJsonValue } });
      return run.nextMessageSequence;
    });
  }

  private async waitForQuery(memberNo: string, runId: string, id: string, signal: AbortSignal): Promise<QueryExecution> {
    while (!signal.aborted) { const execution = await this.queries.get(memberNo, id); if (queryTerminal.has(execution.status)) { if (execution.status !== "SUCCEEDED") throw new BadRequestException(execution.error || `查询${execution.status}`); return execution; } await this.events.publish(runId, "progress", { step: "等待查询完成", query_id: id, status: execution.status }); await sleep(1000); }
    await this.queries.cancel(memberNo, id).catch(() => undefined); throw new Error("查询已停止");
  }

  private querySummary(execution: QueryExecution) { const rows = execution.result?.rows ?? []; const excerpt: typeof rows = []; let bytes = 2; for (const row of rows.slice(0, 100)) { const next = Buffer.byteLength(JSON.stringify(row), "utf8") + (excerpt.length ? 1 : 0); if (bytes + next > 65536) break; excerpt.push(row); bytes += next; } return { query_id: execution.id, status: execution.status, columns: execution.result?.columns ?? [], rows: excerpt, excerpt_complete: rows.length === excerpt.length, result_complete: !execution.result?.truncated, row_count_returned: rows.length, content_version: execution.content_version, snapshot_date: execution.snapshot_date }; }
  private textFromAgent(agent: any) { const message = [...(agent.state?.messages ?? [])].reverse().find((item: any) => item.role === "assistant"); return (message?.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("").trim(); }
  private async systemPrompt(scope: AskScope) { const setting = await this.settings.askPrompt(); return buildAskSystemPrompt(setting.prompt, scope.tableIds.length) + "\n\n当前可查询表的真实数据域：" + JSON.stringify(scopeDataDomains(scope.packages.values())) + "。search_semantic_assets.data_domain 只能使用这些值；不确定时省略。不要用平台名、店铺名猜测数据域；相关检索词放在 keywords 中。"; }
  private runIncludes() { return { events: { where: { type: "processing" }, orderBy: { sequence: "asc" as const } }, messages: { orderBy: { sequence: "asc" as const } }, queries: { include: { queryExecution: true }, orderBy: { createdAt: "asc" as const } }, } as const; }
  private runResponse(run: any, saved: Array<{ queryExecutionId: string; createdAt: Date }> = []): AskRun { const finalIds = finalQueryIds(run.messages ?? [], saved.map((item) => item.queryExecutionId)); const clarification = readClarification(run.clarification, string(run.clarificationId)); return { id: run.id, session_id: run.askSessionId ?? null, status: run.status, question: run.question, answer: run.answer, model_id: run.modelConfigId, model_display_name: run.modelDisplayName ?? null, model_provider_name: run.modelProviderName ?? null, event_cursor: run.nextEventSequence, processing: processingDetails(run.nextMessageSequence, run.events ?? [], run.status, run.completedAt, (run.messages ?? []).filter((message: any) => message.role === "TOOL").map((message: any) => string(message.content?.toolCallId)).filter(Boolean)), thinking_level: thinkingLevel(run.thinkingLevel), table_ids: asStringList(run.tableIds), clarification, error: run.error, started_at: run.startedAt.toISOString(), completed_at: run.completedAt?.toISOString() ?? null, condition_changes: run.conditionChanges && typeof run.conditionChanges === "object" ? run.conditionChanges as AskConditionChanges : defaultChanges(), messages: (run.messages ?? []).map((message: any) => ({ id: message.id, sequence: message.sequence, role: message.role, content: message.content, created_at: message.createdAt.toISOString() })), queries: (run.queries ?? []).map((link: any) => ({ id: link.queryExecution.id, status: link.queryExecution.status, table_id: link.queryExecution.metaTableId, content_version: link.queryExecution.contentVersion, snapshot_date: link.queryExecution.snapshotDate, error: link.queryExecution.error })), final_query_ids: finalIds, charts: finalCharts(run.messages ?? [], finalIds), result_summaries: saved.map((item) => ({ query_id: item.queryExecutionId, saved_at: item.createdAt.toISOString() })) }; }
  private sessionResponse(session: any): AskSession { return { id: session.id, title: session.title, table_ids: asStringList(session.tableIds), model_id: session.modelConfigId, thinking_level: thinkingLevel(session.thinkingLevel), configuration_version: session.configurationVersion, created_at: session.createdAt.toISOString(), updated_at: session.updatedAt.toISOString(), active_run: session.runs?.[0] ? { id: session.runs[0].id, status: session.runs[0].status, question: session.runs[0].question } : null }; }
}
