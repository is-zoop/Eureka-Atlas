import { Injectable } from "@nestjs/common";
import { AssetStatus, Prisma, prisma } from "@eureka-atlas/database";
import type {
  SemanticSelectableTable,
  SemanticSelectableTableGroup,
  SemanticSelectableTablesResponse,
} from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { PackageService } from "../package/package.service";

const uncategorizedLabel = "未分类";
const compare = (left: string, right: string) => left.localeCompare(right, "zh-CN");
const sortDomain = (value: string | null) => value ?? "\uffff";

@Injectable()
export class SelectableSemanticTablesService {
  constructor(private readonly packages: PackageService) {}

  async list(): Promise<SemanticSelectableTablesResponse> {
    return prisma.$transaction(async (tx) => {
      const tables = await tx.metaTable.findMany({
        where: {
          status: AssetStatus.ACTIVE,
          metaProject: { status: AssetStatus.ACTIVE },
          semantic: { isNot: null },
          columns: {
            some: {
              status: AssetStatus.ACTIVE,
              semantic: { isNot: null },
            },
          },
        },
        select: { id: true },
      });

      const items = (await Promise.all(
        tables.map(async ({ id }) => {
          const semanticPackage = await this.packages.getInTransaction(tx, id);
          return {
            id: semanticPackage.table.id,
            business_name: semanticPackage.table.business_name,
            physical_name: semanticPackage.table.name,
            data_domain: semanticPackage.table.data_domain,
            source: {
              id: semanticPackage.source.id,
              name: semanticPackage.source.name,
              project: semanticPackage.source.project,
              catalog: semanticPackage.source.catalog,
              schema: semanticPackage.source.schema,
            },
            completeness: semanticPackage.completeness,
          } satisfies SemanticSelectableTable;
        }),
      )).sort((left, right) =>
        compare(sortDomain(left.data_domain), sortDomain(right.data_domain))
        || compare(left.business_name, right.business_name)
        || compare(left.physical_name, right.physical_name)
        || compare(left.id, right.id),
      );

      const groups = Array.from(
        items.reduce((all, table) => {
          const key = table.data_domain ?? "";
          const group = all.get(key) ?? { data_domain: table.data_domain, label: table.data_domain ?? uncategorizedLabel, tables: [] };
          group.tables.push(table);
          all.set(key, group);
          return all;
        }, new Map<string, SemanticSelectableTableGroup>()).values(),
      );

      return { items, groups };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
