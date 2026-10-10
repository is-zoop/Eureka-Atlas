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

test("assets show publisher names and move the icon-only package button after governance", () => {
  const rows = [
    { id: "A", name: "table_a", type: "MANAGED_TABLE", space: "space", columnCount: 2, updatedAt: "2026-10-09", lastUpdatedBy: "发布人乙", governanceStatus: "COMPLETED", hasPackage: true },
    { id: "B", name: "table_b", type: "MANAGED_TABLE", space: "space", columnCount: 2, updatedAt: "2026-10-09", lastUpdatedBy: null, governanceStatus: "UNGOVERNED", hasPackage: false },
  ];
  let stateIndex = 0;
  const react = {
    Suspense: "Suspense", useEffect() {}, useCallback: fn => fn, useMemo: fn => fn(),
    useState: initial => [stateIndex++ === 1 ? { items: rows, total: 2, page: 1, totalPages: 1, filters: { spaces: [], sources: [], types: [] } } : initial, () => {}],
  };
  const mod = load("../app/assets/tables/page.tsx", react);
  const component = mod.default().props.children;
  const tree = component.type(component.props);
  const nodes = flatten(tree);
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

