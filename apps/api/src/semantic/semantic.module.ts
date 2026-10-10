import { Module } from "@nestjs/common";
import { SemanticController } from "./semantic.controller";
import { SemanticCatalogService } from "./semantic-catalog.service";
import { PackageModule } from "../package/package.module";
import { SelectableSemanticTablesService } from "./selectable-semantic-tables.service";

@Module({
  imports: [PackageModule],
  controllers: [SemanticController],
  providers: [SemanticCatalogService, SelectableSemanticTablesService],
  exports: [SemanticCatalogService, SelectableSemanticTablesService],
})
export class SemanticModule {}
