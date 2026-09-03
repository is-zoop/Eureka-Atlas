import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { MetadataSyncService } from "./metadata-sync.service";

@Controller("metadata")
export class MetadataController {
  constructor(private readonly metadataService: MetadataSyncService) {}
  @Post("sync") sync(@Body() body: { dataSourceId?: string }) {
    if (!body.dataSourceId) throw new BadRequestException("dataSourceId is required");
    return this.metadataService.sync(body.dataSourceId);
  }
  @Get("tables") listTables(@Query() query: { q?: string; project?: string; type?: string; page?: string; pageSize?: string }) { return this.metadataService.listTables(query); }
  @Get("tables/:id") getTable(@Param("id") id: string) { return this.metadataService.getTable(id); }
  @Get("tables/:id/columns") listColumns(@Param("id") id: string) { return this.metadataService.listColumns(id); }
}
