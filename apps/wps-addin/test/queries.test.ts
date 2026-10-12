import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import type { DataQueryExecution, DataQueryResultPage } from "@eureka-atlas/types";
import { api, ApiError, type Api } from "../src/lib/api.ts";
import { cancelQuery, shouldResume, readPending, storePending, submitSaved, waitForResult, readResultPages, pause } from "../src/lib/queries.ts";
import { validateLocalRequest, atlasProxy } from "../local-proxy.ts";

const result = (count = 0): DataQueryExecution => ({ id: "execution", status: "SUCCEEDED", row_count: count, columns: [{ id: "field", name: "金额", type: "decimal", unit: null }], expires_at: new Date(Date.now() + 86400000).toISOString() } as DataQueryExecution);
const mockApi = (handler: (path: string, options?: RequestInit) => unknown): Api => async <T>(path: string, options?: RequestInit) => await handler(path, options) as T;

test("main query action resumes its own pending task without a separate resume button", () => {
  const pending = { member: "A", savedId: "saved-A", queryId: "execution" };
  assert.equal(shouldResume(undefined, pending), true);
  assert.equal(shouldResume("saved-A", pending), true);
  assert.equal(shouldResume("saved-B", pending), false);
  assert.equal(shouldResume("saved-A", null), false);
});

test("single cancellation stops local reads before requesting backend cancellation", async () => {
  const local = new AbortController();
  const item = await cancelQuery(mockApi((path, options) => {
    assert.equal(local.signal.aborted, true);
    assert.equal(path, "/data-queries/own%2Ftask/cancel");
    assert.equal(options?.method, "POST");
    assert.equal(options?.signal, undefined);
    return { ...result(), status: "CANCELLING" };
  }), "own/task", local);
  assert.equal(item.status, "CANCELLING");
});

test("cancellation failure does not destroy pending metadata or pretend success", async () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  storePending(storage, { member: "A", savedId: "saved", queryId: "execution" });
  const local = new AbortController();
  await assert.rejects(cancelQuery(mockApi(() => { throw new ApiError(503, "不可用"); }), "execution", local), /不可用/);
  assert.equal(local.signal.aborted, true);
  assert.equal(readPending(storage, "A")?.queryId, "execution");
});

test("saved query submit reads latest config and never sends account or tokens", async () => {
  const config = { table_id: "table", mode: "DETAIL", field_ids: ["field"], filters: [{ field_id: "date", preset: "LAST_7_DAYS" }] };
  const calls: string[] = [];
  await submitSaved(mockApi((path, options) => {
    calls.push(path);
    if (path.startsWith("/saved")) return { config, validation_errors: [] };
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.filters, config.filters);
    assert.match(body.idempotency_key, /^[a-f0-9-]{36}$/);
    assert.equal(body.ownerMemberNo, undefined); assert.equal(body.token, undefined);
    return result();
  }), "saved", new AbortController().signal);
  assert.deepEqual(calls, ["/saved-data-queries/saved", "/data-queries"]);
});
test("invalid saved configuration cannot submit an execution", async () => {
  let calls = 0;
  await assert.rejects(submitSaved(mockApi(() => { calls++; return { validation_errors: ["字段已删除"] }; }), "saved", new AbortController().signal), /字段已删除/);
  assert.equal(calls, 1);
});
test("pending execution metadata is account scoped and excludes results and credentials", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  storePending(storage, { member: "A", savedId: "saved-A", queryId: "query-A" });
  assert.equal(readPending(storage, "B"), null);
  assert.equal(readPending(storage, "A")?.queryId, "query-A");
  data.set("atlas-wps:pending:B", data.get("atlas-wps:pending:A")!);
  assert.equal(readPending(storage, "B"), null);
  assert.ok(![...data.values()].join().includes("token"));
});
test("polls until ready, rejects timed-out, cancelled, failed and expired executions", async () => {
  let calls = 0;
  const ready = await waitForResult(mockApi(() => ++calls === 1 ? { ...result(), status: "RUNNING" } : result()), "execution", new AbortController().signal, () => {}, async () => {});
  assert.equal(ready.status, "SUCCEEDED"); assert.equal(calls, 2);
  for (const status of ["FAILED", "CANCELLED", "TIMED_OUT"]) await assert.rejects(waitForResult(mockApi(() => ({ ...result(), status })), "execution", new AbortController().signal, () => {}));
  await assert.rejects(waitForResult(mockApi(() => ({ ...result(), expires_at: "2000-01-01" })), "execution", new AbortController().signal, () => {}), /过期/);
});
test("aborting local polling never sends a cloud cancellation", async () => {
  const abort = new AbortController();
  const paths: string[] = [];
  await assert.rejects(waitForResult(mockApi(path => { paths.push(path); abort.abort(); return { ...result(), status: "RUNNING" }; }), "execution", abort.signal, () => {}));
  assert.equal(paths.length, 1); assert.ok(paths.every(path => !path.includes("cancel")));
});
test("503 and 404 polling failures are surfaced without retrying as another account", async () => {
  for (const status of [401, 404, 503]) await assert.rejects(waitForResult(mockApi(() => { throw new ApiError(status, "失败"); }), "execution", new AbortController().signal, () => {}), error => error instanceof ApiError && error.status === status);
});
for (const count of [0, 10001, 200000]) {
  test(`reads ${count} rows in <=500-row batches without omissions or duplicates`, async () => {
    const item = result(count); let written = 0; let calls = 0;
    await readResultPages(mockApi(path => {
      calls++; const page = Number(new URL(`http://test${path}`).searchParams.get("page"));
      const offset = (page - 1) * 500;
      return { columns: item.columns, page, page_size: 500, total: count, rows: Array.from({ length: Math.min(500, count - offset) }, (_, i) => [String(offset + i)]) };
    }), item, new AbortController().signal, (page, offset) => { assert.equal(offset, written); assert.equal(page.rows[0]?.[0], page.rows.length ? String(offset) : undefined); written += page.rows.length; });
    assert.equal(written, count); assert.equal(calls, Math.max(1, Math.ceil(count / 500)));
  });
}
test("incomplete or changed result pages cannot be committed", async () => {
  const item = result(2);
  for (const change of [{ rows: [["0"]] }, { total: 3 }, { page: 2 }, { columns: [] }]) {
    let writes = 0;
    await assert.rejects(readResultPages(mockApi(() => ({ columns: item.columns, rows: [["0"], ["1"]], total: 2, page: 1, page_size: 500, ...change })), item, new AbortController().signal, () => { writes++; }), /不完整/);
    assert.equal(writes, 0);
  }
});
test("late pages after account teardown are discarded", async () => {
  const abort = new AbortController(); let writes = 0;
  await assert.rejects(readResultPages(mockApi(() => { abort.abort(); return { columns: result().columns, rows: [["0"]], total: 1, page: 1, page_size: 500 } as DataQueryResultPage; }), result(1), abort.signal, () => { writes++; }));
  assert.equal(writes, 0);
});
test("abortable polling sleep cleans up immediately", async () => {
  const abort = new AbortController(); const waiting = pause(abort.signal, 60000); abort.abort(); await assert.rejects(waiting, /停止等待/);
});
test("local API proxy rejects CSRF, absent write origins, foreign hosts and DNS rebinding", () => {
  const request = (headers: Record<string, string | undefined>, method = "POST") => ({ headers, method }) as IncomingMessage;
  assert.equal(validateLocalRequest(request({ host: "127.0.0.1:3889", origin: "http://127.0.0.1:3889", "sec-fetch-site": "same-origin" })), true);
  assert.equal(validateLocalRequest(request({ host: "localhost:3889", origin: "http://localhost:3889" })), true);
  assert.equal(validateLocalRequest(request({ host: "127.0.0.1:3889" }, "GET")), true);
  for (const headers of [{ host: "127.0.0.1:3889" }, { host: "evil.test:3889", origin: "http://evil.test:3889" }, { host: "127.0.0.1:3889", origin: "https://evil.test" }, { host: "127.0.0.1:3889", origin: "http://127.0.0.1:3889", "sec-fetch-site": "cross-site" }]) assert.equal(validateLocalRequest(request(headers)), false);
  assert.equal(atlasProxy["/api"].target, "http://127.0.0.1:3001");
});
test("API keeps auth in cookies and distinguishes outages from authentication errors", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (path: string, options: RequestInit) => {
    calls++; assert.equal(path, "/api/auth/me"); assert.equal(options.credentials, "include"); assert.equal(options.redirect, "error");
    assert.equal((options.headers as Record<string, string>).Authorization, undefined);
    return Response.json({ message: "服务不可用" }, { status: calls === 1 ? 503 : 401 });
  });
  await assert.rejects(api("/auth/me"), error => error instanceof ApiError && error.status === 503);
  await assert.rejects(api("/auth/me"), error => error instanceof ApiError && error.status === 401);
  await assert.rejects(api("//evil.test/path"));
});
