import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator";
import {
  ExternalLimitsService,
  EXTERNAL_LIMITS,
} from "../external-api/external-limits";
import { AgentSessionsService } from "./agent-sessions.service";
import { SelectionAccessService } from "./selection-access.service";

// This route deliberately never uses the workbench's login Cookie or Bearer fallback.
// Every operation authenticates a separate, scope-bound selection authorization.
@Public()
@Controller("integrations/selection-browser/:viewId")
export class SelectionBrowserController {
  constructor(
    private readonly access: SelectionAccessService,
    private readonly sessions: AgentSessionsService,
    private readonly limits: ExternalLimitsService,
  ) {}
  private prepare(request: Request, response: Response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (
      Object.keys(request.query).length ||
      Buffer.byteLength(JSON.stringify(request.body ?? {})) >
        EXTERNAL_LIMITS.request_bytes
    )
      throw new BadRequestException(
        "请使用规定的 JSON 参数，不支持额外查询参数。",
      );
  }
  @Post("exchange") async exchange(
    @Param("viewId") id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.prepare(req, res);
    const data = await this.access.exchange(id, body, req, res);
    this.limits.consume(data.member_no, res);
    return data;
  }
  @Get() async read(
    @Param("viewId") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.prepare(req, res);
    const { user, view } = await this.access.authorize(id, req, res);
    this.limits.consume(user.member_no, res);
    return this.access.describe(
      user.member_no,
      view.id,
      view.agentQuerySessionId,
    );
  }
  @Patch() async update(
    @Param("viewId") id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.prepare(req, res);
    const { user, view } = await this.access.authorize(id, req, res);
    this.limits.consume(user.member_no, res);
    await this.sessions.update(user.member_no, view.agentQuerySessionId, body);
    return this.access.describe(
      user.member_no,
      view.id,
      view.agentQuerySessionId,
    );
  }
  @Delete() async revoke(
    @Param("viewId") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.prepare(req, res);
    return this.access.revoke(id, req, res);
  }
}
