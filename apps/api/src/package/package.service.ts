import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AssetStatus, Prisma, prisma } from "@eureka-atlas/database";
import { buildSemanticPackage, type PackageBuildSource } from "./builder/semantic-package.builder";

type Tx = Prisma.TransactionClient;

@Injectable()
export class PackageService {
  async generate(tableId: string) {
    return prisma.$transaction((tx) => this.generateForTable(tx, tableId));
  }

  async generateForTable(tx: Tx, tableId: string) {
    const content = await this.getInTransaction(tx, tableId);
    await tx.semanticPackage.upsert({
      where: { metaTableId: tableId },
      create: { metaTableId: tableId, content: content as Prisma.InputJsonValue },
      update: { content: content as Prisma.InputJsonValue },
    });
    return content;
  }

  async get(tableId: string) {
    return prisma.$transaction((tx) => this.getInTransaction(tx, tableId), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async getInTransaction(tx: Tx, tableId: string) {
    const table = await tx.metaTable.findUnique({
      where: { id: tableId },
      include: {
        metaProject: { include: { dataSource: true } },
        semantic: true,
        columns: {
          where: { status: AssetStatus.ACTIVE },
          orderBy: { ordinal: "asc" },
          include: {
            semantic: {
              include: {
                metricCatalogBindings: { include: { metricCatalog: true } },
                dimensionCatalogBinding: { include: { dimensionCatalog: true } },
              },
            },
          },
        },
        semanticMetrics: {
          orderBy: { name: "asc" },
          include: { catalogBindings: { include: { metricCatalog: true } } },
        },
      },
    });
    if (!table) throw new NotFoundException("Table not found");
    if (table.status !== AssetStatus.ACTIVE || table.metaProject.status !== AssetStatus.ACTIVE)
      throw new NotFoundException("Active table not found");
    if (!table.semantic) throw new BadRequestException("Publish table semantic before reading a package");
    return buildSemanticPackage({ table } as unknown as PackageBuildSource);
  }
}
