import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSourceType } from "@eureka-atlas/database";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { MaxComputeClient } from "./maxcompute.client";
import {
  DataSpace,
  displaySpace,
  normalizeType,
  RemoteColumn,
  RemoteTable,
  RemoteTableSummary,
  SourceAdapter,
} from "./datasource-adapter";

type SourceConfig = Record<string, unknown>;
type Credential = {
  username?: string;
  password?: string;
  accessKey?: string;
  secretKey?: string;
};
type SourceConnection = {
  type: DataSourceType;
  connectionConfig: SourceConfig;
  credentials: Credential;
  endpoint?: string;
  defaultProject?: string;
  region?: string;
};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
};
const rows = (result: unknown): Record<string, unknown>[] =>
  Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
const optional = (value: unknown) =>
  value === null || value === undefined ? undefined : String(value);

abstract class RelationalAdapter implements SourceAdapter {
  protected readonly config: SourceConfig;
  protected readonly credentials: Credential;
  constructor(source: SourceConnection) {
    this.config = source.connectionConfig;
    this.credentials = source.credentials;
  }
  abstract listNamespaces(): Promise<DataSpace[]>;
  abstract testConnection(): Promise<void>;
  abstract listTables(space: DataSpace): Promise<RemoteTableSummary[]>;
  abstract getTableMetadata(
    space: DataSpace,
    name: string,
  ): Promise<RemoteTable>;
}

class MysqlAdapter extends RelationalAdapter {
  private readonly maria: boolean;
  constructor(source: SourceConnection, maria = false) {
    super(source);
    this.maria = maria;
  }
  private async pool(catalog?: string) {
    const mysql = await import("mysql2/promise");
    return mysql.createPool({
      host: text(this.config.host),
      port: number(this.config.port) ?? 3306,
      user: this.credentials.username,
      password: this.credentials.password,
      // Some MySQL-compatible services reject an empty database name during
      // the handshake. information_schema is available to authenticated users
      // and lets us discover the business databases before one is selected.
      database: catalog || "information_schema",
      connectionLimit: 2,
    });
  }
  async testConnection() {
    const pool = await this.pool();
    try {
      await pool.query("SELECT 1");
    } finally {
      await pool.end();
    }
  }
  async listNamespaces(): Promise<DataSpace[]> {
    const pool = await this.pool();
    try {
      const [result] = await pool.query(
        "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') ORDER BY schema_name",
      );
      return rows(result).map((row) => {
        const catalog = text(row.name);
        return { name: catalog, catalog, schema: "" };
      });
    } finally {
      await pool.end();
    }
  }
  async listTables(space: DataSpace) {
    const pool = await this.pool(space.catalog);
    try {
      const [result] = await pool.query(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name",
        [space.catalog],
      );
      return rows(result)
        .map((row) => ({ name: text(row.name) }))
        .filter((row) => row.name);
    } finally {
      await pool.end();
    }
  }
  async getTableMetadata(space: DataSpace, name: string): Promise<RemoteTable> {
    const pool = await this.pool(space.catalog);
    try {
      const [tables] = await pool.query(
        "SELECT table_type, table_comment FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
        [space.catalog, name],
      );
      const [columns] = await pool.query(
        "SELECT column_name, column_type, column_comment, is_nullable, column_default, column_key, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
        [space.catalog, name],
      );
      const table = rows(tables)[0] ?? {};
      return {
        name,
        type: text(table.table_type) === "VIEW" ? "VIEW" : "TABLE",
        comment: text(table.table_comment) || undefined,
        columns: rows(columns).map((column) => this.column(column)),
      };
    } finally {
      await pool.end();
    }
  }
  private column(column: Record<string, unknown>): RemoteColumn {
    const dataType = text(column.column_type);
    return {
      name: text(column.column_name),
      dataType,
      normalizedType: normalizeType(dataType),
      comment: text(column.column_comment) || undefined,
      isNullable: text(column.is_nullable) === "YES",
      defaultValue: optional(column.column_default),
      isPrimaryKey: text(column.column_key) === "PRI",
      isPartition: false,
      length: number(column.character_maximum_length),
      precision: number(column.numeric_precision),
      scale: number(column.numeric_scale),
    };
  }
}

class PostgresAdapter extends RelationalAdapter {
  private async client(catalog = "postgres") {
    const { Client } = await import("pg");
    const client = new Client({
      host: text(this.config.host),
      port: number(this.config.port) ?? 5432,
      user: this.credentials.username,
      password: this.credentials.password,
      database: catalog,
    });
    await client.connect();
    return client;
  }
  async testConnection() {
    const client = await this.client();
    try {
      await client.query("SELECT 1");
    } finally {
      await client.end();
    }
  }
  async listNamespaces(): Promise<DataSpace[]> {
    const client = await this.client();
    try {
      const databases = await client.query(
        "SELECT datname AS name FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname",
      );
      const spaces: DataSpace[] = [];
      for (const row of rows(databases.rows)) {
        const catalog = text(row.name);
        if (!catalog) continue;
        const database = await this.client(catalog);
        try {
          const schemas = await database.query(
            "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name <> 'information_schema' AND schema_name NOT LIKE 'pg_%' ORDER BY schema_name",
          );
          for (const schemaRow of rows(schemas.rows)) {
            const schema = text(schemaRow.name);
            if (schema)
              spaces.push({
                name: displaySpace(catalog, schema),
                catalog,
                schema,
              });
          }
        } finally {
          await database.end();
        }
      }
      return spaces;
    } finally {
      await client.end();
    }
  }
  async listTables(space: DataSpace) {
    const client = await this.client(space.catalog);
    try {
      const result = await client.query(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_catalog = $1 AND table_schema = $2 AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name",
        [space.catalog, space.schema],
      );
      return rows(result.rows).map((row) => ({ name: text(row.name) }));
    } finally {
      await client.end();
    }
  }
  async getTableMetadata(space: DataSpace, name: string): Promise<RemoteTable> {
    const client = await this.client(space.catalog);
    try {
      const table = await client.query(
        "SELECT table_type FROM information_schema.tables WHERE table_catalog = $1 AND table_schema = $2 AND table_name = $3",
        [space.catalog, space.schema, name],
      );
      const columns = await client.query(
        "SELECT c.column_name, c.udt_name, c.is_nullable, c.column_default, c.character_maximum_length, c.numeric_precision, c.numeric_scale, pgd.description AS comment, EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name AND kcu.column_name = c.column_name) AS is_primary FROM information_schema.columns c LEFT JOIN pg_catalog.pg_statio_all_tables st ON st.relname = c.table_name LEFT JOIN pg_catalog.pg_description pgd ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position WHERE c.table_catalog = $1 AND c.table_schema = $2 AND c.table_name = $3 ORDER BY c.ordinal_position",
        [space.catalog, space.schema, name],
      );
      return {
        name,
        type:
          text(rows(table.rows)[0]?.table_type) === "VIEW" ? "VIEW" : "TABLE",
        columns: rows(columns.rows).map((column) => {
          const dataType = text(column.udt_name);
          return {
            name: text(column.column_name),
            dataType,
            normalizedType: normalizeType(dataType),
            comment: text(column.comment) || undefined,
            isNullable: text(column.is_nullable) === "YES",
            defaultValue: optional(column.column_default),
            isPrimaryKey: column.is_primary === true,
            isPartition: false,
            length: number(column.character_maximum_length),
            precision: number(column.numeric_precision),
            scale: number(column.numeric_scale),
          };
        }),
      };
    } finally {
      await client.end();
    }
  }
}

class SqlServerAdapter extends RelationalAdapter {
  private async connect(catalog = "master") {
    const mssql = await import("mssql");
    return new mssql.ConnectionPool({
      server: text(this.config.host),
      port: number(this.config.port) ?? 1433,
      user: this.credentials.username,
      password: this.credentials.password,
      database: catalog,
      options: { trustServerCertificate: true },
    }).connect();
  }
  async testConnection() {
    const pool = await this.connect();
    try {
      await pool.request().query("SELECT 1");
    } finally {
      await pool.close();
    }
  }
  async listNamespaces(): Promise<DataSpace[]> {
    const master = await this.connect();
    try {
      const result = await master
        .request()
        .query(
          "SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY name",
        );
      const spaces: DataSpace[] = [];
      for (const row of rows(result.recordset)) {
        const catalog = text(row.name);
        if (!catalog) continue;
        const database = await this.connect(catalog);
        try {
          const schemas = await database
            .request()
            .query(
              "SELECT name FROM sys.schemas WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') ORDER BY name",
            );
          for (const schemaRow of rows(schemas.recordset)) {
            const schema = text(schemaRow.name);
            if (schema)
              spaces.push({
                name: displaySpace(catalog, schema),
                catalog,
                schema,
              });
          }
        } finally {
          await database.close();
        }
      }
      return spaces;
    } finally {
      await master.close();
    }
  }
  async listTables(space: DataSpace) {
    const pool = await this.connect(space.catalog);
    try {
      const result = await pool
        .request()
        .input("schema", space.schema)
        .query(
          "SELECT t.TABLE_NAME AS name, o.modify_date AS updated_at FROM INFORMATION_SCHEMA.TABLES t JOIN sys.objects o ON o.name = t.TABLE_NAME AND o.schema_id = SCHEMA_ID(t.TABLE_SCHEMA) WHERE t.TABLE_SCHEMA = @schema AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY t.TABLE_NAME",
        );
      return rows(result.recordset).map((row) => ({
        name: text(row.name),
        updatedAt: row.updated_at instanceof Date ? row.updated_at : undefined,
      }));
    } finally {
      await pool.close();
    }
  }
  async getTableMetadata(space: DataSpace, name: string): Promise<RemoteTable> {
    const pool = await this.connect(space.catalog);
    try {
      const request = pool
        .request()
        .input("schema", space.schema)
        .input("name", name);
      const table = await request.query(
        "SELECT TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @name",
      );
      const columns = await pool
        .request()
        .input("schema", space.schema)
        .input("name", name)
        .query(
          "SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable, c.COLUMN_DEFAULT AS default_value, c.CHARACTER_MAXIMUM_LENGTH AS length, c.NUMERIC_PRECISION AS precision, c.NUMERIC_SCALE AS scale, CAST(CASE WHEN pk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS bit) AS is_primary FROM INFORMATION_SCHEMA.COLUMNS c LEFT JOIN (SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY') pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @name ORDER BY c.ORDINAL_POSITION",
        );
      return {
        name,
        type:
          text(rows(table.recordset)[0]?.type) === "VIEW" ? "VIEW" : "TABLE",
        columns: rows(columns.recordset).map((column) => {
          const dataType = text(column.data_type);
          return {
            name: text(column.name),
            dataType,
            normalizedType: normalizeType(dataType),
            isNullable: text(column.is_nullable) === "YES",
            defaultValue: optional(column.default_value),
            isPrimaryKey: Boolean(column.is_primary),
            isPartition: false,
            length: number(column.length),
            precision: number(column.precision),
            scale: number(column.scale),
          };
        }),
      };
    } finally {
      await pool.close();
    }
  }
}

class OracleAdapter extends RelationalAdapter {
  constructor(source: SourceConnection) {
    super(source);
  }
  private async connect() {
    const oracle = await import("oracledb");
    return oracle.getConnection({
      user: this.credentials.username,
      password: this.credentials.password,
      connectString: `${text(this.config.host)}:${number(this.config.port) ?? 1521}/${text(this.config.serviceName)}`,
    });
  }
  async testConnection() {
    const connection = await this.connect();
    try {
      await connection.execute("SELECT 1 FROM dual");
    } finally {
      await connection.close();
    }
  }
  async listNamespaces(): Promise<DataSpace[]> {
    const oracle = await import("oracledb");
    const connection = await this.connect();
    try {
      const result = await connection.execute(
        "SELECT username AS name FROM all_users ORDER BY username",
        [],
        { outFormat: oracle.OUT_FORMAT_OBJECT },
      );
      const catalog = text(this.config.serviceName);
      return rows(result.rows)
        .map((row) => {
          const schema = text(row.NAME ?? row.name);
          return schema
            ? { name: displaySpace(catalog, schema), catalog, schema }
            : null;
        })
        .filter((space): space is DataSpace => Boolean(space));
    } finally {
      await connection.close();
    }
  }
  async listTables(space: DataSpace) {
    const oracle = await import("oracledb");
    const connection = await this.connect();
    try {
      const result = await connection.execute(
        "SELECT object_name AS name, last_ddl_time AS updated_at FROM all_objects WHERE owner = :owner AND object_type IN ('TABLE', 'VIEW') ORDER BY object_name",
        { owner: space.schema.toUpperCase() },
        { outFormat: oracle.OUT_FORMAT_OBJECT },
      );
      return rows(result.rows).map((row) => {
        const updatedAt = row.UPDATED_AT ?? row.updated_at;
        return {
          name: text(row.NAME ?? row.name),
          updatedAt: updatedAt instanceof Date ? updatedAt : undefined,
        };
      });
    } finally {
      await connection.close();
    }
  }
  async getTableMetadata(space: DataSpace, name: string): Promise<RemoteTable> {
    const oracle = await import("oracledb");
    const connection = await this.connect();
    try {
      const object = await connection.execute(
        "SELECT object_type AS type FROM all_objects WHERE owner = :owner AND object_name = :name AND object_type IN ('TABLE', 'VIEW')",
        { owner: space.schema.toUpperCase(), name: name.toUpperCase() },
        { outFormat: oracle.OUT_FORMAT_OBJECT },
      );
      const columns = await connection.execute(
        "SELECT c.column_name AS name, c.data_type AS data_type, c.nullable AS is_nullable, c.data_default AS default_value, c.data_length AS length, c.data_precision AS precision, c.data_scale AS scale, cc.comments AS comment, CASE WHEN pk.column_name IS NULL THEN 0 ELSE 1 END AS is_primary FROM all_tab_columns c LEFT JOIN all_col_comments cc ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name LEFT JOIN (SELECT acc.owner, acc.table_name, acc.column_name FROM all_constraints ac JOIN all_cons_columns acc ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name WHERE ac.constraint_type = 'P') pk ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name WHERE c.owner = :owner AND c.table_name = :name ORDER BY c.column_id",
        { owner: space.schema.toUpperCase(), name: name.toUpperCase() },
        { outFormat: oracle.OUT_FORMAT_OBJECT },
      );
      return {
        name,
        type:
          text(rows(object.rows)[0]?.TYPE ?? rows(object.rows)[0]?.type) ===
          "VIEW"
            ? "VIEW"
            : "TABLE",
        columns: rows(columns.rows).map((column) => {
          const dataType = text(column.DATA_TYPE ?? column.data_type);
          return {
            name: text(column.NAME ?? column.name),
            dataType,
            normalizedType: normalizeType(dataType),
            comment: text(column.COMMENT ?? column.comment) || undefined,
            isNullable: text(column.IS_NULLABLE ?? column.is_nullable) === "Y",
            defaultValue: optional(
              column.DEFAULT_VALUE ?? column.default_value,
            ),
            isPrimaryKey: Boolean(column.IS_PRIMARY ?? column.is_primary),
            isPartition: false,
            length: number(column.LENGTH ?? column.length),
            precision: number(column.PRECISION ?? column.precision),
            scale: number(column.SCALE ?? column.scale),
          };
        }),
      };
    } finally {
      await connection.close();
    }
  }
}

class SqliteAdapter extends RelationalAdapter {
  private readonly file: string;
  private readonly catalog: string;
  constructor(source: SourceConnection) {
    super(source);
    const root = process.env.SQLITE_DATA_SOURCE_ROOT;
    const file = text(source.connectionConfig.filePath);
    if (!root)
      throw new BadRequestException(
        "SQLITE_DATA_SOURCE_ROOT is required for SQLite data sources",
      );
    if (!isAbsolute(file))
      throw new BadRequestException("SQLite file path must be absolute");
    const resolvedRoot = resolve(root);
    const resolvedFile = resolve(file);
    const pathWithinRoot = relative(resolvedRoot, resolvedFile);
    if (
      !/\.((db)|(sqlite))$/i.test(extname(resolvedFile)) ||
      pathWithinRoot.startsWith("..") ||
      isAbsolute(pathWithinRoot) ||
      !pathWithinRoot
    )
      throw new BadRequestException(
        "SQLite file must be a .db or .sqlite file under SQLITE_DATA_SOURCE_ROOT",
      );
    this.file = resolvedFile;
    this.catalog = basename(resolvedFile);
  }
  private async open() {
    const Database = (await import("better-sqlite3")).default;
    return new Database(this.file, { readonly: true, fileMustExist: true });
  }
  async testConnection() {
    const db = await this.open();
    try {
      db.prepare("SELECT 1").get();
    } finally {
      db.close();
    }
  }
  async listNamespaces(): Promise<DataSpace[]> {
    return [{ name: this.catalog, catalog: this.catalog, schema: "" }];
  }
  async listTables() {
    const db = await this.open();
    try {
      return rows(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all(),
      ).map((row) => ({ name: text(row.name) }));
    } finally {
      db.close();
    }
  }
  async getTableMetadata(
    _space: DataSpace,
    name: string,
  ): Promise<RemoteTable> {
    const db = await this.open();
    try {
      const quoted = name.replaceAll("'", "''");
      const type = text(
        rows(
          db.prepare("SELECT type FROM sqlite_master WHERE name = ?").all(name),
        )[0]?.type,
      );
      const columns = rows(
        db.prepare(`PRAGMA table_info('${quoted}')`).all(),
      ).map((column) => {
        const dataType = text(column.type);
        return {
          name: text(column.name),
          dataType,
          normalizedType: normalizeType(dataType),
          isNullable: !Boolean(column.notnull),
          defaultValue: optional(column.dflt_value),
          isPrimaryKey: Boolean(column.pk),
          isPartition: false,
        };
      });
      return { name, type: type === "view" ? "VIEW" : "TABLE", columns };
    } finally {
      db.close();
    }
  }
}

class MaxComputeAdapter implements SourceAdapter {
  private readonly client: MaxComputeClient;
  constructor(source: SourceConnection) {
    // MaxCompute may accept an HTTP endpoint for a lightweight project check,
    // but metadata endpoints can redirect it and invalidate the signed request.
    // Always issue signed metadata calls to the canonical HTTPS endpoint.
    const endpoint = (
      source.endpoint || text(source.connectionConfig.endpoint)
    ).replace(/^http:\/\//i, "https://");
    this.client = new MaxComputeClient({
      endpoint,
      region: source.region || text(source.connectionConfig.region),
      defaultProject:
        source.defaultProject || text(source.connectionConfig.project),
      accessKey: source.credentials.accessKey ?? "",
      secretKey: source.credentials.secretKey ?? "",
    });
  }
  async testConnection() {
    await this.client.getProject();
  }
  async listNamespaces() {
    const projects = await this.client.listProjects();
    const spaces: DataSpace[] = [];
    for (const project of projects) {
      try {
        await this.client.getProject(project.name);
        await this.client.listTables(project.name);
        spaces.push({
          name: project.name,
          catalog: project.name,
          schema: "",
          description: project.description,
        });
      } catch {
        // Listing projects is account-scoped. Only expose projects that this
        // credential can actually read metadata from.
      }
    }
    return spaces;
  }
  async listTables(space: DataSpace) {
    return this.client.listTables(space.catalog);
  }
  async getTableMetadata(space: DataSpace, name: string) {
    return this.client.getTable(name, space.catalog);
  }
}

@Injectable()
export class DataSourceAdapterFactory {
  create(source: SourceConnection): SourceAdapter {
    switch (source.type) {
      case DataSourceType.MAXCOMPUTE:
        return new MaxComputeAdapter(source);
      case DataSourceType.MYSQL:
        return new MysqlAdapter(source);
      case DataSourceType.MARIADB:
        return new MysqlAdapter(source, true);
      case DataSourceType.POSTGRESQL:
        return new PostgresAdapter(source);
      case DataSourceType.SQLSERVER:
        return new SqlServerAdapter(source);
      case DataSourceType.ORACLE:
        return new OracleAdapter(source);
      case DataSourceType.SQLITE:
        return new SqliteAdapter(source);
    }
  }
}
