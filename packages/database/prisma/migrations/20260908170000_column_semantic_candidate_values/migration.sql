ALTER TABLE "column_semantic"
  ADD COLUMN "candidateValueQueryable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "labelDescription" TEXT;

UPDATE "column_semantic"
SET "groupable" = true,
    "candidateValueQueryable" = true
WHERE "semanticType" IN ('DIMENSION', 'LABEL');

UPDATE "column_semantic"
SET "groupable" = false,
    "candidateValueQueryable" = false,
    "labelDescription" = NULL
WHERE "semanticType" IN ('METRIC', 'PARTITION');
