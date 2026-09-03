const assert = require("node:assert/strict");
const test = require("node:test");
const { MetricFormulaService } = require("../dist/governance/metric-formula.service");

const fields = [
  { id: "a", column: "a" },
  { id: "b", column: "B" },
  { id: "c", column: "C" },
  { id: "other", column: "other_field" },
];

test("resolves selected physical fields from a MaxCompute expression", () => {
  const result = new MetricFormulaService().validateAndResolve(
    "SUM(IF(a > 0, B, 0)) / SUM(C)",
    fields.slice(0, 3),
    fields,
  );
  assert.deepEqual(result.dependencies, [
    { meta_column_id: "a", column: "a" },
    { meta_column_id: "b", column: "B" },
    { meta_column_id: "c", column: "C" },
  ]);
  assert.equal(result.formula, "SUM(IF(a > 0, B, 0)) / SUM(C)");
});

test("rejects SQL statements and unselected physical fields", () => {
  const service = new MetricFormulaService();
  assert.throws(() => service.validateAndResolve("SELECT a", fields, fields));
  assert.throws(() => service.validateAndResolve("SUM(other_field)", fields.slice(0, 3), fields));
  assert.throws(() => service.validateAndResolve("SUM(a", fields, fields));
});
