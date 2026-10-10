export function toTsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map((cell) => (cell === null ? "NULL" : String(cell ?? "")).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}
