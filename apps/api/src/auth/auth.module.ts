import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DatasourceModule } from "../datasource/datasource.module";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { HazeAuthService } from "./haze-auth.service";

@Global()
@Module({
  imports: [DatasourceModule], controllers: [AuthController],
  providers: [AuthService, HazeAuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
