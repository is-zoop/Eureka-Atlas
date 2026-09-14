CREATE TYPE "SemanticCatalogStatus" AS ENUM ('PUBLISHED', 'ARCHIVED');
CREATE TYPE "SemanticMetricCatalogType" AS ENUM ('ATOMIC', 'DERIVED', 'MIXED');

CREATE TABLE "semantic_metric_catalog" (
  "id" TEXT NOT NULL, "normalizedName" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '', "type" "SemanticMetricCatalogType" NOT NULL DEFAULT 'ATOMIC',
  "unit" TEXT, "aliases" JSONB NOT NULL DEFAULT '[]', "category" TEXT, "owner" TEXT, "usageNotes" TEXT,
  "status" "SemanticCatalogStatus" NOT NULL DEFAULT 'PUBLISHED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "semantic_metric_catalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "semantic_metric_catalog_normalizedName_key" ON "semantic_metric_catalog"("normalizedName");
CREATE INDEX "semantic_metric_catalog_status_name_idx" ON "semantic_metric_catalog"("status", "name");

CREATE TABLE "semantic_metric_binding" (
  "id" TEXT NOT NULL, "metricCatalogId" TEXT NOT NULL, "columnSemanticId" TEXT, "semanticMetricId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "semantic_metric_binding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "semantic_metric_binding_columnSemanticId_key" ON "semantic_metric_binding"("columnSemanticId");
CREATE UNIQUE INDEX "semantic_metric_binding_semanticMetricId_key" ON "semantic_metric_binding"("semanticMetricId");
CREATE INDEX "semantic_metric_binding_metricCatalogId_idx" ON "semantic_metric_binding"("metricCatalogId");
ALTER TABLE "semantic_metric_binding" ADD CONSTRAINT "semantic_metric_binding_metricCatalogId_fkey" FOREIGN KEY ("metricCatalogId") REFERENCES "semantic_metric_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semantic_metric_binding" ADD CONSTRAINT "semantic_metric_binding_columnSemanticId_fkey" FOREIGN KEY ("columnSemanticId") REFERENCES "column_semantic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semantic_metric_binding" ADD CONSTRAINT "semantic_metric_binding_semanticMetricId_fkey" FOREIGN KEY ("semanticMetricId") REFERENCES "semantic_metric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "semantic_dimension_catalog" (
  "id" TEXT NOT NULL, "normalizedName" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "aliases" JSONB NOT NULL DEFAULT '[]', "category" TEXT, "owner" TEXT, "usageNotes" TEXT,
  "status" "SemanticCatalogStatus" NOT NULL DEFAULT 'PUBLISHED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "semantic_dimension_catalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "semantic_dimension_catalog_normalizedName_key" ON "semantic_dimension_catalog"("normalizedName");
CREATE INDEX "semantic_dimension_catalog_status_name_idx" ON "semantic_dimension_catalog"("status", "name");

CREATE TABLE "semantic_dimension_binding" (
  "id" TEXT NOT NULL, "dimensionCatalogId" TEXT NOT NULL, "columnSemanticId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "semantic_dimension_binding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "semantic_dimension_binding_columnSemanticId_key" ON "semantic_dimension_binding"("columnSemanticId");
CREATE INDEX "semantic_dimension_binding_dimensionCatalogId_idx" ON "semantic_dimension_binding"("dimensionCatalogId");
ALTER TABLE "semantic_dimension_binding" ADD CONSTRAINT "semantic_dimension_binding_dimensionCatalogId_fkey" FOREIGN KEY ("dimensionCatalogId") REFERENCES "semantic_dimension_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semantic_dimension_binding" ADD CONSTRAINT "semantic_dimension_binding_columnSemanticId_fkey" FOREIGN KEY ("columnSemanticId") REFERENCES "column_semantic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
