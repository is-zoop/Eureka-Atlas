import {
  All,
  Controller,
  ForbiddenException,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Response } from "express";
import { ExternalApi } from "../auth/external-api.decorator";
import { personalCredentialFromRequest } from "../auth/auth.service";
import { RequirePermission } from "../auth/permission.decorator";
import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";
import { ExternalLimitsGuard } from "../external-api/external-limits";
import { safeExternalError, trace } from "../external-api/external-http";
import { McpToolsService } from "./mcp-tools.service";
import { timed, serverTiming, type McpTimings } from "./mcp-timing";
import { mcpResultText } from "./mcp-result-text";
import { PLUGIN_VERSION } from "./plugin-skill";

@ExternalApi()
@RequirePermission("query.use")
@UseGuards(ExternalLimitsGuard)
@Controller("mcp")
export class McpController {
  constructor(private readonly tools: McpToolsService) {}
  @All() async handle(@Req() req: AuthRequest, @Res() res: Response) {
    const origin = req.get("origin"),
      allowed = (
        process.env.WEB_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000"
      )
        .split(",")
        .map((v) => v.trim());
    if (origin && !allowed.includes(origin))
      throw new ForbiddenException("MCP 不允许该 Origin。");
    const requestId = trace(req, res),
      memberNo = requestMemberNo(req);
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Stateless MCP supports POST only." },
      });
    }
    // Low-level SDK API deliberately preserves the project's shared TypeBox JSON Schemas.
    const server = new Server(
      { name: "atlas-ask", version: PLUGIN_VERSION },
      {
        capabilities: { tools: {} },
        instructions:
          "先创建或读取当前业务会话；默认全部；open_selection_menu 打开仅限当前会话的免登录独立选数窗口，启动链接不转发。个人凭证只在连接层配置。",
      },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: await this.tools.definitions(),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const timings: McpTimings = { auth: req.authElapsedMs ?? 0 };
      try {
        const data = await timed(timings, "tool", () =>
          this.tools.call(
            memberNo,
            request.params.name,
            request.params.arguments ?? {},
            personalCredentialFromRequest(req),
            timings,
          ),
        );
        res.setHeader("Server-Timing", serverTiming(timings));
        const payload = { data, request_id: requestId, timings_ms: timings };
        return {
          content: [
            { type: "text" as const, text: mcpResultText(data, requestId) },
          ],
          structuredContent: payload,
        };
      } catch (cause) {
        res.setHeader("Server-Timing", serverTiming(timings));
        const error = safeExternalError(cause);
        const payload = {
          error: { code: error.code, message: error.message },
          request_id: requestId,
          ...(error.status === 429 ? { retry_after: 3 } : {}),
        };
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      }
    });
    res.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
