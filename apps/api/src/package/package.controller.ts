import { Controller, Get, Param, Post } from "@nestjs/common";
import { PackageService } from "./package.service";

@Controller("packages")
export class PackageController {
  constructor(private readonly packageService: PackageService) {}

  @Post("generate/:tableId")
  generate(@Param("tableId") tableId: string) { return this.packageService.generate(tableId); }

  @Get(":tableId")
  get(@Param("tableId") tableId: string) { return this.packageService.get(tableId); }
}
