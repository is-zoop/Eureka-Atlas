import { Module } from "@nestjs/common";
import { CredentialCryptoService } from "./credential-crypto.service";
import { DatasourceController } from "./datasource.controller";
import { DatasourceService } from "./datasource.service";

@Module({ controllers: [DatasourceController], providers: [CredentialCryptoService, DatasourceService], exports: [DatasourceService] })
export class DatasourceModule {}
