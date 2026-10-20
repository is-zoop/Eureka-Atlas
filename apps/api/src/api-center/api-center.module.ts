import { Module } from "@nestjs/common";
import { ApiCenterController } from "./api-center.controller";
import { ApiCenterService } from "./api-center.service";
import { ExternalApiModule } from "../external-api/external-api.module";

@Module({ imports: [ExternalApiModule], controllers: [ApiCenterController], providers: [ApiCenterService] })
export class ApiCenterModule {}
