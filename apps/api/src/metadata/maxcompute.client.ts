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
  signal?: AbortSignal;
};
export type RemoteProject = { name: string; description?: string };
export type MaxComputeInstanceStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
export type MaxComputeInstance = { id: string; status: MaxComputeInstanceStatus; startedAt?: string; completedAt?: string };

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

  async listPartitions(tableName: string, projectName = this.credentials.defaultProject): Promise<string[]> {
    const document = await this.request(
      `/projects/${encodeURIComponent(projectName)}/tables/${encodeURIComponent(tableName)}/partitions`,
      projectName,
    );
    const root = document.Partitions ?? document.partitions ?? document;
    return asArray(root.Partition ?? root.partition)
      .map((item: Record<string, unknown> | string) => typeof item === "string" ? item : text(item.Name ?? item.name ?? item.Spec ?? item.spec) ?? "")
      .filter(Boolean);
  }
  async submitSql(sql: string, projectName = this.credentials.defaultProject, idempotencyKey?: string): Promise<string> {
    const taskName = "EurekaAtlasQuery";
    const guid = idempotencyKey ? `<Guid>${escapeXml(idempotencyKey)}</Guid>` : "";
    const query = sql.replace(/]]>/g, "]".repeat(4) + "><![CDATA[>");
    const body = `<Instance><Job><Name>${taskName}</Name>${guid}<Tasks><SQL><Name>${taskName}</Name><Config><Property><Name>settings</Name><Value>{&quot;odps.sql.type.system.odps2&quot;:&quot;true&quot;}</Value></Property></Config><Query><![CDATA[${query}]]></Query></SQL></Tasks></Job></Instance>`;
    const response = await this.requestResponse("POST", `/projects/${encodeURIComponent(projectName)}/instances`, projectName, body, { "Content-Type": "application/xml" });
    const location = response.headers.get("location");
    const id = location?.split("/").filter(Boolean).at(-1);
    if (!id) throw new BadGatewayException("MaxCompute did not return an instance identifier");
    return id;
  }

  async getInstance(instanceId: string, projectName = this.credentials.defaultProject): Promise<MaxComputeInstance> {
    const response = await this.requestResponse("GET", `/projects/${encodeURIComponent(projectName)}/instances/${encodeURIComponent(instanceId)}`, projectName);
    const document = this.parser.parse(await response.text());
    const instance = document.Instance ?? document.instance ?? document;
    const tasks = (instance.Tasks ?? instance.tasks ?? instance) as Record<string, unknown>;
    const task = asArray(tasks.Task ?? tasks.task)[0] as Record<string, unknown> | undefined;
    const value = String(task?.Status ?? task?.status ?? instance.Status ?? instance.status ?? "UNKNOWN").toUpperCase();
    const status: MaxComputeInstanceStatus = value === "CANCELLED" ? "CANCELLED" : value === "TERMINATED" ? "SUCCEEDED" : value === "RUNNING" || value === "SUSPENDED" ? "RUNNING" : value === "SUCCESS" || value === "SUCCEEDED" ? "SUCCEEDED" : value === "FAILED" ? "FAILED" : "UNKNOWN";
    return { id: instanceId, status, startedAt: response.headers.get("x-odps-start-time") ?? undefined, completedAt: response.headers.get("x-odps-end-time") ?? undefined };
  }

  async getInstanceResult(instanceId: string, projectName = this.credentials.defaultProject): Promise<string> {
    const response = await this.requestResponse("GET", `/projects/${encodeURIComponent(projectName)}/instances/${encodeURIComponent(instanceId)}?result`, projectName);
    const document = this.parser.parse(await response.text());
    const root = document.Instance ?? document.instance ?? document;
    const tasks = (root.Tasks ?? root.TaskResults ?? root.tasks ?? root.taskResults ?? root) as Record<string, unknown>;
    const task = asArray(tasks.Task ?? tasks.TaskResult ?? tasks.task ?? tasks.taskResult)[0] as Record<string, unknown> | undefined;
    const result = task?.Result ?? task?.result;
    return text(result) ?? text((result as Record<string, unknown> | undefined)?.["#text"]) ?? "";
  }

  async cancelInstance(instanceId: string, projectName = this.credentials.defaultProject): Promise<void> {
    await this.requestResponse("PUT", `/projects/${encodeURIComponent(projectName)}/instances/${encodeURIComponent(instanceId)}`, projectName, "<Instance><Status>Terminated</Status></Instance>", { "Content-Type": "application/xml" });
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
    const response = await this.requestResponse("GET", resource, currentProject);
    return this.parser.parse(await response.text());
  }

  private async requestResponse(
    method: "GET" | "POST" | "PUT",
    resource: string,
    currentProject = this.credentials.defaultProject,
    body?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
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
    const bareParameters = new Set(
      (resource.split("?", 2)[1] ?? "").split("&")
        .filter((part) => part && !part.includes("="))
        .map((part) => decodeURIComponent(part)),
    );
    const query = [...requestUrl.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => bareParameters.has(key) && value === ""
        ? encodeURIComponent(key)
        : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    requestUrl.search = query ? `?${query}` : "";
    const canonicalResource = `${resourcePath}${query ? `?${query}` : ""}`;
    const contentType = extraHeaders["Content-Type"] ?? "";
    const signature = createHmac("sha1", this.credentials.secretKey)
      .update(`${method}\n\n${contentType}\n${date}\n${canonicalResource}`)
      .digest("base64");
    let response: Response | undefined;
    let requestError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.credentials.signal?.throwIfAborted();
        response = await fetch(requestUrl, {
          ...(this.credentials.signal ? {signal:this.credentials.signal} : {}),
          method,
          body,
          headers: {
            Date: date,
            Authorization: `ODPS ${this.credentials.accessKey}:${signature}`,
            ...extraHeaders,
          },
        });
        break;
      } catch (error) {
        if(this.credentials.signal?.aborted)throw error;
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
    if (response.status === 401)
      throw new UnauthorizedException("MaxCompute credentials were rejected");
    if (response.status === 403) {
      const detail = this.errorDetail(await response.text());
      throw new ForbiddenException(`MaxCompute rejected the request${detail ? `: ${detail}` : ""}`);
    }
    if (!response.ok) {
      const body = await response.text();
      const detail = this.errorDetail(body);
      throw new BadGatewayException(
        `MaxCompute returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return response;
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

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
