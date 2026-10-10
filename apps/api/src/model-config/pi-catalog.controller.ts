import { Body, Controller, Get, Post } from "@nestjs/common";
import { PiCatalogService } from "./pi-catalog.service";

@Controller("models/pi-catalog")
export class PiCatalogController {
  constructor(private readonly catalog: PiCatalogService) {}
  @Get() status() { return this.catalog.status(); }
  @Post() update(@Body() body: unknown) { return this.catalog.update(body); }
}
