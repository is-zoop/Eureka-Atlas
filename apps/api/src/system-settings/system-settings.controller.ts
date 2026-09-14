import { Body, Controller, Delete, Get, Put } from "@nestjs/common";
import { SystemSettingsService } from "./system-settings.service";
import { ModelConfigService } from "../model-config/model-config.service";

@Controller("settings")
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService, private readonly models: ModelConfigService) {}
  @Get("ai-prompt") getAiPrompt() { return this.settings.aiPrompt(); }
  @Put("ai-prompt") saveAiPrompt(@Body() body: { prompt?: unknown }) { return this.settings.saveAiPrompt(body?.prompt); }
  @Delete("ai-prompt") resetAiPrompt() { return this.settings.resetAiPrompt(); }
  @Get("active-ai-model") activeAiModel() { return this.models.current(); }
  @Put("active-ai-model") setActiveAiModel(@Body() body: { modelId?: unknown }) { return this.models.setActive(body?.modelId); }
  @Get("governance-options") governanceOptions() { return this.settings.governanceOptions(); }
  @Put("governance-options") saveGovernanceOptions(@Body() body: unknown) { return this.settings.saveGovernanceOptions(body); }
}
