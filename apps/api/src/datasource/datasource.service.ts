import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DataSource,
  DataSourceType,
  Prisma,
  prisma,
} from "@eureka-atlas/database";
import { DataSourceAdapterFactory } from "../metadata/database-adapters";
import { DataSpace } from "../metadata/datasource-adapter";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { CredentialCryptoService } from "./credential-crypto.service";

type ConnectionConfig = Record<string, unknown>;
type Credentials = {
  username?: string;
  password?: string;
  accessKey?: string;
  secretKey?: string;
};
export type CreateDataSourceInput = {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  connectionConfig?: unknown;
  credentials?: unknown;
};
export type UpdateDataSourceInput = {
  name?: unknown;
  description?: unknown;
  connectionConfig?: unknown;
  credentials?: unknown;
};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const config = (value: unknown): ConnectionConfig =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ConnectionConfig)
    : {};
const credentials = (value: unknown): Credentials =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Credentials)
    : {};
const validTypes = new Set(Object.values(DataSourceType));

@Injectable()
export class DatasourceService {
  constructor(
    private readonly crypto: CredentialCryptoService,
    private readonly adapters: DataSourceAdapterFactory,
  ) {}

  async create(input: CreateDataSourceInput) {
    const name = text(input.name);
    const type = text(input.type) as DataSourceType;
    const connectionConfig = config(input.connectionConfig);
    const secret = credentials(input.credentials);
    if (!name || !validTypes.has(type))
      throw new BadRequestException(
        "A data source name and supported type are required",
      );
    this.validate(type, connectionConfig, secret, true);
    await this.verifyConnection(type, connectionConfig, secret);
    const exists = await prisma.dataSource.findUnique({ where: { name } });
    if (exists)
      throw new ConflictException(
        "A data source with this name already exists",
      );
    return this.toResponse(
      await prisma.dataSource.create({
        data: {
          ...this.write(
            type,
            name,
            text(input.description) || null,
            connectionConfig,
            secret,
          ),
          status: "ACTIVE",
          lastTestedAt: new Date(),
        },
      }),
    );
  }

  async update(id: string, input: UpdateDataSourceInput) {
    const existing = await this.require(id);
    const nextConfig = Object.keys(config(input.connectionConfig)).length
      ? config(input.connectionConfig)
      : this.publicConfig(existing);
    const nextCredentials = {
      ...this.readCredentials(existing),
      ...credentials(input.credentials),
    };
    const name = text(input.name) || existing.name;
    if (
      name !== existing.name &&
      (await prisma.dataSource.findUnique({ where: { name } }))
    )
      throw new ConflictException(
        "A data source with this name already exists",
      );
    this.validate(existing.type, nextConfig, nextCredentials, false);
    await this.verifyConnection(existing.type, nextConfig, nextCredentials);
    return this.toResponse(
      await prisma.dataSource.update({
        where: { id },
        data: {
          ...this.write(
            existing.type,
            name,
            input.description === undefined
              ? existing.description
              : text(input.description) || null,
            nextConfig,
            nextCredentials,
          ),
          status: "ACTIVE",
          lastTestedAt: new Date(),
        },
      }),
    );
  }

  async remove(id: string) {
    const source = await this.require(id);
    if (source.syncStatus === "RUNNING")
      throw new ConflictException("数据源正在同步，请等待同步完成后再删除");
    await prisma.dataSource.delete({ where: { id } });
    return { success: true };
  }

  async list() {
    return (
      await prisma.dataSource.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          syncSpaces: {
            where: { selected: true },
            orderBy: [{ catalog: "asc" }, { schema: "asc" }],
          },
        },
      })
    ).map((source) => this.toResponse(source));
  }

  async listSyncSpaces(id: string) {
    await this.require(id);
    return prisma.dataSourceSyncSpace.findMany({
      where: { dataSourceId: id },
      orderBy: [{ catalog: "asc" }, { schema: "asc" }],
    });
  }

  async refreshSyncSpaces(id: string) {
    const source = await this.getWithCredentials(id);
    const adapter = this.adapters.create(source);
    await adapter.testConnection();
    const discovered = await adapter.listNamespaces();
    const existing = await prisma.dataSourceSyncSpace.findMany({
      where: { dataSourceId: id },
    });
    const known = new Map(
      existing.map((space) => [`${space.catalog}\u0000${space.schema}`, space]),
    );
    await prisma.$transaction([
      prisma.dataSource.update({
        where: { id },
        data: { status: "ACTIVE", lastTestedAt: new Date() },
      }),
      ...discovered.map((space) =>
        prisma.dataSourceSyncSpace.upsert({
          where: {
            dataSourceId_catalog_schema: {
              dataSourceId: id,
              catalog: space.catalog,
              schema: space.schema,
            },
          },
          create: this.syncSpaceCreate(id, space),
          update: {
            name: space.name,
            description: space.description ?? null,
          },
        }),
      ),
    ]);
    return (await this.listSyncSpaces(id)).map((space) => ({
      ...space,
      selected: known.get(`${space.catalog}\u0000${space.schema}`)?.selected ?? space.selected,
    }));
  }

  async getWithCredentials(id: string) {
    const source = await this.require(id);
    return {
      ...source,
      connectionConfig: this.publicConfig(source),
      credentials: this.readCredentials(source),
    };
  }

  private syncSpaceCreate(id: string, space: DataSpace) {
    return {
      dataSourceId: id,
      catalog: space.catalog,
      schema: space.schema,
      name: space.name,
      description: space.description ?? null,
    };
  }

  async testConnection(input: CreateDataSourceInput & { id?: unknown }) {
    const existingId = text(input.id);
    if (existingId) {
      const existing = await this.require(existingId);
      const nextConfig = Object.keys(config(input.connectionConfig)).length
        ? config(input.connectionConfig)
        : this.publicConfig(existing);
      const nextCredentials = {
        ...this.readCredentials(existing),
        ...credentials(input.credentials),
      };
      this.validate(existing.type, nextConfig, nextCredentials, false);
      await this.verifyConnection(existing.type, nextConfig, nextCredentials);
      return { success: true };
    }
    const type = text(input.type) as DataSourceType;
    const connectionConfig = config(input.connectionConfig);
    const secret = credentials(input.credentials);
    if (!validTypes.has(type))
      throw new BadRequestException("A supported data source type is required");
    this.validate(type, connectionConfig, secret, true);
    await this.verifyConnection(type, connectionConfig, secret);
    return { success: true };
  }

  async markSynced(id: string) {
    return prisma.dataSource.update({
      where: { id },
      data: { lastSyncedAt: new Date() },
    });
  }

  private verifyConnection(
    type: DataSourceType,
    connectionConfig: ConnectionConfig,
    secret: Credentials,
  ) {
    return this.adapters
      .create({
        type,
        connectionConfig,
        credentials: secret,
        region: text(connectionConfig.region),
        endpoint: text(connectionConfig.endpoint),
        defaultProject: text(connectionConfig.project),
      })
      .testConnection();
  }

  private require(id: string) {
    return prisma.dataSource.findUnique({ where: { id } }).then((source) => {
      if (!source) throw new NotFoundException("Data source not found");
      return source;
    });
  }
  private publicConfig(source: DataSource) {
    const current = config(source.connectionConfig);
    if (source.type !== DataSourceType.MAXCOMPUTE) return current;
    return {
      region: text(current.region) || source.region,
      endpoint: text(current.endpoint) || source.endpoint,
      project: text(current.project) || source.defaultProject,
    };
  }
  private readCredentials(source: DataSource): Credentials {
    if (source.type === DataSourceType.MAXCOMPUTE)
      return {
        accessKey: source.accessKeyEncrypted
          ? this.crypto.decrypt(source.accessKeyEncrypted)
          : "",
        secretKey: source.secretKeyEncrypted
          ? this.crypto.decrypt(source.secretKeyEncrypted)
          : "",
      };
    return {
      username: source.usernameEncrypted
        ? this.crypto.decrypt(source.usernameEncrypted)
        : "",
      password: source.passwordEncrypted
        ? this.crypto.decrypt(source.passwordEncrypted)
        : "",
    };
  }
  private write(
    type: DataSourceType,
    name: string,
    description: string | null,
    connectionConfig: ConnectionConfig,
    secret: Credentials,
  ) {
    if (type === DataSourceType.MAXCOMPUTE)
      return {
        name,
        type,
        description,
        connectionConfig: connectionConfig as Prisma.InputJsonValue,
        region: text(connectionConfig.region),
        endpoint: text(connectionConfig.endpoint).replace(/\/$/, ""),
        defaultProject: text(connectionConfig.project),
        accessKeyEncrypted: this.crypto.encrypt(text(secret.accessKey)),
        secretKeyEncrypted: this.crypto.encrypt(text(secret.secretKey)),
        usernameEncrypted: null,
        passwordEncrypted: null,
        status: "UNTESTED" as const,
      };
    return {
      name,
      type,
      description,
      connectionConfig: connectionConfig as Prisma.InputJsonValue,
      region: "",
      endpoint: "",
      defaultProject: "",
      accessKeyEncrypted: "",
      secretKeyEncrypted: "",
      usernameEncrypted: this.crypto.encrypt(text(secret.username)),
      passwordEncrypted: this.crypto.encrypt(text(secret.password)),
      status: "UNTESTED" as const,
    };
  }
  private validate(
    type: DataSourceType,
    connectionConfig: ConnectionConfig,
    secret: Credentials,
    creating: boolean,
  ) {
    const required = (value: string, label: string) => {
      if (!value) throw new BadRequestException(`${label} is required`);
    };
    if (type === DataSourceType.SQLITE) {
      const file = text(connectionConfig.filePath);
      required(file, "SQLite file path");
      const root = process.env.SQLITE_DATA_SOURCE_ROOT;
      if (!root || !isAbsolute(file))
        throw new BadRequestException(
          "SQLite file path must be absolute and SQLITE_DATA_SOURCE_ROOT must be configured",
        );
      const nested = relative(resolve(root), resolve(file));
      if (
        !/\.((db)|(sqlite))$/i.test(extname(file)) ||
        !nested ||
        nested.startsWith("..") ||
        isAbsolute(nested)
      )
        throw new BadRequestException(
          "SQLite file must be a .db or .sqlite file under SQLITE_DATA_SOURCE_ROOT",
        );
      return;
    }
    if (type === DataSourceType.MAXCOMPUTE) {
      required(text(connectionConfig.region), "Region");
      required(text(connectionConfig.endpoint), "Endpoint");
      required(text(connectionConfig.project), "Project");
      required(text(secret.accessKey), "AccessKey");
      required(text(secret.secretKey), "SecretKey");
      return;
    }
    required(text(connectionConfig.host), "Host");
    if (type === DataSourceType.ORACLE)
      required(text(connectionConfig.serviceName), "Oracle Service Name");
    if (creating || secret.username !== undefined)
      required(text(secret.username), "Username");
    if (creating || secret.password !== undefined)
      required(text(secret.password), "Password");
    const port = text(connectionConfig.port);
    if (
      port &&
      (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    )
      throw new BadRequestException("Port must be between 1 and 65535");
  }
  private toResponse(source: DataSource & { syncSpaces?: unknown[] }) {
    const {
      accessKeyEncrypted,
      secretKeyEncrypted,
      usernameEncrypted,
      passwordEncrypted,
      syncSpaces,
      ...safe
    } = source;
    return {
      ...safe,
      selectedSpaces: syncSpaces ?? [],
      connectionConfig: this.publicConfig(source),
      username:
        source.type === DataSourceType.MAXCOMPUTE || !usernameEncrypted
          ? null
          : this.crypto.decrypt(usernameEncrypted),
      hasCredentials:
        source.type === DataSourceType.MAXCOMPUTE
          ? Boolean(accessKeyEncrypted && secretKeyEncrypted)
          : source.type === DataSourceType.SQLITE ||
            Boolean(usernameEncrypted && passwordEncrypted),
    };
  }
}
