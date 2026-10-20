import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import type { ExternalDimensionValuesRequest, ExternalQueryRequest, SemanticSearchRequest } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { ExternalApi } from "../auth/external-api.decorator";
import { RequirePermission } from "../auth/permission.decorator";
import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";
import { ExternalDataService } from "./external-data.service";
import { ExternalContractService } from "./external-contract.service";
import { ExternalResponseInterceptor } from "./external-http";
import { ExternalLimitsGuard } from "./external-limits";

@ExternalApi()
@UseInterceptors(ExternalResponseInterceptor)
@UseGuards(ExternalLimitsGuard)
@RequirePermission("api.access")
@Controller("external/v1")
export class ExternalApiController {
  constructor(private readonly data: ExternalDataService, private readonly contracts: ExternalContractService) {}

  @Post("semantic/search") @HttpCode(200)
  async search(@Body() input: unknown) { return this.data.search(await this.contracts.validate<SemanticSearchRequest>("search", input)); }

  @Get("semantic/packages/:tableId")
  async package(@Param("tableId") id: string, @Query() query: unknown) { await this.contracts.validate("package", query, { tableId: id }); return this.data.package(id); }

  @Post("queries") @HttpCode(202)
  async query(@Req() request: AuthRequest, @Body() input: unknown) { return this.data.submit(requestMemberNo(request), await this.contracts.validate<ExternalQueryRequest>("query", input)); }

  @Post("queries/dimension-values") @HttpCode(202)
  async dimensionValues(@Req() request: AuthRequest, @Body() input: unknown) { return this.data.submit(requestMemberNo(request), await this.contracts.validate<ExternalDimensionValuesRequest>("dimensionValues", input), true); }

  @Get("queries/:queryId")
  async status(@Req() request: AuthRequest, @Param("queryId") id: string, @Query() query: unknown) { await this.contracts.validate("status", query, { queryId: id }); return this.data.status(requestMemberNo(request), id); }

  @Get("queries/:queryId/result")
  async result(@Req() request: AuthRequest, @Param("queryId") id: string, @Query() query: unknown) { await this.contracts.validate("result", query, { queryId: id }); return this.data.result(requestMemberNo(request), id); }

  @Post("queries/:queryId/cancel") @HttpCode(200)
  async cancel(@Req() request: AuthRequest, @Param("queryId") id: string, @Body() input: unknown) { await this.contracts.validate("cancel", input ?? {}, { queryId: id }); return this.data.cancel(requestMemberNo(request), id); }
}
