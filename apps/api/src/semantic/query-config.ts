import { BadRequestException } from "@nestjs/common";

export type QueryConfig = {
  default_stat_date: { field_id: string | null; format: string };
  storage: "DATE_INCREMENTAL" | "FULL_SNAPSHOT" | null;
};

type Field = { id: string; isPartition?: boolean };
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
const storageModes = new Set(["DATE_INCREMENTAL", "FULL_SNAPSHOT"]);

export const defaultQueryConfig = (): QueryConfig => ({
  default_stat_date: { field_id: null, format: "" },
  storage: null,
});

export function normalizeQueryConfig(value: unknown, fields: Field[], hasPartition = fields.some((field) => field.isPartition)): QueryConfig {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const date = raw.default_stat_date && typeof raw.default_stat_date === "object" && !Array.isArray(raw.default_stat_date) ? raw.default_stat_date as Record<string, unknown> : {};
  const fieldId = string(date.field_id) || null;
  if (fieldId && !fields.some((field) => field.id === fieldId)) throw new BadRequestException("Default statistic date must belong to this active table");
  const storage = string(raw.storage);
  if (storage && !storageModes.has(storage)) throw new BadRequestException("Invalid storage type");
  if (storage && !hasPartition) throw new BadRequestException("Storage type is only available for partitioned tables");
  return { default_stat_date: { field_id: fieldId, format: fieldId ? string(date.format) : "" }, storage: storage ? storage as QueryConfig["storage"] : null };
}
