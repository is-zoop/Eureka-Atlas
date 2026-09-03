import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AssetStatus,
  ColumnSemanticType,
  prisma,
} from "@eureka-atlas/database";
import { PackageService } from "../package/package.service";
import { GovernanceAiService } from "./governance-ai.service";
import {
  classifySemanticType,
  normalizeSemanticType,
} from "./semantic-classifier";

type TableDraft = {
  businessName: string;
  description: string;
  grain: string;
  permissionColumnId: string | null;
};
type ColumnDraft = {
  metaColumnId: string;
  metricName: string;
  semanticType: string;
  aggregation: string;
  unit: string;
};
export type WorkspaceInput = {
  selectedColumns?: string[];
  table?: Partial<TableDraft>;
  columns?: ColumnDraft[];
};
export type CreateWorkspaceInput = WorkspaceInput & { tableId?: string };
const types = new Set(Object.values(ColumnSemanticType));
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

@Injectable()
export class GovernanceWorkspaceService {
  constructor(
    private readonly ai: GovernanceAiService,
    private readonly packages: PackageService,
  ) {}
  async create(input: CreateWorkspaceInput) {
    const tableId = text(input.tableId);
    if (!tableId) throw new BadRequestException("tableId is required");
    const table = await this.table(tableId);
    const draft = await this.normalize(input, table);
    const task = await prisma.governanceTask.create({
      data: {
        metaTableId: tableId,
        selectedColumns: draft.selectedColumns,
        createdBy: "local-user",
        review: {
          create: { tableDraft: draft.table, columnDrafts: draft.columns },
        },
      },
    });
    return this.get(task.id);
  }
  async get(id: string) {
    const task = await this.task(id);
    const allColumns = await prisma.metaColumn.findMany({
      where: { metaTableId: task.metaTableId, status: AssetStatus.ACTIVE },
      orderBy: { ordinal: "asc" },
    });
    const selectedColumns = this.ids(task.selectedColumns);
    const draft = task.review
      ? this.fromReview(
          task.review.tableDraft,
          task.review.columnDrafts,
          allColumns,
          selectedColumns,
          task.metaTable,
        )
      : this.defaultDraft(task.metaTable, allColumns, selectedColumns);
    const selectedSet = new Set(selectedColumns);
    return {
      id: task.id,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      table: {
        id: task.metaTable.id,
        name: task.metaTable.name,
        project: task.metaTable.metaProject.name,
        type: task.metaTable.type,
        comment: task.metaTable.comment,
      },
      allColumns: allColumns.map((column) => ({
        id: column.id,
        name: column.name,
        dataType: column.dataType,
        comment: column.comment,
        ordinal: column.ordinal,
        isPartition: column.isPartition,
      })),
      selectedColumns,
      draft,
      ai: task.tableSuggestion
        ? {
            table: {
              businessName: task.tableSuggestion.businessName,
              description: task.tableSuggestion.description,
              grain: task.tableSuggestion.grain ?? "",
            },
            columns: task.columnSuggestions.map((suggestion) => ({
              metaColumnId: suggestion.metaColumnId,
              columnName: suggestion.metaColumn.name,
              metricName: suggestion.metricName,
              semanticType: suggestion.semanticType,
              aggregation: suggestion.aggregation ?? "",
              unit: suggestion.unit ?? "",
              confidence: suggestion.confidence,
              reason: suggestion.reason,
            })),
          }
        : null,
      published: {
        table: task.metaTable.semantic
          ? {
              publishedAt: task.metaTable.semantic.publishedAt,
              permissionColumnId: task.metaTable.semantic.permissionColumnId,
            }
          : null,
        columns: allColumns.filter((column) => selectedSet.has(column.id))
          .length,
      },
    };
  }
  async update(id: string, input: WorkspaceInput) {
    const task = await this.task(id);
    const draft = await this.normalize(input, task.metaTable);
    await prisma.$transaction(async (tx) => {
      await tx.governanceTask.update({
        where: { id },
        data: {
          selectedColumns: draft.selectedColumns,
          status: task.tableSuggestion ? "REVIEWING" : "PENDING",
        },
      });
      await tx.governanceReview.upsert({
        where: { governanceTaskId: id },
        create: {
          governanceTaskId: id,
          tableDraft: draft.table,
          columnDrafts: draft.columns,
        },
        update: { tableDraft: draft.table, columnDrafts: draft.columns },
      });
    });
    return this.get(id);
  }
  async generate(id: string, input: WorkspaceInput) {
    await this.update(id, input);
    await this.ai.execute(id);
    return this.get(id);
  }
  async publish(id: string, input?: WorkspaceInput) {
    if (input) await this.update(id, input);
    const task = await this.task(id);
    const allColumns = await prisma.metaColumn.findMany({
      where: { metaTableId: task.metaTableId, status: AssetStatus.ACTIVE },
      orderBy: { ordinal: "asc" },
    });
    const selectedColumns = this.ids(task.selectedColumns);
    const draft = task.review
      ? this.fromReview(
          task.review.tableDraft,
          task.review.columnDrafts,
          allColumns,
          selectedColumns,
          task.metaTable,
        )
      : this.defaultDraft(task.metaTable, allColumns, selectedColumns);
    this.validatePublish(draft);
    const active = new Set(allColumns.map((column) => column.id));
    if (
      draft.table.permissionColumnId &&
      !active.has(draft.table.permissionColumnId)
    )
      throw new BadRequestException(
        "Permission column must belong to this active table",
      );
    const publishedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.tableSemantic.upsert({
        where: { metaTableId: task.metaTableId },
        create: {
          metaTableId: task.metaTableId,
          sourceGovernanceTaskId: id,
          ...draft.table,
          publishedBy: "local-user",
          publishedAt,
        },
        update: {
          sourceGovernanceTaskId: id,
          ...draft.table,
          publishedBy: "local-user",
          publishedAt,
        },
      });
      for (const column of draft.columns)
        await tx.columnSemantic.upsert({
          where: { metaColumnId: column.metaColumnId },
          create: {
            ...column,
            semanticType: column.semanticType as ColumnSemanticType,
            aggregation: column.aggregation || null,
            unit: column.unit || null,
            sourceGovernanceTaskId: id,
            publishedBy: "local-user",
            publishedAt,
          },
          update: {
            metricName: column.metricName,
            semanticType: column.semanticType as ColumnSemanticType,
            aggregation: column.aggregation || null,
            unit: column.unit || null,
            sourceGovernanceTaskId: id,
            publishedBy: "local-user",
            publishedAt,
          },
        });
      await this.packages.generateForTable(tx, task.metaTableId);
      await tx.governanceTask.update({
        where: { id },
        data: { status: "COMPLETED" },
      });
    });
    return this.get(id);
  }
  private async task(id: string) {
    const task = await prisma.governanceTask.findUnique({
      where: { id },
      include: {
        metaTable: { include: { metaProject: true, semantic: true } },
        review: true,
        tableSuggestion: true,
        columnSuggestions: {
          include: { metaColumn: true },
          orderBy: { metaColumn: { ordinal: "asc" } },
        },
      },
    });
    if (!task) throw new NotFoundException("Governance task not found");
    return task;
  }
  private async table(id: string) {
    const table = await prisma.metaTable.findUnique({
      where: { id },
      include: { metaProject: true },
    });
    if (!table || table.status !== AssetStatus.ACTIVE)
      throw new NotFoundException("Active table not found");
    return table;
  }
  private ids(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
  private defaultDraft(
    table: { name: string; comment: string | null },
    columns: Array<{
      id: string;
      name: string;
      dataType: string;
      comment?: string | null;
      isPartition?: boolean;
    }>,
    selected: string[],
  ) {
    return {
      table: {
        businessName: table.name,
        description: table.comment ?? "",
        grain: "",
        permissionColumnId: null,
      },
      columns: selected.map((id) => {
        const column = columns.find((item) => item.id === id);
        return {
          metaColumnId: id,
          metricName: column?.name ?? "",
          semanticType: classifySemanticType(
            column ?? { name: "", dataType: "" },
          ),
          aggregation: "",
          unit: "",
        };
      }),
    };
  }
  private fromReview(
    tableValue: unknown,
    columnsValue: unknown,
    columns: Array<{
      id: string;
      name: string;
      dataType: string;
      comment?: string | null;
      isPartition?: boolean;
    }>,
    selected: string[],
    table: { name: string; comment: string | null },
  ) {
    return this.normalizeDraft(
      {
        table: tableValue as Partial<TableDraft>,
        columns: columnsValue as ColumnDraft[],
        selectedColumns: selected,
      },
      columns,
      table,
    );
  }
  private async normalize(
    input: WorkspaceInput,
    table: { id: string; name: string; comment: string | null },
  ) {
    const columns = await prisma.metaColumn.findMany({
      where: { metaTableId: table.id, status: AssetStatus.ACTIVE },
      select: {
        id: true,
        name: true,
        dataType: true,
        comment: true,
        isPartition: true,
      },
      orderBy: { ordinal: "asc" },
    });
    return this.normalizeDraft(input, columns, table);
  }
  private normalizeDraft(
    input: WorkspaceInput,
    allColumns: Array<{
      id: string;
      name: string;
      dataType: string;
      comment?: string | null;
      isPartition?: boolean;
    }>,
    table: { name: string; comment: string | null },
  ) {
    const selectedColumns = [
      ...new Set((input.selectedColumns ?? []).map(text).filter(Boolean)),
    ];
    if (!selectedColumns.length)
      throw new BadRequestException("Select at least one column");
    const allowed = new Set(allColumns.map((column) => column.id));
    if (selectedColumns.some((id) => !allowed.has(id)))
      throw new BadRequestException(
        "Selected columns must belong to this active table",
      );
    const raw = input.columns;
    if (!Array.isArray(raw) || raw.length !== selectedColumns.length)
      throw new BadRequestException(
        "Draft must include every selected column exactly once",
      );
    const seen = new Set(raw.map((column) => text(column.metaColumnId)));
    if (
      seen.size !== selectedColumns.length ||
      selectedColumns.some((id) => !seen.has(id))
    )
      throw new BadRequestException(
        "Draft columns must match selected columns",
      );
    const rawTable = input.table ?? {};
    const permissionColumnId = text(rawTable.permissionColumnId) || null;
    if (permissionColumnId && !allowed.has(permissionColumnId))
      throw new BadRequestException(
        "Permission column must belong to this active table",
      );
    return {
      selectedColumns,
      table: {
        businessName: text(rawTable.businessName) || table.name,
        description: text(rawTable.description) || table.comment || "",
        grain: text(rawTable.grain),
        permissionColumnId,
      },
      columns: raw.map((column) => ({
        metaColumnId: text(column.metaColumnId),
        metricName: text(column.metricName),
        semanticType: normalizeSemanticType(
          column.semanticType,
          classifySemanticType(
            allColumns.find(
              (item) => item.id === text(column.metaColumnId),
            ) ?? { name: "", dataType: "" },
          ),
        ),
        aggregation: text(column.aggregation),
        unit: text(column.unit),
      })),
    };
  }
  private validatePublish(draft: {
    table: TableDraft;
    columns: ColumnDraft[];
  }) {
    if (
      !draft.table.businessName ||
      !draft.table.description ||
      !draft.table.grain
    )
      throw new BadRequestException(
        "Table business name, description, and grain are required before publishing",
      );
    for (const column of draft.columns) {
      if (
        !column.metricName ||
        !types.has(column.semanticType as ColumnSemanticType)
      )
        throw new BadRequestException(
          "Every selected column needs metric name and semantic type before publishing",
        );
      if (
        column.semanticType === ColumnSemanticType.METRIC &&
        !column.aggregation
      )
        throw new BadRequestException(
          "Metric columns require an aggregation before publishing",
        );
    }
  }
}
