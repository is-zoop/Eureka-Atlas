import { BadRequestException, Injectable } from "@nestjs/common";
import type { Type as TypeBox, TSchema } from "typebox" with { "resolution-mode": "import" };
import { askQueryParameters } from "../ask/ask-query-schema";

export type ExternalOperationId = "search" | "package" | "query" | "dimensionValues" | "status" | "result" | "cancel";
export type OperationSchemas = { request: TSchema; response: TSchema; params: TSchema };
const load = (name: string): Promise<any> => new Function("name", "return import(name)")(name);

@Injectable()
export class ExternalContractService {
  private pending?: Promise<{ schemas: Record<ExternalOperationId, OperationSchemas>; check: (schema: TSchema, value: unknown) => boolean }>;
  private runtime() {
    return this.pending ??= Promise.all([load("typebox"), load("typebox/value")]).then(([{ Type }, { Check }]) => ({ schemas: buildSchemas(Type), check: Check }));
  }
  async schemas() { return (await this.runtime()).schemas; }
  async validate<T>(id: ExternalOperationId, value: unknown, params: unknown = {}): Promise<T> {
    const { schemas, check } = await this.runtime();
    if (!check(schemas[id].request, value) || !check(schemas[id].params, params)) throw new BadRequestException({ code: "INVALID_REQUEST", message: "参数不符合接口定义，请核对必填项、字段类型、枚举值及多余字段。" });
    const range = (value as { date_range?: { start: string; end: string } })?.date_range;
    if (range) {
      const iso = (date: string) => /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date;
      const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
      if (!valid(iso(range.start)) || !valid(iso(range.end)) || iso(range.start) > iso(range.end)) throw new BadRequestException({ code: "INVALID_REQUEST", message: "日期必须为有效的 YYYY-MM-DD 或 YYYYMMDD，且开始日期不得晚于结束日期。" });
    }
    return value as T;
  }
  async checkResponse(id: ExternalOperationId, value: unknown) { const runtime = await this.runtime(); return runtime.check(runtime.schemas[id].response, value); }
}

function buildSchemas(Type: typeof TypeBox): Record<ExternalOperationId, OperationSchemas> {
  const object = (properties: Parameters<typeof Type.Object>[0], options = {}) => Type.Object(properties, { additionalProperties: false, ...options });
  const text = Type.String();
  const id = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$", description: "正式语义中的 ID，不是业务名称或物理字段名。" });
  const nullable = Type.Union([text, Type.Null()]);
  const strings = Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 100 });
  const query = askQueryParameters(Type);
  const version = Type.String({ minLength: 1, maxLength: 128, pattern: "^\\S+$", description: "获取 Package 返回的 content_version；版本不一致返回 409。" });
  const key = Type.String({ minLength: 1, maxLength: 128, pattern: "^\\S+$", description: "由调用方生成的唯一请求标识，建议使用 UUID，长度 1–128 且不能含空白；不是查询任务 ID。同一请求重试保留原值，修改日期、字段、筛选等参数时换新值；同标识用于不同请求返回 409。" });
  const tableId = { ...id, description: "搜索结果 items[].table_id 或当前 Package.table.id，必须是已发布且仍可查询的表；不是物理表名、中心目录 ID 或 Package 记录 ID。" };
  const taskId = { ...id, description: "本人提交指标查询或候选值查询后返回的 data.id；不是 idempotency_key，也不是表 ID。其他用户的任务和不存在的任务均返回 404。" };
  const common = { table_id: tableId, content_version: version, idempotency_key: key, filters: Type.Optional(Type.Array(query.query.properties.filters.items, { maxItems: 100, description: "可选筛选条件数组，最多 100 条，省略表示没有额外业务筛选；多条条件按 AND 组合。每项使用当前 Package 字段 ID、操作符和字符串 values 数组，例如 {\"field_id\":\"字段ID\",\"operator\":\"EQ\",\"values\":[\"ELLE\"]}；日期增量表仍需另传 date_range。" })) };
  const catalog = Type.Union([object({ id: text, name: text, description: text, aliases: Type.Array(text), usage_notes: nullable }), Type.Null()]);
  const source = object({ id: text, name: text, type: text, project: text, catalog: text, schema: text });
  const completeness = object({ status: Type.Union([Type.Literal("COMPLETE"), Type.Literal("INCOMPLETE")]), issues: Type.Array(object({ code: text, object_type: text, object_id: text, path: text, message: text, affects: text })) });
  const field = object({ id: text, column: text, data_type: text, normalized_type: text, is_partition: Type.Boolean(), name: text, type: Type.Union(["METRIC", "DIMENSION", "LABEL", "PARTITION"].map(value => Type.Literal(value))), aggregation: nullable, unit: nullable, groupable: Type.Boolean(), candidate_value_queryable: Type.Boolean(), label_description: nullable, catalog });
  const metric = object({ id: text, name: text, type: Type.Literal("DERIVED"), formula: text, unit: nullable, dependencies: Type.Array(object({ id: text, column: text })), catalog });
  const pkg = object({ schema_version: Type.Literal(1), content_version: text, updated_at: text, source, table: object({ id: text, name: text, data_domain: nullable, business_name: text, description: text, grain: Type.Array(text), query_config: object({ default_stat_date: object({ field_id: nullable, format: text }), storage: Type.Union([Type.Literal("DATE_INCREMENTAL"), Type.Literal("FULL_SNAPSHOT"), Type.Null()]) }) }), fields: Type.Array(field), metrics: Type.Array(metric), completeness });
  const match = object({ asset_id: text, name: text, basis: Type.Union(["EXACT_NAME_OR_ALIAS", "PARTIAL_NAME_OR_ALIAS", "DESCRIPTION"].map(value => Type.Literal(value))) });
  const coverage = Type.Array(object({ requested: text, status: Type.Union(["MATCHED", "TENTATIVE", "AMBIGUOUS", "MISSING"].map(value => Type.Literal(value))), matches: Type.Array(match) }));
  const search = object({ items: Type.Array(object({ table_id: text, business_name: text, physical_name: text, data_domain: nullable, source, grain: Type.Array(text), completeness, match_reasons: Type.Array(object({ text, basis: text })), coverage: object({ status: text, metrics: coverage, dimensions: coverage }) })), total: Type.Integer(), page: Type.Integer(), page_size: Type.Integer(), total_pages: Type.Integer() });
  const taskProperties = { id: text, status: Type.Union(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLING", "CANCELLED", "TIMED_OUT"].map(value => Type.Literal(value))), table_id: text, submitted_at: text, started_at: nullable, completed_at: nullable, elapsed_ms: Type.Union([Type.Number(), Type.Null()]), error: nullable, sql: text, content_version: text, snapshot_date: nullable, expires_at: text };
  const task = object(taskProperties);
  const result = object({ ...taskProperties, result: object({ columns: Type.Array(object({ id: nullable, name: text, type: text, unit: nullable })), rows: Type.Array(Type.Array(Type.Union([text, Type.Number(), Type.Boolean(), Type.Null()]))), truncated: Type.Boolean(), result_bytes: Type.Number() }) });
  const empty = object({});
  return {
    search: { request: object({
      keywords: { ...strings, description: "必填的通用搜索词数组，可传 []；与 metrics、dimensions 合计至少有一个非空业务词。匹配表的业务名、物理表名、表描述，以及已发布字段/计算指标的业务名、别名、目录说明和使用说明。例如 [\"销售额\"] 或 [\"商品流量\"]；最多 100 项，每项 1–256 字符，不扫描业务数据行。" },
      metrics: Type.Optional({ ...strings, description: "可选的指标搜索词数组：填写指标中心展示的中文业务名称或别名，例如 [\"支付金额\",\"访客数\"]、[\"GMV\"]；匹配表内原子指标、计算指标及其目录说明/使用说明。最多 100 项，每项 1–256 字符；填名称而不是目录 ID 或字段 ID，响应 coverage.metrics 会逐项列出匹配情况。" }),
      dimensions: Type.Optional({ ...strings, description: "可选的维度搜索词数组：填写维度中文业务名称或别名，例如 [\"店铺名称\",\"流量来源\"]，也匹配目录说明/使用说明及可分组的标签、分区。最多 100 项，每项 1–256 字符；不填维度目录 ID，也不按 ELLE 等真实字段取值找表，实际取值需定位表后查询候选值。" }),
      data_domain: Type.Optional(Type.String({ minLength: 1, maxLength: 128, description: "可选的数据域过滤值，精确匹配已发布表 Package.table.data_domain（会规范化大小写及首尾空白），例如 \"销售管理\"；长度 1–128。不确定时省略，不要把 \"天猫\" 等平台名或 \"ELLE\" 等店铺名当成数据域；不匹配时返回空 items。" })),
      page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000, default: 1, description: "可选页码，从 1 开始，默认 1；只接受 1–100000 的整数。超过实际结果页数返回空 items，不自动跳回最后一页；总页数见 total_pages。" })),
      page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20, description: "可选的每页候选表数量，默认 20；只接受 1–100 的整数。例如 page=2、page_size=20 读取第 21–40 个候选表；不是指标查询的结果行数。" })),
    }), response: search, params: empty },
    package: { request: empty, response: pkg, params: object({ tableId }) },
    query: { request: object({ ...query.query.properties, ...common,
      metric_ids: Type.Array(id, { minItems: 1, maxItems: 100, description: "必填的指标 ID 数组，1–100 项；原子指标使用当前 Package.fields 中 type=METRIC 的 id，计算指标使用 Package.metrics[].id。不是指标中心目录 ID 或中文名；按各指标已发布的聚合方式或公式执行。" }),
      dimension_ids: Type.Optional(Type.Array(id, { maxItems: 100, description: "可选分组字段 ID 数组，最多 100 项；使用当前 Package.fields 中 groupable=true 的 DIMENSION、LABEL 或 PARTITION 字段 id。不是维度中心目录 ID；省略或传 [] 时不按维度分组。" })),
      order_by: Type.Optional(Type.Array(query.query.properties.order_by.items, { maxItems: 100, description: "可选排序数组，最多 100 项，按填写顺序排序；field_id 必须是本次 metric_ids 或 dimension_ids 中的输出 ID，direction 只能为 ASC 或 DESC。例如按支付金额 ID 降序；省略时不指定排序。" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000, default: 100, description: "可选的最大结果行数，默认 100；只接受 1–5000 的整数。结果还受 5 MiB 大小限制，读取结果时必须检查 result.truncated，不能把截断结果当成全量数据。" })),
    }), response: task, params: empty },
    dimensionValues: { request: object({ ...query.dimensionValues.properties, ...common,
      field_id: { ...id, description: "需要读取真实候选值的物理字段 ID，取自当前 Package.fields[].id；该字段须为 DIMENSION 或 LABEL，且 candidate_value_queryable=true。不是维度目录 ID；分区字段不支持候选值查询。" },
      keyword: Type.Optional(Type.String({ maxLength: 1024, description: "可选的候选值包含关键词，最多 1024 字符；仅用于 normalized_type=STRING 的字段。例如 \"ELLE\" 会查找包含该文本的实际取值；省略时不加关键词条件。精确匹配请使用 filters 的 EQ 条件。" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50, description: "可选的最大候选值条数，默认 50；只接受 1–200 的整数。返回异步任务而不是立即返回候选值数组，需使用 data.id 读取状态及成功结果。" })),
    }), response: task, params: empty },
    status: { request: empty, response: task, params: object({ queryId: taskId }) },
    result: { request: empty, response: result, params: object({ queryId: taskId }) },
    cancel: { request: empty, response: task, params: object({ queryId: taskId }) },
  };
}
