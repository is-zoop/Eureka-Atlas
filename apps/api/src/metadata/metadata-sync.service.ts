import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma } from "@eureka-atlas/database";
import { DatasourceService } from "../datasource/datasource.service";
import { MaxComputeClient } from "./maxcompute.client";

type SyncCounts = { projects: { created: number; updated: number }; tables: { created: number; updated: number; deprecated: number }; columns: { created: number; updated: number; deprecated: number } };
export type ListTablesInput = { q?: string; project?: string; type?: string; page?: string | number; pageSize?: string | number };
const positiveInteger = (value: string | number | undefined, fallback: number) => { const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; };

@Injectable()
export class MetadataSyncService {
  constructor(private readonly datasourceService: DatasourceService) {}

  async sync(dataSourceId: string) {
    const source = await this.datasourceService.getWithCredentials(dataSourceId);
    const client = new MaxComputeClient(source);
    const counts: SyncCounts = { projects: { created: 0, updated: 0 }, tables: { created: 0, updated: 0, deprecated: 0 }, columns: { created: 0, updated: 0, deprecated: 0 } };
    const projectData = await client.getProject();
    const existingProject = await prisma.metaProject.findUnique({ where: { dataSourceId_name: { dataSourceId, name: projectData.name } } });
    const project = await prisma.metaProject.upsert({
      where: { dataSourceId_name: { dataSourceId, name: projectData.name } },
      create: { dataSourceId, name: projectData.name, description: projectData.description, region: source.region, lastSyncedAt: new Date() },
      update: { description: projectData.description, region: source.region, status: "ACTIVE", lastSyncedAt: new Date() },
    });
    counts.projects[existingProject ? "updated" : "created"]++;

    const remoteTables = await client.listTables();
    const names = remoteTables.map((table) => table.name);
    const retiredTables = await prisma.metaTable.updateMany({ where: { metaProjectId: project.id, name: { notIn: names }, status: "ACTIVE" }, data: { status: "DEPRECATED" } });
    counts.tables.deprecated += retiredTables.count;

    for (const item of remoteTables) {
      const tableData = await client.getTable(item.name);
      const existingTable = await prisma.metaTable.findUnique({ where: { metaProjectId_name: { metaProjectId: project.id, name: tableData.name } } });
      const table = await prisma.metaTable.upsert({
        where: { metaProjectId_name: { metaProjectId: project.id, name: tableData.name } },
        create: { metaProjectId: project.id, name: tableData.name, type: tableData.type, comment: tableData.comment, sourceUpdatedAt: tableData.updatedAt, lastSyncedAt: new Date() },
        update: { type: tableData.type, comment: tableData.comment, sourceUpdatedAt: tableData.updatedAt, status: "ACTIVE", lastSyncedAt: new Date() },
      });
      counts.tables[existingTable ? "updated" : "created"]++;
      const columnNames = tableData.columns.map((column) => column.name);
      const retiredColumns = await prisma.metaColumn.updateMany({ where: { metaTableId: table.id, name: { notIn: columnNames }, status: "ACTIVE" }, data: { status: "DEPRECATED" } });
      counts.columns.deprecated += retiredColumns.count;
      for (const [ordinal, column] of tableData.columns.entries()) {
        const existingColumn = await prisma.metaColumn.findUnique({ where: { metaTableId_name: { metaTableId: table.id, name: column.name } } });
        await prisma.metaColumn.upsert({
          where: { metaTableId_name: { metaTableId: table.id, name: column.name } },
          create: { metaTableId: table.id, name: column.name, dataType: column.dataType, comment: column.comment, ordinal, isPartition: column.isPartition },
          update: { dataType: column.dataType, comment: column.comment, ordinal, isPartition: column.isPartition, status: "ACTIVE" },
        });
        counts.columns[existingColumn ? "updated" : "created"]++;
      }
    }
    return { dataSourceId, project: project.name, counts };
  }

  async listTables(input: ListTablesInput = {}) {
    const q = input.q?.trim(); const project = input.project?.trim(); const type = input.type?.trim();
    const requestedPageSize = positiveInteger(input.pageSize, 20); const pageSize = Math.min(requestedPageSize, 100);
    const where: Prisma.MetaTableWhereInput = { status: "ACTIVE", metaProject: { status: "ACTIVE", ...(project ? { name: project } : {}) }, ...(type ? { type } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { comment: { contains: q, mode: "insensitive" } }] } : {}) };
    const activeWhere: Prisma.MetaTableWhereInput = { status: "ACTIVE", metaProject: { status: "ACTIVE" } };
    const [total, projects, types] = await Promise.all([
      prisma.metaTable.count({ where }),
      prisma.metaProject.findMany({ where: { status: "ACTIVE", tables: { some: { status: "ACTIVE" } } }, select: { name: true }, distinct: ["name"], orderBy: { name: "asc" } }),
      prisma.metaTable.findMany({ where: activeWhere, select: { type: true }, distinct: ["type"], orderBy: { type: "asc" } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(positiveInteger(input.page, 1), totalPages);
    const tables = await prisma.metaTable.findMany({ where, include: { metaProject: true, _count: { select: { columns: { where: { status: "ACTIVE" } } } } }, orderBy: [{ metaProject: { name: "asc" } }, { name: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
    return { items: tables.map((table) => ({ id: table.id, name: table.name, type: table.type, comment: table.comment, project: table.metaProject.name, columnCount: table._count.columns, updatedAt: table.sourceUpdatedAt ?? table.updatedAt, governanceStatus: "UNGOVERNED" })), total, page, pageSize, totalPages, filters: { projects: projects.map((item) => item.name), types: types.map((item) => item.type) } };
  }

  async getTable(id: string) {
    const table = await prisma.metaTable.findUnique({ where: { id }, include: { metaProject: true } });
    if (!table) throw new NotFoundException("Table not found");
    return { id: table.id, name: table.name, type: table.type, comment: table.comment, project: table.metaProject.name, updatedAt: table.sourceUpdatedAt ?? table.updatedAt, status: table.status };
  }

  async listColumns(id: string) {
    await this.getTable(id);
    return prisma.metaColumn.findMany({ where: { metaTableId: id, status: "ACTIVE" }, orderBy: { ordinal: "asc" }, select: { id: true, name: true, dataType: true, comment: true, ordinal: true, isPartition: true } });
  }
}
