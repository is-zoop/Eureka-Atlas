ALTER TABLE "semantic_dimension_catalog" ADD COLUMN "dataSource" TEXT NOT NULL DEFAULT '';
ALTER TABLE "semantic_dimension_catalog" ADD COLUMN "editedAt" TIMESTAMP(3);
