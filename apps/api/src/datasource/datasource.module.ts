import { Module } from "@nestjs/common";
import { CredentialCryptoService } from "./credential-crypto.service";
import { DatasourceController } from "./datasource.controller";
import { DatasourceService } from "./datasource.service";
import { DataSourceAdapterFactory } from "../metadata/database-adapters";

@Module({ controllers: [DatasourceController], providers: [CredentialCryptoService, DataSourceAdapterFactory, DatasourceService], exports: [CredentialCryptoService, DatasourceService, DataSourceAdapterFactory] })
export class DatasourceModule {}
