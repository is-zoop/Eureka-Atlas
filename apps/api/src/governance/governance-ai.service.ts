import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ColumnSemanticType, prisma } from "@eureka-atlas/database";
import { LlmService } from "../llm/llm.service";

type Parsed = {
  table: { business_name: string; description: string; grain?: string };
  columns: Array<{
    column_name: string;
    metric_name: string;
    semantic_type: string;
    aggregation?: string;
    unit?: string;
    confidence: number;
    reason: string;
  }>;
};

@Injectable()
export class GovernanceAiService {
  constructor(private readonly llm: LlmService) {}
  async execute(id: string) {
    const task = await this.task(id);
    await prisma.governanceTask.update({
      where: { id },
      data: { status: "PROCESSING" },
    });
    try {
      const parsed = this.parse(
        await this.llm.complete(this.prompt(this.context(task))),
        task.columns.map((column) => column.name),
      );
      const suggestions = parsed.columns.map((item) => {
        const column = task.columns.find(
          (candidate) => candidate.name === item.column_name,
        );
        if (!column)
          throw new BadRequestException(
            "LLM response does not match selected columns",
          );
        return {
          governanceTaskId: id,
          metaColumnId: column.id,
          metricName: item.metric_name,
          semanticType: item.semantic_type,
          aggregation: item.aggregation || null,
          unit: item.unit || null,
          confidence: item.confidence,
          reason: item.reason,
        };
      });
      await prisma.$transaction(async (tx) => {
        await tx.aiTableSuggestion.upsert({
          where: { governanceTaskId: id },
          create: {
            governanceTaskId: id,
            businessName: parsed.table.business_name,
            description: parsed.table.description,
            grain: parsed.table.grain || null,
          },
          update: {
            businessName: parsed.table.business_name,
            description: parsed.table.description,
            grain: parsed.table.grain || null,
          },
        });
        await tx.aiColumnSuggestion.deleteMany({
          where: { governanceTaskId: id },
        });
        await tx.aiColumnSuggestion.createMany({ data: suggestions });
        await tx.governanceTask.update({
          where: { id },
          data: { status: "REVIEWING" },
        });
      });
      return this.suggestions(id);
    } catch (error) {
      await prisma.governanceTask.update({
        where: { id },
        data: { status: "PENDING" },
      });
      throw error;
    }
  }
  async suggestions(id: string) {
    await this.task(id);
    const [table, columns] = await Promise.all([
      prisma.aiTableSuggestion.findUnique({ where: { governanceTaskId: id } }),
      prisma.aiColumnSuggestion.findMany({
        where: { governanceTaskId: id },
        include: { metaColumn: { select: { id: true, name: true } } },
        orderBy: { metaColumn: { ordinal: "asc" } },
      }),
    ]);
    return {
      table,
      columns: columns.map((item) => ({ ...item, column: item.metaColumn })),
    };
  }
  async count(id: string) {
    return prisma.aiColumnSuggestion.count({ where: { governanceTaskId: id } });
  }
  private async task(id: string) {
    const task = await prisma.governanceTask.findUnique({
      where: { id },
      include: { metaTable: { include: { metaProject: true } } },
    });
    if (!task) throw new NotFoundException("Governance task not found");
    const ids = Array.isArray(task.selectedColumns)
      ? task.selectedColumns.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const columns = await prisma.metaColumn.findMany({
      where: { id: { in: ids }, metaTableId: task.metaTableId },
      orderBy: { ordinal: "asc" },
    });
    if (!columns.length)
      throw new BadRequestException("Governance task has no selected columns");
    return { ...task, columns };
  }
  private context(task: Awaited<ReturnType<GovernanceAiService["task"]>>) {
    return {
      table: {
        project: task.metaTable.metaProject.name,
        name: task.metaTable.name,
        comment: task.metaTable.comment,
        type: task.metaTable.type,
      },
      columns: task.columns.map((column) => ({
        name: column.name,
        type: column.dataType,
        comment: column.comment,
        is_partition: column.isPartition,
      })),
      historical_semantics: [],
      governance_rules: [],
    };
  }
  private prompt(context: unknown) {
    return `你是一名企业数据治理专家。根据以下表结构生成业务语义建议。只返回 JSON，不要 Markdown 或说明。输出格式：{"table":{"business_name":"","description":"","grain":""},"columns":[{"column_name":"","metric_name":"","semantic_type":"DIMENSION|METRIC|LABEL|PARTITION","aggregation":"","unit":"","confidence":0.0,"reason":""}]}。每个输入字段必须且只能出现一次。\n${JSON.stringify(context)}`;
  }
  private parse(raw: string, names: string[]): Parsed {
    let data: unknown;
    try {
      data = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      throw new BadRequestException("LLM returned invalid JSON");
    }
    const result = data as Parsed;
    if (
      !result?.table ||
      !Array.isArray(result.columns) ||
      result.columns.length !== names.length ||
      !result.table.business_name ||
      !result.table.description
    )
      throw new BadRequestException(
        "LLM response has an invalid suggestion structure",
      );
    const actual = result.columns.map((item) => item.column_name);
    if (
      new Set(actual).size !== names.length ||
      names.some((name) => !actual.includes(name)) ||
      result.columns.some(
        (item) =>
          !item.metric_name ||
          !item.semantic_type ||
          !item.reason ||
          !Object.values(ColumnSemanticType).includes(
            item.semantic_type as ColumnSemanticType,
          ) ||
          typeof item.confidence !== "number" ||
          item.confidence < 0 ||
          item.confidence > 1,
      )
    )
      throw new BadRequestException(
        "LLM response does not match selected columns",
      );
    return result;
  }
}
