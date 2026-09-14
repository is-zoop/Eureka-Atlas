CREATE TYPE "ModelProviderKind" AS ENUM ('BUILTIN', 'CUSTOM');
CREATE TYPE "ModelTestStatus" AS ENUM ('UNTESTED', 'SUCCEEDED', 'FAILED');

CREATE TABLE "model_provider" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "ModelProviderKind" NOT NULL,
  "builtinId" TEXT,
  "protocol" TEXT NOT NULL,
  "baseUrl" TEXT,
  "apiKeyEncrypted" TEXT,
  "headers" JSONB NOT NULL DEFAULT '{}',
  "compat" JSONB NOT NULL DEFAULT '{}',
  "lastTestStatus" "ModelTestStatus" NOT NULL DEFAULT 'UNTESTED',
  "lastTestedAt" TIMESTAMP(3),
  "lastTestLatencyMs" INTEGER,
  "lastTestError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "model_provider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "model_config" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "displayName" TEXT,
  "protocol" TEXT NOT NULL,
  "contextWindow" INTEGER NOT NULL DEFAULT 128000,
  "maxTokens" INTEGER NOT NULL DEFAULT 16384,
  "reasoning" BOOLEAN NOT NULL DEFAULT false,
  "headers" JSONB NOT NULL DEFAULT '{}',
  "compat" JSONB NOT NULL DEFAULT '{}',
  "cost" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "model_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "model_provider_name_key" ON "model_provider"("name");
CREATE UNIQUE INDEX "model_provider_builtinId_key" ON "model_provider"("builtinId");
CREATE UNIQUE INDEX "model_config_providerId_modelId_key" ON "model_config"("providerId", "modelId");
CREATE INDEX "model_config_providerId_idx" ON "model_config"("providerId");
ALTER TABLE "model_config" ADD CONSTRAINT "model_config_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "model_provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
