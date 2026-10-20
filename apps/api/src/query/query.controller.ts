import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { DimensionValuesRequest, QueryRequest } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { QueryExecutionService } from "./query-execution.service";

import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";

import { RequirePermission } from "../auth/permission.decorator";

@RequirePermission("query.use")
@Controller("queries")
export class QueryController {
  constructor(private readonly queries: QueryExecutionService) {}
  @Post() submit(@Req() request: AuthRequest, @Body() body: QueryRequest) { return this.queries.submit(requestMemberNo(request), body); }
  @Post("dimension-values") dimensionValues(@Req() request: AuthRequest, @Body() body: DimensionValuesRequest) { return this.queries.dimensionValues(requestMemberNo(request), body); }
  @Get(":queryId") get(@Req() request: AuthRequest, @Param("queryId") queryId: string) { return this.queries.get(requestMemberNo(request), queryId); }
  @Get(":queryId/result") result(@Req() request: AuthRequest, @Param("queryId") queryId: string) { return this.queries.result(requestMemberNo(request), queryId); }
  @Post(":queryId/cancel") cancel(@Req() request: AuthRequest, @Param("queryId") queryId: string) { return this.queries.cancel(requestMemberNo(request), queryId); }
}
