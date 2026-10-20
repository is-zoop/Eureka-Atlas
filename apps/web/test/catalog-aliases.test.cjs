/* eslint-disable @typescript-eslint/no-require-imports -- Node component tests transpile the actual catalog list. */
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
const longAlias = "Gross Merchandise Value 与商品成交总金额的较长业务别名".repeat(8);
const rows = [
  { id: "A", name: "销售额", description: "支付金额", aliases: ["GMV", "成交金额", longAlias], type: "ATOMIC", unit: "元", sourceCount: 2, editStatus: "UNEDITED" },
  { id: "B", name: "客户数", description: "客户数量", aliases: [], type: "ATOMIC", unit: "人", sourceCount: 1, editStatus: "UNEDITED" },
];
function fixture(kind) {
  const slots = [], effects = [], deps = [], cleanups = [], requests = [];
  let stateIndex = 0, effectIndex = 0, search = "", expanded = new Set();
  const query = new URLSearchParams();
  const react = {
    Fragment: "Fragment",
    useState(initial) {
      const index = stateIndex++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: fn => fn(),
    useEffect(fn, next) {
      const index = effectIndex++;
      if (!deps[index] || next.some((value, i) => value !== deps[index][i])) {
        deps[index] = next;
        effects.push(() => { cleanups[index]?.(); cleanups[index] = fn(); });
      }
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../components/semantic/catalog-list.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "@/lib/use-list-view") return { useListView: () => ({
      search, query: query.toString(), params: query, field: "editStatus", expanded,
      setSearch(value) { search = value; query.set("q", value); query.delete("page"); },
      setExpanded(value) { expanded = typeof value === "function" ? value(expanded) : value; },
      setField() {}, update() {}, reset() {}, canReset: Boolean(search),
    }) };
    if (name === "@/lib/api") return { api: async url => {
      requests.push(url);
      const q = (new URL(url, "http://api").searchParams.get("q") || "").toLowerCase();
      const items = rows.filter(row => [row.name, row.description, ...row.aliases].some(value => value.toLowerCase().includes(q))).map(row => ({ ...row }));
      return { items, total: items.length, page: 1, totalPages: 1, filters: { types: [], dataSources: [] } };
    } };
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  };
  new Function("module", "exports", "require", code)(mod, mod.exports, localRequire);
  return {
    requests,
    render() { stateIndex = 0; effectIndex = 0; return mod.exports.CatalogList({ kind }); },
    async flush() { for (const fn of effects.splice(0)) fn(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

for (const kind of ["metrics", "dimensions"]) {
  const metric = kind === "metrics", aliasColumn = metric ? 4 : 3, columns = metric ? 9 : 7;
  test(`${kind}: aliases appear immediately after the description at a fixed width with an accessible Tooltip`, async () => {
    const f = fixture(kind);
    f.render(); await f.flush();
    const tree = f.render(), nodes = flatten(tree);
    const headers = nodes.filter(node => node.type === "TableHead");
    assert.equal(headers.length, columns);
    assert.equal(text(headers[aliasColumn - 1]), metric ? "指标说明" : "维度说明");
    assert.equal(text(headers[aliasColumn]), "别名");
    const table = nodes.find(node => node.type === "Table");
    assert.match(table.props.className, /table-fixed/);
    assert.equal(table.props.freezeLastColumn, true);
    const colgroup = nodes.find(node => node.type === "colgroup");
    const cols = flatten(colgroup).filter(node => node.type === "col");
    assert.equal(cols.length, columns);
    assert.equal(cols[aliasColumn].props.className, "w-[240px]");
    assert.ok(nodes.some(node => node.type === "TooltipProvider"));
    const tooltip = nodes.find(node => node.type === "Tooltip");
    const trigger = flatten(tooltip).find(node => node.type === "TooltipTrigger");
    assert.equal(trigger.props.asChild, true);
    assert.equal(trigger.props.children.type, "span");
    assert.equal(trigger.props.children.props.tabIndex, 0);
    assert.match(trigger.props.children.props.className, /truncate/);
    assert.match(trigger.props.children.props.className, /whitespace-nowrap/);
    assert.equal(text(trigger), rows[0].aliases.join("、"));
    const content = flatten(tooltip).find(node => node.type === "TooltipContent");
    assert.equal(text(content), rows[0].aliases.join("、"));
    assert.match(content.props.className, /break-words/);
    assert.match(content.props.className, /whitespace-pre-wrap/);
    assert.equal(nodes.filter(node => node.type === "Tooltip").length, 1);
    assert.ok(nodes.some(node => node.type === "TableCell" && text(node) === "—"));
    assert.equal(nodes.find(node => node.type === "InputGroupInput").props.placeholder, `搜索${metric ? "指标" : "维度"}名称、说明或别名`);
  });

  test(`${kind}: wide and narrow layouts distribute space without stretching the description or aliases`, async () => {
    const f = fixture(kind);
    f.render(); await f.flush();
    const colgroup = flatten(f.render()).find(node => node.type === "colgroup");
    const cols = flatten(colgroup).filter(node => node.type === "col");
    const fractions = cols.filter(col => col.props.style).map(col => {
      const match = col.props.style.width.match(/^(\d+)%$/);
      assert.ok(match, "use percentage columns: browsers treat percentage calc() widths on col as auto");
      return Number(match[1]) / 100;
    });
    assert.ok(Math.abs(fractions.reduce((sum, value) => sum + value, 0) - 1) < 0.0001);
    for (const width of [metric ? 1280 : 1024, 1440, 2200]) {
      const widths = cols.map(col => {
        if (col.props.style) return (width - 380) * Number.parseFloat(col.props.style.width) / 100;
        return { "w-11": 44, "w-[240px]": 240, "w-24": 96 }[col.props.className];
      });
      assert.ok(widths.every(value => Number.isFinite(value) && value > 0), "every column needs an explicit width");
      assert.ok(Math.abs(widths.reduce((sum, value) => sum + value, 0) - width) < 0.0001);
      assert.equal(widths[aliasColumn], 240);
      assert.equal(widths.at(-1), 96);
      assert.ok(widths[aliasColumn - 1] <= width * (metric ? 0.22 : 0.30));
      assert.ok(widths.slice(0, aliasColumn).reduce((sum, value) => sum + value, 0) < width * 0.6, "aliases must not be pushed to the far-right edge");
    }
  });

  test(`${kind}: alias edits update the visible text and Tooltip without a reload`, async () => {
    const f = fixture(kind);
    f.render(); await f.flush();
    let tree = f.render();
    const dialog = flatten(tree).find(node => node.type === (metric ? "MetricEditDialog" : "DimensionEditDialog"));
    dialog.props.onSaved({ id: "A", description: "新说明", aliases: ["新增别名", "Revenue"] });
    tree = f.render();
    assert.equal(text(flatten(tree).find(node => node.type === "TooltipTrigger")), "新增别名、Revenue");
    assert.equal(text(flatten(tree).find(node => node.type === "TooltipContent")), "新增别名、Revenue");
    assert.ok(flatten(tree).some(node => node.type === "TableCell" && text(node) === "新说明"));
    assert.ok(flatten(tree).some(node => node.type === "TableCell" && text(node) === "已编辑"));
    dialog.props.onSaved({ id: "A", description: "新说明", aliases: [] });
    assert.equal(flatten(f.render()).some(node => node.type === "Tooltip"), false);
  });

  test(`${kind}: alias queries reach the server and expanded/empty rows use the new column count`, async () => {
    const f = fixture(kind);
    f.render(); await f.flush();
    let tree = f.render();
    const expand = flatten(tree).find(node => node.type === "Button" && node.props.size === "icon-sm");
    expand.props.onClick();
    assert.ok(flatten(f.render()).some(node => node.type === "TableCell" && node.props.colSpan === columns));
    flatten(tree).find(node => node.type === "InputGroupInput").props.onChange({ target: { value: "merchandise" } });
    f.render(); await f.flush(); tree = f.render();
    assert.equal(f.requests.at(-1), `/semantic/${kind}?q=merchandise`);
    assert.ok(flatten(tree).some(node => node.type === "Link" && text(node) === "销售额"));
    assert.equal(flatten(tree).some(node => node.type === "Link" && text(node) === "客户数"), false);
    flatten(tree).find(node => node.type === "InputGroupInput").props.onChange({ target: { value: "没有对应别名" } });
    f.render(); await f.flush(); tree = f.render();
    const empty = flatten(tree).find(node => node.type === "TableCell" && text(node).startsWith("暂无已发布"));
    assert.equal(empty.props.colSpan, columns);
    assert.ok(flatten(tree).some(node => node.type === "InputGroupText" && text(node) === "0 条"));
  });
}
