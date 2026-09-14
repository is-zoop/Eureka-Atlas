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
import {
  classifySemanticType,
  normalizeSemanticType,
} from "./semantic-classifier";
import { MetricFormulaService } from "./metric-formula.service";
import { SemanticCatalogService } from "../semantic/semantic-catalog.service";
import { SystemSettingsService } from "../system-settings/system-settings.service";

type TableDraft = {
  dataDomain: string | null;
  businessName: string;
  description: string;
  grain: string;
  permissionColumnId: string | null;
  permissionRelation: string | null;
};
type ColumnDraft = {
  metaColumnId: string;
  metricName: string;
  semanticType: string;
  aggregation: string;
  unit: string;
  groupable: boolean;
  candidateValueQueryable: boolean;
  labelDescription: string;
};
type MetricDraft = {
  id: string;
  name: string;
  formula: string;
  unit: string;
};
export type WorkspaceInput = {
  selectedColumns?: string[];
  table?: Partial<TableDraft>;
  columns?: ColumnDraft[];
  metrics?: MetricDraft[];
};
export type CreateWorkspaceInput = WorkspaceInput & { tableId?: string };
export type FormulaValidationInput = { tableId?: string; selectedColumns?: string[]; formula?: string };
const types = new Set(Object.values(ColumnSemanticType));
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

@Injectable()
export class GovernanceWorkspaceService {
  constructor(
    private readonly packages: PackageService,
    private readonly formulas: MetricFormulaService,
    private readonly catalogs: SemanticCatalogService,
    private readonly settings: SystemSettingsService,
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
          create: { tableDraft: draft.table, columnDrafts: draft.columns, metricDrafts: draft.metrics },
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
          task.review.metricDrafts,
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
              dataDomain: task.tableSuggestion.dataDomain,
              businessName: task.tableSuggestion.businessName,
              description: task.tableSuggestion.description,
              grain: task.tableSuggestion.grain ?? "",
              permissionColumnId: task.tableSuggestion.permissionColumnId,
              permissionRelation: task.tableSuggestion.permissionRelation,
            },
            columns: task.columnSuggestions.map((suggestion) => ({
              metaColumnId: suggestion.metaColumnId,
              columnName: suggestion.metaColumn.name,
              metricName: suggestion.metricName,
              semanticType: suggestion.semanticType,
              aggregation: suggestion.aggregation ?? "",
              unit: suggestion.unit ?? "",
              groupable: suggestion.groupable,
              candidateValueQueryable: suggestion.candidateValueQueryable,
              labelDescription: suggestion.labelDescription,
              confidence: suggestion.confidence,
              reason: suggestion.reason,
            })),
            metrics: task.metricSuggestions.map((suggestion) => ({
              id: suggestion.id,
              name: suggestion.name,
              formula: suggestion.formula,
              unit: suggestion.unit ?? "",
              dependencies: Array.isArray(suggestion.dependencies)
                ? suggestion.dependencies
                : [],
              confidence: suggestion.confidence,
              reason: suggestion.reason,
            })),
          }
        : null,
      published: {
        table: task.metaTable.semantic
          ? {
              publishedAt: task.metaTable.semantic.publishedAt,
              dataDomain: task.metaTable.semantic.dataDomain,
              permissionColumnId: task.metaTable.semantic.permissionColumnId,
              permissionRelation: task.metaTable.semantic.permissionRelation,
            }
          : null,
        columns: allColumns.filter((column) => selectedSet.has(column.id))
          .length,
      },
    };
  }
  async resolveForTable(tableId: string, requestedTaskId?: string) {
    await this.table(tableId);
    const explicitId = text(requestedTaskId);
    if (explicitId) {
      const task = await prisma.governanceTask.findFirst({
        where: { id: explicitId, metaTableId: tableId },
        select: { id: true },
      });
      if (!task)
        throw new NotFoundException("Governance task does not belong to this table");
      return this.get(task.id);
    }
    const formal = await prisma.tableSemantic.findUnique({
      where: { metaTableId: tableId },
      select: { sourceGovernanceTaskId: true },
    });
    if (formal) return this.get(formal.sourceGovernanceTaskId);
    const latest = await prisma.governanceTask.findFirst({
      where: { metaTableId: tableId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    return latest ? this.get(latest.id) : null;
  }
  async validateFormula(input: FormulaValidationInput) {
    const tableId = text(input.tableId);
    if (!tableId) throw new BadRequestException("tableId is required");
    await this.table(tableId);
    const allColumns = await prisma.metaColumn.findMany({
      where: { metaTableId: tableId, status: AssetStatus.ACTIVE },
      select: { id: true, name: true },
    });
    const selectedIds = this.ids(input.selectedColumns);
    const selected = allColumns.filter((column) => selectedIds.includes(column.id));
    if (selected.length !== new Set(selectedIds).size)
      throw new BadRequestException("Selected columns must belong to this active table");
    return this.formulas.validateAndResolve(
      text(input.formula),
      this.allFormulaFields(selected),
      this.allFormulaFields(allColumns),
    );
  }
  async update(id: string, input: WorkspaceInput) {
    const task = await this.task(id);
    const legacyTable = task.review?.tableDraft as Partial<TableDraft> | undefined;
    const draft = await this.normalize(input, task.metaTable, legacyTable);
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
            metricDrafts: draft.metrics,
          },
        update: {
          tableDraft: draft.table,
          columnDrafts: draft.columns,
          metricDrafts: draft.metrics,
        },
      });
    });
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
          task.review.metricDrafts,
          allColumns,
          selectedColumns,
          task.metaTable,
        )
      : this.defaultDraft(task.metaTable, allColumns, selectedColumns);
    const resolvedMetrics = this.validatePublish(draft, allColumns);
    const active = new Set(selectedColumns);
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
            aggregation: column.semanticType === ColumnSemanticType.METRIC ? column.aggregation || null : null,
            unit: column.semanticType === ColumnSemanticType.METRIC ? column.unit || null : null,
            groupable: (column.semanticType === ColumnSemanticType.DIMENSION || column.semanticType === ColumnSemanticType.LABEL) && column.groupable,
            candidateValueQueryable: (column.semanticType === ColumnSemanticType.DIMENSION || column.semanticType === ColumnSemanticType.LABEL) && column.candidateValueQueryable,
            labelDescription: column.semanticType === ColumnSemanticType.LABEL ? column.labelDescription || null : null,
            sourceGovernanceTaskId: id,
            publishedBy: "local-user",
            publishedAt,
          },
          update: {
            metricName: column.metricName,
            semanticType: column.semanticType as ColumnSemanticType,
            aggregation: column.semanticType === ColumnSemanticType.METRIC ? column.aggregation || null : null,
            unit: column.semanticType === ColumnSemanticType.METRIC ? column.unit || null : null,
            groupable: (column.semanticType === ColumnSemanticType.DIMENSION || column.semanticType === ColumnSemanticType.LABEL) && column.groupable,
            candidateValueQueryable: (column.semanticType === ColumnSemanticType.DIMENSION || column.semanticType === ColumnSemanticType.LABEL) && column.candidateValueQueryable,
            labelDescription: column.semanticType === ColumnSemanticType.LABEL ? column.labelDescription || null : null,
            sourceGovernanceTaskId: id,
            publishedBy: "local-user",
            publishedAt,
          },
        });
      await tx.semanticMetric.deleteMany({
        where: { metaTableId: task.metaTableId },
      });
      if (resolvedMetrics.length)
        await tx.semanticMetric.createMany({
          data: resolvedMetrics.map(({ draft: metric, resolved }) => ({
            metaTableId: task.metaTableId,
            sourceGovernanceTaskId: id,
            name: metric.name,
            formula: resolved.formula,
            unit: metric.unit || null,
            dependencies: resolved.dependencies,
            publishedBy: "local-user",
            publishedAt,
          })),
        });
      await this.catalogs.syncForTable(tx, task.metaTableId);
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
        metricSuggestions: { orderBy: { createdAt: "asc" } },
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
        dataDomain: null,
        businessName: "",
        description: table.comment ?? "",
        grain: "",
        permissionColumnId: null,
        permissionRelation: null,
      },
      columns: selected.map((id) => {
        const column = columns.find((item) => item.id === id);
        const semanticType = classifySemanticType(
          column ?? { name: "", dataType: "" },
        );
        const supportsOptions = semanticType === ColumnSemanticType.DIMENSION || semanticType === ColumnSemanticType.LABEL;
        return {
          metaColumnId: id,
          semanticType,
          metricName: column?.isPartition ? column.name : column?.comment?.trim() ?? "",
          aggregation: "",
          unit: "",
          groupable: supportsOptions,
          candidateValueQueryable: supportsOptions,
          labelDescription: "",
        };
      }),
      metrics: [],
    };
  }
  private fromReview(
    tableValue: unknown,
    columnsValue: unknown,
    metricsValue: unknown,
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
        metrics: metricsValue as MetricDraft[],
        selectedColumns: selected,
      },
      columns,
      table,
    );
  }
  private async normalize(
    input: WorkspaceInput,
    table: { id: string; name: string; comment: string | null },
    legacyTable?: Partial<TableDraft>,
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
    const draft = this.normalizeDraft(input, columns, table);
    const options = await this.settings.governanceOptions();
    if (draft.table.dataDomain && !options.dataDomains.includes(draft.table.dataDomain) && draft.table.dataDomain !== text(legacyTable?.dataDomain))
      throw new BadRequestException("Invalid data domain");
    if (draft.table.permissionRelation && !options.permissionRelations.includes(draft.table.permissionRelation) && draft.table.permissionRelation !== text(legacyTable?.permissionRelation))
      throw new BadRequestException("Invalid permission relation");
    return draft;
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
    const dataDomain = text(rawTable.dataDomain) || null;
    const permissionColumnId = text(rawTable.permissionColumnId) || null;
    const permissionRelation = text(rawTable.permissionRelation) || null;
    const selectedNames = new Set(
      allColumns
        .filter((column) => selectedColumns.includes(column.id))
        .map((column) => column.name),
    );
    const grainFields = text(rawTable.grain)
      .split(",")
      .map((name) => name.trim())
      // Older drafts may contain a business-name grain suggested by AI instead
      // of a physical column name. It cannot be selected in the current UI, so
      // discard it while saving the draft rather than blocking AI generation.
      .filter((name) => selectedNames.has(name));
    if (permissionColumnId && !selectedColumns.includes(permissionColumnId))
      throw new BadRequestException(
        "Permission column must belong to this active table",
      );
    const normalized = {
      selectedColumns,
      table: {
        dataDomain,
        businessName: text(rawTable.businessName),
        description: text(rawTable.description) || table.comment || "",
        grain: [...new Set(grainFields)].join(", "),
        permissionColumnId,
        permissionRelation,
      },
      columns: raw.map((column) => {
        const semanticType = normalizeSemanticType(
          column.semanticType,
          classifySemanticType(
            allColumns.find(
              (item) => item.id === text(column.metaColumnId),
            ) ?? { name: "", dataType: "" },
          ),
        );
        const supportsOptions = semanticType === ColumnSemanticType.DIMENSION || semanticType === ColumnSemanticType.LABEL;
        const groupable = supportsOptions ? column.groupable !== false : false;
        const candidateValueQueryable = supportsOptions ? column.candidateValueQueryable !== false : false;
        return {
          metaColumnId: text(column.metaColumnId),
          metricName: text(column.metricName),
          semanticType,
          aggregation: semanticType === ColumnSemanticType.METRIC ? text(column.aggregation) : "",
          unit: semanticType === ColumnSemanticType.METRIC ? text(column.unit) : "",
          groupable,
          candidateValueQueryable,
          labelDescription: semanticType === ColumnSemanticType.LABEL ? text(column.labelDescription) : "",
        };
      }),
      metrics: (Array.isArray(input.metrics) ? input.metrics : []).map((metric) => ({
        id: text(metric.id),
        name: text(metric.name),
        formula: text(metric.formula),
        unit: text(metric.unit),
      })),
    };
    const metricIds = normalized.metrics.map((metric) => metric.id);
    if (metricIds.some((id) => !id) || new Set(metricIds).size !== metricIds.length)
      throw new BadRequestException("Every metric draft needs a unique id");
    this.validateMetricReferences(normalized, allColumns);
    return normalized;
  }
  private validatePublish(draft: {
    table: TableDraft;
    columns: ColumnDraft[];
    metrics: MetricDraft[];
  }, allColumns: Array<{ id: string; name: string }>) {
    if (
      !draft.table.businessName ||
      !draft.table.description ||
      !draft.table.grain ||
      !draft.table.permissionColumnId ||
      !draft.table.permissionRelation
    )
      throw new BadRequestException(
        "Table business name, description, grain, permission column, and permission relation are required before publishing",
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
    const names = draft.metrics.map((metric) => metric.name);
    if (names.some((name) => !name) || new Set(names).size !== names.length)
      throw new BadRequestException("Derived metric names must be present and unique");
    return draft.metrics.map((metric) => ({
      draft: metric,
      resolved: this.formulas.validateAndResolve(
        metric.formula,
        this.selectedFormulaFields(draft, allColumns),
        this.allFormulaFields(allColumns),
      ),
    }));
  }
  private validateMetricReferences(
    draft: { columns: ColumnDraft[]; metrics: MetricDraft[] },
    allColumns: Array<{ id: string; name: string }>,
  ) {
    const selected = this.selectedFormulaFields(draft, allColumns);
    for (const metric of draft.metrics)
      if (metric.formula)
        this.formulas.validateAndResolve(
          metric.formula,
          selected,
          this.allFormulaFields(allColumns),
        );
  }
  private selectedFormulaFields(
    draft: { columns: ColumnDraft[] },
    allColumns: Array<{ id: string; name: string }>,
  ) {
    const names = new Map(allColumns.map((column) => [column.id, column.name]));
    return draft.columns
      .filter((column) => Boolean(names.get(column.metaColumnId)))
      .map((column) => ({
        id: column.metaColumnId,
        column: names.get(column.metaColumnId) ?? "",
      }));
  }
  private allFormulaFields(allColumns: Array<{ id: string; name: string }>) {
    return allColumns.map((column) => ({ id: column.id, column: column.name }));
  }
}
