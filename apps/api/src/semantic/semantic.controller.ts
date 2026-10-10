import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { SemanticCatalogService } from "./semantic-catalog.service";
import { SelectableSemanticTablesService } from "./selectable-semantic-tables.service";

@Controller("semantic")
export class SemanticController {
  constructor(
    private readonly catalogs: SemanticCatalogService,
    private readonly selectableTables: SelectableSemanticTablesService,
  ) {}
  @Get("queryable-tables") queryableTables() { return this.selectableTables.list(); }
  @Get("metrics") metrics(@Query() query: Record<string, unknown>) { return this.catalogs.metrics(query); }
  @Get("metrics/:id") metric(@Param("id") id: string) { return this.catalogs.metric(id); }
  @Patch("metrics/:id") updateMetric(@Param("id") id: string, @Body() body: Record<string, unknown>) { return this.catalogs.updateMetric(id, body); }
  @Get("dimensions") dimensions(@Query() query: Record<string, unknown>) { return this.catalogs.dimensions(query); }
  @Get("dimensions/:id") dimension(@Param("id") id: string) { return this.catalogs.dimension(id); }
  @Patch("dimensions/:id") updateDimension(@Param("id") id: string, @Body() body: Record<string, unknown>) { return this.catalogs.updateDimension(id, body); }
}
