import assert from "node:assert/strict";
import test from "node:test";
import type { DataQueryExecution, DataQueryResultPage } from "@eureka-atlas/types";
import { appendPage, beginImport, captureTarget, discardImport, finishImport, readBinding, rectangle, type Application, type Range, type Workbook, type Worksheet } from "../src/lib/workbook.ts";

class MockSheet implements Worksheet {
  Name: string;
  ProtectContents = false;
  merged = false;
  array = false;
  failCopyOnce = false;
  deleted = false;
  cells = new Map<string, unknown>();
  formats: string[] = [];
  constructor(name: string) { this.Name = name; }
  Activate() {}
  Delete() { this.deleted = true; }
  Range(address: string): Range {
    const parse = (cell: string) => {
      const parts = /^([A-Z]+)(\d+)$/.exec(cell)!;
      let c = 0; for (const letter of parts[1]) c = c * 26 + letter.charCodeAt(0) - 64;
      return { r: Number(parts[2]), c };
    };
    const [start, end] = address.split(":"); const a = parse(start), b = parse(end ?? start); const { cells, formats } = this;
    const range: Range & { _sheet: MockSheet; _a: typeof a } = {
      _sheet: this, _a: a, MergeCells: this.merged, HasArray: this.array,
      get NumberFormat() { return formats.at(-1) ?? "General"; }, set NumberFormat(value) { formats.push(value); },
      get Value2() { return Array.from({ length: b.r - a.r + 1 }, (_, r) => Array.from({ length: b.c - a.c + 1 }, (_, c) => cells.get(`${a.r + r},${a.c + c}`) ?? null)); },
      set Value2(value) { const rows = value as unknown[][]; for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) cells.set(`${r},${c}`, rows[r - a.r]?.[c - a.c] ?? null); },
      Copy(destination) {
        const dest = destination as typeof range;
        for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) dest._sheet.cells.set(`${dest._a.r + r - a.r},${dest._a.c + c - a.c}`, cells.get(`${r},${c}`) ?? null);
        if (dest._sheet.failCopyOnce) { dest._sheet.failCopyOnce = false; throw new Error("模拟部分覆盖后宿主错误"); }
      },
      ClearContents() { for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) cells.set(`${r},${c}`, null); },
    };
    return range;
  }
}
function fixture() {
  const sheets = [new MockSheet("用户原表")];
  const properties: { Name: string; Value: unknown }[] = [];
  const workbook: Workbook = {
    Name: "测试.xlsx", FullName: "E:/测试.xlsx", ReadOnly: false, ProtectStructure: false,
    Worksheets: {
      get Count() { return sheets.filter(sheet => !sheet.deleted).length; },
      Item(index) { const sheet = typeof index === "number" ? sheets.filter(sheet => !sheet.deleted)[index - 1] : sheets.find(sheet => sheet.Name === index && !sheet.deleted); if (!sheet) throw new Error("工作表已删除或更名"); return sheet; },
      Add() { const sheet = new MockSheet(`Sheet${sheets.length + 1}`); sheets.push(sheet); return sheet; },
    },
    CustomDocumentProperties: {
      get Count() { return properties.length; }, Item(index) { return typeof index === "number" ? properties[index - 1] : properties.find(item => item.Name === index)!; },
      Add(name, link, type, value) { assert.equal(link, false); assert.equal(type, 4); assert.ok(value.length <= 255); const prop = { Name: name, Value: value }; properties.push(prop); return prop; },
    },
  };
  const app: Application = { ActiveWorkbook: workbook, DisplayAlerts: true, CreateTaskPane: () => ({ Visible: false, Width: 0, DockPosition: 0 }) };
  const item = (rows: unknown[][]): DataQueryExecution => ({ id: "task", status: "SUCCEEDED", row_count: rows.length, columns: Array.from({ length: rows[0]?.length ?? 2 }, (_, i) => ({ id: `field${i}`, name: `字段${i}`, type: "string", unit: null })) } as DataQueryExecution);
  function stage(rows: (string | number | boolean | null)[][]) {
    const target = captureTarget(app, "member-A", "saved-A"); const execution = item(rows);
    const staged = beginImport(app, target, execution);
    appendPage(app, staged, { rows, columns: execution.columns } as DataQueryResultPage, 0);
    return staged;
  }
  return { sheets, properties, workbook, app, stage };
}

test("first import creates a dedicated sheet and stores only non-secret identifiers", () => {
  const f = fixture(); f.sheets[0].cells.set("1,1", "用户数据");
  const stage = f.stage([["=HYPERLINK(\"evil\")", "00123"], ["9007199254740993", "0.1234567890123456789"], [null, false]]);
  const binding = finishImport(f.app, stage, "销售查询");
  assert.equal(f.sheets[0].cells.get("1,1"), "用户数据");
  assert.equal(binding.s, "销售查询"); assert.equal(binding.r, 4); assert.equal(binding.c, 2);
  assert.ok((stage.sheet as MockSheet).formats.every(format => format === "@"));
  assert.equal((stage.sheet as MockSheet).cells.get("2,1"), '=HYPERLINK("evil")');
  assert.equal((stage.sheet as MockSheet).cells.get("3,1"), "9007199254740993");
  assert.deepEqual(readBinding(f.workbook, "saved-A", "member-A"), binding);
  assert.ok(!String(f.properties[0].Value).includes("token")); assert.ok(!String(f.properties[0].Value).includes("HYPERLINK"));
  assert.equal(f.app.DisplayAlerts, true);
});
test("refresh overwrites only confirmed rectangle and removes stale rows and columns", () => {
  const f = fixture(); const first = finishImport(f.app, f.stage([[1, 2], [3, 4], [5, 6]]), "销售");
  const sheet = f.workbook.Worksheets.Item(first.s) as MockSheet; sheet.cells.set("20,20", "范围外保留");
  const stage = f.stage([["新数据"]]); assert.equal(sheet.cells.get("2,1"), 1);
  const binding = finishImport(f.app, stage, "新名称");
  assert.equal(binding.s, "新名称"); assert.equal(sheet.Name, "新名称"); assert.equal(sheet.cells.get("2,1"), "新数据");
  assert.deepEqual(readBinding(f.workbook, "saved-A", "member-A"), binding);
  assert.equal(sheet.cells.get("3,1"), null); assert.equal(sheet.cells.get("2,2"), null); assert.equal(sheet.cells.get("20,20"), "范围外保留");
  assert.equal(f.workbook.Worksheets.Count, 2); assert.equal(f.app.DisplayAlerts, true);
});
test("empty result writes headers, clears old data and retains binding", () => {
  const f = fixture(); const first = finishImport(f.app, f.stage([[1, 2]]), "销售");
  finishImport(f.app, f.stage([]), "销售");
  const sheet = f.workbook.Worksheets.Item(first.s) as MockSheet;
  assert.equal(sheet.cells.get("1,1"), "字段0"); assert.equal(sheet.cells.get("2,1"), null);
});
test("partial read cancellation only removes Atlas staging sheet and leaves old results intact", () => {
  const f = fixture(); const first = finishImport(f.app, f.stage([["旧数据"]]), "销售");
  const stage = f.stage([["未完成数据"]]); discardImport(f.app, stage);
  assert.equal((f.workbook.Worksheets.Item(first.s) as MockSheet).cells.get("2,1"), "旧数据");
  assert.equal(f.workbook.Worksheets.Count, 2); assert.equal(f.app.DisplayAlerts, true);
});
test("bound worksheet cannot be refreshed by a different account", () => {
  const f = fixture(); finishImport(f.app, f.stage([[1]]), "销售");
  assert.throws(() => captureTarget(f.app, "member-B", "saved-A"), /其他账号/);
  assert.equal(f.workbook.Worksheets.Count, 2);
});
for (const kind of ["readonly", "structure", "changed-workbook", "changed-binding", "protected", "merged", "array", "deleted"] as const) {
  test(`refuses ${kind} before replacing results`, () => {
    const f = fixture(); const first = finishImport(f.app, f.stage([["旧数据"]]), "销售"); const stage = f.stage([["新数据"]]);
    const sheet = f.workbook.Worksheets.Item(first.s) as MockSheet;
    if (kind === "readonly") f.workbook.ReadOnly = true;
    if (kind === "structure") f.workbook.ProtectStructure = true;
    if (kind === "changed-workbook") f.app.ActiveWorkbook = null;
    if (kind === "changed-binding") f.properties[0].Value = "{}";
    if (kind === "protected") sheet.ProtectContents = true;
    if (kind === "merged") sheet.merged = true;
    if (kind === "array") sheet.array = true;
    if (kind === "deleted") sheet.deleted = true;
    assert.throws(() => finishImport(f.app, stage, "销售"));
    assert.equal(sheet.cells.get("2,1"), "旧数据");
  });
}
test("copy failure restores full overwritten rectangle, including expansion cells", () => {
  const f = fixture(); const first = finishImport(f.app, f.stage([["旧数据"]]), "销售");
  const sheet = f.workbook.Worksheets.Item(first.s) as MockSheet;
  sheet.cells.set("3,2", "扩张范围原数据"); const stage = f.stage([["新", "新"], ["新", "新"]]); sheet.failCopyOnce = true;
  assert.throws(() => finishImport(f.app, stage, "销售"), /宿主错误/);
  assert.equal(sheet.cells.get("2,1"), "旧数据"); assert.equal(sheet.cells.get("3,2"), "扩张范围原数据");
  assert.deepEqual(readBinding(f.workbook, "saved-A", "member-A"), first); assert.equal(f.app.DisplayAlerts, true);
});
test("incomplete stage, unsafe numbers and oversized text are rejected", () => {
  const f = fixture(); const stage = f.stage([[1]]); stage.written = 0;
  assert.throws(() => finishImport(f.app, stage, "销售"), /完整结果/);
  assert.throws(() => f.stage([[9007199254740992]]), /数值/);
  assert.throws(() => f.stage([["x".repeat(32768)]]), /32767/);
});
test("multiple imports avoid sheet name collisions and validate range limits", () => {
  const f = fixture(); finishImport(f.app, f.stage([[1]]), "a/b"); assert.equal(readBinding(f.workbook, "saved-A", "member-A")?.s, "a_b");
  assert.equal(rectangle(200001, 16384), "A1:XFD200001"); assert.throws(() => rectangle(1, 16385));
});

test("refresh renames a previously prefixed sheet and keeps unrelated same-name sheets intact", () => {
  const f = fixture(); const first = finishImport(f.app, f.stage([["旧数据"]]), "Atlas_销售查询");
  const original = f.workbook.Worksheets.Item(first.s) as MockSheet;
  const other = new MockSheet("销售查询"); other.cells.set("1,1", "不能覆盖"); f.sheets.push(other);
  const binding = finishImport(f.app, f.stage([["新数据"]]), "销售查询");
  assert.equal(binding.s, "销售查询_2"); assert.equal(original.Name, binding.s);
  assert.equal(original.cells.get("2,1"), "新数据"); assert.equal(other.cells.get("1,1"), "不能覆盖");
  assert.deepEqual(captureTarget(f.app, "member-A", "saved-A").binding, binding);
});

test("binding write failure restores the original sheet name, data and metadata", () => {
  const f = fixture(); const first = finishImport(f.app, f.stage([["旧数据"]]), "Atlas_销售查询");
  const original = f.workbook.Worksheets.Item(first.s) as MockSheet; const stage = f.stage([["新数据"]]);
  let stored = f.properties[0].Value; let failOnce = true;
  Object.defineProperty(f.properties[0], "Value", {
    get() { return stored; },
    set(value: unknown) { if (failOnce) { failOnce = false; throw new Error("模拟绑定保存失败"); } stored = value; },
  });
  assert.throws(() => finishImport(f.app, stage, "销售查询"), /绑定保存失败/);
  assert.equal(original.Name, first.s); assert.equal(original.cells.get("2,1"), "旧数据");
  assert.deepEqual(readBinding(f.workbook, "saved-A", "member-A"), first);
  discardImport(f.app, stage); assert.equal(f.workbook.Worksheets.Count, 2);
});

test("resuming without selected query metadata preserves the bound result name", () => {
  const f = fixture(); const first = finishImport(f.app, f.stage([["旧数据"]]), "销售查询");
  const binding = finishImport(f.app, f.stage([["新数据"]]));
  assert.equal(binding.s, first.s); assert.equal((f.workbook.Worksheets.Item(first.s) as MockSheet).cells.get("2,1"), "新数据");
});

test("sheet names honor case-insensitive collisions and the 31-character limit", () => {
  const f = fixture(); f.sheets.push(new MockSheet("sales"));
  assert.equal(finishImport(f.app, f.stage([[1]]), "Sales").s, "Sales_2");
  const g = fixture(); const name = "长".repeat(40); g.sheets.push(new MockSheet(name.slice(0, 31)));
  const binding = finishImport(g.app, g.stage([[1]]), name);
  assert.equal(binding.s, `${name.slice(0, 29)}_2`); assert.equal(binding.s.length, 31);
});
