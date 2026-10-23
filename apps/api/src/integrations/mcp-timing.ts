import { performance } from "node:perf_hooks";
export type McpTimings = Partial<
  Record<
    "auth" | "tool" | "scope" | "packages" | "submit" | "wait" | "result",
    number
  >
>;
export async function timed<T>(
  timings: McpTimings,
  name: keyof McpTimings,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    timings[name] =
      Math.round(((timings[name] ?? 0) + performance.now() - start) * 100) /
      100;
  }
}
export function serverTiming(timings: McpTimings): string {
  return Object.entries(timings)
    .filter(
      ([key, value]) =>
        [
          "auth",
          "tool",
          "scope",
          "packages",
          "submit",
          "wait",
          "result",
        ].includes(key) && Number.isFinite(value),
    )
    .map(([key, value]) => `${key};dur=${value}`)
    .join(", ");
}
