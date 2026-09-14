import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@eureka-atlas/database";
import { DEFAULT_AI_SYSTEM_PROMPT } from "../governance/ai-prompt";

const key = "ai_system_prompt";

@Injectable()
export class SystemSettingsService {
  async aiPrompt() {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>(Prisma.sql`SELECT "value" FROM "system_setting" WHERE "key" = ${key} LIMIT 1`);
    return { prompt: rows[0]?.value ?? DEFAULT_AI_SYSTEM_PROMPT, defaultPrompt: DEFAULT_AI_SYSTEM_PROMPT, customized: rows.length > 0 };
  }
  async saveAiPrompt(value: unknown) {
    const prompt = typeof value === "string" ? value.trim() : "";
    if (!prompt) throw new BadRequestException("System prompt cannot be empty");
    if (prompt.length > 30_000) throw new BadRequestException("System prompt must not exceed 30,000 characters");
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "system_setting" ("id", "key", "value", "createdAt", "updatedAt") VALUES (${crypto.randomUUID()}, ${key}, ${prompt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`);
    return this.aiPrompt();
  }
  async resetAiPrompt() {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "system_setting" WHERE "key" = ${key}`);
    return this.aiPrompt();
  }
}
