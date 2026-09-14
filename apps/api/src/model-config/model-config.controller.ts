import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ModelConfigService } from "./model-config.service";

@Controller("models")
export class ModelConfigController {
  constructor(private readonly models: ModelConfigService) {}
  @Get() list() { return this.models.list(); }
  @Get("builtin-catalog") builtinCatalog() { return this.models.builtinCatalog(); }
  @Post("providers") createProvider(@Body() body: unknown) { return this.models.createProvider(body); }
  @Patch("providers/:id") updateProvider(@Param("id") id: string, @Body() body: unknown) { return this.models.updateProvider(id, body); }
  @Delete("providers/:id") removeProvider(@Param("id") id: string) { return this.models.removeProvider(id); }
  @Post("providers/:id/discover") discover(@Param("id") id: string) { return this.models.discover(id); }
  @Post("providers/:id/models") createModel(@Param("id") id: string, @Body() body: unknown) { return this.models.createModel(id, body); }
  @Patch("model-configs/:id") updateModel(@Param("id") id: string, @Body() body: unknown) { return this.models.updateModel(id, body); }
  @Delete("model-configs/:id") removeModel(@Param("id") id: string) { return this.models.removeModel(id); }
  @Post("model-configs/:id/test") test(@Param("id") id: string) { return this.models.test(id); }
  @Get("available") available() { return this.models.available(); }
}
