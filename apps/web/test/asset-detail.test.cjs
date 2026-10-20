/* eslint-disable @typescript-eslint/no-require-imports -- Node unit tests transpile UI without browser automation. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../app/assets/tables/[id]/page.tsx"), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

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

const detail = { id: "A", name: "orders", type: "MANAGED_TABLE", comment: "订单表", space: "sales", updatedAt: "2026-10-09", governanceStatus: "UNGOVERNED" };
const columns = [{ id: "C", name: "order_id", dataType: "BIGINT" }];
function workspace(published) {
  return {
    id: "W", selectedColumns: ["C"],
    draft: { table: { businessName: "订单" }, columns: [], metrics: [] },
    published: { table: published ? { publishedAt: "2026-10-09" } : null },
  };
}
const semanticPackage = { fields: [{ column: "order_id" }], metrics: [], updated_at: "2026-10-09", completeness: { status: "COMPLETE", issues: [] } };

function harness({ semantic = null, packageResult = semanticPackage, metadataError, role = "ADMIN" } = {}) {
  const states = [];
  const calls = [];
  let cursor = 0;
  let pendingEffect;
  let cleanup;
  let runEffect = true;
  let params = Promise.resolve({ id: "A" });
  const react = {
    useMemo: fn => fn(),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useEffect(fn) { if (runEffect) pendingEffect = fn; },
  };
  const api = async url => {
    calls.push(url);
    if (url.endsWith("/columns")) return columns;
    if (url.startsWith("/metadata/")) {
      if (metadataError) throw metadataError;
      return detail;
    }
    if (url.startsWith("/governance/")) return semantic;
    if (url.startsWith("/packages/")) {
      if (packageResult instanceof Error) throw packageResult;
      return packageResult;
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const localRequire = name => {
    if (name === "@eureka-atlas/types") return require(name);
    if (name === "@/lib/auth") return { useAuth: () => ({ user: { role_code: role } }) };
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams() };
    if (name === "@/lib/api") return { api };
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", code)(mod, mod.exports, localRequire);
  function render() {
    cursor = 0;
    const tree = mod.exports.default({ params });
    if (runEffect) {
      cleanup = pendingEffect();
      runEffect = false;
    }
    return tree;
  }
  render();
  return {
    calls, render,
    settle: () => new Promise(resolve => setImmediate(resolve)),
    navigate(nextSemantic) {
      cleanup();
      semantic = nextSemantic;
      params = Promise.resolve({ id: "B" });
      runEffect = true;
      render();
    },
    unmount: () => cleanup(),
  };
}

function assertBasicInformation(tree) {
  assert.ok(text(tree).includes("orders"));
  assert.ok(flatten(tree).some(node => node.type.name === "SummaryItem" && node.props.label === "表注释" && node.props.value === "订单表"));
  assert.ok(flatten(tree).some(node => node.type.name === "SummaryItem" && node.props.label === "字段数量" && node.props.value === "1 个"));
  assert.ok(flatten(tree).some(node => node.type.name === "FieldList" && node.props.columns[0].name === "order_id"));
  assert.equal(flatten(tree).filter(node => node.type === "FloatingAlert").length, 0);
}

for (const [label, semantic] of [["ungoverned", null], ["draft", workspace(false)]]) {
  test(`${label} tables show basic information without requesting a semantic package`, async () => {
    const ui = harness({ semantic });
    await ui.settle();
    const tree = ui.render();
    assertBasicInformation(tree);
    assert.equal(ui.calls.some(url => url.startsWith("/packages/")), false);
    assert.ok(text(tree).includes("尚未生成 Semantic Package"));
    assert.ok(text(tree).includes(label === "ungoverned" ? "尚未开始治理" : "草稿，尚未发布"));
  });
}

test("published tables load and display their semantic package", async () => {
  const ui = harness({ semantic: workspace(true) });
  await ui.settle();
  const tree = ui.render();
  assertBasicInformation(tree);
  assert.ok(ui.calls.includes("/packages/A"));
  assert.ok(text(tree).includes("Semantic Package 已生成"));
  assert.ok(flatten(tree).some(node => node.type === "SemanticPackageDialog" && node.props.tableId === "A"));
});

test("package failures stay in the package section without hiding basic information", async () => {
  const ui = harness({ semantic: workspace(true), packageResult: new Error("语义包读取失败") });
  await ui.settle();
  const tree = ui.render();
  assertBasicInformation(tree);
  const packageSection = flatten(tree).find(node => node.type === "section" && text(node).includes("语义 Package"));
  assert.ok(flatten(packageSection).some(node => node.type === "Alert" && node.props.variant === "destructive"));
  assert.ok(text(packageSection).includes("语义包读取失败"));
  assert.equal(text(packageSection).includes("尚未生成 Semantic Package"), false);
});

test("metadata failures still report a page error", async () => {
  const ui = harness({ metadataError: new Error("Table not found") });
  await ui.settle();
  const tree = ui.render();
  assert.ok(flatten(tree).some(node => node.type === "FloatingAlert" && text(node) === "Table not found"));
  assert.equal(ui.calls.some(url => url.startsWith("/packages/")), false);
});

for (const packageResult of [semanticPackage, new Error("读取失败")]) {
  test(`navigation clears the previous table's package ${packageResult instanceof Error ? "error" : "content"}`, async () => {
    const ui = harness({ semantic: workspace(true), packageResult });
    await ui.settle();
    ui.navigate(null);
    await ui.settle();
    const tree = ui.render();
    assertBasicInformation(tree);
    assert.ok(text(tree).includes("尚未生成 Semantic Package"));
    assert.equal(flatten(tree).some(node => node.type === "SemanticPackageDialog" || node.type === "Alert"), false);
    assert.equal(ui.calls.includes("/packages/B"), false);
  });
}

test("asset details keep fields and packages visible but expose governance links only to editors", async () => {
  for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER"]) {
    for (const semantic of [null, workspace(true)]) {
      const ui = harness({ semantic, role });
      await ui.settle();
      const tree = ui.render();
      assertBasicInformation(tree);
      const links = flatten(tree).filter(node => node.type === "Link" && node.props.href.startsWith("/governance/"));
      assert.equal(links.length > 0, ["SYSTEM_ADMIN", "ADMIN"].includes(role));
      assert.equal(flatten(tree).some(node => node.type === "SemanticPackageDialog"), Boolean(semantic));
    }
  }
});

test("a late package response cannot update an unmounted page", async () => {
  let resolvePackage;
  const packageResult = new Promise(resolve => { resolvePackage = resolve; });
  const ui = harness({ semantic: workspace(true), packageResult });
  await ui.settle();
  assert.ok(ui.calls.includes("/packages/A"));
  ui.unmount();
  resolvePackage(semanticPackage);
  await ui.settle();
  assert.equal(flatten(ui.render()).some(node => node.type === "SemanticPackageDialog"), false);
});
