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
  if (fieldId && !fields.some((field) => field.id === fieldId)) throw new BadRequestException("默认统计日期必须使用当前表已选择的有效字段");
  const storage = string(raw.storage);
  if (storage && !storageModes.has(storage)) throw new BadRequestException("存储方式无效，请选择日期增量、全量快照或不设置");
  if (storage && !hasPartition) throw new BadRequestException("只有物理分区表才能设置存储方式");
  return { default_stat_date: { field_id: fieldId, format: fieldId ? string(date.format) : "" }, storage: storage ? storage as QueryConfig["storage"] : null };
}
