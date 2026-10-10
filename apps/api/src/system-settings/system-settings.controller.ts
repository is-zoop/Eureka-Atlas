import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { SystemSettingsService } from "./system-settings.service";
import { ModelConfigService } from "../model-config/model-config.service";

@Controller("settings")
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService, private readonly models: ModelConfigService) {}
  @Get("ai-prompt") getAiPrompt() { return this.settings.aiPrompt(); }
  @Get("ask-prompt") getAskPrompt() { return this.settings.askPrompt(); }
  @Put("ask-prompt") saveAskPrompt(@Body() body: { prompt?: unknown }) { return this.settings.saveAskPrompt(body?.prompt); }
  @Delete("ask-prompt") resetAskPrompt() { return this.settings.resetAskPrompt(); }
  @Put("ai-prompt") saveAiPrompt(@Body() body: { prompt?: unknown }) { return this.settings.saveAiPrompt(body?.prompt); }
  @Delete("ai-prompt") resetAiPrompt() { return this.settings.resetAiPrompt(); }
  @Get("active-ai-model") activeAiModel() { return this.models.current(); }
  @Put("active-ai-model") setActiveAiModel(@Body() body: { modelId?: unknown }) { return this.models.setActive(body?.modelId); }
  @Get("governance-options") governanceOptionRecords() { return this.settings.governanceOptionRecords(); }
  @Post("governance-options") createGovernanceOption(@Body() body: unknown) { return this.settings.createGovernanceOption(body); }
  @Patch("governance-options/:id") updateGovernanceOption(@Param("id") id: string, @Body() body: unknown) { return this.settings.updateGovernanceOption(id, body); }
  @Delete("governance-options/:id") deleteGovernanceOption(@Param("id") id: string) { return this.settings.deleteGovernanceOption(id); }
}
