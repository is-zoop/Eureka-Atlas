import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";
import { resolve } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  config({ path: resolve(__dirname, "../../../.env") });
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:3000", "http://127.0.0.1:3000"],
  });
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
