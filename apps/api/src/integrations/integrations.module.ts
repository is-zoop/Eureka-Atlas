import { Module } from "@nestjs/common";
import { DatasourceModule } from "../datasource/datasource.module";
import { SelectionAccessService } from "./selection-access.service";
import { SelectionBrowserController } from "./selection-browser.controller";
import { SelectionNativeController } from "./selection-native.controller";
import { SemanticModule } from "../semantic/semantic.module";
import { ExternalApiModule } from "../external-api/external-api.module";
import { AgentSessionsController } from "./agent-sessions.controller";
import { AgentSessionsService } from "./agent-sessions.service";
import { McpController } from "./mcp.controller";
import { McpToolsService } from "./mcp-tools.service";
import { McpDataService } from "./mcp-data.service";
import { SystemSettingsModule } from "../system-settings/system-settings.module";
import { PluginPackageController } from "./plugin-package.controller";
import { PluginPackageService } from "./plugin-package.service";
@Module({
  imports: [
    SemanticModule,
    ExternalApiModule,
    SystemSettingsModule,
    DatasourceModule,
  ],
  controllers: [
    AgentSessionsController,
    SelectionBrowserController,
    SelectionNativeController,
    McpController,
    PluginPackageController,
  ],
  providers: [
    AgentSessionsService,
    SelectionAccessService,
    McpToolsService,
    McpDataService,
    PluginPackageService,
  ],
  exports: [AgentSessionsService],
})
export class IntegrationsModule {}
