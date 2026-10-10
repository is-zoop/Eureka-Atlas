import type { Type as TypeBox } from "typebox" with { "resolution-mode": "import" };
import type { SemanticPackage } from "@eureka-atlas/types" with { "resolution-mode": "import" };

export const scopeDataDomains = (packages: Iterable<SemanticPackage>) => [...new Set(
  [...packages].map((pkg) => pkg.table.data_domain?.trim()).filter((value): value is string => Boolean(value)),
)].sort();

export function askSearchParameters(Type: typeof TypeBox, domains: string[]) {
  return Type.Object({
    keywords: Type.Array(Type.String()),
    metrics: Type.Optional(Type.Array(Type.String())),
    dimensions: Type.Optional(Type.Array(Type.String())),
    ...(domains.length ? { data_domain: Type.Optional(Type.Union(domains.map((domain) => Type.Literal(domain)),
      { description: "仅可使用当前已选表的真实数据域。不确定时省略，不能用平台名或店铺名猜测数据域。" })) } : {}),
  }, { additionalProperties: false });
}

export function askQueryParameters(Type: typeof TypeBox) {
  const fieldId = Type.String({ minLength: 1, description: "正式语义 Package 中的字段 ID，不是字段名。" });
  const oneValue = Type.Array(Type.String(), { minItems: 1, maxItems: 1 });
  const filter = Type.Union([
    Type.Object({
      field_id: fieldId,
      operator: Type.Union(["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "CONTAINS"].map((value) => Type.Literal(value))),
      values: oneValue,
    }, { additionalProperties: false }),
    Type.Object({
      field_id: fieldId, operator: Type.Literal("BETWEEN"),
      values: Type.Array(Type.String(), { minItems: 2, maxItems: 2 }),
    }, { additionalProperties: false }),
    Type.Object({
      field_id: fieldId, operator: Type.Literal("IN"),
      values: Type.Array(Type.String(), { minItems: 1, maxItems: 100 }),
    }, { additionalProperties: false }),
    Type.Object({
      field_id: fieldId,
      operator: Type.Union([Type.Literal("IS_NULL"), Type.Literal("IS_NOT_NULL")]),
      values: Type.Optional(Type.Array(Type.String(), { maxItems: 0 })),
    }, { additionalProperties: false }),
  ], { description: "操作符使用大写枚举，等于用 EQ，不用 = 或 SQL LIKE。CONTAINS 仅适用于 STRING 字段。values 是字符串数组：比较/CONTAINS 一个，BETWEEN 两个，IN 1–100 个，空值判断不传或传空数组。" });
  const dateRange = Type.Optional(Type.Object({
    start: Type.String({ minLength: 1, description: "范围开始日期，YYYY-MM-DD 或 YYYYMMDD。" }),
    end: Type.String({ minLength: 1, description: "范围结束日期，含当日，YYYY-MM-DD 或 YYYYMMDD。" }),
  }, { additionalProperties: false, description: "读取 table.query_config.storage：DATE_INCREMENTAL 必须传（候选值查询也一样），FULL_SNAPSHOT 不传，由服务选择最新快照。日期未知先澄清，不猜测或删掉日期重试。" }));
  const common = {
    table_id: Type.String({ minLength: 1, description: "搜索结果或正式语义中的表 ID。" }),
    filters: Type.Optional(Type.Array(filter)),
    date_range: dateRange,
  };
  return {
    dimensionValues: Type.Object({
      ...common, field_id: fieldId,
      keyword: Type.Optional(Type.String({ description: "仅用于 normalized_type=STRING 的候选字段，服务自动生成 CONTAINS；精确匹配用 filters 的 EQ。" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }, { additionalProperties: false }),
    query: Type.Object({
      ...common,
      metric_ids: Type.Array(fieldId, { minItems: 1, description: "正式语义中的原子指标或派生指标 ID。" }),
      dimension_ids: Type.Optional(Type.Array(fieldId, { description: "groupable=true 的维度、标签或分区字段 ID。" })),
      order_by: Type.Optional(Type.Array(Type.Object({
        field_id: fieldId, direction: Type.Union([Type.Literal("ASC"), Type.Literal("DESC")]),
      }, { additionalProperties: false }))),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    }, { additionalProperties: false }),
  };
}
