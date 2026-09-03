import { Module } from "@nestjs/common";
import { DatasourceModule } from "../datasource/datasource.module";
import { MetadataController } from "./metadata.controller";
import { MetadataSyncService } from "./metadata-sync.service";

@Module({ imports: [DatasourceModule], controllers: [MetadataController], providers: [MetadataSyncService] })
export class MetadataModule {}
