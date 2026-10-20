import { Controller, Get, Param, Post } from "@nestjs/common";
import { PackageService } from "./package.service";

import { RequirePermission } from "../auth/permission.decorator";

@RequirePermission("governance.write")
@Controller("packages")
export class PackageController {
  constructor(private readonly packageService: PackageService) {}

  @Post("generate/:tableId")
  generate(@Param("tableId") tableId: string) { return this.packageService.generate(tableId); }

  @RequirePermission("assets.read")
  @Get(":tableId")
  get(@Param("tableId") tableId: string) { return this.packageService.get(tableId); }
}
