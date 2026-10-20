import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { RequirePermission } from "../auth/permission.decorator";
import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";
import { AgentSessionsService } from "./agent-sessions.service";
import { ExternalLimitsGuard } from "../external-api/external-limits";
@RequirePermission("query.use")
@UseGuards(ExternalLimitsGuard)
@Controller("integrations/agent-sessions")
export class AgentSessionsController {
  constructor(private readonly sessions: AgentSessionsService) {}
  @Post() async create(@Req() req: AuthRequest, @Body() input?: unknown) {
    if (
      input !== undefined &&
      (!input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length)
    )
      throw new BadRequestException(
        "创建会话不接受身份或选表参数，请在页面读取后明确保存范围。",
      );
    const row = await this.sessions.create(requestMemberNo(req));
    return this.sessions.describe(requestMemberNo(req), row.id);
  }
  @Get(":id") get(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.sessions.describe(requestMemberNo(req), id);
  }
  @Patch(":id") update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.sessions.update(requestMemberNo(req), id, body);
  }
}
