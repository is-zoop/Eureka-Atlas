import { Module } from "@nestjs/common";
import { ModelConfigModule } from "../model-config/model-config.module";
import { LlmService } from "./llm.service";

@Module({ imports: [ModelConfigModule], providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
