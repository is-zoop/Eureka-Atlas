import type { AskProcessingStep, AskRun, AskSavedQueryResult } from "@eureka-atlas/types";
import { toolFailureText } from "./tool-failure";

type RecordValue = Record<string, unknown>;
export type LogEntry = { label: string; value: string };
export type LogSection = { title: string; entries: LogEntry[] };
export type LogCall = { id: string; name: string; arguments: unknown; request: LogEntry[] };
export type StepLog = {
  messageId: string | null;
  toolCallId: string | null;
  toolName: string | null;
  text: string;
  calls: LogCall[];
  request: LogEntry[];
  output: LogSection[];
  arguments: unknown;
  hasArguments: boolean;
  hasOutput: boolean;
  error: string | null;
  queryId?: string;
};

const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === "string" ? value : "";
const display = (value: unknown): string => value === undefined ? "未记录" : value === null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);
const entry = (label: string, value: unknown): LogEntry => ({ label, value: display(value) });
const textContent = (message: unknown): string => {
  const content = object(message).content;
  return typeof content === "string" ? content : list(content).map(object).filter((part) => part.type === "text").map((part) => string(part.text)).join("");
};

/** Read only visible text and whitelisted result fields; never expose thinking or full messages. */
export function buildStepLogs(run: AskRun, results: Record<string, AskSavedQueryResult>): Map<string, StepLog> {
  const messages = [...run.messages].sort((a, b) => a.sequence - b.sequence);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const calls = new Map<string, { call: RecordValue; messageId: string }>();
  const toolResults = new Map<string, typeof messages[number]>();
  const packages = new Map<string, RecordValue>();
  const tableNames = new Map<string, string>();
  const allowedQueries = new Set([...run.queries.map((query) => query.id), ...run.result_summaries.map((result) => result.query_id)]);

  for (const message of messages) {
    const content = object(message.content);
    if (message.role === "ASSISTANT") {
      for (const part of list(content.content).map(object)) if (part.type === "toolCall" && string(part.id)) {
        calls.set(string(part.id), { call: part, messageId: message.id });
      }
    }
    if (message.role !== "TOOL") continue;
    if (string(content.toolCallId)) toolResults.set(string(content.toolCallId), message);
    if (content.isError) continue;
    const details = object(content.details);
    if (content.toolName === "get_semantic_package") {
      const table = object(details.table);
      if (string(table.id)) packages.set(string(table.id), details);
      if (string(table.id) && string(table.business_name)) tableNames.set(string(table.id), string(table.business_name));
    }
    if (content.toolName === "search_semantic_assets") {
      for (const candidate of list(details.items).map(object)) if (string(candidate.table_id) && string(candidate.business_name)) {
        tableNames.set(string(candidate.table_id), string(candidate.business_name));
      }
    }
  }

  const requestEntries = (tool: string, argumentsValue: unknown, saved?: AskSavedQueryResult): LogEntry[] => {
    const input = object(argumentsValue);
    const tableId = string(input.table_id);
    const pkg = packages.get(tableId);
    const fields = new Map<string, string>();
    for (const field of [...list(pkg?.fields), ...list(pkg?.metrics)].map(object)) {
      if (string(field.id) && string(field.name)) fields.set(string(field.id), string(field.name));
    }
    for (const column of saved?.execution.result?.columns ?? []) if (column.id) fields.set(column.id, column.name);
    const fieldName = (id: unknown) => fields.get(string(id)) ?? display(id);
    const names = (ids: unknown) => Array.isArray(ids) ? ids.map(fieldName).join("、") || "无" : "未记录";
    const table = tableId ? (saved?.source.business_name ?? tableNames.get(tableId) ?? tableId) : "未记录";
    if (tool === "search_semantic_assets") return [
      entry("检索词", input.keywords), entry("数据域", input.data_domain), entry("指标检索", input.metrics), entry("维度检索", input.dimensions),
    ];
    if (tool === "get_semantic_package") return [entry("表", table), entry("表 ID", input.table_id)];
    if (tool === "request_clarification") return [
      entry("澄清问题", input.question),
      entry("选择模式", input.selection_mode === "single" ? "单选" : input.selection_mode === "multiple" ? "可多选" : undefined),
      entry("选项", input.selection_mode === "single" || input.selection_mode === "multiple"
        ? list(input.options).map(object).map((option, index) => String.fromCharCode(65 + index) + ". " + display(option.summary) + "： " + display(option.description)).join("\n") || "无（纯文字澄清）"
        : input.options),
    ];
    if (tool === "present_query_results") return [entry("选定查询 ID", input.query_ids), entry("图表配置", input.charts)];
    if (tool !== "query_data" && tool !== "get_dimension_values") return [];
    const date = object(input.date_range);
    const entries = [
      entry("表", table), entry("表 ID", input.table_id),
      entry("日期", input.date_range === undefined ? undefined : display(date.start) + " ～ " + display(date.end)),
      entry("筛选", input.filters === undefined ? "未传入" : list(input.filters).map(object).map((filter) => fieldName(filter.field_id) + " " + display(filter.operator) + (filter.values === undefined ? "" : " " + display(filter.values))).join("；") || "无"),
      entry("限制行数", input.limit),
    ];
    if (tool === "get_dimension_values") entries.push(entry("候选维度", fieldName(input.field_id)), entry("关键词", input.keyword));
    else entries.push(
      entry("指标", names(input.metric_ids)), entry("分组", names(input.dimension_ids)),
      entry("排序", input.order_by === undefined ? "未传入" : list(input.order_by).map(object).map((sort) => fieldName(sort.field_id) + " " + display(sort.direction)).join("；") || "无"),
    );
    return entries;
  };

  const logs = new Map<string, StepLog>();
  for (const step of run.processing.steps) {
    const callId = step.tool_call_id;
    const linkedCall = callId ? calls.get(callId) : undefined;
    const matchedMessage = step.kind === "message" ? messageById.get(step.message_id ?? "") : undefined;
    const assistant = matchedMessage?.role === "ASSISTANT" ? matchedMessage : undefined;
    const resultMessage = callId ? toolResults.get(callId) : undefined;
    const result = object(resultMessage?.content);
    const details = object(result.details);
    const toolName = string(linkedCall?.call.name) || string(result.toolName) || null;
    const returnedId = string(details.query_id);
    const queryId = (toolName === "query_data" || toolName === "get_dimension_values") && allowedQueries.has(returnedId) ? returnedId : undefined;
    const saved = queryId ? results[queryId] : undefined;
    const rawArguments = linkedCall?.call.arguments;
    const input = object(rawArguments);
    const output: LogSection[] = [];
    const hasOutput = step.kind === "message" ? Boolean(assistant) : Boolean(resultMessage);
    const error = step.kind === "message" ? string(object(assistant?.content).errorMessage) || null : toolFailureText(result);
    const log: StepLog = {
      messageId: linkedCall?.messageId ?? step.message_id,
      toolCallId: callId, toolName, text: assistant ? textContent(assistant.content) : "",
      calls: [], request: linkedCall ? requestEntries(toolName ?? "", rawArguments, saved) : [],
      output, arguments: rawArguments, hasArguments: Boolean(linkedCall && rawArguments !== undefined),
      hasOutput, error, queryId,
    };
    if (assistant) log.calls = list(object(assistant.content).content).map(object).filter((part) => part.type === "toolCall").map((part) => ({
      id: string(part.id), name: string(part.name), arguments: part.arguments,
      request: requestEntries(string(part.name), part.arguments),
    }));
    if (!resultMessage || error) { logs.set(step.id, log); continue; }

    if (toolName === "search_semantic_assets") {
      output.push({ title: "搜索结果", entries: [entry("返回数量", details.total), entry("页码", details.page)] });
      list(details.items).map(object).forEach((item, index) => output.push({
        title: "候选表 " + (index + 1), entries: [
          entry("业务名称", item.business_name), entry("物理表", item.physical_name), entry("表 ID", item.table_id),
          entry("数据域", item.data_domain),
          entry("来源", [object(item.source).name, object(item.source).project].filter(Boolean).join(" / ") || undefined),
          entry("匹配原因", list(item.match_reasons).map(object).map((reason) => display(reason.text) + "（" + display(reason.basis) + "）").join("；") || undefined),
        ],
      }));
    } else if (toolName === "get_semantic_package") {
      const table = object(details.table);
      const source = object(details.source);
      const config = object(table.query_config);
      const date = object(config.default_stat_date);
      const fields = list(details.fields).map(object);
      const metrics = list(details.metrics).map(object);
      const fieldName = (id: unknown) => string(fields.find((field) => field.id === id)?.name) || display(id);
      output.push({ title: "正式语义摘要", entries: [
        entry("表", table.business_name), entry("物理表", table.name), entry("表 ID", table.id),
        entry("来源", [source.name, source.project, source.catalog, source.schema].filter(Boolean).join(" / ") || undefined),
        entry("语义版本", details.content_version), entry("数据粒度", table.grain), entry("存储方式", config.storage),
        entry("日期字段", date.field_id === undefined ? undefined : fieldName(date.field_id)), entry("日期格式", date.format),
        entry("字段定义数", details.fields === undefined ? undefined : fields.length), entry("指标定义数", details.metrics === undefined ? undefined : metrics.length),
      ] });
      output.push({ title: "字段映射与聚合", entries: fields.map((field) => entry(string(field.name) || string(field.id) || "字段", [
        "ID：" + display(field.id), "物理字段：" + display(field.column), "类型：" + display(field.type),
        "数据类型：" + display(field.data_type), "单位：" + display(field.unit), "聚合：" + display(field.aggregation),
      ].join(" · "))) });
      output.push({ title: "指标公式", entries: metrics.map((metric) => entry(string(metric.name) || string(metric.id) || "指标", [
        "ID：" + display(metric.id), "类型：" + display(metric.type), "单位：" + display(metric.unit),
        "公式：" + display(metric.formula),
        "依赖：" + (metric.dependencies === undefined ? "未记录" : list(metric.dependencies).map(object).map((dep) => fieldName(dep.id) + "（" + display(dep.column) + "）").join("、")),
      ].join(" · "))) });
    } else if (toolName === "query_data" || toolName === "get_dimension_values") {
      output.push({ title: "查询输出", entries: [
        entry("查询 ID", details.query_id), entry("查询状态", saved?.execution.status ?? details.status),
        entry("返回行数", saved?.execution.result?.rows.length ?? details.row_count_returned),
        entry("结果完整", saved?.execution.result ? !saved.execution.result.truncated : details.result_complete),
        entry("模型收到的摘要完整", details.excerpt_complete), entry("语义版本", saved?.execution.content_version ?? details.content_version), entry("快照日期", saved ? saved.execution.snapshot_date : details.snapshot_date),
      ] });
    } else if (toolName === "request_clarification") {
      const question = string(input.question);
      const prefix = "用户对澄清问题「" + question + "」的回答：";
      const nextQuestion = messages.find((message) => message.role === "TOOL" && message.sequence > resultMessage.sequence && object(message.content).toolName === "request_clarification");
      const user = messages.find((message) => message.role === "USER" &&
        (details.clarification_id
          ? object(object(message.content).clarification_response).clarification_id === details.clarification_id
          : question && message.sequence > resultMessage.sequence && (!nextQuestion || message.sequence < nextQuestion.sequence) && textContent(message.content).startsWith(prefix)));
      const answer = user ? textContent(user.content).slice(prefix.length).split("\n请接着本轮已完成的步骤执行，", 1)[0] : undefined;
      const clarification = typeof details.clarification_id === "string" && run.clarification?.id === details.clarification_id ? run.clarification : null;
      const response = user ? object(object(user.content).clarification_response) : clarification?.response;
      output.push({ title: "澄清结果", entries: [
        entry("等待用户确认", details.waiting_for_user),
        entry("澄清 ID", details.clarification_id),
        entry("实际选择", response?.selected_option_ids),
        entry("补充文字", response?.custom_text),
        entry("用户回答", answer ?? clarification?.answer ?? undefined),
      ] });
    } else if (toolName === "present_query_results") {
      output.push({ title: "选定结果", entries: [
        entry("查询 ID", details.query_ids), entry("查询数量", Array.isArray(details.query_ids) ? details.query_ids.length : undefined),
        entry("图表数量", Array.isArray(details.charts) ? details.charts.length : undefined), entry("图表配置", details.charts),
      ] });
    } else {
      output.push({ title: "工具输出", entries: [entry("返回文本", textContent(result) || undefined)] });
    }
    logs.set(step.id, log);
  }
  return logs;
}

export function stepStatusLabel(step: AskProcessingStep) {
  return { RUNNING: "处理中", SUCCEEDED: "成功", FAILED: "失败" }[step.status];
}