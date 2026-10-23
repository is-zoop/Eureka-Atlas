/** Computed result metadata only; governance maintains the existing unit, not a format config. */
export type ResultDisplayFormat = {
  style: "TEXT" | "NUMBER";
  decimal_places: number;
};
export const DEFAULT_DECIMAL_PLACES = 2;
export const isPercentUnit = (unit: string | null | undefined) =>
  ["%", "％", "百分比"].includes(unit?.trim() ?? "");

/** Raw amounts/counts use base units. The governed unit selects the display magnitude. */
export function unitScalePower(unit: string | null | undefined): number {
  const value = unit?.trim() ?? "";
  if (isPercentUnit(value)) return 2;
  if (["‰", "千分比"].includes(value)) return 3;
  const prefixes: Array<[string, number]> = [
    ["万亿", -12],
    ["千亿", -11],
    ["百亿", -10],
    ["十亿", -9],
    ["亿", -8],
    ["千万", -7],
    ["百万", -6],
    ["十万", -5],
    ["万", -4],
  ];
  for (const [prefix, power] of prefixes)
    if (value.startsWith(prefix)) return power;
  // Do not mistake physical units such as 千克/千瓦 for monetary magnitudes.
  if (value === "千元") return -3;
  if (value === "百元") return -2;
  return 0;
}

export function resolveResultDisplay(input: {
  type: string;
  unit?: string | null;
  metric: boolean;
  aggregation?: string | null;
}): ResultDisplayFormat {
  if (!input.metric) return { style: "TEXT", decimal_places: 0 };
  const number =
    /^(TINYINT|SMALLINT|INTEGER|DECIMAL|NUMBER|BIGINT|INT|FLOAT|DOUBLE|NUMERIC|REAL)/i.test(
      input.type,
    );
  const integer =
    (/^(TINYINT|SMALLINT|INTEGER|BIGINT|INT)/i.test(input.type) &&
      input.aggregation !== "AVG") ||
    ["COUNT", "COUNT_DISTINCT"].includes(input.aggregation ?? "");
  return {
    style: number ? "NUMBER" : "TEXT",
    decimal_places:
      unitScalePower(input.unit) !== 0
        ? DEFAULT_DECIMAL_PLACES
        : integer
          ? 0
          : DEFAULT_DECIMAL_PLACES,
  };
}
