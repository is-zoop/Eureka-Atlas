import BigNumber from "bignumber.js";
import {
  isPercentUnit,
  resolveResultDisplay,
  unitScalePower,
  type ResultDisplayFormat,
} from "./display";
export type DisplayColumn = {
  name: string;
  type: string;
  unit: string | null;
  display?: ResultDisplayFormat;
};
export type DisplayResult = {
  columns: DisplayColumn[];
  rows: Array<Array<string | number | boolean | null>>;
  truncated: boolean;
};

export function columnDisplay(column: DisplayColumn): ResultDisplayFormat {
  return (
    column.display ??
    resolveResultDisplay({
      type: column.type,
      unit: column.unit,
      metric: Boolean(column.unit),
    })
  );
}
export function resultColumnLabel(column: DisplayColumn): string {
  return column.unit && !column.name.endsWith(`（${column.unit}）`)
    ? `${column.name}（${column.unit}）`
    : column.name;
}
/** Exact unit conversion for charts and presentation; never modifies saved raw values. */
export function convertUnitValue(
  value: string | number,
  unit: string | null,
): string {
  const raw = String(value),
    power = unitScalePower(unit);
  if (!power || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))
    return raw;
  const numeric = new BigNumber(raw);
  return numeric.isFinite() && Math.abs(numeric.e ?? 0) <= 512
    ? numeric.shiftedBy(power).toFixed()
    : raw;
}
export function formatResultCell(
  value: unknown,
  column: DisplayColumn,
): string {
  if (value === null || value === undefined) return "—";
  const raw = String(value),
    format = columnDisplay(column);
  if (
    format.style === "TEXT" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
  )
    return raw;
  const numeric = new BigNumber(convertUnitValue(raw, column.unit));
  if (!numeric.isFinite() || (numeric.e ?? 0) > 512) return raw;
  let rendered = numeric.toFixed(
    format.decimal_places,
    BigNumber.ROUND_HALF_UP,
  );
  if (new BigNumber(rendered).isZero()) rendered = rendered.replace(/^-/, "");
  return (
    rendered +
    (isPercentUnit(column.unit)
      ? "%"
      : ["‰", "千分比"].includes(column.unit?.trim() ?? "")
        ? "‰"
        : "")
  );
}
const escapeMarkdown = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
/** Bounded presentation only; never mutates raw results or recomputes business aggregates. */
export function buildResultPresentation(
  result: DisplayResult,
  maxRows = 100,
  maxCharacters = 32768,
) {
  const headers = result.columns.map(resultColumnLabel),
    rows: string[][] = [];
  const lines = [
    "| " + headers.map(escapeMarkdown).join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |",
  ];
  let characters = lines.join("\n").length;
  for (const raw of result.rows.slice(0, maxRows)) {
    const row = result.columns.map((c, i) => formatResultCell(raw[i], c));
    const line = "| " + row.map(escapeMarkdown).join(" | ") + " |";
    if (characters + line.length + 1 > maxCharacters) break;
    rows.push(row);
    lines.push(line);
    characters += line.length + 1;
  }
  return {
    headers,
    rows,
    markdown: result.rows.length ? lines.join("\n") : "没有符合条件的数据。",
    displayed_rows: rows.length,
    saved_rows: result.rows.length,
    truncated: result.truncated || rows.length < result.rows.length,
  };
}
