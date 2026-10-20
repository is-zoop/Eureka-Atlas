/* eslint-disable @typescript-eslint/no-require-imports -- Node unit tests transpile UI without browser automation. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(relative, react) {
  const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => {
    if (name === "@eureka-atlas/types") return require(name);
    if (name === "@/lib/auth") return { useAuth: () => ({ user: { role_code: "ADMIN" } }) };
    if (name === "@/lib/use-list-view") return { useListView: () => ({ search: "", query: "", params: new URLSearchParams(), field: "space", setSearch() {}, setField() {}, update() {}, reset() {}, canReset: false }) };
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "next/navigation") return { usePathname: () => "/assets/tables", useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams() };
    if (name.startsWith("@codemirror/") || name.startsWith("@lezer/")) return require(name);
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  };
  new Function("module", "exports", "require", code)(mod, mod.exports, localRequire);
  return mod.exports;
}

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

test("assets show published business descriptions with truncation and tooltips alongside publisher names", () => {
  const description = "治理后发布的业务描述，包含订单、商品、销售金额等信息。".repeat(20);
  const rows = [
    { id: "A", name: "table_a", type: "MANAGED_TABLE", comment: "原始表注释", businessName: "订单明细", businessDescription: description, space: "space", columnCount: 2, updatedAt: "2026-10-09", lastUpdatedBy: "发布人乙", governanceStatus: "COMPLETED", hasPackage: true },
    { id: "B", name: "table_b", type: "MANAGED_TABLE", comment: "未治理的原始注释", businessName: null, businessDescription: null, space: "space", columnCount: 2, updatedAt: "2026-10-09", lastUpdatedBy: null, governanceStatus: "UNGOVERNED", hasPackage: false },
    { id: "C", name: "table_c", type: "MANAGED_TABLE", businessName: "历史订单", businessDescription: "", space: "space", columnCount: 2, updatedAt: "2026-10-09", lastUpdatedBy: null, governanceStatus: "COMPLETED", hasPackage: false },
    { id: "D", name: "table_d", type: "MANAGED_TABLE", comment: "草稿的原始注释", businessName: null, businessDescription: null, space: "space", columnCount: 2, updatedAt: "2026-10-09", lastUpdatedBy: null, governanceStatus: "DRAFT", hasPackage: false },
    { id: "E", name: "table_e", type: "MANAGED_TABLE", comment: null, businessName: null, businessDescription: null, space: "space", columnCount: 2, updatedAt: "2026-10-09", lastUpdatedBy: null, governanceStatus: "UNGOVERNED", hasPackage: false },
  ];
  let stateIndex = 0;
  const react = {
    Suspense: "Suspense", useEffect() {}, useCallback: fn => fn, useMemo: fn => fn(),
    useState: initial => [stateIndex++ === 0 ? { items: rows, total: rows.length, page: 1, totalPages: 1, filters: { spaces: [], sources: [], types: [] } } : initial, () => {}],
  };
  const mod = load("../app/assets/tables/page.tsx", react);
  const component = mod.default().props.children;
  const tree = component.type(component.props);
  const nodes = flatten(tree);
  assert.equal(nodes.find(node => node.type === "InputGroupInput").props.placeholder, "搜索表名、业务名称、注释或业务描述");
  const headers = nodes.filter(node => node.type === "TableHead");
  assert.equal(headers.length, 9);
  assert.deepEqual(headers.slice(0, 3).map(text), ["表名称", "业务描述", "数据空间"]);
  assert.ok(nodes.find(node => node.type === "Table").props.className.includes("table-fixed"));
  const tooltip = nodes.find(node => node.type === "Tooltip");
  const trigger = flatten(tooltip).find(node => node.type === "TooltipTrigger");
  assert.equal(trigger.props.asChild, true);
  assert.equal(trigger.props.children.type, "span");
  assert.equal(trigger.props.children.props.tabIndex, 0);
  assert.match(trigger.props.children.props.className, /truncate/);
  assert.match(trigger.props.children.props.className, /whitespace-nowrap/);
  assert.equal(text(trigger), description);
  const content = flatten(tooltip).find(node => node.type === "TooltipContent");
  assert.equal(text(content), description);
  assert.match(content.props.className, /whitespace-pre-wrap/);
  assert.match(content.props.className, /break-words/);
  assert.equal(nodes.filter(node => node.type === "Tooltip").length, 1);
  const assetRows = nodes.filter(node => node.type === "tr" && node.props.className === "group");
  assert.equal(text(assetRows[0].props.children[0]), "table_a订单明细");
  assert.equal(text(assetRows[1].props.children[0]), "table_b未治理的原始注释");
  assert.equal(text(assetRows[2].props.children[0]), "table_c历史订单");
  assert.equal(text(assetRows[3].props.children[0]), "table_d草稿的原始注释");
  assert.equal(text(assetRows[4].props.children[0]), "table_e无注释");
  for (const [index, label] of ["订单明细", "未治理的原始注释", "历史订单", "草稿的原始注释", "无注释"].entries()) {
    const secondary = flatten(assetRows[index].props.children[0]).find(node => node.type === "div");
    assert.equal(secondary.props.title, label);
    assert.match(secondary.props.className, /truncate/);
  }
  assert.equal(text(assetRows[1].props.children[1]), "—");
  assert.equal(text(assetRows[2].props.children[1]), "—");
  assert.ok(nodes.some(node => node.type === "TableHead" && text(node) === "最近更新人"));
  assert.ok(nodes.some(node => node.type === "TableCell" && text(node) === "发布人乙"));
  assert.ok(nodes.some(node => node.type === "TableCell" && text(node) === "—"));
  const packageButton = nodes.find(node => node.type === "SemanticPackageDialog");
  assert.equal(packageButton.props.iconOnly, true);
  assert.equal(packageButton.props.label, "查看 Package");
  const controls = nodes.find(node => node.type === "div" && node.props.className === "flex gap-2" && flatten(node).includes(packageButton));
  assert.equal(controls.props.children[0].type, "Button");
  assert.equal(text(controls.props.children[0]), "开始治理");
  assert.equal(controls.props.children[1], packageButton);
  assert.equal(nodes.filter(node => node.type === "SemanticPackageDialog").length, 1);
});

test("package icon retains an accessible label and other package entry points keep their text", () => {
  const react = { useState: initial => [initial, () => {}], useCallback: fn => fn, useEffect() {}, useMemo: fn => fn() };
  const { SemanticPackageDialog } = load("../components/semantic/semantic-package-dialog.tsx", react);
  for (const iconOnly of [true, false]) {
    const nodes = flatten(SemanticPackageDialog({ tableId: "A", label: "查看 Package", iconOnly }));
    const trigger = nodes.find(node => node.type === "DialogTrigger");
    const button = trigger.props.children;
    assert.equal(button.props["aria-label"], "查看 Package");
    assert.equal(button.props.title, "查看 Package");
    assert.equal(button.props.size, iconOnly ? "icon-sm" : "sm");
    assert.equal(text(button), iconOnly ? "" : "查看 Package");
    assert.equal(flatten(button).filter(node => node.type === "FileJson").length, 1);
  }
});

