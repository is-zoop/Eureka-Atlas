import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { RequirePermission } from "../auth/permission.decorator";
import { PluginPackageService } from "./plugin-package.service";
@RequirePermission("api.access")
@Controller("integrations/plugins")
export class PluginPackageController {
  constructor(private readonly packages: PluginPackageService) {}
  @Get() info() {
    return this.packages.info();
  }
  @Get(":client.zip") async download(
    @Param("client") client: string,
    @Query("rules_version") expected: string | undefined,
    @Res() response: Response,
  ) {
    const artifact = await this.packages.archive(client, expected);
    response.setHeader("Content-Type", "application/zip");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${artifact.filename}"`,
    );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Atlas-Rules-Version", artifact.rulesVersion);
    response.setHeader("X-Atlas-Archive-SHA256", artifact.sha256);
    response.send(artifact.buffer);
  }
}
