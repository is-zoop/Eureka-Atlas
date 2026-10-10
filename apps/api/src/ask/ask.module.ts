import { Module } from "@nestjs/common";
import { ModelConfigModule } from "../model-config/model-config.module";
import { PackageModule } from "../package/package.module";
import { QueryModule } from "../query/query.module";
import { SemanticModule } from "../semantic/semantic.module";
import { SystemSettingsModule } from "../system-settings/system-settings.module";
import { AskController } from "./ask.controller";
import { AskEventService } from "./ask-event.service";
import { AskExportService } from "./ask-export.service";
import { AskRunService } from "./ask-run.service";
import { AskScopeService } from "./ask-scope.service";

@Module({ imports: [SemanticModule, PackageModule, QueryModule, ModelConfigModule, SystemSettingsModule], controllers: [AskController], providers: [AskEventService, AskExportService, AskScopeService, AskRunService] })
export class AskModule {}