import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { Writable } from "node:stream";
import type { QueryResultColumn } from "@eureka-atlas/types" with { "resolution-mode": "import" };
import { DataQueryService } from "./data-query.service";
const safeCell = (value: unknown): string | boolean | null => {
  if(value === null)return null;
  if(typeof value === "boolean")return value;
  const text = String(value);
  // Preserve precision as Excel strings; neutralize formula / DDE prefixes.
  return !/^-?\d+(?:\.\d+)?$/.test(text) && /^[=+@\-\t\r\n]/.test(text) ? "'"+text : text;
};
@Injectable()
export class DataQueryExportService {
  constructor(private readonly queries: DataQueryService) {}
  async write(member: string,item: Awaited<ReturnType<DataQueryService["ready"]>>,stream: Writable) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({stream,useStyles:true,useSharedStrings:false,zip:{store:true}});
    const data = workbook.addWorksheet("数据");
    const columns = item.resultColumns as unknown as QueryResultColumn[];
    data.columns = columns.map(column => ({width:Math.min(48,Math.max(14,column.name.length*2)),style:{numFmt:"@"}}));
    data.addRow(columns.map(column => safeCell(column.name))).commit();
    for await(const row of this.queries.rows(member,item.id)) {
      if(stream.destroyed)throw new Error("下载连接已关闭");
      data.addRow(row.map(safeCell)).commit();
      // Yield to archiver / response backpressure instead of buffering 200,000 rows.
      if(stream.writableNeedDrain)await new Promise<void>((resolve,reject) => {const cleanup=()=>{stream.off("drain",drain);stream.off("close",close);};const drain=()=>{cleanup();resolve();};const close=()=>{cleanup();reject(new Error("下载连接已关闭"));};stream.once("drain",drain);stream.once("close",close);});
    }
    data.commit();
    const notes = workbook.addWorksheet("查询说明");
    notes.columns = [{width:20},{width:100}];
    for(const row of [["查询 ID",item.id],["语义版本",item.contentVersion],["快照日期",item.snapshotDate ?? ""],["保存行数",item.resultRowCount],["结果上限",200000],["超过上限",item.truncated ? "是，仅导出已保存的 200000 行" : "否"],["空值","NULL 导出为空白单元格；空字符串保留为空；文本 NULL 和 [NULL] 原样保留"],["精度","整数与小数以文本保存；公式前缀添加单引号"],["请求",JSON.stringify(item.request)],["实际日期",JSON.stringify(item.resolvedDates)],["SQL",item.sql]])notes.addRow(row.map(safeCell)).commit();
    notes.commit(); await workbook.commit();
  }
}
