const assert = require("node:assert/strict");
const test = require("node:test");
const { physicalNameFallback, historicalMatchScore } = require("../dist/governance/semantic-reference.service");

test("derives a readable fallback name from a physical field name", () => {
  assert.equal(physicalNameFallback("pay_amt"), "支付金额");
  assert.equal(physicalNameFallback("shop_name"), "店铺名称");
});

test("ranks an exact physical-field match above a similar one", () => {
  assert.equal(historicalMatchScore("pay_amt", "pay_amt"), 100);
  assert.ok(historicalMatchScore("pay_amt", "refund_amt") < 100);
});
