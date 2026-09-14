import { Module } from "@nestjs/common";
import { SemanticController } from "./semantic.controller";
import { SemanticCatalogService } from "./semantic-catalog.service";

@Module({ controllers: [SemanticController], providers: [SemanticCatalogService], exports: [SemanticCatalogService] })
export class SemanticModule {}
