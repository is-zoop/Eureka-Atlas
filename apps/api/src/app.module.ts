import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DatasourceModule } from "./datasource/datasource.module";
import { GovernanceModule } from "./governance/governance.module";
import { LlmModule } from "./llm/llm.module";
import { MetadataModule } from "./metadata/metadata.module";
import { PackageModule } from "./package/package.module";
import { RuleModule } from "./rule/rule.module";
import { SemanticModule } from "./semantic/semantic.module";
import { HealthController } from "./common/health.controller";
import { SystemSettingsModule } from "./system-settings/system-settings.module";
import { ModelConfigModule } from "./model-config/model-config.module";
import { QueryModule } from "./query/query.module";
import { AskModule } from "./ask/ask.module";

@Module({
  imports: [
    AuthModule,
    DatasourceModule,
    MetadataModule,
    GovernanceModule,
    SemanticModule,
    PackageModule,
    LlmModule,
    RuleModule,
    SystemSettingsModule,
    ModelConfigModule,
    QueryModule,
    AskModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
