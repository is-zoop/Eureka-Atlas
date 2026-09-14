import { Module } from "@nestjs/common";
import { ModelConfigModule } from "../model-config/model-config.module";
import { SystemSettingsController } from "./system-settings.controller";
import { SystemSettingsService } from "./system-settings.service";

@Module({ imports: [ModelConfigModule], controllers: [SystemSettingsController], providers: [SystemSettingsService], exports: [SystemSettingsService] })
export class SystemSettingsModule {}
