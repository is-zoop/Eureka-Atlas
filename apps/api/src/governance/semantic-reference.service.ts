import { Injectable } from "@nestjs/common";
import { prisma } from "@eureka-atlas/database";

export type ReferenceField = { id: string; name: string; dataType: string; comment: string | null; isPartition: boolean };

type HistoricalField = {
  physical_field: string;
  metric_name: string;
  semantic_type: string;
  aggregation: string | null;
  unit: string | null;
  project: string;
  table: string;
};

const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
export const historicalMatchScore = (current: string, candidate: string) => {
  if (current.toLowerCase() === candidate.toLowerCase()) return 100;
  const left = new Set(words(current)); const right = new Set(words(candidate));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared ? Math.round((shared / Math.max(left.size, right.size)) * 60) : 0;
};
const dictionary: Record<string, string> = { id: "编号", name: "名称", date: "日期", time: "时间", amt: "金额", amount: "金额", num: "数量", cnt: "数量", count: "数量", ratio: "比率", rate: "率", shop: "店铺", sku: "SKU", spu: "SPU", order: "订单", refund: "退款", pay: "支付", user: "用户", goods: "商品", stat: "统计", create: "创建", update: "更新", status: "状态", type: "类型", label: "标签", tag: "标签", source: "来源", price: "价格", qty: "件数", quantity: "数量", total: "总", direct: "直接", visit: "访问", uv: "访客数", pv: "浏览量" };

export const physicalNameFallback = (name: string) => words(name).map((word) => dictionary[word] ?? word).join("") || name;

@Injectable()
export class SemanticReferenceService {
  async build(fields: ReferenceField[]) {
    const [columns, metrics] = await Promise.all([
      prisma.columnSemantic.findMany({
        include: { metaColumn: { include: { metaTable: { include: { metaProject: true } } } } },
      }),
      prisma.semanticMetric.findMany({
        include: { metaTable: { include: { metaProject: true } } },
        orderBy: { publishedAt: "desc" },
      }),
    ]);
    const historical = columns.map<HistoricalField>((item) => ({
      physical_field: item.metaColumn.name,
      metric_name: item.metricName,
      semantic_type: item.semanticType,
      aggregation: item.aggregation,
      unit: item.unit,
      project: item.metaColumn.metaTable.metaProject.name,
      table: item.metaColumn.metaTable.name,
    }));
    const fieldReferences = fields.map((field) => {
      const references = historical
        .map((item) => ({ item, score: historicalMatchScore(field.name, item.physical_field) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.item.metric_name.localeCompare(right.item.metric_name))
        .slice(0, 3)
        .map(({ item }) => item);
      return {
        current_column: field.name,
        references,
        preferred_name: references[0]?.metric_name || field.comment?.trim() || physicalNameFallback(field.name),
      };
    });
    const metricReferences = metrics
      .map((metric) => {
        const dependencies: unknown[] = Array.isArray(metric.dependencies) ? metric.dependencies : [];
        const related = dependencies.reduce<number>((best, dependency) => {
          const name = dependency && typeof dependency === "object" && "column" in dependency ? String((dependency as { column?: unknown }).column ?? "") : "";
          return Math.max(best, ...fields.map((field) => historicalMatchScore(field.name, name)));
        }, 0);
        return {
          score: related,
          name: metric.name,
          formula: metric.formula,
          unit: metric.unit,
          dependencies,
          project: metric.metaTable.metaProject.name,
          table: metric.metaTable.name,
        };
      })
      .filter((metric) => metric.score > 0)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, 20)
      .map((metric) => ({
        name: metric.name,
        formula: metric.formula,
        unit: metric.unit,
        dependencies: metric.dependencies,
        project: metric.project,
        table: metric.table,
      }));
    return { fieldReferences, metricReferences };
  }
}
