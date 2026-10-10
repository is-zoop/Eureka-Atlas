const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");
const componentFile = path.join(root, "components/ask/clarification-card.tsx");
const cache = new Map();
function load(file, overrides = {}) {
  if (!Object.keys(overrides).length && cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith("@/") || name.startsWith(".")) {
      const candidate = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      return load([candidate, candidate + ".ts", candidate + ".tsx"].find(fs.existsSync));
    }
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
  if (!Object.keys(overrides).length) cache.set(file, mod.exports);
  return mod.exports;
}
const clarification = mode => ({
  id: "question-1", question: "请选择八月指标", selection_mode: mode,
  options: [{ id: "A", summary: "销售收入", description: "八月销售收入，按店铺汇总" }, { id: "B", summary: "实际利润", description: "八月实际利润，按店铺汇总" }],
  response: null, answer: null,
});
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) { for (const child of tree) { const match = find(child, predicate); if (match) return match; } return; }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
// Test handler and draft lifetimes without browser automation. Actual Radix markup is tested below.
function mount(current, onSubmit) {
  let index = 0;
  const slots = [];
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
    },
    useRef(initial) { const slot = index++; slots[slot] ??= { current: initial }; return slots[slot]; },
  };
  const code = ts.transpileModule(fs.readFileSync(componentFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    return new Proxy({}, { get: (_, key) => key });
  }, mod, mod.exports);
  return {
    render() { index = 0; return mod.exports.ClarificationCard({ clarification: current, onSubmit }); },
    refresh(next) { current = next; },
  };
}
const group = tree => find(tree, e => e.type === "ToggleGroup");
const input = tree => find(tree, e => e.type === "Textarea");
const button = tree => find(tree, e => e.type === "Button");
const submit = tree => find(tree, e => e.type === "form").props.onSubmit({ preventDefault() {} });
const flush = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("real cards render summaries, light explanations, one option per row and native keyboard controls", () => {
  const { ClarificationCard } = load(componentFile);
  const single = renderToStaticMarkup(React.createElement(ClarificationCard, { clarification: clarification("single"), onSubmit: async () => {} }));
  assert.match(single, /单选|销售收入|实际利润|八月销售收入/);
  assert.match(single, /grid-cols-1/);
  assert.doesNotMatch(single, /(?:sm|md|lg):grid-cols-[2-9]/);
  assert.match(single, /truncate text-xs leading-\[1\.6\] text-slate-500/);
  assert.match(single, /<textarea[^>]*rows="1"/);
  assert.match(single, /min-h-0 resize-y/);
  assert.doesNotMatch(single, /min-h-24|min-h-20/);
  const compact = mount(clarification("single"), async () => {}).render();
  const tooltip = find(compact, e => e.type === "TooltipContent");
  assert.equal(tooltip.props.children, clarification("single").options[0].description);
  assert.match(tooltip.props.className, /whitespace-pre-wrap/);
  assert.equal((single.match(/role="radio"/g) ?? []).length, 2);
  assert.equal((single.match(/aria-checked="false"/g) ?? []).length, 2);
  assert.match(single, /type="button"/); // Enter/Space activation uses Radix's native buttons; selection does not submit the form.
  assert.match(single, /type="submit"[^>]*disabled=""/);
  assert.match(single, /<label[^>]*for="clarification-question-1-custom"/);
  const multiple = renderToStaticMarkup(React.createElement(ClarificationCard, { clarification: clarification("multiple"), onSubmit: async () => {} }));
  assert.match(multiple, /可多选/);
  assert.equal((multiple.match(/aria-pressed="false"/g) ?? []).length, 2);
});

test("selected cards use Check, pale blue background and blue border", () => {
  let index = 0;
  const state = [["B"], "", false, ""];
  const { ClarificationCard } = load(componentFile, { react: { ...React, useState: () => [state[index++], () => {}] } });
  const html = renderToStaticMarkup(React.createElement(ClarificationCard, { clarification: clarification("single"), onSubmit: async () => {} }));
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /data-state="on"/);
  assert.match(html, /data-\[state=on\]:border-blue-400/);
  assert.match(html, /data-\[state=on\]:bg-blue-50/);
  assert.match(html, /lucide-check/);
});

test("single selection replaces the first card and only Continue submits", async () => {
  const answers = [];
  const view = mount(clarification("single"), async answer => answers.push(answer));
  assert.equal(button(view.render()).props.disabled, true);
  group(view.render()).props.onValueChange("A");
  group(view.render()).props.onValueChange("B");
  assert.equal(group(view.render()).props.value, "B");
  assert.equal(answers.length, 0);
  submit(view.render()); await flush();
  assert.deepEqual(answers, [{ clarification_id: "question-1", selected_option_ids: ["B"], custom_text: "" }]);
});

test("multiple selection can remove cards and combines chosen cards with custom text in card order", async () => {
  const answers = [];
  const view = mount(clarification("multiple"), async answer => answers.push(answer));
  group(view.render()).props.onValueChange(["A", "B"]);
  group(view.render()).props.onValueChange(["B"]);
  assert.deepEqual(group(view.render()).props.value, ["B"]);
  group(view.render()).props.onValueChange(["B", "A"]);
  input(view.render()).props.onChange({ target: { value: "  2026 年 8 月  " } });
  submit(view.render()); await flush();
  assert.deepEqual(answers[0], { clarification_id: "question-1", selected_option_ids: ["A", "B"], custom_text: "2026 年 8 月" });
});

test("text-only questions submit custom answers and reject whitespace-only drafts", async () => {
  const answers = [];
  const view = mount({ ...clarification("single"), options: [] }, async answer => answers.push(answer));
  assert.equal(group(view.render()), undefined);
  input(view.render()).props.onChange({ target: { value: " \n " } });
  submit(view.render()); await flush();
  assert.equal(answers.length, 0);
  assert.equal(button(view.render()).props.disabled, true);
  input(view.render()).props.onChange({ target: { value: "自己的指标范围" } });
  submit(view.render()); await flush();
  assert.deepEqual(answers[0], { clarification_id: "question-1", selected_option_ids: [], custom_text: "自己的指标范围" });
});

test("submission blocks duplicate clicks and failed responses keep both selected cards and typed text", async () => {
  const pending = defer();
  let count = 0;
  const view = mount(clarification("multiple"), () => { count++; return pending.promise; });
  group(view.render()).props.onValueChange(["A", "B"]);
  input(view.render()).props.onChange({ target: { value: "补充日期" } });
  const tree = view.render();
  submit(tree); submit(tree);
  assert.equal(count, 1);
  const busy = view.render();
  assert.equal(group(busy).props.disabled, true);
  assert.equal(input(busy).props.disabled, true);
  assert.equal(button(busy).props.disabled, true);
  pending.reject(new Error("网络中断")); await flush();
  const failed = view.render();
  assert.deepEqual(group(failed).props.value, ["A", "B"]);
  assert.equal(input(failed).props.value, "补充日期");
  assert.equal(button(failed).props.disabled, false);
  assert.equal(find(failed, e => e.props?.role === "alert").props.children, "网络中断");
});

test("same-question refresh preserves the draft and a remounted question starts empty", () => {
  const view = mount(clarification("single"), async () => {});
  group(view.render()).props.onValueChange("B");
  input(view.render()).props.onChange({ target: { value: "补充说明" } });
  view.refresh({ ...clarification("single"), options: [...clarification("single").options] });
  assert.equal(group(view.render()).props.value, "B");
  assert.equal(input(view.render()).props.value, "补充说明");
  const next = mount({ ...clarification("single"), id: "question-2" }, async () => {});
  assert.equal(group(next.render()).props.value, "");
  assert.equal(input(next.render()).props.value, "");
  assert.equal(button(next.render()).props.disabled, true);
});