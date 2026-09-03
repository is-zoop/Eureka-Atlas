import { Module } from "@nestjs/common";
import { DatasourceModule } from "./datasource/datasource.module";
import { GovernanceModule } from "./governance/governance.module";
import { LlmModule } from "./llm/llm.module";
import { MetadataModule } from "./metadata/metadata.module";
import { PackageModule } from "./package/package.module";
import { RuleModule } from "./rule/rule.module";
import { SemanticModule } from "./semantic/semantic.module";
import { HealthController } from "./common/health.controller";

@Module({
  imports: [
    DatasourceModule,
    MetadataModule,
    GovernanceModule,
    SemanticModule,
    PackageModule,
    LlmModule,
    RuleModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
