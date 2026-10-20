/* eslint-disable @typescript-eslint/no-require-imports -- Node component tests do not automate a browser. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== "object") return [];
  return [node, ...flatten(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node == null || typeof node === "boolean") return "";
  return typeof node === "object" ? text(node.props?.children) : String(node);
}
function fixture(id) {
  const table = { dataDomain: "销售管理", businessName: "人工名称", description: "人工描述", grain: "", permissionColumnId: null, permissionRelation: null, queryConfig: { storage: null, default_stat_date: { field_id: null, format: "" } } };
  return { id: "task-" + id, status: "REVIEWING", table: { id, name: "table_" + id }, allColumns: [], selectedColumns: [], draft: { table, columns: [], metrics: [] }, ai: { table: { ...table, businessName: "AI 名称" }, columns: [], metrics: [{ id: "suggestion", name: "AI 指标", formula: "SUM(amount)" }] }, published: { table: null, columns: 0 } };
}
function harness(workspaceFor = fixture) {
  let tableId = "A", stateIndex = 0, effectIndex = 0;
  const states = [], effectDeps = [], pending = [];
  const react = {
    Suspense: "Suspense",
    useMemo: fn => fn(),
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useEffect(fn, deps) {
      const index = effectIndex++, old = effectDeps[index];
      if (!old || deps.some((value, i) => value !== old[i])) { pending.push(fn); effectDeps[index] = deps; }
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../app/governance/tables/[tableId]/page.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "next/navigation") return { useParams: () => ({ tableId }), useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams() };
    if (name === "@/lib/api") return { api: async url => url === "/settings/governance-options" ? { dataDomains: [], permissionRelations: [] } : url.endsWith("/generations/active") ? null : workspaceFor(tableId) };
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  };
  new Function("module", "exports", "require", code)(mod, mod.exports, localRequire);
  return {
    render() {
      stateIndex = 0; effectIndex = 0;
      const child = mod.exports.default().props.children;
      return child.type(child.props);
    },
    async flush() { for (const fn of pending.splice(0)) fn(); await new Promise(resolve => setImmediate(resolve)); },
    select(id) { tableId = id; },
  };
}

test("existing suggestions start hidden, toggle all suggestion areas, and reset when opening another table", async () => {
  const view = harness();
  view.render(); await view.flush();
  let tree = view.render(); await view.flush();
  const button = label => flatten(tree).find(node => node.type === "Button" && text(node) === label);
  const metricEditor = () => flatten(tree).find(node => node.type === "CalculatedMetrics");
  assert.ok(button("显示 AI 建议"));
  assert.equal(flatten(tree).filter(node => typeof node.type === "function" && node.type.name === "AiHint").length, 0);
  assert.deepEqual(metricEditor().props.suggestions, []);
  button("显示 AI 建议").props.onClick(); tree = view.render();
  assert.ok(button("隐藏 AI 建议"));
  assert.ok(flatten(tree).some(node => typeof node.type === "function" && node.type.name === "AiHint"));
  assert.equal(metricEditor().props.suggestions.length, 1);
  assert.ok(flatten(tree).some(node => node.type === "Input" && node.props.value === "人工名称"));
  button("隐藏 AI 建议").props.onClick(); tree = view.render();
  assert.deepEqual(metricEditor().props.suggestions, []);
  button("显示 AI 建议").props.onClick(); tree = view.render();
  view.select("B"); view.render(); await view.flush(); tree = view.render(); await view.flush();
  assert.ok(button("显示 AI 建议"));
  assert.deepEqual(metricEditor().props.suggestions, []);
  const generation = flatten(tree).find(node => node.type === "AiGenerationDialog");
  await generation.props.onCompleted(); tree = view.render();
  assert.ok(button("隐藏 AI 建议"));
  assert.equal(metricEditor().props.suggestions.length, 1);
});

test("permission field is explicitly optional and clearing it removes the mapping without opening its dialog", async () => {
  const view = harness(id => {
    const workspace = fixture(id);
    workspace.allColumns = [{ id: "shop", name: "shop_id", dataType: "STRING", isPartition: false }];
    workspace.selectedColumns = ["shop"];
    workspace.draft.table.permissionColumnId = "shop";
    workspace.draft.table.permissionRelation = "平台店铺名称";
    workspace.draft.columns = [{ metaColumnId: "shop", metricName: "店铺", semanticType: "DIMENSION", aggregation: "", unit: "", groupable: true, candidateValueQueryable: true, labelDescription: "" }];
    return workspace;
  });
  view.render(); await view.flush();
  let tree = view.render(); await view.flush();
  assert.ok(flatten(tree).some(node => node.type === "FieldLabel" && text(node) === "权限字段（选填）"));
  const picker = () => flatten(tree).find(node => node.type === "Combobox" && node.props.searchPlaceholder === "选择权限字段");
  assert.deepEqual(picker().props.options[0], { value: "", label: "不设置权限字段" });
  assert.equal(picker().props.value, "shop");
  assert.ok(flatten(tree).some(node => node.type === "button" && text(node) === "平台店铺名称"));
  picker().props.onValueChange(""); tree = view.render();
  assert.equal(picker().props.value, "");
  assert.equal(flatten(tree).some(node => node.type === "button" && text(node) === "平台店铺名称"), false);
  assert.equal(flatten(tree).find(node => node.type === "Dialog").props.open, false);
  picker().props.onValueChange("shop"); tree = view.render();
  assert.equal(flatten(tree).find(node => node.type === "Dialog").props.open, true);
});

