import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { AuthRequest } from "../auth/auth.types";
import { ExternalApi } from "../auth/external-api.decorator";
import { RequirePermission } from "../auth/permission.decorator";
import { requestMemberNo } from "../auth/member-no";
import { ExternalLimitsGuard } from "../external-api/external-limits";
import { AgentSessionsService } from "./agent-sessions.service";
@ExternalApi()
@RequirePermission("query.use")
@UseGuards(ExternalLimitsGuard)
@Controller("integrations/selection-native")
export class SelectionNativeController {
  constructor(private readonly sessions: AgentSessionsService) {}
  @Post("open") async open(@Req() req: AuthRequest, @Body() input: unknown) {
    const body = input as { conversation_id?: unknown };
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => k !== "conversation_id") ||
      typeof body.conversation_id !== "string"
    )
      throw new BadRequestException(
        "需要当前客户端对话标识，不接受用户身份参数。",
      );
    const memberNo = requestMemberNo(req),
      row = await this.sessions.bound(memberNo, body.conversation_id);
    return {
      member_no: memberNo,
      session: await this.sessions.describe(memberNo, row.id),
    };
  }
  @Get(":id") async read(@Req() req: AuthRequest, @Param("id") id: string) {
    const memberNo = requestMemberNo(req);
    return {
      member_no: memberNo,
      session: await this.sessions.describe(memberNo, id),
    };
  }
  @Patch(":id") async update(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const memberNo = requestMemberNo(req);
    return {
      member_no: memberNo,
      session: await this.sessions.update(memberNo, id, input),
    };
  }
}
