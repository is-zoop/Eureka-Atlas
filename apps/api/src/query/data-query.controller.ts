import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import type { DataQueryRequest, DataDimensionValuesRequest } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";
import { DataQueryService } from "./data-query.service";
import { DataQueryExportService } from "./data-query-export.service";
@Controller("data-queries")
export class DataQueryController {
  constructor(private readonly queries: DataQueryService,private readonly exporter: DataQueryExportService) {}
  @Post() submit(@Req() req: AuthRequest,@Body() body: DataQueryRequest) {return this.queries.submit(requestMemberNo(req),body);}
  @Post("dimension-values") values(@Req() req: AuthRequest,@Body() body: DataDimensionValuesRequest) {return this.queries.dimensionValues(requestMemberNo(req),body);}
  @Get(":id") get(@Req() req: AuthRequest,@Param("id") id: string) {return this.queries.get(requestMemberNo(req),id);}
  @Get(":id/result") result(@Req() req: AuthRequest,@Param("id") id: string,@Query("page") page?: string,@Query("pageSize") size?: string) {return this.queries.result(requestMemberNo(req),id,page === undefined ? 1 : Number(page),size === undefined ? 100 : Number(size));}
  @Post(":id/cancel") cancel(@Req() req: AuthRequest,@Param("id") id: string) {return this.queries.cancel(requestMemberNo(req),id);}
  @Get(":id/export") async export(@Req() req: AuthRequest,@Param("id") id: string,@Res() response: Response) {
    const member = requestMemberNo(req);
    const item = await this.queries.ready(member,id);
    response.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition",`attachment; filename="data-query-${id}.xlsx"`);
    response.setHeader("Cache-Control","no-store");
    try {await this.exporter.write(member,item,response);} catch {response.destroy();}
  }
}
