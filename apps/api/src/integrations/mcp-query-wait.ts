import { setTimeout as delay } from "node:timers/promises";
const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
/** Read-only, bounded wait. It never submits, cancels or restarts a query. */
export async function waitForMcpQuery<T extends { id: string; status: string }>(
  initial: T,
  read: () => Promise<T>,
  waitMs: number,
): Promise<T> {
  const deadline = Date.now() + waitMs;
  let current = initial;
  while (!terminal.has(current.status) && Date.now() < deadline) {
    await delay(Math.min(250, Math.max(0, deadline - Date.now())));
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = await Promise.race([
      read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), remaining);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (!next) break;
    current = next;
  }
  return current;
}
