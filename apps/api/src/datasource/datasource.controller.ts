import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  CreateDataSourceInput,
  DatasourceService,
  UpdateDataSourceInput,
} from "./datasource.service";

import { RequirePermission } from "../auth/permission.decorator";

@RequirePermission("system.manage")
@Controller("datasources")
export class DatasourceController {
  constructor(private readonly datasourceService: DatasourceService) {}

  @Post()
  create(@Body() input: CreateDataSourceInput) {
    return this.datasourceService.create(input);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() input: UpdateDataSourceInput) {
    return this.datasourceService.update(id, input);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.datasourceService.remove(id);
  }

  @Get()
  list() {
    return this.datasourceService.list();
  }

  @Get(":id/spaces")
  listSyncSpaces(@Param("id") id: string) {
    return this.datasourceService.listSyncSpaces(id);
  }

  @Post(":id/spaces/refresh")
  refreshSyncSpaces(@Param("id") id: string) {
    return this.datasourceService.refreshSyncSpaces(id);
  }

  @Post("test-connection")
  testConnection(@Body() input: CreateDataSourceInput & { id?: unknown }) {
    return this.datasourceService.testConnection(input);
  }
}
