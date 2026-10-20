import { Module } from "@nestjs/common";
import { SemanticController } from "./semantic.controller";
import { SemanticCatalogService } from "./semantic-catalog.service";
import { PackageModule } from "../package/package.module";
import { SelectableSemanticTablesService } from "./selectable-semantic-tables.service";
import { SemanticScopeService } from "./semantic-scope.service";

@Module({
  imports: [PackageModule],
  controllers: [SemanticController],
  providers: [SemanticCatalogService, SelectableSemanticTablesService, SemanticScopeService],
  exports: [SemanticCatalogService, SelectableSemanticTablesService, SemanticScopeService],
})
export class SemanticModule {}
