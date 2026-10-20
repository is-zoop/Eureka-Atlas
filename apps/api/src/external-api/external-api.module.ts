import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { SemanticModule } from "../semantic/semantic.module";
import { QueryModule } from "../query/query.module";
import { ExternalApiController } from "./external-api.controller";
import { ExternalDataService } from "./external-data.service";
import { ExternalContractService } from "./external-contract.service";
import { ExternalExceptionFilter, ExternalResponseInterceptor } from "./external-http";
import { ExternalLimitsService, ExternalLimitsGuard } from "./external-limits";

@Module({ imports: [SemanticModule, QueryModule], controllers: [ExternalApiController], providers: [ExternalLimitsService, ExternalLimitsGuard, ExternalDataService, ExternalContractService, ExternalResponseInterceptor, { provide: APP_FILTER, useClass: ExternalExceptionFilter }], exports: [ExternalContractService, ExternalLimitsService, ExternalLimitsGuard, ExternalDataService] })
export class ExternalApiModule {}
