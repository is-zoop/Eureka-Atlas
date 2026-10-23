import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { SemanticPackage, SemanticSearchRequest } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { PackageService } from "../package/package.service";
import { SelectableSemanticTablesService } from "./selectable-semantic-tables.service";
import { searchSemanticPackages } from "./semantic-asset-search";

export type SemanticScope = { tableIds: string[]; packages: Map<string, SemanticPackage> };

@Injectable()
export class SemanticScopeService {
  constructor(private readonly selectable: SelectableSemanticTablesService, private readonly packages: PackageService) {}

  async resolve(requested: unknown, includePackages = true): Promise<SemanticScope> {
    const selectedIds = [...new Set(Array.isArray(requested) ? requested.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [])];
    const available = new Set((await this.selectable.list()).items.map(item => item.id));
    const ids = selectedIds.length ? selectedIds : [...available];
    if (!ids.length) throw new BadRequestException("暂无可查询表，请先完成数据表治理并发布语义");
    const invalid = ids.filter(id => !available.has(id));
    if (invalid.length) throw new BadRequestException(`已选择表不可查询或已失效：${invalid.join(", ")}`);
    return includePackages ? this.loadPackages(ids) : { tableIds: ids, packages: new Map() };
  }

  /** Internal use after scope/eligibility has been resolved; Package.get still validates current publication. */
  async loadPackages(tableIds: string[]): Promise<SemanticScope> {
    const entries = await Promise.all(tableIds.map(async id => [id, await this.packages.get(id)] as const));
    return { tableIds, packages: new Map(entries) };
  }

  async queryablePackage(tableId: string, expectedVersion?: string) {
    const available = (await this.selectable.list()).items;
    if (!available.some(item => item.id === tableId)) throw new NotFoundException("该表未发布、不可查询或已失效。");
    const pkg = await this.packages.get(tableId);
    if (expectedVersion !== undefined && pkg.content_version !== expectedVersion) throw new ConflictException({ code: "SEMANTIC_VERSION_CHANGED", message: "正式语义已更新，请重新获取 Package 并确认口径。" });
    return pkg;
  }

  async package(scope: SemanticScope, tableId: string) {
    if (!scope.tableIds.includes(tableId)) throw new NotFoundException("该表不在本次问数选择范围内");
    return this.queryablePackage(tableId);
  }

  async search(input: SemanticSearchRequest, scope?: SemanticScope) {
    if (![...(input.keywords ?? []), ...(input.metrics ?? []), ...(input.dimensions ?? [])].some(value => value.trim())) throw new BadRequestException("请至少输入业务关键词、指标或维度。");
    if(scope) return searchSemanticPackages([...scope.packages.values()],input);
    const available = (await this.selectable.list()).items;
    const packages = await Promise.all(available.map(item => this.packages.get(item.id)));
    return searchSemanticPackages(packages, input);
  }
}
