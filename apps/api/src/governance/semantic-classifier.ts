import { ColumnSemanticType } from "@eureka-atlas/database";

const numeric =
  /^(tinyint|smallint|int|integer|bigint|float|double|real|decimal|numeric)(\b|\()/i;
const tag = /(label|tag|标签)/i;

export type ClassifiableColumn = {
  name: string;
  dataType: string;
  comment?: string | null;
  isPartition?: boolean;
};

export function classifySemanticType(
  column: ClassifiableColumn,
): ColumnSemanticType {
  if (column.isPartition) return ColumnSemanticType.PARTITION;
  if (numeric.test((column.dataType ?? "").trim()))
    return ColumnSemanticType.METRIC;
  if (tag.test(`${column.name} ${column.comment ?? ""}`))
    return ColumnSemanticType.LABEL;
  return ColumnSemanticType.DIMENSION;
}

export function normalizeSemanticType(
  value: unknown,
  fallback: ColumnSemanticType = ColumnSemanticType.DIMENSION,
): ColumnSemanticType {
  if (value === "ATTRIBUTE") return ColumnSemanticType.LABEL;
  return Object.values(ColumnSemanticType).includes(value as ColumnSemanticType)
    ? (value as ColumnSemanticType)
    : fallback;
}
