import type { SemanticPackage } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import type { ExternalOperationId } from "../external-api/external-contract.service";
import { searchSemanticPackages } from "../semantic/semantic-asset-search";

const catalog = { id: "example-catalog", name: "销售额", aliases: ["GMV"], description: "已发布口径的销售额", usage_notes: null };
export const examplePackage: SemanticPackage = {
  schema_version: 1, content_version: "example-version", updated_at: "2026-10-01T00:00:00Z",
  source: { id: "example-source", name: "示例数据源", type: "MAXCOMPUTE", project: "example_project", catalog: "example_project", schema: "" },
  table: { id: "example-table", name: "sales", business_name: "示例销售表", description: "仅为接口说明示例，并非真实数据", data_domain: "销售管理", grain: ["shop"], query_config: { storage: "DATE_INCREMENTAL", default_stat_date: { field_id: "example-day", format: "yyyyMMdd" } } },
  fields: [
    { id: "example-day", column: "day", name: "日期", data_type: "STRING", normalized_type: "STRING", is_partition: true, type: "PARTITION", aggregation: null, unit: null, groupable: true, candidate_value_queryable: false, label_description: null, catalog: null },
    { id: "example-shop", column: "shop", name: "店铺", data_type: "STRING", normalized_type: "STRING", is_partition: false, type: "DIMENSION", aggregation: null, unit: null, groupable: true, candidate_value_queryable: true, label_description: null, catalog: { ...catalog, id: "example-dimension", name: "店铺", aliases: ["店名"] } },
    { id: "example-amount", column: "amount", name: "销售额", data_type: "DECIMAL", normalized_type: "DECIMAL", is_partition: false, type: "METRIC", aggregation: "SUM", unit: "元", groupable: false, candidate_value_queryable: false, label_description: null, catalog },
  ], metrics: [], completeness: { status: "COMPLETE", issues: [] },
};
const task = { id: "example-query", status: "RUNNING", table_id: "example-table", submitted_at: "2026-10-01T00:00:00Z", started_at: "2026-10-01T00:00:00Z", completed_at: null, elapsed_ms: null, error: null, sql: "SELECT shop, SUM(amount) FROM example_project.sales GROUP BY shop", content_version: "example-version", snapshot_date: null, expires_at: "2026-10-02T00:00:00Z" };
const dates = { start: "2026-10-01", end: "2026-10-15" };
const submit = { table_id: "example-table", content_version: "example-version", idempotency_key: "replace-with-a-unique-request-id", date_range: dates };
const searchRequest = { keywords: [], metrics: ["销售额"], dimensions: ["店铺"], page: 1, page_size: 20 };
type Example = { title: string; description: string; request: Record<string, unknown>; params: Record<string, string>; response: unknown; notes: string[] };
export const examples: Record<ExternalOperationId, Example> = {
  search: { title: "搜索语义资产", description: "根据表的业务词，或指标中心/维度中心的中文名称、别名与说明，查找对应的已发布候选表；只搜索元数据，不扫描业务数据行。", request: searchRequest, params: {}, response: searchSemanticPackages([examplePackage], searchRequest), notes: [
    "keywords 必须传数组，可以传 []；keywords、metrics、dimensions 合计至少提供一个非空业务词。搜索范围是已发布可查询表，不包括未发布表。",
    "keywords 是通用搜索：查表业务名/物理表名/表描述，以及已发布字段、计算指标的业务名、别名、目录说明和使用说明；metrics、dimensions 则分别检查所需指标与维度。填写中文名称或别名，不填写中心目录 ID。",
    "只搜指标的请求例：{\"keywords\":[],\"metrics\":[\"销售额\"]}；只搜维度的请求例：{\"keywords\":[],\"dimensions\":[\"店铺\"]}；下方完整示例演示同时查找包含两者的候选表。",
    "匹配支持名称/别名完全匹配、双向部分匹配及说明匹配，会规范化大小写和首尾空白；部分匹配、说明匹配仅为待确认候选，不代表业务口径已经一致。",
    "同时填写多个指标/维度不是严格的 AND 过滤：只命中部分条件的表也可能返回，完整覆盖的候选优先；不能仅凭 items 非空就认定满足全部查询条件。",
    "检查 coverage.status：FULL 表示每个所需指标/维度均有唯一的名称或别名完全匹配；PARTIAL 表示部分缺失、只有模糊匹配或存在歧义；仅用 keywords 搜索时为 UNSPECIFIED。",
    "coverage.metrics/dimensions 会逐项返回 MATCHED（唯一完全匹配）、TENTATIVE（部分名称/说明匹配）、AMBIGUOUS（多个完全匹配）或 MISSING（没有匹配）。用 items[].table_id 获取 Package，继续确认口径、分组开关和实际字段/指标 ID。",
    "dimensions 搜索的是维度定义，例如“店铺”，不是 ELLE 等实际取值；要查这些取值，先定位表、获取 Package，再调用维度候选值接口。data_domain 只填写真实数据域，例如“销售管理”，不确定时省略。",
    "默认 page=1、page_size=20，page_size 最大 100；超过总页数或没有命中时返回空 items。",
  ] },
  package: { title: "获取正式语义 Package", description: "获取字段／指标 ID、业务口径、日期规则、版本及完整性信息。", request: {}, params: { tableId: "example-table" }, response: examplePackage, notes: ["使用搜索结果的 table_id；直接指定未发布或失效表同样返回 404。", "后续提交必须携带此处返回的 content_version；不能用字段名替代 ID。", "INCOMPLETE 表示需查看 issues；不代表可以绕过后续查询校验。"] },
  query: { title: "提交指标查询", description: "按正式语义进行单表聚合、分组、趋势或排行，返回异步任务。", request: { ...submit, metric_ids: ["example-amount"], dimension_ids: ["example-shop"], filters: [{ field_id: "example-shop", operator: "EQ", values: ["示例旗舰店"] }], order_by: [{ field_id: "example-amount", direction: "DESC" }], limit: 100 }, params: {}, response: task, notes: ["返回 202 表示任务已提交，不表示查询已成功；检查 status，再轮询任务接口。", "只接受指标和字段 ID，不接受 SQL、用户编号或数据源凭据；当前只支持 MaxCompute。", "指标结果默认 100 行，最多 5000 行；指定分组字段必须 groupable=true。", "DATE_INCREMENTAL 必须传 date_range（包含结束日期），支持 YYYY-MM-DD / YYYYMMDD；FULL_SNAPSHOT 不传，由服务选择最新快照。", "筛选支持 EQ、NEQ、GT、GTE、LT、LTE、BETWEEN、IN、IS_NULL、IS_NOT_NULL、CONTAINS；values 为字符串数组，CONTAINS 仅支持 STRING。", "同用户、同 idempotency_key、同请求返回原任务；变更参数或版本须使用新标识，否则 409。"] },
  dimensionValues: { title: "提交维度候选值查询", description: "读取已开启候选值查询的字段的真实取值，返回异步任务。", request: { ...submit, field_id: "example-shop", keyword: "旗舰店", limit: 50 }, params: {}, response: task, notes: ["默认 50 条，最多 200 条；字段必须 candidate_value_queryable=true。", "keyword 仅用于 STRING 字段；日期规则和指标查询相同，增量表不能省略日期。", "读取返回任务 ID 的状态与结果；查询失败不代表没有匹配项。"] },
  status: { title: "读取查询状态", description: "读取当前用户任务的状态、生成 SQL、语义版本、耗时及结果过期时间，不携带结果行。", request: {}, params: { queryId: "example-query" }, response: task, notes: ["状态包括 PENDING、RUNNING、SUCCEEDED、FAILED、CANCELLING、CANCELLED、TIMED_OUT。", "建议每 3 秒轮询一次；停止本地等待不等于取消后台任务。", "只能读取本人任务；其他用户的任务和不存在的任务均返回 404。"] },
  result: { title: "读取实际查询结果", description: "返回当前用户已成功任务的保存结果，而不是模型使用的 100 行摘要。", request: {}, params: { queryId: "example-query" }, response: { ...task, status: "SUCCEEDED", completed_at: "2026-10-01T00:00:01Z", elapsed_ms: 1000, result: { columns: [{ id: "example-shop", name: "店铺", type: "STRING", unit: null }, { id: "example-amount", name: "销售额", type: "DECIMAL", unit: "元" }], rows: [["示例旗舰店", "12345678901234567890.12"]], truncated: false, result_bytes: 200 } }, notes: ["尚未成功完成返回 409，结果过期返回 410；结果按提交时间保留 24 小时。", "rows 按 columns 顺序排列；大整数和小数保留字符串精度，空值返回 JSON null。", "必须检查 result.truncated，不能将受行数或 5 MiB 大小限制的结果当成全量结论。"] },
  cancel: { title: "取消查询任务", description: "请求取消当前用户的任务，返回当前任务状态。", request: {}, params: { queryId: "example-query" }, response: { ...task, status: "CANCELLING" }, notes: ["提交取消后可能先返回 CANCELLING；继续读取状态，确认最终结果。", "终态任务不会重新执行或删除结果；取消其他用户任务返回 404。"] },
};
