import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma } from "@eureka-atlas/database";
import { buildSemanticPackage, SemanticPackageContent } from "./builder/semantic-package.builder";

@Injectable()
export class PackageService {
  async generate(tableId: string) {
    return prisma.$transaction((tx) => this.generateForTable(tx, tableId));
  }

  async generateForTable(tx: Prisma.TransactionClient, tableId: string) {
    const table = await tx.metaTable.findUnique({ where: { id: tableId }, include: { semantic: { include: { permissionColumn: { select: { name: true } } } }, columns: { where: { semantic: { isNot: null } }, include: { semantic: true }, orderBy: { ordinal: "asc" } }, semanticMetrics: { orderBy: { name: "asc" } } } });
    if (!table) throw new NotFoundException("Table not found");
    if (!table.semantic) throw new BadRequestException("Publish table semantic before generating a package");
    if (!table.columns.length) throw new BadRequestException("Publish at least one column semantic before generating a package");
    const content = buildSemanticPackage(table);
    if (!content.fields.length) throw new BadRequestException("Publish at least one column semantic before generating a package");
    const saved = await tx.semanticPackage.upsert({ where: { metaTableId: tableId }, create: { metaTableId: tableId, content }, update: { content } });
    return { ...content, updatedAt: saved.updatedAt };
  }

  async get(tableId: string) {
    const table = await prisma.metaTable.findUnique({ where: { id: tableId }, select: { id: true } });
    if (!table) throw new NotFoundException("Table not found");
    const semanticPackage = await prisma.semanticPackage.findUnique({ where: { metaTableId: tableId } });
    if (!semanticPackage) throw new NotFoundException("Semantic package not found for this table");
    const content = semanticPackage.content as SemanticPackageContent;
    return { ...content, metrics: Array.isArray(content.metrics) ? content.metrics : [], updatedAt: semanticPackage.updatedAt };
  }
}
