/* eslint-disable @typescript-eslint/no-explicit-any -- Nest passes Express request/response for SSE and binary exports. */
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { AskClarificationRequest, AskRunCreateRequest, AskSessionCreateRequest, AskSessionUpdateRequest } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { AskEventService } from "./ask-event.service";
import { AskExportService } from "./ask-export.service";
import { AskRunService } from "./ask-run.service";
import { AuthService } from "../auth/auth.service";
import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";

import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";

@Controller("ask")
export class AskController {
  constructor(private readonly runs: AskRunService, private readonly events: AskEventService, private readonly exporter: AskExportService, private readonly auth: AuthService) {}

  @Get("sessions")
  sessions(@Req() request: AuthRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.runs.listSessions(requestMemberNo(request), cursor, Number(limit) || 20); }
  @Post("sessions")
  createSession(@Req() request: AuthRequest, @Body() input: AskSessionCreateRequest) { return this.runs.createSession(requestMemberNo(request), input); }
  @Get("sessions/:sessionId")
  session(@Req() request: AuthRequest, @Param("sessionId") sessionId: string) { return this.runs.session(requestMemberNo(request), sessionId); }
  @Patch("sessions/:sessionId")
  updateSession(@Req() request: AuthRequest, @Param("sessionId") sessionId: string, @Body() input: AskSessionUpdateRequest) { return this.runs.updateSession(requestMemberNo(request), sessionId, input); }
  @Delete("sessions/:sessionId")
  @HttpCode(204)
  deleteSession(@Req() request: AuthRequest, @Param("sessionId") sessionId: string) { return this.runs.deleteSession(requestMemberNo(request), sessionId); }
  @Get("sessions/:sessionId/runs")
  runsForSession(@Req() request: AuthRequest, @Param("sessionId") sessionId: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string) { return this.runs.listRuns(requestMemberNo(request), sessionId, cursor, Number(limit) || 20); }
  @Post("sessions/:sessionId/runs")
  createRun(@Req() request: AuthRequest, @Param("sessionId") sessionId: string, @Body() input: AskRunCreateRequest) { return this.runs.create(requestMemberNo(request), sessionId, input); }

  @Get("runs/:runId")
  get(@Req() request: AuthRequest, @Param("runId") runId: string) { return this.runs.detail(requestMemberNo(request), runId); }

  @Get("runs/:runId/events")
  @Header("Content-Type", "text/event-stream")
  async stream(@Param("runId") runId: string, @Query("after") after: string | undefined, @Req() request: AuthRequest, @Res() response: any) {
    const memberNo = requestMemberNo(request);
    await this.runs.assertRunOwnership(memberNo, runId);
    response.setHeader("Cache-Control", "no-cache, no-transform"); response.setHeader("Connection", "keep-alive"); response.flushHeaders?.();
    const last = Math.max(Number.parseInt(after ?? "0", 10) || 0, Number.parseInt(String(request.headers["last-event-id"] ?? "0"), 10) || 0);
    const seen = new Set<number>();
    let closed = false;
    let validating = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined = undefined;
    let unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(heartbeat); unsubscribe(); response.end();
    };
    response.on("close", close);
    const write = (event: Awaited<ReturnType<AskEventService["after"]>>[number]) => { if (closed || response.writableEnded || seen.has(event.sequence)) return; seen.add(event.sequence); response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
    let replaying = true;
    const pending: Awaited<ReturnType<AskEventService["after"]>> = [];
    unsubscribe = this.events.subscribe(runId, (event) => { if (!closed) { if (replaying) pending.push(event); else write(event); } });
    try { (await this.events.after(runId, last)).forEach(write); }
    catch (error) { close(); throw error; }
    if (closed) return;
    pending.sort((a, b) => a.sequence - b.sequence).forEach(write);
    replaying = false;
    heartbeat = setInterval(() => {
      if (closed || validating) return;
      validating = true;
      void this.auth.authenticate(request).then(async (user) => {
        if (user.member_no !== memberNo) throw new ForbiddenException("登录账号已变化");
        await this.runs.assertRunOwnership(memberNo, runId);
        if (!closed) response.write(": keepalive\n\n");
      }).catch((error: unknown) => {
        if (closed) return;
        const event = error instanceof UnauthorizedException ? "auth-expired" : error instanceof ForbiddenException ? "auth-changed" : error instanceof NotFoundException ? "resource-unavailable" : "auth-unavailable";
        response.write(`event: ${event}\ndata: {}\n\n`);
        close();
      }).finally(() => { validating = false; });
    }, 20_000);
  }

  @Post("runs/:runId/clarifications")
  clarify(@Req() request: AuthRequest, @Param("runId") runId: string, @Body() input: AskClarificationRequest) { return this.runs.clarify(requestMemberNo(request), runId, input); }
  @Post("runs/:runId/cancel")
  @HttpCode(200)
  cancel(@Req() request: AuthRequest, @Param("runId") runId: string) { return this.runs.cancel(requestMemberNo(request), runId); }
  @Get("runs/:runId/queries/:queryId/result")
  result(@Req() request: AuthRequest, @Param("runId") runId: string, @Param("queryId") queryId: string) { return this.runs.queryResult(requestMemberNo(request), runId, queryId); }

  @Get("runs/:runId/queries/:queryId/export")
  async export(@Req() request: AuthRequest, @Param("runId") runId: string, @Param("queryId") queryId: string, @Res() response: any) {
    const result = await this.runs.queryResult(requestMemberNo(request), runId, queryId);
    const content = await this.exporter.workbook(result);
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename="eureka-atlas-${queryId}.xlsx"`);
    response.send(Buffer.from(content));
  }
}
