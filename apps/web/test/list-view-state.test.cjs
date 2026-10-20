/* eslint-disable @typescript-eslint/no-require-imports -- Test real list state and client components without browser automation. */
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
function fixture(initialPath = "/assets/tables") {
  const cache = new Map(), calls = [], redirects = [], timers = new Map();
  let location = new URL(initialPath, "http://localhost"), active, timerId = 0;
  const browser = {
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const router = { replace(url) { redirects.push(url); location = new URL(url, location); } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    Suspense: "Suspense", Fragment: "Fragment",
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    useState(initial) {
      const context = active, index = context.cursor++;
      if (!(index in context.slots)) context.slots[index] = { value: typeof initial === "function" ? initial() : initial };
      const slot = context.slots[index];
      return [slot.value, value => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
    },
    useMemo(fn, deps) {
      const index = active.cursor++, old = active.slots[index];
      if (!old || !same(old.deps, deps)) active.slots[index] = { value: fn(), deps };
      return active.slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = active.cursor++, old = active.slots[index];
      if (old && same(old.deps, deps)) return;
      const slot = { deps, cleanup: old?.cleanup };
      active.slots[index] = slot;
      active.effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); });
    },
  };
  const api = async (url, options) => {
    calls.push({ url, options });
    if (/\/semantic\/(metrics|dimensions)\/[^?]+$/.test(url)) return { sources: [{ table: { id: "T", name: "orders", project: "dw" }, field: "amount" }] };
    const page = Number(new URL(url, "http://api").searchParams.get("page") || 1);
    const items = url.startsWith("/metadata")
      ? [{ id: "T", name: "orders", type: "MANAGED_TABLE", comment: "原始注释", businessName: "订单", businessDescription: "描述", space: "dw", columnCount: 2, updatedAt: "2026-10-09", governanceStatus: "COMPLETED", hasPackage: false }]
      : [{ id: "M", name: "销售额", description: "说明", aliases: ["GMV"], type: "DERIVED", unit: "元", sourceCount: 1, editStatus: "EDITED" }];
    return { items, total: 100, page, totalPages: 5, filters: { spaces: ["dw"], sources: [], types: ["DERIVED"], dataSources: ["dw"] } };
  };
  function load(relative) {
    const filename = path.resolve(__dirname, relative);
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    const localRequire = name => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime" || name === "@eureka-atlas/types") return require(name);
      if (name === "next/link") return { __esModule: true, default: "Link" };
      if (name === "next/navigation") return { usePathname: () => location.pathname, useRouter: () => router, useSearchParams: () => location.searchParams };
      if (name === "@/lib/api") return { api };
      if (name === "@/lib/auth") return { useAuth: () => ({ user: { role_code: "ADMIN" } }) };
      if (name === "@/lib/use-list-view") return load("../lib/use-list-view.ts");
      if (name.startsWith("./")) return load(path.relative(__dirname, path.resolve(path.dirname(filename), name + ".ts")));
      return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
    };
    new Function("module", "exports", "require", "window", code)(mod, mod.exports, localRequire, browser);
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  function mount(component, props = {}) {
    const context = { cursor: 0, slots: [], effects: [] };
    return {
      render() {
        active = context; context.cursor = 0; context.effects = [];
        const tree = component(props);
        context.effects.forEach(run => run());
        return tree;
      },
      unmount() { context.slots.forEach(slot => slot.cleanup?.()); },
    };
  }
  const store = load("../lib/list-view-state.ts");
  return {
    store, calls, redirects, mount,
    navigate(url) { location = new URL(url, location); },
    get url() { return location.pathname + location.search; },
    flushSearch() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    settle: () => new Promise(resolve => setImmediate(resolve)),
    page(key) {
      const component = key === "assets" ? load("../app/assets/tables/page.tsx").default().props.children.type : load("../components/semantic/catalog-list.tsx").CatalogList;
      return mount(component, key === "assets" ? {} : { kind: key });
    },
    hook(key) { return mount(() => load("../lib/use-list-view.ts").useListView(key)); },
  };
}
const filters = tree => flatten(tree).filter(node => node.type === "Combobox");
const search = tree => flatten(tree).find(node => node.type === "InputGroupInput");
const button = (tree, label) => flatten(tree).find(node => node.type === "Button" && text(node) === label);

for (const key of ["assets", "metrics", "dimensions"]) {
  test(`${key} keeps search, filter field, values, pagination and expansion across sidebar/detail/back navigation`, async () => {
    const f = fixture(fixturePath(key));
    let page = f.page(key), tree = page.render();
    await f.settle(); tree = page.render();
    search(tree).props.onChange({ target: { value: "订单" } });
    filters(tree)[0].props.onValueChange(key === "assets" ? "governanceStatus" : "dataSource");
    tree = page.render();
    filters(tree)[1].props.onValueChange(key === "assets" ? "COMPLETED" : "dw");
    f.flushSearch(); tree = page.render(); await f.settle(); tree = page.render();
    button(tree, "下一页").props.onClick();
    tree = page.render(); await f.settle(); tree = page.render();
    if (key !== "assets") {
      flatten(tree).find(node => node.type === "Button" && node.props.size === "icon-sm").props.onClick();
      tree = page.render();
    }
    const selected = f.store.getListView(key);
    assert.equal(new URLSearchParams(selected.query).get("page"), "2");
    assert.equal(new URLSearchParams(selected.query).get("q"), "订单");
    if (key !== "assets") assert.ok(selected.expanded.has("M"));
    page.unmount();
    f.navigate("/query/ask");
    f.navigate(fixturePath(key) + "/detail");
    f.navigate(fixturePath(key));
    page = f.page(key); tree = page.render(); await f.settle(); tree = page.render();
    assert.equal(search(tree).props.value, "订单");
    assert.equal(filters(tree)[0].props.value, selected.field);
    assert.equal(filters(tree)[1].props.value, key === "assets" ? "COMPLETED" : "dw");
    assert.equal(f.store.getListView(key), selected);
    assert.ok(f.calls.some(call => call.url.includes("page=2")));
    assert.equal(new URL(f.url, "http://localhost").searchParams.get("page"), "2");
    if (key !== "assets") {
      const expanded = flatten(tree).find(node => typeof node.type === "function" && node.type.name === "ExpandedSources");
      assert.ok(expanded);
      const row = f.mount(expanded.type, expanded.props);
      row.render(); await f.settle();
      assert.ok(flatten(row.render()).some(node => typeof node.type === "function" && node.type.name === "Sources"));
      row.unmount();
      assert.equal(f.calls.at(-1).options.signal.aborted, true);
    }
    page.unmount();
  });
}
function fixturePath(key) { return key === "assets" ? "/assets/tables" : `/semantic/${key}`; }

test("each list is independent and switching filter fields preserves their values until explicit reset", async () => {
  const f = fixture();
  const page = f.page("assets");
  let tree = page.render(); await f.settle(); tree = page.render();
  filters(tree)[0].props.onValueChange("governanceStatus"); tree = page.render();
  filters(tree)[1].props.onValueChange("COMPLETED"); tree = page.render();
  filters(tree)[0].props.onValueChange("space"); tree = page.render();
  filters(tree)[1].props.onValueChange("dw"); tree = page.render();
  filters(tree)[0].props.onValueChange("governanceStatus"); tree = page.render();
  assert.equal(filters(tree)[1].props.value, "COMPLETED");
  assert.equal(new URLSearchParams(f.store.getListView("assets").query).get("space"), "dw");
  const metrics = f.hook("metrics");
  metrics.render().setSearch("销售额");
  const metricState = f.store.getListView("metrics");
  assert.equal(f.store.getListView("dimensions"), f.store.getDefaultListView("dimensions"));
  button(tree, "重置筛选").props.onClick(); tree = page.render();
  assert.equal(f.store.getListView("assets"), f.store.getDefaultListView("assets"));
  assert.equal(f.store.getListView("metrics"), metricState);
  assert.equal(filters(tree)[0].props.value, "space");
  assert.equal(button(tree, "重置筛选").props.disabled, true);
  page.unmount(); metrics.unmount();
});

for (const key of ["assets", "metrics", "dimensions"]) {
  test(`${key} refresh ignores old URL selections and starts clean; reset clears pending search and expansion`, async () => {
    const f = fixture(fixturePath(key) + "?q=old&page=3&dataSource=dw&governanceStatus=COMPLETED");
    const page = f.page(key);
    let tree = page.render(); await f.settle(); tree = page.render();
    assert.equal(f.url, fixturePath(key));
    assert.equal(search(tree).props.value, "");
    assert.equal(f.calls[0].url.includes("?"), false);
    search(tree).props.onChange({ target: { value: "pending" } }); tree = page.render();
    if (key !== "assets") {
      flatten(tree).find(node => node.type === "Button" && node.props.size === "icon-sm").props.onClick();
      tree = page.render();
    }
    button(tree, "重置筛选").props.onClick(); tree = page.render(); f.flushSearch();
    assert.equal(f.store.getListView(key), f.store.getDefaultListView(key));
    assert.equal(search(tree).props.value, "");
    page.unmount();
  });
}

test("a list cannot redirect a detail route while navigation is in progress", () => {
  const f = fixture("/assets/tables/T?returnTo=%2Fassets%2Ftables");
  const hook = f.hook("assets");
  hook.render();
  assert.deepEqual(f.redirects, []);
  hook.unmount();
});

test("memory-store subscribers are notified, cleanup unsubscribes, and a new document has no saved choices", () => {
  const first = fixture();
  let notifications = 0;
  const unsubscribe = first.store.subscribeListViews(() => notifications++);
  first.store.setListView("assets", state => ({ ...state, search: "订单" }));
  assert.equal(notifications, 1);
  unsubscribe();
  first.store.resetListViews();
  assert.equal(notifications, 1);
  first.store.setListView("assets", state => ({ ...state, search: "订单" }));
  const reloaded = fixture();
  assert.equal(reloaded.store.getListView("assets").search, "");
});
