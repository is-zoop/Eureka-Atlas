const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildSemanticPackage,
} = require("../dist/package/builder/semantic-package.builder");

test("builds the compact semantic package", () => {
  const result = buildSemanticPackage({
    name: "shop_sales",
    semantic: {
      dataDomain: "销售管理",
      businessName: "店铺销售日报",
      description: "店铺每日销售",
      grain: "日期加店铺",
      permissionColumn: { name: "shop_id" },
      permissionRelation: "平台店铺名称",
    },
    columns: [
      {
        name: "shop_id",
        semantic: {
          metricName: "店铺",
          semanticType: "DIMENSION",
          aggregation: null,
          unit: null,
          groupable: true,
          candidateValueQueryable: true,
          labelDescription: null,
        },
      },
      {
        name: "gmv",
        semantic: {
          metricName: "销售额",
          semanticType: "METRIC",
          aggregation: "SUM",
          unit: "元",
          groupable: false,
          candidateValueQueryable: false,
          labelDescription: null,
        },
      },
      {
        name: "source_label",
        semantic: {
          metricName: "来源标签",
          semanticType: "LABEL",
          aggregation: null,
          unit: null,
          groupable: true,
          candidateValueQueryable: true,
          labelDescription: "标识订单来源渠道",
        },
      },
    ],
    semanticMetrics: [
      {
        name: "客单价",
        formula: "SUM(gmv) / NULLIF(SUM(buyer_cnt), 0)",
        unit: "元",
        dependencies: [
          {
            meta_column_id: "gmv",
            column: "gmv",
          },
          {
            meta_column_id: "buyer",
            column: "buyer_cnt",
          },
        ],
      },
    ],
  });
  assert.deepEqual(result, {
    table: {
      name: "shop_sales",
      data_domain: "销售管理",
      business_name: "店铺销售日报",
      description: "店铺每日销售",
      grain: "日期加店铺",
      permission_field: "shop_id",
      permission_relation: "平台店铺名称",
    },
    fields: [
      {
        column: "shop_id",
        name: "店铺",
        type: "DIMENSION",
        aggregation: null,
        unit: null,
        groupable: true,
        candidate_value_queryable: true,
        label_description: null,
      },
      {
        column: "gmv",
        name: "销售额",
        type: "METRIC",
        aggregation: "SUM",
        unit: "元",
        groupable: false,
        candidate_value_queryable: false,
        label_description: null,
      },
      {
        column: "source_label",
        name: "来源标签",
        type: "LABEL",
        aggregation: null,
        unit: null,
        groupable: true,
        candidate_value_queryable: true,
        label_description: "标识订单来源渠道",
      },
    ],
    metrics: [
      {
        name: "客单价",
        type: "DERIVED",
        formula: "SUM(gmv) / NULLIF(SUM(buyer_cnt), 0)",
        unit: "元",
        dependencies: [
          { column: "gmv" },
          { column: "buyer_cnt" },
        ],
      },
    ],
  });
});
