import { Module } from "@nestjs/common";
import { DatasourceModule } from "../datasource/datasource.module";
import { ModelConfigController } from "./model-config.controller";
import { ModelConfigService } from "./model-config.service";

@Module({ imports: [DatasourceModule], controllers: [ModelConfigController], providers: [ModelConfigService], exports: [ModelConfigService] })
export class ModelConfigModule {}
