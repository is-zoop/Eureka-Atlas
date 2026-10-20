import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { MetadataSyncService, SyncSpaceInput } from "./metadata-sync.service";

import { RequirePermission } from "../auth/permission.decorator";

@RequirePermission("assets.read")
@Controller("metadata")
export class MetadataController {
  constructor(private readonly metadataService: MetadataSyncService) {}
  @RequirePermission("system.manage")
  @Post("sync") sync(@Body() body: { dataSourceId?: string; spaces?: SyncSpaceInput[] }) {
    if (!body.dataSourceId) throw new BadRequestException("dataSourceId is required");
    if (!Array.isArray(body.spaces) || !body.spaces.length)
      throw new BadRequestException("至少选择一个数据空间");
    return this.metadataService.startSync(body.dataSourceId, body.spaces);
  }
  @Get("tables") listTables(@Query() query: { q?: string; space?: string; sourceId?: string; type?: string; governanceStatus?: "COMPLETED" | "DRAFT" | "UNGOVERNED"; page?: string; pageSize?: string }) { return this.metadataService.listTables(query); }
  @Get("tables/:id") getTable(@Param("id") id: string) { return this.metadataService.getTable(id); }
  @Get("tables/:id/columns") listColumns(@Param("id") id: string) { return this.metadataService.listColumns(id); }
}
