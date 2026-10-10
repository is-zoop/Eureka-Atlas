const assert = require("node:assert/strict");
const test = require("node:test");
const { finalQueryIds } = require("../dist/ask/ask-processing");
const selection = (ids, isError = false) => ({ role: "TOOL", content: { toolName: "present_query_results", isError, details: { query_ids: ids } } });

test("only explicitly selected saved results appear in the final answer", () => {
  assert.deepEqual(finalQueryIds([selection(["final", "foreign", "final"])], ["probe", "final"]), ["final"]);
});
test("latest successful selection replaces earlier results and can choose text only", () => {
  assert.deepEqual(finalQueryIds([selection(["old"]), selection(["new"])], ["old", "new"]), ["new"]);
  assert.deepEqual(finalQueryIds([selection(["old"]), selection([])], ["old"]), []);
});
test("failed selection does not replace the successful selection", () => {
  assert.deepEqual(finalQueryIds([selection(["final"]), selection(["probe"], true)], ["probe", "final"]), ["final"]);
});
test("unmarked historical and exploratory queries stay in processing details", () => {
  const probe = { role: "TOOL", content: { toolName: "get_dimension_values", details: { query_id: "probe" } } };
  assert.deepEqual(finalQueryIds([probe], ["probe"]), []);
});
