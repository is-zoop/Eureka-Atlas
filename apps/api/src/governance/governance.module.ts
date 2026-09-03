import { Module } from "@nestjs/common";
import { GovernanceController, GovernanceWorkspaceController } from "./governance.controller";
import { GovernanceService } from "./governance.service";
import { LlmModule } from "../llm/llm.module";
import { GovernanceAiService } from "./governance-ai.service";
import { PackageModule } from "../package/package.module";
import { GovernanceWorkspaceService } from "./governance-workspace.service";

@Module({ imports: [LlmModule, PackageModule], controllers: [GovernanceController, GovernanceWorkspaceController], providers: [GovernanceService, GovernanceAiService, GovernanceWorkspaceService] })
export class GovernanceModule {}
