CREATE TABLE "saved_data_query" (
    "id" TEXT NOT NULL,
    "ownerMemberNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "tableName" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "saved_data_query_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saved_data_query_ownerMemberNo_updatedAt_id_idx" ON "saved_data_query"("ownerMemberNo", "updatedAt", "id");
