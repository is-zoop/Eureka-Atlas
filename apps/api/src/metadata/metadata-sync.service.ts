import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import {
  DataSourceSyncStatus,
  GovernanceTaskStatus,
  Prisma,
  prisma,
} from "@eureka-atlas/database";
import { DatasourceService } from "../datasource/datasource.service";
import { DataSourceAdapterFactory } from "./database-adapters";
import { DataSpace, displaySpace } from "./datasource-adapter";

type SyncCounts = {
  projects: { created: number; updated: number };
  tables: { created: number; updated: number; deprecated: number };
  columns: { created: number; updated: number; deprecated: number };
};
export type ListTablesInput = {
  q?: string;
  space?: string;
  sourceId?: string;
  type?: string;
  governanceStatus?: "COMPLETED" | "DRAFT" | "UNGOVERNED";
  page?: string | number;
  pageSize?: string | number;
};
export type SyncSpaceInput = { catalog?: unknown; schema?: unknown };
const spaceKey = (catalog: string, schema: string) => `${catalog}\u0000${schema}`;
const stringValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const positiveInteger = (
  value: string | number | undefined,
  fallback: number,
) => {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

@Injectable()
export class MetadataSyncService implements OnModuleInit {
  private readonly logger = new Logger(MetadataSyncService.name);
  private readonly activeSyncs = new Set<string>();
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly adapters: DataSourceAdapterFactory,
  ) {}

  async onModuleInit() {
    await prisma.dataSource.updateMany({
      where: { syncStatus: DataSourceSyncStatus.RUNNING },
      data: {
        syncStatus: DataSourceSyncStatus.FAILED,
        syncFinishedAt: new Date(),
        syncError: "同步在服务重启前未完成，请重新同步。",
      },
    });
    await prisma.dataSourceSyncSpace.updateMany({
      where: { syncStatus: DataSourceSyncStatus.RUNNING },
      data: {
        syncStatus: DataSourceSyncStatus.FAILED,
        syncFinishedAt: new Date(),
        syncError: "同步在服务重启前未完成，请重新同步。",
      },
    });
  }

  async startSync(dataSourceId: string, requestedSpaces: SyncSpaceInput[]) {
    const source =
      await this.datasourceService.getWithCredentials(dataSourceId);
    if (source.syncStatus === DataSourceSyncStatus.RUNNING)
      return { status: "RUNNING" as const };
    if (this.activeSyncs.has(dataSourceId))
      return { status: "RUNNING" as const };
    if (!requestedSpaces.length)
      throw new NotFoundException("请至少选择一个数据空间");
    const client = this.adapters.create(source);
    const discovered = await client.listNamespaces();
    const discoveredByKey = new Map(
      discovered.map((space) => [spaceKey(space.catalog, space.schema), space]),
    );
    const spaces = requestedSpaces.map((input) => {
      const catalog = stringValue(input.catalog);
      const schema = stringValue(input.schema);
      const space = discoveredByKey.get(spaceKey(catalog, schema));
      if (!space) throw new NotFoundException("选择的数据空间已不存在或无访问权限");
      return space;
    });
    await prisma.$transaction([
      prisma.dataSourceSyncSpace.updateMany({
        where: { dataSourceId },
        data: { selected: false },
      }),
      ...spaces.map((space) =>
        prisma.dataSourceSyncSpace.upsert({
          where: {
            dataSourceId_catalog_schema: {
              dataSourceId,
              catalog: space.catalog,
              schema: space.schema,
            },
          },
          create: {
            dataSourceId,
            catalog: space.catalog,
            schema: space.schema,
            name: space.name,
            description: space.description ?? null,
            selected: true,
            syncStatus: DataSourceSyncStatus.RUNNING,
            syncStartedAt: new Date(),
          },
          update: {
            name: space.name,
            description: space.description ?? null,
            selected: true,
            syncStatus: DataSourceSyncStatus.RUNNING,
            syncTotalTables: 0,
            syncProcessedTables: 0,
            syncSyncedTables: 0,
            syncSkippedTables: 0,
            syncFailedTables: 0,
            syncError: null,
            syncStartedAt: new Date(),
            syncFinishedAt: null,
          },
        }),
      ),
    ]);
    await prisma.dataSource.update({
      where: { id: dataSourceId },
      data: {
        syncStatus: DataSourceSyncStatus.RUNNING,
        syncTotalTables: 0,
        syncProcessedTables: 0,
        syncSyncedTables: 0,
        syncSkippedTables: 0,
        syncFailedTables: 0,
        syncError: null,
        syncStartedAt: new Date(),
        syncFinishedAt: null,
      },
    });
    this.activeSyncs.add(dataSourceId);
    void this.sync(dataSourceId, spaces)
      .catch((error) =>
        this.logger.error(
          `Metadata synchronization failed for data source ${dataSourceId}`,
          error instanceof Error ? error.stack : undefined,
        ),
      )
      .finally(() => this.activeSyncs.delete(dataSourceId));
    return { status: "STARTED" as const };
  }

  async sync(dataSourceId: string, spaces: DataSpace[]) {
    await prisma.dataSource.update({
      where: { id: dataSourceId },
      data: {
        syncStatus: "RUNNING",
        syncTotalTables: 0,
        syncProcessedTables: 0,
        syncSyncedTables: 0,
        syncSkippedTables: 0,
        syncFailedTables: 0,
        syncError: null,
        syncStartedAt: new Date(),
        syncFinishedAt: null,
      },
    });
    const source =
      await this.datasourceService.getWithCredentials(dataSourceId);
    const client = this.adapters.create(source);
    const counts: SyncCounts = {
      projects: { created: 0, updated: 0 },
      tables: { created: 0, updated: 0, deprecated: 0 },
      columns: { created: 0, updated: 0, deprecated: 0 },
    };
    const failedTables: Array<{ name: string; message: string }> = [];
    let total = 0;
    let processed = 0;
    let synced = 0;
    let skipped = 0;
    try {
      const tableGroups: Array<{
        space: DataSpace;
        tables: Array<{ name: string; updatedAt?: Date }>;
      }> = [];
      for (const space of spaces) {
        try {
          const tables = await client.listTables(space);
          tableGroups.push({ space, tables });
          await prisma.dataSourceSyncSpace.update({
            where: {
              dataSourceId_catalog_schema: {
                dataSourceId,
                catalog: space.catalog,
                schema: space.schema,
              },
            },
            data: { syncStatus: "RUNNING", syncTotalTables: tables.length },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "无法读取表清单";
          failedTables.push({ name: space.name, message });
          await prisma.dataSourceSyncSpace.update({
            where: {
              dataSourceId_catalog_schema: {
                dataSourceId,
                catalog: space.catalog,
                schema: space.schema,
              },
            },
            data: {
              syncStatus: "FAILED",
              syncFailedTables: 1,
              syncError: message,
              syncFinishedAt: new Date(),
            },
          });
        }
      }
      total = tableGroups.reduce((sum, group) => sum + group.tables.length, 0);
      await this.updateProgress(
        dataSourceId,
        total,
        processed,
        synced,
        skipped,
        failedTables.length,
      );
      for (const { space, tables: remoteTables } of tableGroups) {
        let spaceProcessed = 0;
        let spaceSynced = 0;
        let spaceSkipped = 0;
        const failedBeforeSpace = failedTables.length;
        const projectName = displaySpace(space.catalog, space.schema);
        const existingProject = await prisma.metaProject.findUnique({
          where: { dataSourceId_name: { dataSourceId, name: projectName } },
        });
        const project = await prisma.metaProject.upsert({
          where: { dataSourceId_name: { dataSourceId, name: projectName } },
          create: {
            dataSourceId,
            name: projectName,
            catalog: space.catalog,
            schema: space.schema,
            description: space.description,
            region: source.region,
            lastSyncedAt: new Date(),
          },
          update: {
            catalog: space.catalog,
            schema: space.schema,
            description: space.description,
            region: source.region,
            status: "ACTIVE",
            lastSyncedAt: new Date(),
          },
        });
        counts.projects[existingProject ? "updated" : "created"]++;
        const names = remoteTables.map((table) => table.name);
        const retiredTables = await prisma.metaTable.updateMany({
          where: {
            metaProjectId: project.id,
            name: { notIn: names },
            status: "ACTIVE",
          },
          data: { status: "DEPRECATED" },
        });
        counts.tables.deprecated += retiredTables.count;
        const existingTables = await prisma.metaTable.findMany({
          where: { metaProjectId: project.id },
          select: { id: true, name: true, sourceUpdatedAt: true },
        });
        const existingByName = new Map(
          existingTables.map((table) => [table.name, table]),
        );
        // Fetching table schemas one by one is unnecessarily slow for a project
        // with many tables and can exceed the web request timeout. Keep the
        // concurrency deliberately small so MaxCompute is not flooded.
        for (let offset = 0; offset < remoteTables.length; offset += 5) {
          await Promise.all(
            remoteTables.slice(offset, offset + 5).map(async (item) => {
              try {
                const known = existingByName.get(item.name);
                if (
                  item.updatedAt &&
                  known?.sourceUpdatedAt?.getTime() === item.updatedAt.getTime()
                ) {
                  skipped++;
                  spaceSkipped++;
                  return;
                }
                const tableData = await client.getTableMetadata(
                  space,
                  item.name,
                );
                const existingTable = existingByName.get(tableData.name);
                const table = await prisma.metaTable.upsert({
                  where: {
                    metaProjectId_name: {
                      metaProjectId: project.id,
                      name: tableData.name,
                    },
                  },
                  create: {
                    metaProjectId: project.id,
                    name: tableData.name,
                    type: tableData.type,
                    comment: tableData.comment,
                    sourceUpdatedAt: tableData.updatedAt ?? item.updatedAt,
                    lastSyncedAt: new Date(),
                  },
                  update: {
                    type: tableData.type,
                    comment: tableData.comment,
                    sourceUpdatedAt: tableData.updatedAt ?? item.updatedAt,
                    status: "ACTIVE",
                    lastSyncedAt: new Date(),
                  },
                });
                counts.tables[existingTable ? "updated" : "created"]++;
                const columnNames = tableData.columns.map(
                  (column) => column.name,
                );
                const existingColumns = await prisma.metaColumn.findMany({
                  where: { metaTableId: table.id },
                  select: { name: true },
                });
                const existingColumnNames = new Set(
                  existingColumns.map((column) => column.name),
                );
                const columnOperations = tableData.columns.map(
                  (column, ordinal) =>
                    prisma.metaColumn.upsert({
                      where: {
                        metaTableId_name: {
                          metaTableId: table.id,
                          name: column.name,
                        },
                      },
                      create: {
                        metaTableId: table.id,
                        name: column.name,
                        dataType: column.dataType,
                        normalizedType: column.normalizedType,
                        comment: column.comment,
                        ordinal,
                        isNullable: column.isNullable,
                        defaultValue: column.defaultValue,
                        isPrimaryKey: column.isPrimaryKey ?? false,
                        isPartition: column.isPartition,
                        length: column.length,
                        precision: column.precision,
                        scale: column.scale,
                      },
                      update: {
                        dataType: column.dataType,
                        normalizedType: column.normalizedType,
                        comment: column.comment,
                        ordinal,
                        isNullable: column.isNullable,
                        defaultValue: column.defaultValue,
                        isPrimaryKey: column.isPrimaryKey ?? false,
                        isPartition: column.isPartition,
                        length: column.length,
                        precision: column.precision,
                        scale: column.scale,
                        status: "ACTIVE",
                      },
                    }),
                );
                const [retiredColumns] = await prisma.$transaction([
                  prisma.metaColumn.updateMany({
                    where: {
                      metaTableId: table.id,
                      name: { notIn: columnNames },
                      status: "ACTIVE",
                    },
                    data: { status: "DEPRECATED" },
                  }),
                  ...columnOperations,
                ]);
                counts.columns.deprecated += retiredColumns.count;
                for (const column of tableData.columns) {
                  counts.columns[
                    existingColumnNames.has(column.name) ? "updated" : "created"
                  ]++;
                }
                synced++;
                spaceSynced++;
              } catch (error) {
                failedTables.push({
                  name: item.name,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Unable to synchronize table metadata",
                });
              }
            }),
          );
          processed += Math.min(5, remoteTables.length - offset);
          spaceProcessed += Math.min(5, remoteTables.length - offset);
          await this.updateProgress(
            dataSourceId,
            total,
            processed,
            synced,
            skipped,
            failedTables.length,
          );
          await prisma.dataSourceSyncSpace.update({
            where: {
              dataSourceId_catalog_schema: {
                dataSourceId,
                catalog: space.catalog,
                schema: space.schema,
              },
            },
            data: {
              syncProcessedTables: spaceProcessed,
              syncSyncedTables: spaceSynced,
              syncSkippedTables: spaceSkipped,
              syncFailedTables: failedTables.length - failedBeforeSpace,
            },
          });
        }
        const spaceFailed = failedTables.length - failedBeforeSpace;
        await prisma.dataSourceSyncSpace.update({
          where: {
            dataSourceId_catalog_schema: {
              dataSourceId,
              catalog: space.catalog,
              schema: space.schema,
            },
          },
          data: {
            syncStatus:
              spaceFailed === 0
                ? "SUCCEEDED"
                : spaceSynced || spaceSkipped
                  ? "PARTIAL_FAILED"
                  : "FAILED",
            syncProcessedTables: spaceProcessed,
            syncSyncedTables: spaceSynced,
            syncSkippedTables: spaceSkipped,
            syncFailedTables: spaceFailed,
            syncError: spaceFailed
              ? failedTables
                  .slice(failedBeforeSpace, failedBeforeSpace + 3)
                  .map((item) => `${item.name}: ${item.message}`)
                  .join("；")
              : null,
            syncFinishedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        });
      }
      await this.datasourceService.markSynced(dataSourceId);
      const syncStatus =
        failedTables.length === 0
          ? "SUCCEEDED"
          : synced || skipped
            ? "PARTIAL_FAILED"
            : "FAILED";
      await prisma.dataSource.update({
        where: { id: dataSourceId },
        data: {
          syncStatus,
          syncProcessedTables: processed,
          syncSyncedTables: synced,
          syncSkippedTables: skipped,
          syncFailedTables: failedTables.length,
          syncFinishedAt: new Date(),
          syncError: failedTables.length
            ? failedTables
                .slice(0, 3)
                .map((item) => `${item.name}: ${item.message}`)
                .join("；")
            : null,
        },
      });
      return { dataSourceId, counts, failedTables };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Metadata synchronization failed";
      await prisma.dataSourceSyncSpace.updateMany({
        where: { dataSourceId, syncStatus: "RUNNING" },
        data: {
          syncStatus: "FAILED",
          syncFinishedAt: new Date(),
          syncError: message,
        },
      });
      await prisma.dataSource.update({
        where: { id: dataSourceId },
        data: {
          syncStatus: "FAILED",
          syncFinishedAt: new Date(),
          syncError: message,
        },
      });
      throw error;
    }
  }

  private updateProgress(
    dataSourceId: string,
    total: number,
    processed: number,
    synced: number,
    skipped: number,
    failed: number,
  ) {
    return prisma.dataSource.update({
      where: { id: dataSourceId },
      data: {
        syncTotalTables: total,
        syncProcessedTables: processed,
        syncSyncedTables: synced,
        syncSkippedTables: skipped,
        syncFailedTables: failed,
      },
    });
  }

  async listTables(input: ListTablesInput = {}) {
    const q = input.q?.trim();
    const space = input.space?.trim();
    const sourceId = input.sourceId?.trim();
    const type = input.type?.trim();
    const governanceStatus = input.governanceStatus;
    const requestedPageSize = positiveInteger(input.pageSize, 20);
    const pageSize = Math.min(requestedPageSize, 100);
    const where: Prisma.MetaTableWhereInput = {
      status: "ACTIVE",
      metaProject: {
        status: "ACTIVE",
        ...(space ? { name: space } : {}),
        ...(sourceId ? { dataSourceId: sourceId } : {}),
      },
      ...(type ? { type } : {}),
      ...(governanceStatus === "COMPLETED"
        ? { semantic: { isNot: null } }
        : governanceStatus === "DRAFT"
          ? {
              semantic: { is: null },
              governanceTasks: {
                some: { status: { not: GovernanceTaskStatus.COMPLETED } },
              },
            }
          : governanceStatus === "UNGOVERNED"
            ? {
                semantic: { is: null },
                governanceTasks: {
                  none: { status: { not: GovernanceTaskStatus.COMPLETED } },
                },
              }
            : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { comment: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const activeWhere: Prisma.MetaTableWhereInput = {
      status: "ACTIVE",
      metaProject: { status: "ACTIVE" },
    };
    const [total, projects, types] = await Promise.all([
      prisma.metaTable.count({ where }),
      prisma.metaProject.findMany({
        where: { status: "ACTIVE", tables: { some: { status: "ACTIVE" } } },
        select: { name: true },
        distinct: ["name"],
        orderBy: { name: "asc" },
      }),
      prisma.metaTable.findMany({
        where: activeWhere,
        select: { type: true },
        distinct: ["type"],
        orderBy: { type: "asc" },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(positiveInteger(input.page, 1), totalPages);
    const tables = await prisma.metaTable.findMany({
      where,
      include: {
        metaProject: true,
        semantic: { select: { id: true, publishedByName: true } },
        semanticPackage: { select: { id: true } },
        governanceTasks: {
          where: { status: { not: GovernanceTaskStatus.COMPLETED } },
          select: { id: true },
          take: 1,
        },
        _count: { select: { columns: { where: { status: "ACTIVE" } } } },
      },
      orderBy: [{ metaProject: { name: "asc" } }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const sources = await prisma.dataSource.findMany({
      where: {
        projects: {
          some: { status: "ACTIVE", tables: { some: { status: "ACTIVE" } } },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return {
      items: tables.map((table) => ({
        id: table.id,
        name: table.name,
        type: table.type,
        comment: table.comment,
        space: table.metaProject.name,
        source: table.metaProject.dataSourceId,
        columnCount: table._count.columns,
        updatedAt: table.sourceUpdatedAt ?? table.updatedAt,
        lastUpdatedBy: table.semantic?.publishedByName ?? null,
        governanceStatus: table.semantic
          ? "COMPLETED"
          : table.governanceTasks.length
            ? "DRAFT"
            : "UNGOVERNED",
        hasPackage: Boolean(table.semanticPackage),
      })),
      total,
      page,
      pageSize,
      totalPages,
      filters: {
        spaces: projects.map((item) => item.name),
        sources,
        types: types.map((item) => item.type),
      },
    };
  }

  async getTable(id: string) {
    const table = await prisma.metaTable.findUnique({
      where: { id },
      include: {
        metaProject: true,
        semantic: { select: { id: true, publishedByName: true } },
        semanticPackage: { select: { id: true } },
        governanceTasks: {
          where: { status: { not: GovernanceTaskStatus.COMPLETED } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!table) throw new NotFoundException("Table not found");
    return {
      id: table.id,
      name: table.name,
      type: table.type,
      comment: table.comment,
      space: table.metaProject.name,
      catalog: table.metaProject.catalog,
      schema: table.metaProject.schema,
      updatedAt: table.sourceUpdatedAt ?? table.updatedAt,
      lastUpdatedBy: table.semantic?.publishedByName ?? null,
      status: table.status,
      governanceStatus: table.semantic
        ? "COMPLETED"
        : table.governanceTasks.length
          ? "DRAFT"
          : "UNGOVERNED",
      hasPackage: Boolean(table.semanticPackage),
    };
  }

  async listColumns(id: string) {
    await this.getTable(id);
    return prisma.metaColumn.findMany({
      where: { metaTableId: id, status: "ACTIVE" },
      orderBy: { ordinal: "asc" },
      select: {
        id: true,
        name: true,
        dataType: true,
        normalizedType: true,
        comment: true,
        ordinal: true,
        isNullable: true,
        defaultValue: true,
        isPrimaryKey: true,
        isPartition: true,
        length: true,
        precision: true,
        scale: true,
      },
    });
  }
}
