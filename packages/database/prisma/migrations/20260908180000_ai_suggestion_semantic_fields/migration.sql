ALTER TABLE "ai_table_suggestion"
  ADD COLUMN "dataDomain" TEXT,
  ADD COLUMN "permissionColumnId" TEXT,
  ADD COLUMN "permissionRelation" TEXT;

ALTER TABLE "ai_column_suggestion"
  ADD COLUMN "groupable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "candidateValueQueryable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "labelDescription" TEXT;
