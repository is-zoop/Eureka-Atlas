import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@eureka-atlas/database";
import { DEFAULT_AI_SYSTEM_PROMPT } from "../governance/ai-prompt";

const aiPromptKey = "ai_system_prompt";
const dataDomainsKey = "governance_data_domains";
const permissionRelationsKey = "governance_permission_relations";
export const DEFAULT_GOVERNANCE_OPTIONS = {
  dataDomains: ["商品企划", "设计研发", "采购管理", "销售管理", "商品运营", "仓库管理", "客服管理", "财务管理", "人资管理", "运维管理"],
  permissionRelations: ["品牌项目名", "财务店铺名称", "ERP店铺名称", "平台店铺名称"],
};

type GovernanceOptions = typeof DEFAULT_GOVERNANCE_OPTIONS;

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
    const rows = await prisma.$queryRaw<Array<{ key: string; value: string }>>(Prisma.sql`SELECT "key", "value" FROM "system_setting" WHERE "key" IN (${dataDomainsKey}, ${permissionRelationsKey})`);
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      dataDomains: this.readList(values.get(dataDomainsKey), DEFAULT_GOVERNANCE_OPTIONS.dataDomains),
      permissionRelations: this.readList(values.get(permissionRelationsKey), DEFAULT_GOVERNANCE_OPTIONS.permissionRelations),
    };
  }
  async saveGovernanceOptions(input: unknown): Promise<GovernanceOptions> {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const dataDomains = this.validateList(body.dataDomains, "dataDomains");
    const permissionRelations = this.validateList(body.permissionRelations, "permissionRelations");
    await prisma.$transaction([
      prisma.$executeRaw(Prisma.sql`INSERT INTO "system_setting" ("id", "key", "value", "createdAt", "updatedAt") VALUES (${crypto.randomUUID()}, ${dataDomainsKey}, ${JSON.stringify(dataDomains)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`),
      prisma.$executeRaw(Prisma.sql`INSERT INTO "system_setting" ("id", "key", "value", "createdAt", "updatedAt") VALUES (${crypto.randomUUID()}, ${permissionRelationsKey}, ${JSON.stringify(permissionRelations)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`),
    ]);
    return { dataDomains, permissionRelations };
  }
  private readList(value: string | undefined, fallback: string[]) {
    try {
      const parsed = JSON.parse(value ?? "") as unknown;
      return Array.isArray(parsed) && parsed.every((item) => typeof item === "string" && item.trim()) && new Set(parsed.map((item) => item.trim())).size === parsed.length
        ? parsed.map((item) => item.trim())
        : fallback;
    } catch { return fallback; }
  }
  private validateList(value: unknown, field: string) {
    if (!Array.isArray(value)) throw new BadRequestException(`${field} must be an array`);
    const items = value.map((item) => typeof item === "string" ? item.trim() : "");
    if (items.some((item) => !item)) throw new BadRequestException(`${field} cannot contain empty values`);
    if (new Set(items).size !== items.length) throw new BadRequestException(`${field} cannot contain duplicate values`);
    return items;
  }
}
