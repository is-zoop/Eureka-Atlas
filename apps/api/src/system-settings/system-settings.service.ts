import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma } from "@eureka-atlas/database";
import { DEFAULT_AI_SYSTEM_PROMPT } from "../governance/ai-prompt";

const aiPromptKey = "ai_system_prompt";
export const DEFAULT_GOVERNANCE_OPTIONS = {
  dataDomains: ["商品企划", "设计研发", "采购管理", "销售管理", "商品运营", "仓库管理", "客服管理", "财务管理", "人资管理", "运维管理"],
  permissionRelations: ["品牌项目名", "财务店铺名称", "ERP店铺名称", "平台店铺名称"],
};

type GovernanceOptions = typeof DEFAULT_GOVERNANCE_OPTIONS;
type GovernanceOptionRecord = { id: string; value: string; description: string; createdAt: Date; updatedAt: Date; updatedBy: string };
type GovernanceOptionGroups = { dataDomains: GovernanceOptionRecord[]; permissionRelations: GovernanceOptionRecord[] };
type GovernanceOptionType = "DATA_DOMAIN" | "PERMISSION_RELATION";
@Injectable()
export class SystemSettingsService {
  async aiPrompt() {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT "value" FROM "system_setting" WHERE "key" = ${aiPromptKey} LIMIT 1`);
    return { prompt: rows[0]?.value ?? DEFAULT_AI_SYSTEM_PROMPT, defaultPrompt: DEFAULT_AI_SYSTEM_PROMPT, customized: rows.length > 0 };
  }
  async saveAiPrompt(value: unknown) {
    const prompt = typeof value === "string" ? value.trim() : "";
    if (!prompt) throw new BadRequestException("System prompt cannot be empty");
    if (prompt.length > 30_000) throw new BadRequestException("System prompt must not exceed 30,000 characters");
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "system_setting" ("id", "key", "value", "createdAt", "updatedAt") VALUES (${crypto.randomUUID()}, ${aiPromptKey}, ${prompt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`);
    return this.aiPrompt();
  }
  async resetAiPrompt() {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "system_setting" WHERE "key" = ${aiPromptKey}`);
    return this.aiPrompt();
  }
  async governanceOptions(): Promise<GovernanceOptions> {
    const records = await this.governanceOptionRecords();
    return {
      dataDomains: records.dataDomains.map((item) => item.value),
      permissionRelations: records.permissionRelations.map((item) => item.value),
    };
  }
  async governanceOptionRecords(): Promise<GovernanceOptionGroups> {
    const rows = await prisma.$queryRaw<Array<GovernanceOptionRecord & { type: GovernanceOptionType }>>(Prisma.sql`SELECT "id", "type", "value", "description", "createdAt", "updatedAt", "updatedBy" FROM "governance_option" ORDER BY "type", "createdAt"`);
    return {
      dataDomains: rows.filter((item) => item.type === "DATA_DOMAIN"),
      permissionRelations: rows.filter((item) => item.type === "PERMISSION_RELATION"),
    };
  }
  async createGovernanceOption(input: unknown) {
    const { type, value, description } = this.readOptionInput(input, true);
    await this.ensureUnique(type, value);
    const id = crypto.randomUUID();
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "governance_option" ("id", "type", "value", "description", "updatedBy", "createdAt", "updatedAt") VALUES (${id}, ${type}::"GovernanceOptionType", ${value}, ${description}, 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
    return this.option(id);
  }
  async updateGovernanceOption(id: string, input: unknown) {
    const { value, description } = this.readOptionInput(input, false);
    const current = await this.option(id);
    await this.ensureUnique(current.type, value, id);
    await prisma.$executeRaw(Prisma.sql`UPDATE "governance_option" SET "value" = ${value}, "description" = ${description}, "updatedBy" = 'admin', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}`);
    return this.option(id);
  }
  async deleteGovernanceOption(id: string) {
    const deleted = await prisma.$executeRaw(Prisma.sql`DELETE FROM "governance_option" WHERE "id" = ${id}`);
    if (!deleted) throw new NotFoundException("Governance option not found");
    return { id };
  }
  private readOptionInput(input: unknown, includeType: boolean) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) throw new BadRequestException("字段不能为空");
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const type: GovernanceOptionType | undefined = body.type === "DATA_DOMAIN" || body.type === "PERMISSION_RELATION" ? body.type : undefined;
    if (includeType && !type) throw new BadRequestException("配置类型无效");
    return { type: type as GovernanceOptionType, value, description };
  }
  private async option(id: string) {
    const rows = await prisma.$queryRaw<GovernanceOptionRecord[]>(Prisma.sql`SELECT "id", "value", "description", "createdAt", "updatedAt", "updatedBy", "type" FROM "governance_option" WHERE "id" = ${id} LIMIT 1`);
    if (!rows[0]) throw new NotFoundException("Governance option not found");
    return rows[0] as GovernanceOptionRecord & { type: GovernanceOptionType };
  }
  private async ensureUnique(type: GovernanceOptionType, value: string, exceptId?: string) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "governance_option" WHERE "type" = ${type}::"GovernanceOptionType" AND "value" = ${value} ${exceptId ? Prisma.sql`AND "id" <> ${exceptId}` : Prisma.empty} LIMIT 1`);
    if (rows.length) throw new BadRequestException("同一配置类型下字段不能重复");
  }
}
