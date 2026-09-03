import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AssetStatus, prisma } from "@eureka-atlas/database";

export type CreateGovernanceTaskInput = { tableId?: string; columns?: string[] };

@Injectable()
export class GovernanceService {
  async create(input: CreateGovernanceTaskInput) {
    const tableId = input.tableId?.trim();
    const columnIds = [...new Set((input.columns ?? []).filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))];
    if (!tableId) throw new BadRequestException("tableId is required");
    if (!columnIds.length) throw new BadRequestException("Select at least one column");

    const table = await prisma.metaTable.findUnique({ where: { id: tableId }, select: { id: true } });
    if (!table) throw new NotFoundException("Table not found");
    const columns = await prisma.metaColumn.findMany({ where: { id: { in: columnIds }, metaTableId: tableId, status: AssetStatus.ACTIVE }, select: { id: true } });
    if (columns.length !== columnIds.length) throw new BadRequestException("Selected columns must belong to this active table");

    const task = await prisma.governanceTask.create({ data: { metaTableId: tableId, selectedColumns: columnIds, createdBy: "local-user" } });
    return { id: task.id, status: task.status, createdAt: task.createdAt };
  }

  async list() {
    const tasks = await prisma.governanceTask.findMany({ include: { metaTable: { include: { metaProject: true } } }, orderBy: { createdAt: "desc" } });
    return Promise.all(tasks.map(async (task) => ({ id: task.id, table: { id: task.metaTable.id, name: task.metaTable.name, project: task.metaTable.metaProject.name }, columnCount: this.columnIds(task.selectedColumns).length, semanticCount: await prisma.columnSemantic.count({ where: { metaColumnId: { in: this.columnIds(task.selectedColumns) } } }), status: task.status, createdBy: task.createdBy, createdAt: task.createdAt, updatedAt: task.updatedAt })));
  }

  async get(id: string) {
    const task = await prisma.governanceTask.findUnique({ where: { id }, include: { metaTable: { include: { metaProject: true } } } });
    if (!task) throw new NotFoundException("Governance task not found");
    const selectedIds = this.columnIds(task.selectedColumns);
    const columns = await prisma.metaColumn.findMany({ where: { id: { in: selectedIds }, metaTableId: task.metaTableId }, select: { id: true, name: true, dataType: true, comment: true, ordinal: true, isPartition: true } });
    const [aiSuggestionCount, semanticCount, semanticPackage] = await Promise.all([prisma.aiColumnSuggestion.count({ where: { governanceTaskId: id } }), prisma.columnSemantic.count({ where: { metaColumnId: { in: selectedIds } } }), prisma.semanticPackage.findUnique({ where: { metaTableId: task.metaTableId }, select: { id: true } })]);
    const columnsById = new Map(columns.map((column) => [column.id, column]));
    return {
      id: task.id,
      status: task.status,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      aiSuggestionCount,
      semanticCount,
      semanticPackageAvailable: Boolean(semanticPackage),
      table: { id: task.metaTable.id, name: task.metaTable.name, type: task.metaTable.type, comment: task.metaTable.comment, project: task.metaTable.metaProject.name },
      columns: selectedIds.map((columnId) => columnsById.get(columnId)).filter((column): column is NonNullable<typeof column> => Boolean(column)),
    };
  }

  private columnIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
}
