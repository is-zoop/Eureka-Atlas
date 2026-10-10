import { Module } from "@nestjs/common";
import { DatasourceModule } from "../datasource/datasource.module";
import { PiCatalogController } from "./pi-catalog.controller";
import { PiCatalogService } from "./pi-catalog.service";
import { SubscriptionAuthController } from "./subscription-auth.controller";
import { SubscriptionAuthService } from "./subscription-auth.service";
import { ModelConfigController } from "./model-config.controller";
import { ModelConfigService } from "./model-config.service";

@Module({ imports: [DatasourceModule], controllers: [ModelConfigController, SubscriptionAuthController, PiCatalogController], providers: [ModelConfigService, SubscriptionAuthService, PiCatalogService], exports: [ModelConfigService] })
export class ModelConfigModule {}
