const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildSemanticPackage,
} = require("../dist/package/builder/semantic-package.builder");

test("builds the compact semantic package", () => {
  const result = buildSemanticPackage({
    name: "shop_sales",
    semantic: {
      businessName: "店铺销售日报",
      description: "店铺每日销售",
      grain: "日期加店铺",
      permissionColumn: { name: "shop_id" },
    },
    columns: [
      {
        name: "shop_id",
        semantic: {
          metricName: "店铺",
          semanticType: "DIMENSION",
          aggregation: null,
          unit: null,
        },
      },
      {
        name: "gmv",
        semantic: {
          metricName: "销售额",
          semanticType: "METRIC",
          aggregation: "SUM",
          unit: "元",
        },
      },
    ],
  });
  assert.deepEqual(result, {
    table: {
      name: "shop_sales",
      business_name: "店铺销售日报",
      description: "店铺每日销售",
      grain: "日期加店铺",
      permission_field: "shop_id",
    },
    fields: [
      {
        column: "shop_id",
        name: "店铺",
        type: "DIMENSION",
        aggregation: null,
        unit: null,
      },
      {
        column: "gmv",
        name: "销售额",
        type: "METRIC",
        aggregation: "SUM",
        unit: "元",
      },
    ],
  });
});
