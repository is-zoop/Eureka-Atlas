import { StandardDataType } from "@eureka-atlas/database";

export type DataSpace = { name: string; catalog: string; schema: string; description?: string };
export type RemoteColumn = {
  name: string;
  dataType: string;
  normalizedType: StandardDataType;
  comment?: string;
  isNullable?: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  isPartition: boolean;
  length?: number;
  precision?: number;
  scale?: number;
};
export type RemoteTable = { name: string; type: string; comment?: string; updatedAt?: Date; columns: RemoteColumn[] };
export type RemoteTableSummary = { name: string; updatedAt?: Date };
export type SourceAdapter = {
  testConnection(): Promise<void>;
  listNamespaces(): Promise<DataSpace[]>;
  listTables(space: DataSpace): Promise<RemoteTableSummary[]>;
  getTableMetadata(space: DataSpace, name: string): Promise<RemoteTable>;
};

export function normalizeType(type: string): StandardDataType {
  const value = type.trim().toUpperCase();
  if (value === "STRING") return StandardDataType.STRING;
  if (/BOOL/.test(value)) return StandardDataType.BOOLEAN;
  if (/JSON/.test(value)) return StandardDataType.JSON;
  if (/BLOB|BINARY|BYTEA|RAW|IMAGE/.test(value)) return StandardDataType.BINARY;
  if (/TIMESTAMP|DATETIME|DATE\s*TIME/.test(value)) return StandardDataType.DATETIME;
  if (/^DATE$/.test(value)) return StandardDataType.DATE;
  if (/DECIMAL|NUMERIC|NUMBER|MONEY|FLOAT|DOUBLE|REAL/.test(value)) return StandardDataType.DECIMAL;
  if (/INT|SERIAL|YEAR/.test(value)) return StandardDataType.INTEGER;
  if (/CHAR|TEXT|CLOB|VARCHAR|UUID|XML|ENUM|SET/.test(value)) return StandardDataType.STRING;
  return StandardDataType.UNKNOWN;
}

export const displaySpace = (catalog: string, schema: string) => [catalog, schema].filter(Boolean).join(" / ") || "默认空间";
