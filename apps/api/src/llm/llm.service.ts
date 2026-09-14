import { Injectable } from "@nestjs/common";
import { ModelConfigService } from "../model-config/model-config.service";

@Injectable()
export class LlmService {
  constructor(private readonly models: ModelConfigService) {}
  async complete(system: string, user: string, signal?: AbortSignal): Promise<string> {
    return this.models.completeActive(system, user, signal);
  }
}
