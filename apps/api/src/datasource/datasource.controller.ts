import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateDataSourceInput, DatasourceService } from "./datasource.service";

@Controller("datasources")
export class DatasourceController {
  constructor(private readonly datasourceService: DatasourceService) {}

  @Post()
  create(@Body() input: CreateDataSourceInput) { return this.datasourceService.create(input); }

  @Get()
  list() { return this.datasourceService.list(); }

  @Post(":id/test")
  test(@Param("id") id: string) { return this.datasourceService.test(id); }
}
