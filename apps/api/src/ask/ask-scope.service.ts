import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { SemanticPackage } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { PackageService } from "../package/package.service";
import { SelectableSemanticTablesService } from "../semantic/selectable-semantic-tables.service";

export type AskScope = { tableIds: string[]; packages: Map<string, SemanticPackage> };

@Injectable()
export class AskScopeService {
  constructor(private readonly selectable: SelectableSemanticTablesService, private readonly packages: PackageService) {}

  async resolve(requested: unknown): Promise<AskScope> {
    const selectedIds = [...new Set(Array.isArray(requested) ? requested.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [])];
    const available = new Set((await this.selectable.list()).items.map((item) => item.id));
    const ids = selectedIds.length ? selectedIds : [...available];
    if (!ids.length) throw new BadRequestException("暂无可查询表，请先完成数据表治理并发布语义");
    const invalid = ids.filter((id) => !available.has(id));
    if (invalid.length) throw new BadRequestException(`已选择表不可查询或已失效：${invalid.join(", ")}`);
    const entries = await Promise.all(ids.map(async (id) => [id, await this.packages.get(id)] as const));
    return { tableIds: ids, packages: new Map(entries) };
  }

  async package(scope: AskScope, tableId: string) {
    if (!scope.tableIds.includes(tableId)) throw new NotFoundException("该表不在本次问数选择范围内");
    return this.packages.get(tableId);
  }
}
