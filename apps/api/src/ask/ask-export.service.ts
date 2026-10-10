import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { AskSavedQueryResult } from "@eureka-atlas/types" with { "resolution-mode": "import" };

@Injectable()
export class AskExportService {
  async workbook(result: AskSavedQueryResult) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Eureka Atlas";
    workbook.created = new Date();
    const data = workbook.addWorksheet("数据");
    const query = result.execution;
    const headers = query.result?.columns ?? [];
    data.addRow(headers.map((column) => column.name));
    const header = data.getRow(1); header.font = { bold: true, color: { argb: "FFFFFFFF" } }; header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    for (const row of query.result?.rows ?? []) data.addRow(row.map((value, index) => value === null ? "[NULL]" : this.value(value, headers[index]?.type)));
    data.views = [{ state: "frozen", ySplit: 1 }]; data.autoFilter = { from: "A1", to: { row: Math.max(1, data.rowCount), column: Math.max(1, headers.length) } };
    headers.forEach((column, index) => { const cell = data.getColumn(index + 1); cell.width = Math.min(48, Math.max(12, column.name.length * 2 + 4)); if (["BIGINT", "DECIMAL", "INTEGER"].includes(column.type)) cell.numFmt = "@"; });
    const notes = workbook.addWorksheet("查询说明");
    const rows: Array<[string, string]> = [
      ["来源业务表", result.source.business_name], ["物理表", result.source.physical_name], ["项目", result.source.project], ["catalog", result.source.catalog], ["schema", result.source.schema], ["查询时间", query.completed_at ?? query.submitted_at], ["语义版本", query.content_version], ["实际快照日期", query.snapshot_date ?? ""], ["结果截断", query.result?.truncated ? "是：仅包含本次返回结果" : "否"], ["NULL 标记", "[NULL]；空字符串保留为空"], ["SQL", query.sql], ["查询定义", JSON.stringify(result.query_definition, null, 2)], ["沿用条件", result.condition_changes.inherited.join("、")], ["本轮调整", result.condition_changes.changed.join("、")],
    ];
    rows.forEach((row) => notes.addRow(row)); notes.getColumn(1).width = 18; notes.getColumn(2).width = 100; notes.getColumn(1).font = { bold: true }; notes.getColumn(2).alignment = { wrapText: true, vertical: "top" }; notes.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
    return workbook.xlsx.writeBuffer();
  }
  private value(value: string | number | boolean, type?: string) { return ["BIGINT", "DECIMAL", "INTEGER"].includes(type ?? "") ? String(value) : value; }
}