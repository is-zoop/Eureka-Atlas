import { Controller, Get } from "@nestjs/common";
import { RequirePermission } from "../auth/permission.decorator";
import { ApiCenterService } from "./api-center.service";

@RequirePermission("api.access")
@Controller("api-center")
export class ApiCenterController {
  constructor(private readonly apiCenter: ApiCenterService) {}

  @Get()
  catalog() { return this.apiCenter.catalog(); }

  @Get("openapi")
  openapi() { return this.apiCenter.openapi(); }
}
