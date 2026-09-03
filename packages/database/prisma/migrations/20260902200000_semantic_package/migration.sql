CREATE TABLE "semantic_package" (
    "id" TEXT NOT NULL,
    "metaTableId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "semantic_package_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "semantic_package_metaTableId_key" ON "semantic_package"("metaTableId");

ALTER TABLE "semantic_package" ADD CONSTRAINT "semantic_package_metaTableId_fkey" FOREIGN KEY ("metaTableId") REFERENCES "meta_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
