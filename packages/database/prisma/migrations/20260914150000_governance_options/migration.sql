CREATE TYPE "GovernanceOptionType" AS ENUM ('DATA_DOMAIN', 'PERMISSION_RELATION');

CREATE TABLE "governance_option" (
    "id" TEXT NOT NULL,
    "type" "GovernanceOptionType" NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governance_option_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "governance_option_type_value_key" ON "governance_option"("type", "value");
CREATE INDEX "governance_option_type_idx" ON "governance_option"("type");

INSERT INTO "governance_option" ("id", "type", "value", "description", "updatedBy", "createdAt", "updatedAt")
SELECT
    md5(random()::text || clock_timestamp()::text || item.value),
    CASE source."key"
        WHEN 'governance_data_domains' THEN 'DATA_DOMAIN'::"GovernanceOptionType"
        ELSE 'PERMISSION_RELATION'::"GovernanceOptionType"
    END,
    item.value,
    '',
    'admin',
    source."createdAt",
    source."updatedAt"
FROM "system_setting" AS source
CROSS JOIN LATERAL jsonb_array_elements_text(source."value"::jsonb) AS item(value)
WHERE source."key" IN ('governance_data_domains', 'governance_permission_relations')
  AND jsonb_typeof(source."value"::jsonb) = 'array'
  AND btrim(item.value) <> '';

INSERT INTO "governance_option" ("id", "type", "value", "description", "updatedBy", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || item.value), 'DATA_DOMAIN'::"GovernanceOptionType", item.value, '', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM unnest(ARRAY['商品企划', '设计研发', '采购管理', '销售管理', '商品运营', '仓库管理', '客服管理', '财务管理', '人资管理', '运维管理']) AS item(value)
WHERE NOT EXISTS (SELECT 1 FROM "system_setting" WHERE "key" = 'governance_data_domains');

INSERT INTO "governance_option" ("id", "type", "value", "description", "updatedBy", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || item.value), 'PERMISSION_RELATION'::"GovernanceOptionType", item.value, '', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM unnest(ARRAY['品牌项目名', '财务店铺名称', 'ERP店铺名称', '平台店铺名称']) AS item(value)
WHERE NOT EXISTS (SELECT 1 FROM "system_setting" WHERE "key" = 'governance_permission_relations');

DELETE FROM "system_setting"
WHERE "key" IN ('governance_data_domains', 'governance_permission_relations');
