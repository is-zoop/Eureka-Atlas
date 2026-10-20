import { BadRequestException, Injectable } from "@nestjs/common";
import { AgentSessionsService } from "./agent-sessions.service";
import { contextProperties, readContext } from "./mcp-context";
import { McpDataService } from "./mcp-data.service";
import { SelectionAccessService } from "./selection-access.service";
const sessionIdSchema = contextProperties.session_id;
@Injectable()
export class McpToolsService {
  constructor(
    private readonly sessions: AgentSessionsService,
    private readonly data: McpDataService,
    private readonly access: SelectionAccessService,
  ) {}
  async definitions() {
    return [
      {
        name: "create_query_session",
        description:
          "仅为明确的新对话创建业务会话，默认全部已发布可查询表；不要用新会话绕过原选数范围。",
        inputSchema: {
          type: "object" as const,
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "get_query_session",
        description:
          "读取本人的业务会话范围和版本；需要界面时使用选数菜单，范围失效不自动扩大。",
        inputSchema: {
          type: "object" as const,
          properties: { session_id: sessionIdSchema },
          required: ["session_id"],
          additionalProperties: false,
        },
      },
      {
        name: "open_selection_menu",
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        description:
          "为当前已有业务会话打开免网页登录的独立选数窗口。服务端加密保存连接凭证，仅用于本对话选数校验；不得在参数中传凭证。启动链接只用于当前会话，不要转发。",
        inputSchema: {
          type: "object" as const,
          properties: { session_id: sessionIdSchema },
          required: ["session_id"],
          additionalProperties: false,
        },
      },
      ...(await this.data.definitions()),
    ];
  }
  async call(
    memberNo: string,
    name: string,
    args: Record<string, unknown>,
    credential?: string,
  ) {
    if (name === "open_selection_menu") {
      if (Object.keys(args).some((k) => k !== "session_id"))
        throw new BadRequestException("选数菜单只接收当前业务会话标识。");
      return this.access.open(memberNo, readContext(args).id, credential ?? "");
    }
    if (name === "create_query_session") {
      if (Object.keys(args).length)
        throw new BadRequestException("创建会话不接受身份或选表参数。");
      const row = await this.sessions.create(memberNo);
      return this.description(memberNo, row.id);
    }
    if (name === "get_query_session") {
      if (Object.keys(args).some((k) => k !== "session_id"))
        throw new BadRequestException("会话参数无效。");
      return this.description(memberNo, readContext(args).id);
    }
    return this.data.call(memberNo, name, args);
  }
  private async description(memberNo: string, id: string) {
    const { available_tables, ...value } = await this.sessions.describe(
      memberNo,
      id,
    );
    const tables =
      value.scope_mode === "ALL"
        ? available_tables
        : available_tables.filter((table) =>
            value.selected_table_ids.includes(table.id),
          );
    return { ...value, tables };
  }
}
