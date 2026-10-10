import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";
import { resolve } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  config({ path: resolve(__dirname, "../../../.env") });
  const app = await NestFactory.create(AppModule);
  const { DocumentBuilder, SwaggerModule } = await import("@nestjs/swagger");
  app.setGlobalPrefix("api");
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Eureka Atlas API")
      .setDescription("Eureka Atlas 数据语义治理平台接口文档")
      .setVersion("1.0")
      .build(),
  );

  SwaggerModule.setup("docs", app, document, {
    useGlobalPrefix: true,
    jsonDocumentUrl: "docs-json",
  });
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",").map(value => value.trim()) ?? ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
