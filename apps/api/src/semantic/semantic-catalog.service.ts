import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ColumnSemanticType, Prisma, prisma, SemanticCatalogStatus, SemanticMetricCatalogType } from "@eureka-atlas/database";

type Tx = Prisma.TransactionClient;
type CatalogPatch = { description?: unknown; aliases?: unknown; dataSource?: unknown; category?: unknown; owner?: unknown; usageNotes?: unknown };
const nameKey = (value: string) => value.trim().toLowerCase();
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
const optional = (value: unknown) => string(value) || null;
const aliases = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(string).filter(Boolean))] : [];
const pageValue = (value: unknown, fallback: number, max = 100) => Math.min(max, Math.max(1, Number.parseInt(String(value ?? fallback), 10) || fallback));

@Injectable()
export class SemanticCatalogService {
  async syncForTable(tx: Tx, tableId: string) {
    const [atomic, derived, dimensions] = await Promise.all([
      tx.columnSemantic.findMany({ where: { semanticType: ColumnSemanticType.METRIC, metaColumn: { metaTableId: tableId } }, include: { metaColumn: true } }),
      tx.semanticMetric.findMany({ where: { metaTableId: tableId } }),
      tx.columnSemantic.findMany({ where: { semanticType: ColumnSemanticType.DIMENSION, metaColumn: { metaTableId: tableId } }, include: { metaColumn: true } }),
    ]);
    const oldMetricBindings = await tx.semanticMetricBinding.findMany({ where: { OR: [{ columnSemantic: { metaColumn: { metaTableId: tableId } } }, { semanticMetric: { metaTableId: tableId } }] }, select: { metricCatalogId: true } });
    const oldDimensionBindings = await tx.semanticDimensionBinding.findMany({ where: { columnSemantic: { metaColumn: { metaTableId: tableId } } }, select: { dimensionCatalogId: true } });
    await tx.semanticMetricBinding.deleteMany({ where: { OR: [{ columnSemantic: { metaColumn: { metaTableId: tableId } } }, { semanticMetric: { metaTableId: tableId } }] } });
    await tx.semanticDimensionBinding.deleteMany({ where: { columnSemantic: { metaColumn: { metaTableId: tableId } } } });
    const metricIds = new Set(oldMetricBindings.map((item) => item.metricCatalogId));
    const dimensionIds = new Set(oldDimensionBindings.map((item) => item.dimensionCatalogId));
    for (const source of atomic) {
      const catalog = await this.metricCatalog(tx, source.metricName, source.metaColumn.comment ?? "");
      metricIds.add(catalog.id);
      await tx.semanticMetricBinding.create({ data: { metricCatalogId: catalog.id, columnSemanticId: source.id } });
    }
    for (const source of derived) {
      const catalog = await this.metricCatalog(tx, source.name, "");
      metricIds.add(catalog.id);
      await tx.semanticMetricBinding.create({ data: { metricCatalogId: catalog.id, semanticMetricId: source.id } });
    }
    for (const source of dimensions) {
      const catalog = await this.dimensionCatalog(tx, source.metricName, source.metaColumn.comment ?? "");
      dimensionIds.add(catalog.id);
      await tx.semanticDimensionBinding.create({ data: { dimensionCatalogId: catalog.id, columnSemanticId: source.id } });
    }
    await Promise.all([...metricIds].map((id) => this.refreshMetric(tx, id)));
    await Promise.all([...dimensionIds].map((id) => this.refreshDimension(tx, id)));
  }

  async metrics(query: Record<string, unknown>): Promise<unknown> {
    const q = string(query.q); const type = string(query.type); const editStatus = string(query.editStatus); const dataSource = string(query.dataSource); const pageSize = pageValue(query.pageSize, 20); const page = pageValue(query.page, 1);
    const aliasIds = q ? await this.aliasMatches("metrics", q) : [];
    const where: Prisma.SemanticMetricCatalogWhereInput = { status: SemanticCatalogStatus.PUBLISHED, ...(type ? { type: type as SemanticMetricCatalogType } : {}), ...(dataSource ? { dataSource: { contains: dataSource, mode: "insensitive" } } : {}), ...(editStatus === "EDITED" ? { editedAt: { not: null } } : editStatus === "UNEDITED" ? { editedAt: null } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { id: { in: aliasIds } }] } : {}) };
    const [total, items, dataSources] = await Promise.all([
      prisma.semanticMetricCatalog.count({ where }),
      prisma.semanticMetricCatalog.findMany({ where, include: { _count: { select: { bindings: true } } }, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.semanticMetricCatalog.findMany({ where: { status: SemanticCatalogStatus.PUBLISHED, dataSource: { not: "" } }, distinct: ["dataSource"], select: { dataSource: true }, orderBy: { dataSource: "asc" } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const validPage = Math.min(page, totalPages);
    if (validPage !== page) return this.metrics({ ...query, page: validPage });
    return { items: items.map((item) => this.metricListItem(item)), total, page, pageSize, totalPages, filters: { types: Object.values(SemanticMetricCatalogType), dataSources: dataSources.map((item) => item.dataSource) } };
  }
  async dimensions(query: Record<string, unknown>): Promise<unknown> {
    const q = string(query.q); const editStatus = string(query.editStatus); const dataSource = string(query.dataSource); const pageSize = pageValue(query.pageSize, 20); const page = pageValue(query.page, 1);
    const aliasIds = q ? await this.aliasMatches("dimensions", q) : [];
    const where: Prisma.SemanticDimensionCatalogWhereInput = { status: SemanticCatalogStatus.PUBLISHED, ...(dataSource ? { dataSource: { contains: dataSource, mode: "insensitive" } } : {}), ...(editStatus === "EDITED" ? { editedAt: { not: null } } : editStatus === "UNEDITED" ? { editedAt: null } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { id: { in: aliasIds } }] } : {}) };
    const [total, items, dataSources] = await Promise.all([
      prisma.semanticDimensionCatalog.count({ where }),
      prisma.semanticDimensionCatalog.findMany({ where, include: { _count: { select: { bindings: true } } }, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.semanticDimensionCatalog.findMany({ where: { status: SemanticCatalogStatus.PUBLISHED, dataSource: { not: "" } }, distinct: ["dataSource"], select: { dataSource: true }, orderBy: { dataSource: "asc" } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const validPage = Math.min(page, totalPages);
    if (validPage !== page) return this.dimensions({ ...query, page: validPage });
    return { items: items.map((item) => ({ ...this.maintenance(item), dataSource: item.dataSource, editStatus: item.editedAt ? "EDITED" : "UNEDITED", sourceCount: item._count.bindings })), total, page, pageSize, totalPages, filters: { dataSources: dataSources.map((item) => item.dataSource) } };
  }
  async metric(id: string) {
    const item = await prisma.semanticMetricCatalog.findUnique({ where: { id }, include: { bindings: { include: { columnSemantic: { include: { metaColumn: { include: { metaTable: { include: { metaProject: true } } } } } }, semanticMetric: { include: { metaTable: { include: { metaProject: true } } } } } } } });
    if (!item) throw new NotFoundException("Metric catalog not found");
    return { ...this.maintenance(item), dataSource: item.dataSource, type: item.type, unit: item.unit, status: item.status, sources: item.bindings.map((binding) => binding.columnSemantic ? { kind: "ATOMIC", table: this.table(binding.columnSemantic.metaColumn.metaTable), field: binding.columnSemantic.metaColumn.name, fieldType: binding.columnSemantic.metaColumn.dataType, aggregation: binding.columnSemantic.aggregation, unit: binding.columnSemantic.unit, formula: null } : binding.semanticMetric ? { kind: "DERIVED", table: this.table(binding.semanticMetric.metaTable), field: null, fieldType: null, aggregation: null, unit: binding.semanticMetric.unit, formula: binding.semanticMetric.formula } : null).filter(Boolean) };
  }
  async dimension(id: string) {
    const item = await prisma.semanticDimensionCatalog.findUnique({
      where: { id },
      include: { bindings: { include: { columnSemantic: { include: { metaColumn: { include: { metaTable: { include: { metaProject: true } } } } } } } } },
    });
    if (!item) throw new NotFoundException("Dimension catalog not found");
    return { ...this.maintenance(item), dataSource: item.dataSource, editStatus: item.editedAt ? "EDITED" : "UNEDITED", status: item.status, sources: item.bindings.map((binding) => ({ table: this.table(binding.columnSemantic.metaColumn.metaTable), field: binding.columnSemantic.metaColumn.name, fieldType: binding.columnSemantic.metaColumn.dataType, comment: binding.columnSemantic.metaColumn.comment })) };
  }
  async updateMetric(id: string, input: CatalogPatch) { await this.metric(id); return this.metricUpdate(prisma.semanticMetricCatalog, id, input); }
  async updateDimension(id: string, input: CatalogPatch) { await this.dimension(id); return this.dimensionUpdate(id, input); }

  private async aliasMatches(kind: "metrics" | "dimensions", query: string) {
    const table = kind === "metrics" ? Prisma.sql`semantic_metric_catalog` : Prisma.sql`semantic_dimension_catalog`;
    // JSON array containment only matches whole aliases. Search each alias as
    // literal text so partial names work without treating %, _ or quotes as SQL.
    const matches = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM ${table}
      WHERE status = 'PUBLISHED' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(aliases) AS alias(value)
        WHERE strpos(lower(alias.value), lower(${query})) > 0
      )
    `);
    return matches.map(item => item.id);
  }

  private async metricCatalog(tx: Tx, name: string, description: string) { const normalizedName = nameKey(name); return tx.semanticMetricCatalog.upsert({ where: { normalizedName }, create: { normalizedName, name: name.trim(), description }, update: { name: name.trim(), status: SemanticCatalogStatus.PUBLISHED } }); }
  private async dimensionCatalog(tx: Tx, name: string, description: string) { const normalizedName = nameKey(name); return tx.semanticDimensionCatalog.upsert({ where: { normalizedName }, create: { normalizedName, name: name.trim(), description }, update: { name: name.trim(), status: SemanticCatalogStatus.PUBLISHED } }); }
  private async refreshMetric(tx: Tx, id: string) { const item = await tx.semanticMetricCatalog.findUnique({ where: { id }, include: { bindings: { include: { columnSemantic: true, semanticMetric: true } } } }); if (!item) return; const bindings = item.bindings; const atomic = bindings.some((item) => item.columnSemantic); const derived = bindings.some((item) => item.semanticMetric); const units = [...new Set(bindings.map((item) => item.columnSemantic?.unit ?? item.semanticMetric?.unit).filter((unit): unit is string => Boolean(unit)))]; await tx.semanticMetricCatalog.update({ where: { id }, data: { status: bindings.length ? SemanticCatalogStatus.PUBLISHED : SemanticCatalogStatus.ARCHIVED, type: atomic && derived ? SemanticMetricCatalogType.MIXED : derived ? SemanticMetricCatalogType.DERIVED : SemanticMetricCatalogType.ATOMIC, unit: units.length === 1 ? units[0] : units.length > 1 ? "多单位" : null } }); }
  private async refreshDimension(tx: Tx, id: string) { const count = await tx.semanticDimensionBinding.count({ where: { dimensionCatalogId: id } }); await tx.semanticDimensionCatalog.update({ where: { id }, data: { status: count ? SemanticCatalogStatus.PUBLISHED : SemanticCatalogStatus.ARCHIVED } }); }
  private maintenance(item: { id: string; name: string; description: string; aliases: Prisma.JsonValue; category: string | null; owner: string | null; usageNotes: string | null }) { return { id: item.id, name: item.name, description: item.description, aliases: aliases(item.aliases), category: item.category, owner: item.owner, usageNotes: item.usageNotes }; }
  private metricListItem(item: { id: string; name: string; description: string; type: SemanticMetricCatalogType; unit: string | null; aliases: Prisma.JsonValue; dataSource: string; editedAt: Date | null; category: string | null; owner: string | null; usageNotes: string | null; _count: { bindings: number } }) { return { ...this.maintenance(item), dataSource: item.dataSource, type: item.type, unit: item.unit, sourceCount: item._count.bindings, editStatus: item.editedAt ? "EDITED" : "UNEDITED" }; }
  private table(table: { id: string; name: string; metaProject: { name: string } }) { return { id: table.id, name: table.name, project: table.metaProject.name }; }
  private patch(input: CatalogPatch) { const allowed = ["description", "aliases", "dataSource", "category", "owner", "usageNotes"]; if (Object.keys(input).some((key) => !allowed.includes(key))) throw new BadRequestException("Only catalog maintenance fields can be updated"); return { ...(Object.hasOwn(input, "description") ? { description: string(input.description) } : {}), ...(Object.hasOwn(input, "aliases") ? { aliases: aliases(input.aliases) } : {}), ...(Object.hasOwn(input, "dataSource") ? { dataSource: string(input.dataSource) } : {}), ...(Object.hasOwn(input, "category") ? { category: optional(input.category) } : {}), ...(Object.hasOwn(input, "owner") ? { owner: optional(input.owner) } : {}), ...(Object.hasOwn(input, "usageNotes") ? { usageNotes: optional(input.usageNotes) } : {}) }; }
  private async metricUpdate(delegate: typeof prisma.semanticMetricCatalog, id: string, input: CatalogPatch) { await delegate.update({ where: { id }, data: { ...this.patch(input), editedAt: new Date() } }); return this.metric(id); }
  private async dimensionUpdate(id: string, input: CatalogPatch) { await prisma.semanticDimensionCatalog.update({ where: { id }, data: { ...this.patch(input), editedAt: new Date() } }); return this.dimension(id); }
}
