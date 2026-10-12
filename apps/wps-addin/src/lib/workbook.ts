import type { DataQueryExecution, DataQueryResultPage, QueryResult } from "@eureka-atlas/types";
import type { WpsApplication, WpsWorkbook } from "./host.ts";

export interface Range {
  Value2: unknown;
  NumberFormat: string;
  MergeCells: boolean | null;
  HasArray: boolean | null;
  Copy(destination: Range): void;
  ClearContents(): void;
}
export interface Worksheet {
  Name: string;
  ProtectContents: boolean;
  Range(address: string): Range;
  Delete(): void;
  Activate(): void;
}
interface Property { Name: string; Value: unknown }
interface Properties { Count: number; Item(index: number | string): Property; Add(name: string, link: boolean, type: number, value: string): Property }
export interface Workbook extends WpsWorkbook {
  ProtectStructure: boolean;
  Worksheets: { Count: number; Item(index: number | string): Worksheet; Add(): Worksheet };
  CustomDocumentProperties: Properties;
}
export interface Application extends WpsApplication { DisplayAlerts: boolean }
export type Binding = { v: 1; m: string; q: string; s: string; r: number; c: number };
export type ImportTarget = { workbook: Workbook; path: string; name: string; member: string; savedId: string; binding: Binding | null };
export type StagedImport = { target: ImportTarget; sheet: Worksheet; item: DataQueryExecution; written: number; finished: boolean };

const propertyName = (id: string) => `AtlasQ_${id}`;
function property(workbook: Workbook, id: string): Property | undefined {
  const properties = workbook.CustomDocumentProperties;
  if (!properties || typeof properties.Add !== "function") throw new Error("当前 WPS 不支持保存查询绑定，请停止写入并反馈版本信息");
  for (let i = 1; i <= properties.Count; i++) {
    const item = properties.Item(i);
    if (item.Name === propertyName(id)) return item;
  }
}
export function readBinding(workbook: Workbook, savedId: string, member: string): Binding | null {
  const stored = property(workbook, savedId);
  if (!stored) return null;
  let value: Binding;
  try { value = JSON.parse(String(stored.Value)) as Binding; } catch { throw new Error("工作簿查询绑定已损坏，不能自动覆盖数据"); }
  if (value.v !== 1 || value.q !== savedId || value.m !== member) throw new Error("该结果表绑定了其他账号或查询，不能刷新");
  if (typeof value.s !== "string" || !Number.isInteger(value.r) || value.r < 1 || value.r > 200001 || !Number.isInteger(value.c) || value.c < 1 || value.c > 16384) throw new Error("工作簿查询绑定范围无效");
  return value;
}
export function captureTarget(app: WpsApplication, member: string, savedId: string): ImportTarget {
  const workbook = app.ActiveWorkbook as Workbook | null;
  if (!workbook?.Worksheets || !workbook.CustomDocumentProperties) throw new Error("请打开支持自定义属性的 WPS 表格工作簿，建议使用 .xlsx 格式");
  if (workbook.ReadOnly || workbook.ProtectStructure) throw new Error("工作簿只读或结构已保护，无法导入");
  return { workbook, path: workbook.FullName, name: workbook.Name, member, savedId, binding: readBinding(workbook, savedId, member) };
}
export function loadedQueries(app: WpsApplication, member: string): { savedId: string; sheet: string }[] {
  const workbook = app.ActiveWorkbook as Workbook | null;
  if (!workbook?.CustomDocumentProperties) throw new Error('请打开支持查询绑定的工作簿');
  const result = [];
  for (let i = 1; i <= workbook.CustomDocumentProperties.Count; i++) {
    const item = workbook.CustomDocumentProperties.Item(i);
    if (!item.Name.startsWith('AtlasQ_')) continue;
    let value: Binding;
    try { value = JSON.parse(String(item.Value)); } catch { throw new Error('工作簿中存在损坏的查询绑定，请先修复'); }
    if (value.m !== member) continue;
    const savedId = item.Name.slice('AtlasQ_'.length);
    const binding = readBinding(workbook, savedId, member)!;
    result.push({ savedId, sheet: binding.s });
  }
  return result;
}
function assertTarget(app: WpsApplication, target: ImportTarget) {
  if (app.ActiveWorkbook?.FullName !== target.path || app.ActiveWorkbook?.Name !== target.name) throw new Error("当前工作簿已切换或另存，未更新原表。请回到原工作簿后重新读取任务");
  if (target.workbook.ReadOnly || target.workbook.ProtectStructure) throw new Error("工作簿已变为只读或受保护");
  if (JSON.stringify(readBinding(target.workbook, target.savedId, target.member)) !== JSON.stringify(target.binding)) throw new Error("工作簿的查询绑定已变化，请重新读取");
}
export function columnName(column: number): string {
  if (!Number.isInteger(column) || column < 1 || column > 16384) throw new Error("结果列数超出工作表上限");
  let value = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + (n - 1) % 26) + value;
  return value;
}
export const rectangle = (rows: number, columns: number) => `A1:${columnName(columns)}${rows}`;
function uniqueSheetName(workbook: Workbook, label: string, excludedName?: string): string {
  const names = new Set<string>();
  for (let i = 1; i <= workbook.Worksheets.Count; i++) {
    const name = workbook.Worksheets.Item(i).Name;
    if (name !== excludedName) names.add(name.toLowerCase());
  }
  const base = label.replace(/[\\/?*[\]:']/g, "_").trim().slice(0, 31) || "查询结果";
  let name = base;
  for (let i = 2; names.has(name.toLowerCase()); i++) {
    const suffix = `_${i}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  return name;
}
function newSheet(workbook: Workbook, label: string): Worksheet {
  const name = uniqueSheetName(workbook, label);
  const sheet = workbook.Worksheets.Add();
  sheet.Name = name;
  return sheet;
}
function deleteOwnedSheet(app: Application, sheet: Worksheet) {
  const previous = app.DisplayAlerts;
  try { app.DisplayAlerts = false; sheet.Delete(); } finally { app.DisplayAlerts = previous; }
}
function literalRows(rows: QueryResult["rows"]): QueryResult["rows"] {
  return rows.map(row => row.map(value => {
    if (typeof value === "string" && value.length > 32767) throw new Error("结果含超过单元格 32767 字符上限的内容，未覆盖原表，请使用 Atlas 导出检查");
    if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error("结果含不能精确写入的数值，未覆盖原表");
    return value;
  }));
}
export function beginImport(app: WpsApplication, target: ImportTarget, item: DataQueryExecution): StagedImport {
  assertTarget(app, target);
  if (item.status !== "SUCCEEDED" || item.row_count > 200000 || !item.columns.length) throw new Error("查询结果尚未准备好");
  columnName(item.columns.length);
  const sheet = newSheet(target.workbook, "Atlas_暂存");
  const stage = { target, sheet, item, written: 0, finished: false };
  try {
    const header = sheet.Range(rectangle(1, item.columns.length));
    header.NumberFormat = "@"; // Literal strings, including =,+,-,@ and long decimals.
    header.Value2 = literalRows([item.columns.map(column => column.name)]);
    return stage;
  } catch (cause) { discardImport(app as Application, stage); throw cause; }
}
export function appendPage(app: WpsApplication, stage: StagedImport, page: DataQueryResultPage, offset: number) {
  assertTarget(app, stage.target);
  if (stage.finished || offset !== stage.written) throw new Error("写入分页顺序不一致");
  if (stage.sheet.ProtectContents) throw new Error("暂存工作表被保护，无法继续写入");
  if (page.rows.length) {
    const range = stage.sheet.Range(`A${offset + 2}:${columnName(stage.item.columns.length)}${offset + page.rows.length + 1}`);
    if (range.MergeCells !== false || range.HasArray !== false) throw new Error("暂存区域包含合并单元格或数组公式，无法写入");
    range.NumberFormat = "@";
    range.Value2 = literalRows(page.rows);
  }
  stage.written += page.rows.length;
}
export function replacementRange(stage: StagedImport): string {
  return rectangle(Math.max(stage.item.row_count + 1, stage.target.binding?.r ?? 1), Math.max(stage.item.columns.length, stage.target.binding?.c ?? 1));
}
export function finishImport(app: Application, stage: StagedImport, queryName?: string): Binding {
  assertTarget(app, stage.target);
  if (stage.finished || stage.written !== stage.item.row_count) throw new Error("完整结果尚未写入暂存表，不能更新");
  const { target } = stage;
  const previousProperty = property(target.workbook, target.savedId);
  const oldPropertyValue = previousProperty?.Value;
  const destination = target.binding ? target.workbook.Worksheets.Item(target.binding.s) : stage.sheet;
  const originalName = destination.Name;
  if (destination.ProtectContents) throw new Error("结果工作表已保护，无法刷新");
  const area = destination.Range(replacementRange(stage));
  if (area.MergeCells !== false || area.HasArray !== false) throw new Error("目标区域含合并单元格或数组公式，无法覆盖");
  const binding: Binding = { v: 1, m: target.member, q: target.savedId, s: uniqueSheetName(target.workbook, queryName ?? target.binding?.s ?? "查询结果", originalName), r: stage.item.row_count + 1, c: stage.item.columns.length };
  let backup: Worksheet | undefined;
  let modified = false;
  try {
    if (!target.binding) {
      // Reuse the complete temporary sheet; never clear an existing worksheet.
      stage.sheet.Name = binding.s;
    }
    const serialized = JSON.stringify(binding);
    if (serialized.length > 255) throw new Error("查询绑定超过 WPS 属性长度限制，未更新原结果表");
    if (target.binding) {
      backup = newSheet(target.workbook, "Atlas_恢复备份");
      area.Copy(backup.Range("A1"));
      modified = true;
      stage.sheet.Range(rectangle(binding.r, binding.c)).Copy(destination.Range("A1"));
      if (target.binding.r > binding.r) destination.Range(`A${binding.r + 1}:${columnName(target.binding.c)}${target.binding.r}`).ClearContents();
      if (target.binding.c > binding.c) destination.Range(`${columnName(binding.c + 1)}1:${columnName(target.binding.c)}${Math.min(binding.r, target.binding.r)}`).ClearContents();
      if (destination.Name !== binding.s) destination.Name = binding.s;
    }
    if (previousProperty) previousProperty.Value = serialized;
    else target.workbook.CustomDocumentProperties.Add(propertyName(target.savedId), false, 4, serialized);
    if (JSON.stringify(readBinding(target.workbook, target.savedId, target.member)) !== serialized) throw new Error("WPS 未确认保存查询绑定，未完成更新");
    stage.finished = true;
  } catch (cause) {
    if (modified && backup) {
      try { backup.Range(replacementRange(stage)).Copy(destination.Range("A1")); if (destination.Name !== originalName) destination.Name = originalName; if (previousProperty) previousProperty.Value = oldPropertyValue; }
      catch { throw new Error(`更新失败且自动恢复失败。原数据备份保留在“${backup.Name}”，请勿保存覆盖原文件，先手动恢复。`); }
    }
    if (backup) deleteOwnedSheet(app, backup);
    throw cause;
  }
  // Cleanup is best-effort after a successful commit, not a failed import.
  try { if (backup) deleteOwnedSheet(app, backup); if (target.binding) deleteOwnedSheet(app, stage.sheet); } catch { /* Only Atlas-owned staging/backup sheets can remain. */ }
  try { destination.Activate(); } catch { /* A committed result remains valid even if the host cannot activate it. */ }
  return binding;
}
export function discardImport(app: Application, stage: StagedImport) {
  if (!stage.finished) {
    try { deleteOwnedSheet(app, stage.sheet); } catch { /* Keep the incomplete Atlas temporary sheet; never touch the bound result. */ }
    stage.finished = true;
  }
}
