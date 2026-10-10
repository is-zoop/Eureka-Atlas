import { BadRequestException, Injectable } from "@nestjs/common";
import { normalizeDataFilters, shiftDay } from "./data-query-dates";
import { Parser } from "node-sql-parser";
import type { DataQueryRequest, DimensionValuesRequest, QueryFilter, QueryRequest, SemanticPackage } from "@eureka-atlas/types" with { "resolution-mode": "import" };

type Output = { id: string; name: string; type: string; unit: string | null };
export type CompiledQuery = { sql: string; outputs: Output[]; snapshotDate: string | null; limit: number };
type CompileOptions = { snapshotDate?: string | null; maxRows?: number; completeDays?: boolean; candidateSearch?: boolean };

const aggregations = new Set(["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX"]);
const dateFormats = new Set(["yyyyMMdd", "yyyy-MM-dd", "yyyy/MM/dd"]);
const parser = new Parser();
const asArray = <T>(value: T[] | undefined) => value ?? [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const quote = (name: string) => `\`${name.replace(/`/g, "``")}\``;
const sqlString = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
const readableAlias = (name: string, used: Set<string>) => {
  const base = text(name).replace(/[\r\n\t]+/g, " ").replace(/`/g, "") || "结果";
  let alias = base;
  let sequence = 2;
  while (used.has(alias)) alias = `${base}_${sequence++}`;
  used.add(alias);
  return alias;
};

@Injectable()
export class QueryCompilerService {
  compileQuery(pkg: SemanticPackage, input: QueryRequest, options: CompileOptions = {}): CompiledQuery {
    const metricIds = unique(input.metric_ids);
    const dimensionIds = unique(input.dimension_ids);
    if (!metricIds.length) throw new BadRequestException("请至少选择一个指标");
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > (options.maxRows ?? 5000))) throw new BadRequestException("结果数量必须介于 1 到 5000");
    const fields = new Map(pkg.fields.map((field) => [field.id, field]));
    const metrics = new Map(pkg.metrics.map((metric) => [metric.id, metric]));
    const dimensions = dimensionIds.map((id) => {
      const field = fields.get(id);
      if (!field || !field.groupable || (field.type !== "DIMENSION" && field.type !== "LABEL" && field.type !== "PARTITION")) throw new BadRequestException(`字段 ${id} 不能用于分组`);
      return field;
    });
    const outputs: Output[] = [];
    const aliases = new Map<string, string>();
    const usedAliases = new Set<string>();
    const addOutput = (output: Output) => {
      outputs.push(output);
      const alias = readableAlias(output.name, usedAliases);
      aliases.set(output.id, alias);
      return alias;
    };
    const selections = dimensions.map((field) => {
      const alias = addOutput({ id: field.id, name: field.name, type: field.normalized_type, unit: null });
      return `${quote(field.column)} AS ${quote(alias)}`;
    });
    for (const id of metricIds) {
      const field = fields.get(id);
      const metric = metrics.get(id);
      if (field) {
        if (field.type !== "METRIC") throw new BadRequestException(`字段 ${field.name} 不是原子指标`);
        const aggregation = text(field.aggregation).toUpperCase();
        if (!aggregations.has(aggregation)) throw new BadRequestException(`指标 ${field.name} 的聚合方式不受支持`);
        const expression = aggregation === "COUNT_DISTINCT" ? `COUNT(DISTINCT ${quote(field.column)})` : `${aggregation}(${quote(field.column)})`;
        const alias = addOutput({ id, name: field.name, type: field.normalized_type, unit: field.unit });
        selections.push(`${expression} AS ${quote(alias)}`);
        continue;
      }
      if (!metric) throw new BadRequestException(`指标 ${id} 不存在于当前正式语义`);
      this.assertFormula(metric.formula, fields, metric.name);
      const alias = addOutput({ id, name: metric.name, type: "DECIMAL", unit: metric.unit });
      selections.push(`(${metric.formula}) AS ${quote(alias)}`);
    }
    const { where } = this.where(pkg, fields, asArray(input.filters), input.date_range, options.snapshotDate, options.completeDays);
    const snapshotField = pkg.table.query_config.storage === "FULL_SNAPSHOT" && pkg.table.query_config.default_stat_date.field_id ? fields.get(pkg.table.query_config.default_stat_date.field_id) : undefined;
    if (snapshotField) selections.push(`MAX(${quote(snapshotField.column)}) AS ${quote("__snapshot_date")}`);
    const table = `${quote(pkg.source.project)}.${quote(pkg.table.name)}`;
    const groupBy = dimensions.length ? dimensions.map((field) => quote(field.column)).join(", ") : "";
    const order = asArray(input.order_by).map((item) => {
      const alias = aliases.get(item.field_id);
      if (!alias) throw new BadRequestException("排序字段必须是本次查询的输出项");
      if (item.direction !== "ASC" && item.direction !== "DESC") throw new BadRequestException("排序方向无效");
      return `${quote(alias)} ${item.direction}`;
    });
    const limit = input.limit ?? 100;
    const clauses = [
      "SELECT",
      selections.map((selection) => `  ${selection}`).join(",\n"),
      `FROM ${table}`,
      where ? `WHERE ${where}` : "",
      groupBy ? `GROUP BY ${groupBy}` : "",
      order.length ? `ORDER BY ${order.join(", ")}` : "",
      `LIMIT ${limit + 1};`,
    ].filter(Boolean);
    return { sql: clauses.join("\n"), outputs, snapshotDate: options.snapshotDate ?? null, limit };
  }


  compileDataQuery(pkg: SemanticPackage, input: DataQueryRequest, options: CompileOptions = {}) {
    if (input.table_id !== pkg.table.id || !["DETAIL", "AGGREGATE"].includes(input.mode)) throw new BadRequestException("查询必须使用当前单表及有效查询模式");
    if (!Array.isArray(input.field_ids) || !input.field_ids.length || input.field_ids.some(id => typeof id !== "string") || new Set(input.field_ids).size !== input.field_ids.length) throw new BadRequestException("请至少选择一个有效字段，字段不能重复");
    if (input.order_by !== undefined && (!Array.isArray(input.order_by) || input.order_by.length > 100 || input.order_by.some(item => !item || typeof item !== "object" || typeof item.field_id !== "string" || !["ASC","DESC"].includes(item.direction)))) throw new BadRequestException("排序无效");
    const normalized = normalizeDataFilters(pkg, input.filters);
    const fields = new Map(pkg.fields.map(field => [field.id,field]));
    const derived = new Set(pkg.metrics.map(metric => metric.id));
    for (const id of input.field_ids) if (!fields.has(id) && !derived.has(id)) throw new BadRequestException("输出字段不属于当前表");
    let compiled: CompiledQuery;
    if (input.mode === "AGGREGATE") {
      compiled = this.compileQuery(pkg, { table_id:input.table_id, metric_ids:input.field_ids.filter(id => fields.get(id)?.type === "METRIC" || derived.has(id)), dimension_ids:input.field_ids.filter(id => fields.has(id) && fields.get(id)!.type !== "METRIC"), filters:normalized.filters,date_range:normalized.dateRange,order_by:input.order_by,limit:200000 }, {...options,maxRows:200000,completeDays:true});
    } else {
      const selected = input.field_ids.map(id => {
        const field = fields.get(id);
        if (!field) throw new BadRequestException("计算指标仅支持汇总查询");
        return field;
      });
      const used = new Set<string>();
      const aliases = new Map<string,string>();
      const selections = selected.map(field => {
        const alias = readableAlias(field.name,used); aliases.set(field.id,alias);
        return quote(field.column)+" AS "+quote(alias);
      });
      const {where} = this.where(pkg,fields,normalized.filters,normalized.dateRange,options.snapshotDate,true);
      if (input.order_by !== undefined && (!Array.isArray(input.order_by) || input.order_by.length > 100)) throw new BadRequestException("排序无效");
      const order = (input.order_by ?? []).map(item => {
        if (!aliases.has(item.field_id) || !["ASC","DESC"].includes(item.direction)) throw new BadRequestException("排序必须使用已选输出字段");
        return quote(aliases.get(item.field_id)!)+ " "+item.direction;
      });
      compiled = { sql:["SELECT "+selections.join(", "), "FROM "+quote(pkg.source.project)+"."+quote(pkg.table.name),where ? "WHERE "+where : "",order.length ? "ORDER BY "+order.join(", ") : "","LIMIT 200001;"].filter(Boolean).join("\n"),outputs:selected.map(field => ({id:field.id,name:field.name,type:field.normalized_type,unit:field.unit})),snapshotDate:options.snapshotDate ?? null,limit:200000 };
    }
    return {...compiled,resolvedDates:normalized.resolvedDates};
  }

  compileDimensionValues(pkg: SemanticPackage, input: DimensionValuesRequest, options: CompileOptions = {}): CompiledQuery {
    const fields = new Map(pkg.fields.map((field) => [field.id, field]));
    const field = fields.get(input.field_id);
    if (!field || !field.candidate_value_queryable || (field.type !== "DIMENSION" && field.type !== "LABEL")) throw new BadRequestException("该字段未开放候选值查询");
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException("候选值数量必须介于 1 到 200");
    const filters = [...asArray(input.filters)];
    const keywordCondition = text(input.keyword) && options.candidateSearch && field.normalized_type !== "STRING" ? `CAST(${quote(field.column)} AS STRING) LIKE ${sqlString("%"+text(input.keyword).replace(/[\\%_]/g,"\\$&")+"%")}` : "";
    if (text(input.keyword) && !keywordCondition) filters.push({ field_id: field.id, operator: "CONTAINS", values: [text(input.keyword)] });
    const { where: baseWhere } = this.where(pkg, fields, filters, input.date_range, options.snapshotDate, options.completeDays);
    const where = [baseWhere,keywordCondition].filter(Boolean).join(" AND ");
    const snapshotField = pkg.table.query_config.storage === "FULL_SNAPSHOT" && pkg.table.query_config.default_stat_date.field_id ? fields.get(pkg.table.query_config.default_stat_date.field_id) : undefined;
    const alias = readableAlias(field.name, new Set());
    const table = `${quote(pkg.source.project)}.${quote(pkg.table.name)}`;
    const selections = [`${snapshotField ? "" : "DISTINCT "}${quote(field.column)} AS ${quote(alias)}`];
    if (snapshotField) selections.push(`MAX(${quote(snapshotField.column)}) AS ${quote("__snapshot_date")}`);
    const clauses = [
      "SELECT",
      selections.map((selection) => `  ${selection}`).join(",\n"),
      `FROM ${table}`,
      where ? `WHERE ${where}` : "",
      snapshotField ? `GROUP BY ${quote(field.column)}` : "",
      `ORDER BY ${quote(field.column)} ASC`,
      `LIMIT ${limit + 1};`,
    ].filter(Boolean);
    return { sql: clauses.join("\n"), outputs: [{ id: field.id, name: field.name, type: field.normalized_type, unit: null }], snapshotDate: options.snapshotDate ?? null, limit };
  }

  private where(pkg: SemanticPackage, fields: Map<string, SemanticPackage["fields"][number]>, filters: QueryFilter[], dateRange: QueryRequest["date_range"] | DimensionValuesRequest["date_range"], snapshotDate?: string | null, completeDays = false) {
    const conditions: string[] = [];
    const config = pkg.table.query_config;
    const defaultDate = config.default_stat_date.field_id ? fields.get(config.default_stat_date.field_id) : undefined;
    if (config.storage === "FULL_SNAPSHOT") {
      if (!defaultDate?.is_partition) throw new BadRequestException("全量快照表需要把默认统计日期配置为有效分区字段");
      this.assertSupportedDate(defaultDate, config.default_stat_date.format);
      if (dateRange) throw new BadRequestException("全量快照表的默认统计日期用于自动选择最新快照，请使用其他业务日期字段筛选历史范围");
      if (!snapshotDate) throw new BadRequestException("全量快照表未能确定最新有效分区");
      conditions.push(`${quote(defaultDate.column)} = ${this.literal(defaultDate.normalized_type, snapshotDate)}`);
    } else if (dateRange) {
      if (!defaultDate) throw new BadRequestException("此表没有配置默认统计日期");
      this.assertSupportedDate(defaultDate, config.default_stat_date.format);
      const start = this.formatDefaultDate(defaultDate, config.default_stat_date.format, dateRange.start);
      const end = this.formatDefaultDate(defaultDate, config.default_stat_date.format, dateRange.end);
      if (start > end) throw new BadRequestException("日期范围无效");
      if (completeDays && defaultDate.normalized_type === "DATETIME") {
        conditions.push(`${quote(defaultDate.column)} >= ${this.literal("DATETIME", dateRange.start + " 00:00:00")} AND ${quote(defaultDate.column)} < ${this.literal("DATETIME", shiftDay(dateRange.end, 1) + " 00:00:00")}`);
      } else conditions.push(`${quote(defaultDate.column)} BETWEEN ${this.literal(defaultDate.normalized_type, start)} AND ${this.literal(defaultDate.normalized_type, end)}`);
    } else if (config.storage === "DATE_INCREMENTAL") {
      throw new BadRequestException("日期增量表必须指定日期范围：query_data 和 get_dimension_values 都需传 date_range: { start, end }，日期使用 YYYY-MM-DD 或 YYYYMMDD；日期未知请先澄清。");
    }
    for (const filter of filters) {
      const field = fields.get(filter.field_id);
      if (!field) throw new BadRequestException(`筛选字段 ${filter.field_id} 不存在于当前正式语义`);
      conditions.push(this.filter(field, filter));
    }
    return { where: conditions.join(" AND ") };
  }

  private filter(field: SemanticPackage["fields"][number], filter: QueryFilter) {
    const values = asArray(filter.values);
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) throw new BadRequestException("筛选 values 必须是字符串数组");
    const column = quote(field.column);
    if (filter.operator === "IS_NULL" || filter.operator === "IS_NOT_NULL") {
      if (values.length) throw new BadRequestException("空值判断不应提供 values");
      return `${column} IS ${filter.operator === "IS_NOT_NULL" ? "NOT " : ""}NULL`;
    }
    if (filter.operator === "BETWEEN") {
      if (values.length !== 2) throw new BadRequestException("区间筛选必须提供两个值");
      return `${column} BETWEEN ${this.literal(field.normalized_type, values[0])} AND ${this.literal(field.normalized_type, values[1])}`;
    }
    if (filter.operator === "IN") {
      if (!values.length || values.length > 100) throw new BadRequestException("集合筛选需要 1 到 100 个值");
      return `${column} IN (${values.map((value) => this.literal(field.normalized_type, value)).join(", ")})`;
    }
    if (filter.operator === "CONTAINS") {
      if (values.length !== 1) throw new BadRequestException("CONTAINS 的 values 必须恰好包含一个字符串");
      if (field.normalized_type !== "STRING") throw new BadRequestException(`字段 ${field.name} 的标准类型为 ${field.normalized_type}，CONTAINS/keyword 仅支持 STRING 字段；请核对正式语义和字段类型。`);
      return `${column} LIKE ${sqlString(`%${values[0].replace(/[\\%_]/g, "\\$&")}%`)}`;
    }
    if (values.length !== 1) throw new BadRequestException("筛选必须提供一个值");
    const operator = { EQ: "=", NEQ: "!=", GT: ">", GTE: ">=", LT: "<", LTE: "<=" }[filter.operator];
    if (!operator) throw new BadRequestException("筛选操作符无效：只支持 EQ、NEQ、GT、GTE、LT、LTE、BETWEEN、IN、IS_NULL、IS_NOT_NULL、CONTAINS；等于使用 EQ，不使用 =。");
    return `${column} ${operator} ${this.literal(field.normalized_type, values[0])}`;
  }

  private literal(type: string, value: string) {
    if (type === "INTEGER") {
      if (!/^-?\d+$/.test(value)) throw new BadRequestException("整数筛选值无效");
      return value;
    }
    if (type === "DECIMAL") {
      if (!/^-?(?:\d+|\d*\.\d+)$/.test(value)) throw new BadRequestException("数字筛选值无效");
      return value;
    }
    if (type === "BOOLEAN") {
      if (value !== "true" && value !== "false") throw new BadRequestException("布尔筛选值必须为 true 或 false");
      return value.toUpperCase();
    }
    return sqlString(value);
  }

  private formatDefaultDate(field: SemanticPackage["fields"][number], format: string, value: string) {
    if (!value) throw new BadRequestException("日期范围无效");
    if (field.normalized_type === "DATE" || field.normalized_type === "DATETIME") return value;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    const parts = iso ?? compact;
    if (!parts) throw new BadRequestException(`默认统计日期 ${field.name} 的值必须是有效日期`);
    if (format === "yyyyMMdd") return `${parts[1]}${parts[2]}${parts[3]}`;
    if (format === "yyyy-MM-dd") return `${parts[1]}-${parts[2]}-${parts[3]}`;
    if (format === "yyyy/MM/dd") return `${parts[1]}/${parts[2]}/${parts[3]}`;
    throw new BadRequestException(`默认统计日期 ${field.name} 的格式不受执行服务支持`);
  }

  private assertSupportedDate(field: SemanticPackage["fields"][number], format: string) {
    if (field.normalized_type === "DATE" || field.normalized_type === "DATETIME") return;
    if (!dateFormats.has(format)) throw new BadRequestException(`默认统计日期 ${field.name} 的格式不受执行服务支持`);
  }

  private assertFormula(formula: string, fields: Map<string, SemanticPackage["fields"][number]>, metricName: string) {
    if (!formula || /;|--|\/\*/.test(formula) || /\b(SELECT|FROM|JOIN|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|OVER)\b/i.test(formula)) throw new BadRequestException(`派生指标 ${metricName} 的公式不安全或为空`);
    let ast: unknown;
    try { ast = parser.astify(`SELECT ${formula}`, { database: "Hive" }); } catch { throw new BadRequestException(`派生指标 ${metricName} 的公式不符合受支持的 SQL 表达式`); }
    if (!ast) throw new BadRequestException(`派生指标 ${metricName} 的公式不符合受支持的 SQL 表达式`);
    const identifiers = formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    const knownColumns = new Set([...fields.values()].map((field) => field.column.toUpperCase()));
    const allowed = new Set(["SUM", "COUNT", "AVG", "MIN", "MAX", "IF", "NULLIF", "COALESCE", "ROUND", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST", "AS", "DISTINCT", "TRUE", "FALSE", "DECIMAL", "STRING", "BIGINT", "DOUBLE"]);
    for (const identifier of identifiers) if (!knownColumns.has(identifier.toUpperCase()) && !allowed.has(identifier.toUpperCase()) && !/^[Ee]$/.test(identifier)) throw new BadRequestException(`派生指标 ${metricName} 引用了未发布字段或不受支持函数：${identifier}`);
  }
}

const unique = (values: string[] | undefined) => [...new Set(asArray(values).filter((value) => typeof value === "string" && value.trim()))];
