import { Module } from "@nestjs/common";
import { DatasourceModule } from "../datasource/datasource.module";
import { PackageModule } from "../package/package.module";
import { DataQueryController } from "./data-query.controller";
import { DataQueryService } from "./data-query.service";
import { DataQueryExportService } from "./data-query-export.service";
import { MaxComputeResultReader } from "./maxcompute-result-reader";
import { QueryCompilerService } from "./query-compiler.service";
import { QueryController } from "./query.controller";
import { QueryExecutionService } from "./query-execution.service";
import { SavedDataQueryController } from "./saved-data-query.controller";
import { SavedDataQueryService } from "./saved-data-query.service";

@Module({ imports: [DatasourceModule, PackageModule], controllers: [QueryController, DataQueryController, SavedDataQueryController], providers: [QueryCompilerService, QueryExecutionService, DataQueryService, DataQueryExportService, MaxComputeResultReader, SavedDataQueryService], exports: [QueryExecutionService] })
export class QueryModule {}
