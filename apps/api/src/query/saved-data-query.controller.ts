import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { SavedDataQueryConfig } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import type { AuthRequest } from "../auth/auth.types";
import { requestMemberNo } from "../auth/member-no";
import { SavedDataQueryService } from "./saved-data-query.service";

import { RequirePermission } from "../auth/permission.decorator";

@RequirePermission("query.use")
@Controller("saved-data-queries")
export class SavedDataQueryController {
  constructor(private readonly saved: SavedDataQueryService) {}
  @Post() create(@Req() req: AuthRequest, @Body() body: { name: string; config: SavedDataQueryConfig }) { return this.saved.create(requestMemberNo(req), body); }
  @Get() list(@Req() req: AuthRequest, @Query("keyword") keyword?: string, @Query("page") page?: string, @Query("pageSize") size?: string) { return this.saved.list(requestMemberNo(req), keyword, page === undefined ? 1 : Number(page), size === undefined ? 20 : Number(size)); }
  @Get(":id") get(@Req() req: AuthRequest, @Param("id") id: string) { return this.saved.get(requestMemberNo(req), id); }
  @Patch(":id") update(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: { name: string; config: SavedDataQueryConfig }) { return this.saved.update(requestMemberNo(req), id, body); }
  @Delete(":id") remove(@Req() req: AuthRequest, @Param("id") id: string) { return this.saved.remove(requestMemberNo(req), id); }
}
