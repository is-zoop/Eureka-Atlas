import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma, type SavedDataQuery as StoredQuery } from "@eureka-atlas/database";
import type { SavedDataQuery, SavedDataQueryConfig, SavedDataQueryDetail, SavedDataQueryList } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { requireMemberNo } from "../auth/member-no";
import { PackageService } from "../package/package.service";
import { QueryCompilerService } from "./query-compiler.service";

const serialize = (item: StoredQuery): SavedDataQuery => ({
  id: item.id, name: item.name, config: item.config as unknown as SavedDataQueryConfig,
  table_name: item.tableName, content_version: item.contentVersion,
  created_at: item.createdAt.toISOString(), updated_at: item.updatedAt.toISOString(),
});

@Injectable()
export class SavedDataQueryService {
  constructor(private readonly packages: PackageService, private readonly compiler: QueryCompilerService) {}

  private async owned(member: string, id: string) {
    requireMemberNo(member);
    const item = await prisma.savedDataQuery.findFirst({ where: { id, ownerMemberNo: member } });
    if (!item) throw new NotFoundException("保存的查询不存在或无法访问");
    return item;
  }

  private async prepare(body: { name: string; config: SavedDataQueryConfig }) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || Array.from(name).length > 60) throw new BadRequestException("查询名称需要 1～60 个字符");
    const input = body?.config;
    if (!input || typeof input !== "object" || typeof input.table_id !== "string" || !input.table_id) throw new BadRequestException("请选择数据集");
    // Whitelist every nested property; request metadata, tokens and extra fields are never stored.
    if (input.filters !== undefined && (!Array.isArray(input.filters) || input.filters.some(item => !item || typeof item !== "object"))) throw new BadRequestException("筛选条件无效");
    if (input.order_by !== undefined && (!Array.isArray(input.order_by) || input.order_by.some(item => !item || typeof item !== "object"))) throw new BadRequestException("排序无效");
    const config: SavedDataQueryConfig = {
      table_id: input.table_id, mode: input.mode, field_ids: input.field_ids,
      filters: (input.filters ?? []).map(item => "preset" in item
        ? { field_id: item.field_id, preset: item.preset, ...(item.days !== undefined ? { days: item.days } : {}), ...(item.start !== undefined ? { start: item.start } : {}), ...(item.end !== undefined ? { end: item.end } : {}), ...(item.logic !== undefined ? { logic: item.logic } : {}) }
        : { field_id: item.field_id, operator: item.operator, values: item.values ?? [], ...(item.logic !== undefined ? { logic: item.logic } : {}) }),
      order_by: (input.order_by ?? []).map(item => ({ field_id: item.field_id, direction: item.direction })),
    };
    const pkg = await this.packages.get(config.table_id);
    this.compiler.validateDataQuery(pkg, config);
    return { name, config: config as unknown as Prisma.InputJsonValue, tableName: pkg.table.business_name || pkg.table.name, contentVersion: pkg.content_version };
  }

  async create(member: string, body: { name: string; config: SavedDataQueryConfig }) {
    requireMemberNo(member);
    const data = await this.prepare(body);
    return serialize(await prisma.savedDataQuery.create({ data: { ...data, ownerMemberNo: member } }));
  }

  async update(member: string, id: string, body: { name: string; config: SavedDataQueryConfig }) {
    await this.owned(member, id);
    const data = await this.prepare(body);
    const result = await prisma.savedDataQuery.updateMany({ where: { id, ownerMemberNo: member }, data });
    if (!result.count) throw new NotFoundException("保存的查询不存在或无法访问");
    return serialize(await this.owned(member, id));
  }

  async list(member: string, keyword = "", page = 1, pageSize = 20): Promise<SavedDataQueryList> {
    requireMemberNo(member);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || typeof keyword !== "string" || keyword.length > 200 || !Number.isSafeInteger((page - 1) * pageSize)) throw new BadRequestException("列表分页或搜索参数无效");
    const where = { ownerMemberNo: member, ...(keyword.trim() ? { name: { contains: keyword.trim(), mode: Prisma.QueryMode.insensitive } } : {}) };
    const [total, items] = await prisma.$transaction([
      prisma.savedDataQuery.count({ where }),
      prisma.savedDataQuery.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: items.map(serialize), total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) };
  }

  async get(member: string, id: string): Promise<SavedDataQueryDetail> {
    const item = await this.owned(member, id);
    const result: SavedDataQueryDetail = { ...serialize(item), current_content_version: null, validation_errors: [] };
    try {
      const pkg = await this.packages.get(result.config.table_id);
      result.current_content_version = pkg.content_version;
      this.compiler.validateDataQuery(pkg, result.config);
    } catch (cause) {
      if (!(cause instanceof BadRequestException || cause instanceof NotFoundException)) throw cause;
      result.validation_errors = [cause.message];
    }
    return result;
  }

  async remove(member: string, id: string) {
    requireMemberNo(member);
    const result = await prisma.savedDataQuery.deleteMany({ where: { id, ownerMemberNo: member } });
    if (!result.count) throw new NotFoundException("保存的查询不存在或无法访问");
    return { success: true };
  }
}
