import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import MaxComputeOpenApi, {
  ListProjectsRequest,
} from "@alicloud/maxcompute20220104";
import * as OpenApi from "@alicloud/openapi-client";
import { normalizeType, RemoteColumn, RemoteTable } from "./datasource-adapter";

type Credentials = {
  endpoint: string;
  region: string;
  defaultProject: string;
  accessKey: string;
  secretKey: string;
};
export type RemoteProject = { name: string; description?: string };

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;

@Injectable()
export class MaxComputeClient {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });
  constructor(private readonly credentials: Credentials) {}

  async getProject(projectName = this.credentials.defaultProject): Promise<RemoteProject> {
    const document = await this.request(
      `/projects/${encodeURIComponent(projectName)}`,
      projectName,
    );
    const project = document.Project ?? document.project ?? document;
    return {
      name:
        text(project.Name ?? project.name) ?? projectName,
      description: text(project.Comment ?? project.comment),
    };
  }

  async listProjects(): Promise<RemoteProject[]> {
    const client = new MaxComputeOpenApi(new OpenApi.Config({
      accessKeyId: this.credentials.accessKey,
      accessKeySecret: this.credentials.secretKey,
      regionId: this.credentials.region,
    }));
    const projects: RemoteProject[] = [];
    let marker: string | undefined;
    do {
      const response = await client.listProjects(
        new ListProjectsRequest({
          region: this.credentials.region,
          maxItem: 100,
          marker,
          listSystemCatalog: false,
        }),
      );
      const data = response.body?.data;
      projects.push(
        ...(data?.projects ?? [])
          .filter((project) => project.status === "AVAILABLE" && project.name)
          .map((project) => ({
            name: project.name as string,
            description: project.comment,
          })),
      );
      marker = data?.marker || data?.nextToken;
    } while (marker);
    return projects;
  }

  async listTables(projectName = this.credentials.defaultProject): Promise<Array<{ name: string; updatedAt?: Date }>> {
    const document = await this.request(
      `/projects/${encodeURIComponent(projectName)}/tables`,
      projectName,
    );
    const root = document.Tables ?? document.tables ?? document;
    return asArray(root.Table ?? root.table)
      .map((item: Record<string, unknown>) => {
        const value =
          item.LastModifiedTime ??
          item.lastModifiedTime ??
          item.LastModified ??
          item.lastModified;
        const timestamp =
          typeof value === "number"
            ? new Date(value)
            : typeof value === "string"
              ? new Date(value)
              : undefined;
        return {
          name: text(item.Name ?? item.name) ?? "",
          updatedAt:
            timestamp && !Number.isNaN(timestamp.getTime())
              ? timestamp
              : undefined,
        };
      })
      .filter((item) => item.name);
  }

  async getTable(name: string, projectName = this.credentials.defaultProject): Promise<RemoteTable> {
    const document = await this.request(
      `/projects/${encodeURIComponent(projectName)}/tables/${encodeURIComponent(name)}`,
      projectName,
    );
    const table = document.Table ?? document.table ?? document;
    const schema = this.parseSchema(table.Schema ?? table.schema);
    const columns = this.parseColumns(
      this.schemaColumns(schema, "Columns", "columns"),
      false,
    );
    const partitions = this.parseColumns(
      this.schemaColumns(schema, "PartitionKeys", "partitionKeys"),
      true,
    );
    const updated = text(table.LastModifiedTime ?? table.lastModifiedTime);
    return {
      name: text(table.Name ?? table.name) ?? name,
      type: text(table.Type ?? table.type) ?? "TABLE",
      comment: text(table.Comment ?? table.comment),
      updatedAt:
        updated && !Number.isNaN(Number(updated))
          ? new Date(Number(updated))
          : undefined,
      columns: [...columns, ...partitions],
    };
  }

  private parseColumns(raw: unknown, isPartition: boolean): RemoteColumn[] {
    return asArray<Record<string, unknown>>(
      raw as Record<string, unknown> | Record<string, unknown>[] | undefined,
    )
      .map((column) => ({
        name: text(column.Name ?? column.name) ?? "",
        dataType: text(column.Type ?? column.type) ?? "UNKNOWN",
        normalizedType: normalizeType(
          text(column.Type ?? column.type) ?? "UNKNOWN",
        ),
        comment: text(column.Comment ?? column.comment),
        isPartition,
      }))
      .filter((column) => column.name);
  }

  private parseSchema(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object") return {};
    const schema = raw as Record<string, unknown>;
    const innerXml = text(schema["#text"]);
    if (!innerXml) return schema;
    if (text(schema["@_format"])?.toLowerCase() === "json") {
      try {
        return JSON.parse(innerXml) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    const parsed = this.parser.parse(innerXml);
    return (parsed.Schema ?? parsed.schema ?? parsed) as Record<
      string,
      unknown
    >;
  }

  private schemaColumns(
    schema: Record<string, unknown>,
    primaryKey: string,
    secondaryKey: string,
  ): unknown {
    const group = schema[primaryKey] ?? schema[secondaryKey];
    if (Array.isArray(group)) return group;
    if (!group || typeof group !== "object") return undefined;
    const fields = group as Record<string, unknown>;
    return fields.Column ?? fields.column;
  }

  private async request(
    resource: string,
    currentProject = this.credentials.defaultProject,
  ) {
    const date = new Date().toUTCString();
    const requestUrl = new URL(
      `${this.credentials.endpoint.replace(/\/$/, "")}${resource}`,
    );
    // PyODPS includes the active project on every REST call. MaxCompute uses it
    // for request context and permission evaluation, even when the project is
    // already present in the URL path.
    requestUrl.searchParams.set(
      "curr_project",
      currentProject,
    );
    // PyODPS signs the resource relative to the configured endpoint. The
    // service endpoint ends in /api, which is therefore excluded from the
    // canonical resource (for example: /projects/paiwo_smart?...).
    const endpointPath = new URL(this.credentials.endpoint).pathname.replace(
      /\/$/,
      "",
    );
    const resourcePath = requestUrl.pathname.slice(endpointPath.length) || "/";
    const query = [...requestUrl.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      )
      .join("&");
    const canonicalResource = `${resourcePath}${query ? `?${query}` : ""}`;
    const signature = createHmac("sha1", this.credentials.secretKey)
      .update(`GET\n\n\n${date}\n${canonicalResource}`)
      .digest("base64");
    let response: Response | undefined;
    let requestError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch(requestUrl, {
          headers: {
            Date: date,
            Authorization: `ODPS ${this.credentials.accessKey}:${signature}`,
          },
        });
        break;
      } catch (error) {
        requestError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    }
    if (!response) {
      const cause =
        requestError instanceof Error && "cause" in requestError
          ? requestError.cause
          : undefined;
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? String(cause.code)
          : undefined;
      throw new BadGatewayException(
        `Unable to reach the MaxCompute endpoint${code ? ` (${code})` : ""}`,
      );
    }
    const body = await response.text();
    if (response.status === 401)
      throw new UnauthorizedException("MaxCompute credentials were rejected");
    if (response.status === 403)
      throw new ForbiddenException(
        "MaxCompute permissions are insufficient for metadata access",
      );
    if (!response.ok) {
      const detail = this.errorDetail(body);
      throw new BadGatewayException(
        `MaxCompute returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return this.parser.parse(body);
  }

  private errorDetail(body: string): string | undefined {
    try {
      const document = this.parser.parse(body);
      const error = document.Error ?? document.error ?? document;
      const code = text(error.Code ?? error.code);
      const message = text(error.Message ?? error.message);
      return [code, message].filter(Boolean).join(": ") || undefined;
    } catch {
      return undefined;
    }
  }
}
