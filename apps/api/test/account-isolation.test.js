const test = require("node:test");
const assert = require("node:assert/strict");
const { Test } = require("@nestjs/testing");
const { APP_GUARD } = require("@nestjs/core");
const { prisma } = require("@eureka-atlas/database");
const { AuthController } = require("../dist/auth/auth.controller");
const { AuthService } = require("../dist/auth/auth.service");
const { AuthGuard } = require("../dist/auth/auth.guard");
const { HazeAuthService } = require("../dist/auth/haze-auth.service");
const { CredentialCryptoService } = require("../dist/datasource/credential-crypto.service");
const { AskController } = require("../dist/ask/ask.controller");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { AskEventService } = require("../dist/ask/ask-event.service");
const { AskExportService } = require("../dist/ask/ask-export.service");
const { QueryController } = require("../dist/query/query.controller");
const { QueryExecutionService } = require("../dist/query/query-execution.service");
const { createClarification } = require("../dist/ask/ask-clarification");

const now = new Date();
const profile = member => ({ member_no: member, name: member, phone: member === "A" ? "13800000001" : "13800000002", email: null, avatar_url: null, department: "测试", role_code: "USER", role_name: "使用者", status: "active" });
const session = (id, ownerMemberNo) => ({ id, ownerMemberNo, title: id, tableIds: [], modelConfigId: "model", thinkingLevel: "off", configurationVersion: 1, createdAt: now, updatedAt: now });
const query = (id, ownerMemberNo) => ({ id, ownerMemberNo, metaTableId: "table", dataSourceId: "source", status: "SUCCEEDED", request: {}, sql: "SELECT 1", contentVersion: "v", snapshotDate: null, result: { columns: [{ name: "数值", type: "INTEGER" }], rows: [["1"]], truncated: false }, submittedAt: now, completedAt: now, expiresAt: new Date(Date.now() + 3600000) });
const run = (id, askSessionId) => ({ id, askSessionId, status: "SUCCEEDED", idempotencyKey: id, question: id, answer: "回答", modelConfigId: "model", thinkingLevel: "off", tableIds: [], packageVersions: {}, loopVersion: 0, nextMessageSequence: 0, nextEventSequence: 0, startedAt: now, completedAt: now });
const snapshot = row => ({ query_id: row.id, execution: { id: row.id, status: row.status, result: row.result, content_version: "v", submitted_at: now.toISOString() }, source: { business_name: "业务表", physical_name: "table", project: "project", catalog: "", schema: "" }, query_definition: {}, condition_changes: { inherited: [], changed: [] }, saved_at: now.toISOString() });

async function fixture() {
  let role = "USER";
  const authRows = new Map();
  const sessions = new Map([["sa", session("sa", "A")], ["sb", session("sb", "B")], ["old", session("old", null)]]);
  const runs = new Map([["ra", run("ra", "sa")], ["rb", run("rb", "sb")], ["old-run", run("old-run", "old")], ["orphan", run("orphan", null)]]);
  const queries = new Map([["qa", query("qa", "A")], ["qb", query("qb", "B")], ["old-query", query("old-query", null)]]);
  const saved = new Map([["qa", { askSessionId: "sa", askRunId: "ra", queryExecutionId: "qa", createdAt: now, snapshot: snapshot(queries.get("qa")) }], ["qb", { askSessionId: "sb", askRunId: "rb", queryExecutionId: "qb", createdAt: now, snapshot: snapshot(queries.get("qb")) }]]);
  const links = [{ askRunId: "ra", queryExecutionId: "qa" }, { askRunId: "rb", queryExecutionId: "qb" }];
  const calls = { submitted: [], cancelled: [], background: [], subscriptions: 0, hazeLogout: 0 };
  const undo = [];
  let disconnect;
  const disconnected = new Promise(resolve => { disconnect = resolve; });
  let serial = 0;
  const replace = (object, key, fn) => { const old = object[key]; object[key] = fn; undo.push(() => { object[key] = old; }); };
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === "askSessionId_idempotencyKey" || key === "ownerMemberNo_idempotencyKey") return matches(row, value);
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const find = (rows, where) => [...rows.values()].find(row => matches(row, where)) || null;
  const hydratedSession = row => row && ({ ...row, runs: [...runs.values()].filter(r => r.askSessionId === row.id && ["RUNNING", "CANCELLING", "WAITING_CLARIFICATION"].includes(r.status)).slice(0, 1) });
  const hydratedRun = row => row && ({ ...row, session: sessions.get(row.askSessionId) || null, messages: [], events: [], queries: links.filter(l => l.askRunId === row.id).map(l => ({ ...l, queryExecution: queries.get(l.queryExecutionId), createdAt: now })) });
  replace(prisma.authSession, "create", async ({ data }) => { const row = { ...data, createdAt: now }; authRows.set(row.id, row); return row; });
  replace(prisma.authSession, "findUnique", async ({ where }) => find(authRows, where));
  replace(prisma.authSession, "deleteMany", async ({ where }) => {
    let count = 0;
    for (const [id, row] of authRows) if ((where.OR || [where]).some(w => w.id === id || (w.expiresAt && row.expiresAt <= w.expiresAt.lte))) { authRows.delete(id); count++; }
    return { count };
  });
  replace(prisma.askSession, "findUnique", async ({ where }) => hydratedSession(find(sessions, where)));
  replace(prisma.askSession, "findMany", async ({ where, take, cursor, skip }) => {
    let rows = [...sessions.values()].filter(row => matches(row, where)).sort((a, b) => b.id.localeCompare(a.id));
    if (cursor) rows = rows.slice(rows.findIndex(row => row.id === cursor.id) + (skip || 0));
    return rows.slice(0, take).map(hydratedSession);
  });
  replace(prisma.askSession, "create", async ({ data }) => { const row = { ...session("s" + ++serial, data.ownerMemberNo), ...data }; sessions.set(row.id, row); return hydratedSession(row); });
  replace(prisma.askSession, "update", async ({ where, data }) => {
    const row = find(sessions, where); assert.ok(row);
    Object.assign(row, data, { configurationVersion: row.configurationVersion + 1 }); return hydratedSession(row);
  });
  replace(prisma.askSession, "delete", async ({ where }) => { const row = find(sessions, where); assert.ok(row); sessions.delete(row.id); return row; });
  replace(prisma.askRun, "findUnique", async ({ where }) => hydratedRun(find(runs, where)));
  replace(prisma.askRun, "findUniqueOrThrow", async ({ where }) => { const row = hydratedRun(find(runs, where)); assert.ok(row); return row; });
  replace(prisma.askRun, "findFirst", async ({ where }) => hydratedRun(find(runs, where)));
  replace(prisma.askRun, "findMany", async ({ where, take, cursor, skip }) => {
    let rows = [...runs.values()].filter(row => matches(row, where));
    if (cursor) rows = rows.slice(rows.findIndex(row => row.id === cursor.id) + (skip || 0));
    return rows.slice(0, take).map(hydratedRun);
  });
  replace(prisma.askRun, "create", async ({ data }) => { const row = { ...run("r" + ++serial, data.askSessionId), ...data, status: "RUNNING" }; runs.set(row.id, row); return row; });
  replace(prisma.askRun, "update", async ({ where, data }) => { const row = find(runs, where); assert.ok(row); Object.assign(row, data); return hydratedRun(row); });
  replace(prisma.askRun, "updateMany", async ({ where, data }) => { const row = find(runs, where); if (!row) return { count: 0 }; Object.assign(row, data, { loopVersion: row.loopVersion + 1 }); return { count: 1 }; });
  replace(prisma.askSavedQueryResult, "findMany", async ({ where }) => [...saved.values()].filter(row => matches(row, where)));
  replace(prisma.askSavedQueryResult, "findFirst", async ({ where }) => find(saved, where));
  replace(prisma.askRunQuery, "findFirst", async ({ where }) => { const row = links.find(row => matches(row, where)); return row ? { ...row, queryExecution: queries.get(row.queryExecutionId) } : null; });
  replace(prisma.queryExecution, "findUnique", async ({ where }) => find(queries, where));
  replace(prisma.queryExecution, "create", async ({ data }) => { const row = { ...query("q" + ++serial, data.ownerMemberNo), ...data, status: "PENDING", result: null, completedAt: null }; queries.set(row.id, row); return row; });
  replace(prisma.queryExecution, "update", async ({ where, data }) => { const row = find(queries, where); assert.ok(row); Object.assign(row, data); return row; });
  replace(prisma, "$transaction", async fn => fn(prisma));
  const pkg = { table: { id: "table", query_config: { storage: "DATE_INCREMENTAL" } }, source: { id: "source", type: "MAXCOMPUTE", project: "project" }, content_version: "v" };
  const compiler = { compileQuery: () => ({ sql: "SELECT 1", outputs: [], snapshotDate: null }), compileDimensionValues: () => ({ sql: "SELECT 2", outputs: [], snapshotDate: null }) };
  const queryService = new QueryExecutionService({ get: async () => pkg }, {}, compiler);
  queryService.onModuleInit = () => {};
  queryService.clientFor = async () => ({
    submitSql: async (_, __, id) => { calls.submitted.push(id); return "remote-" + id; },
    getInstance: async () => ({ status: "RUNNING" }),
    cancelInstance: async id => { calls.cancelled.push(id); },
  });
  queryService.projectFor = async () => "project";
  const events = { publish: async () => {}, after: async () => [{ sequence: 1, type: "status", payload: { status: "SUCCEEDED" } }], subscribe: () => { calls.subscriptions++; return () => { calls.subscriptions--; disconnect(); }; } };
  const runtime = { modelConfigId: "model", thinkingLevels: ["off"], defaultThinkingLevel: "off" };
  const ask = new AskRunService({ resolve: async () => ({ tableIds: ["table"], packages: new Map([["table", pkg]]) }) }, { agentRuntime: async () => runtime }, queryService, events, {});
  ask.onModuleInit = async () => {};
  ask.run = async id => { calls.background.push(id); };
  const haze = { login: async phone => { const member = phone === profile("A").phone ? "A" : "B"; return { user: profile(member), token: member, expiresIn: 3600 }; }, me: async token => ({ ...profile(token), role_code: role }) };
  const crypto = { encrypt: value => "encrypted:" + value, decrypt: value => value.slice(10) };
  const module = await Test.createTestingModule({
    controllers: [AuthController, AskController, QueryController],
    providers: [AuthService, { provide: HazeAuthService, useValue: haze }, { provide: CredentialCryptoService, useValue: crypto }, { provide: APP_GUARD, useClass: AuthGuard },
      { provide: AskRunService, useValue: ask }, { provide: QueryExecutionService, useValue: queryService }, { provide: AskEventService, useValue: events }, AskExportService],
  }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
  const request = (path, cookie, method = "GET", body) => fetch(base + "/api" + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = async (member, previousCookie) => { const response = await request("/auth/login", previousCookie, "POST", { phone: profile(member).phone, password: "mock-password" }); assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0]; };
  let a, b;
  try { a = await login("A"); b = await login("B"); }
  catch (error) { await app.close(); undo.reverse().forEach(fn => fn()); throw error; }
  return { request, login, a, b, setRole(value) { role = value; }, disconnected, ask, queryService, sessions, runs, queries, calls, async close() { await app.close(); undo.reverse().forEach(fn => fn()); } };
}

test("all four roles including system administrator remain restricted to their own history", async () => {
  const f = await fixture();
  try {
    for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER"]) {
      f.setRole(role);
      assert.equal((await f.request("/ask/sessions/sa", f.a)).status, 200);
      assert.equal((await f.request("/queries/qa/result", f.a)).status, 200);
      for (const path of ["/ask/sessions/sb", "/ask/sessions/old", "/ask/runs/rb", "/ask/runs/rb/events", "/ask/runs/rb/queries/qb/export", "/queries/qb/result", "/queries/old-query/result"]) {
        assert.equal((await f.request(path, f.a)).status, 404, `${role} ${path}`);
      }
      assert.equal((await f.request("/ask/sessions/sb", f.a, "DELETE")).status, 404);
      assert.equal((await f.request("/queries/qb/cancel", f.a, "POST")).status, 404);
    }
  } finally { await f.close(); }
});

test("session lists, scoped cursors, create/update/delete and legacy records are isolated", async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await (await f.request("/ask/sessions", f.a)).json()).items.map(s => s.id), ["sa"]);
    assert.deepEqual((await (await f.request("/ask/sessions", f.b)).json()).items.map(s => s.id), ["sb"]);
    for (const id of ["sb", "old", "missing"]) {
      assert.equal((await f.request("/ask/sessions/" + id, f.a)).status, 404);
      assert.equal((await f.request("/ask/sessions/" + id, f.a, "PATCH", { title: "篡改", expected_configuration_version: 1 })).status, 404);
      assert.equal((await f.request("/ask/sessions/" + id, f.a, "DELETE")).status, 404);
      assert.equal((await f.request("/ask/sessions/" + id + "/runs", f.a)).status, 404);
    }
    assert.equal((await f.request("/ask/sessions?cursor=sb", f.a)).status, 404);
    assert.equal((await f.request("/ask/sessions/sa/runs?cursor=rb", f.a)).status, 404);
    assert.equal((await f.request("/ask/sessions/sa/runs?cursor=ra", f.a)).status, 200);
    const created = await (await f.request("/ask/sessions", f.a, "POST", { ownerMemberNo: "B", title: "个人会话" })).json();
    assert.equal(f.sessions.get(created.id).ownerMemberNo, "A");
    assert.equal((await f.request("/ask/sessions/" + created.id, f.b)).status, 404);
    assert.equal((await f.request("/ask/sessions/" + created.id, f.a, "PATCH", { title: "新标题", expected_configuration_version: 1 })).status, 200);
    assert.equal((await f.request("/ask/sessions/" + created.id, f.a, "DELETE")).status, 204);
    assert.ok(f.sessions.has("old")); assert.equal(f.sessions.get("sb").title, "sb");
    await assert.rejects(f.ask.listSessions(undefined), error => error.getStatus() === 401);
  } finally { await f.close(); }
});

test("run details, clarifications, cancellation, SSE, results and exports enforce ownership", async () => {
  const f = await fixture();
  try {
    for (const id of ["rb", "old-run", "orphan"]) {
      for (const suffix of ["", "/events", "/queries/qb/result", "/queries/qb/export"]) assert.equal((await f.request("/ask/runs/" + id + suffix, f.a)).status, 404);
      assert.equal((await f.request("/ask/runs/" + id + "/clarifications", f.a, "POST", { clarification_id: "c" })).status, 404);
      assert.equal((await f.request("/ask/runs/" + id + "/cancel", f.a, "POST")).status, 404);
    }
    assert.equal((await f.request("/ask/runs/ra", f.a)).status, 200);
    assert.equal((await f.request("/ask/runs/ra/queries/qb/result", f.a)).status, 404);
    assert.equal((await f.request("/ask/runs/ra/queries/qa/result", f.a)).status, 200);
    const exported = await f.request("/ask/runs/ra/queries/qa/export", f.a);
    assert.equal(exported.status, 200); assert.match(exported.headers.get("content-type"), /spreadsheet/);
    assert.ok((await exported.arrayBuffer()).byteLength > 0);
    const stream = await f.request("/ask/runs/ra/events", f.a); assert.equal(stream.status, 200);
    const reader = stream.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /event: status/); await reader.cancel();
    await f.disconnected; assert.equal(f.calls.subscriptions, 0);
    const waiting = f.runs.get("ra"); waiting.status = "WAITING_CLARIFICATION"; waiting.clarificationId = "c";
    waiting.clarification = createClarification("c", { question: "请选择日期", selection_mode: "single", options: [] });
    assert.equal((await f.request("/ask/runs/ra/clarifications", f.a, "POST", { clarification_id: "c", selected_option_ids: [], custom_text: "2026年" })).status, 201);
    assert.equal(f.calls.background.length, 1);
    assert.equal((await f.request("/ask/runs/ra/cancel", f.a, "POST")).status, 200);
    assert.equal(f.runs.get("rb").status, "SUCCEEDED");
  } finally { await f.close(); }
});

test("query debugging uses server identity, scoped idempotency and no generic-query bypass", async () => {
  const f = await fixture();
  try {
    for (const id of ["qb", "old-query", "missing"]) {
      assert.equal((await f.request("/queries/" + id, f.a)).status, 404);
      assert.equal((await f.request("/queries/" + id + "/result", f.a)).status, 404);
      assert.equal((await f.request("/queries/" + id + "/cancel", f.a, "POST")).status, 404);
    }
    assert.equal((await f.request("/queries/qa", f.a)).status, 200);
    assert.equal((await f.request("/queries/qa/result", f.a)).status, 200);
    const body = { table_id: "table", metric_ids: ["metric"], idempotency_key: "same", ownerMemberNo: "B" };
    const first = await (await f.request("/queries", f.a, "POST", body)).json();
    const again = await (await f.request("/queries", f.a, "POST", body)).json();
    const other = await (await f.request("/queries", f.b, "POST", body)).json();
    assert.equal(first.id, again.id); assert.notEqual(first.id, other.id); assert.equal(f.queries.get(first.id).ownerMemberNo, "A");
    assert.equal(f.calls.submitted.length, 2);
    assert.equal((await f.request("/queries", f.a, "POST", { ...body, metric_ids: ["changed"] })).status, 409);
    assert.equal((await f.request("/queries/" + first.id + "/cancel", f.b, "POST")).status, 404);
    assert.equal((await f.request("/queries/" + first.id + "/cancel", f.a, "POST")).status, 201);
    assert.equal(f.calls.cancelled.length, 1);
    const dimension = await (await f.request("/queries/dimension-values", f.a, "POST", { table_id: "table", field_id: "field", idempotency_key: "dimension" })).json();
    assert.equal(f.queries.get(dimension.id).ownerMemberNo, "A");
    assert.equal((await f.request("/queries/dimension-values", f.a, "POST", { table_id: "table", field_id: "changed", idempotency_key: "dimension" })).status, 409);
    await assert.rejects(f.queryService.get(undefined, "qa"), error => error.getStatus() === 401);
  } finally { await f.close(); }
});

test("run retries are scoped to sessions and logout never deletes history or stops background work", async () => {
  const f = await fixture();
  try {
    const body = { question: "销售额", idempotency_key: "same", expected_configuration_version: 1 };
    assert.equal((await f.request("/ask/sessions/sb/runs", f.a, "POST", body)).status, 404);
    const first = await (await f.request("/ask/sessions/sa/runs", f.a, "POST", body)).json();
    const again = await (await f.request("/ask/sessions/sa/runs", f.a, "POST", body)).json();
    const second = await (await f.request("/ask/sessions/sb/runs", f.b, "POST", body)).json();
    assert.equal(first.id, again.id); assert.notEqual(first.id, second.id); assert.equal(f.calls.background.length, 2);
    assert.equal((await f.request("/ask/sessions/sa/runs", f.a, "POST", { ...body, question: "利润" })).status, 409);
    assert.equal((await f.request("/auth/logout", f.a, "POST")).status, 200);
    assert.equal(f.runs.get(first.id).status, "RUNNING"); assert.equal(f.calls.cancelled.length, 0);
    assert.equal((await f.request("/ask/sessions/sa", f.a)).status, 401);
    const anotherLogin = await f.login("A");
    assert.equal((await f.request("/ask/runs/" + first.id, anotherLogin)).status, 200);
    assert.deepEqual((await (await f.request("/ask/sessions", anotherLogin)).json()).items.map(s => s.id), ["sa"]);
    assert.equal((await f.request("/ask/runs/" + first.id, f.b)).status, 404);
    for (const path of ["/ask/sessions", "/ask/runs/ra/events", "/ask/runs/ra/queries/qa/export", "/queries/qa/result"]) assert.equal((await f.request(path)).status, 401);
  } finally { await f.close(); }
});

test("concurrent idempotency conflicts replay the winner without duplicate remote or model work", async () => {
  const { Prisma } = require("@eureka-atlas/database");
  const f = await fixture();
  const previousCreate = prisma.queryExecution.create, previousTransaction = prisma.$transaction;
  const conflict = () => new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
  try {
    prisma.queryExecution.create = async ({ data }) => {
      f.queries.set("race-query", { ...query("race-query", data.ownerMemberNo), ...data, request: data.request });
      throw conflict();
    };
    const body = { table_id: "table", metric_ids: ["metric"], idempotency_key: "race" };
    const response = await f.request("/queries", f.a, "POST", body);
    assert.equal(response.status, 201); assert.equal((await response.json()).id, "race-query");
    assert.equal(f.calls.submitted.length, 0);
    prisma.$transaction = async () => {
      f.runs.set("race-run", { ...run("race-run", "sa"), idempotencyKey: "race", question: "销售额" });
      throw conflict();
    };
    const response2 = await f.request("/ask/sessions/sa/runs", f.a, "POST", { question: "销售额", idempotency_key: "race", expected_configuration_version: 1 });
    assert.equal(response2.status, 201); assert.equal((await response2.json()).id, "race-run");
    assert.equal(f.calls.background.length, 0);
  } finally { prisma.queryExecution.create = previousCreate; prisma.$transaction = previousTransaction; await f.close(); }
});

test("internal timeout maintenance handles unowned legacy queries without exposing an API bypass", async () => {
  const f = await fixture();
  try {
    Object.assign(f.queries.get("old-query"), { status: "RUNNING", submittedAt: new Date(0), remoteInstanceId: "legacy-remote" });
    await f.queryService.refresh("old-query");
    assert.equal(f.queries.get("old-query").status, "TIMED_OUT");
    assert.deepEqual(f.calls.cancelled, ["legacy-remote"]);
    assert.equal((await f.request("/queries/old-query", f.a)).status, 404);
  } finally { await f.close(); }
});

test("owned archived results and Excel exports survive live query removal while staying private", async () => {
  const f = await fixture();
  try {
    f.queries.delete("qa");
    assert.equal((await f.request("/queries/qa/result", f.a)).status, 404);
    assert.equal((await f.request("/ask/runs/ra/queries/qa/result", f.a)).status, 200);
    assert.equal((await f.request("/ask/runs/ra/queries/qa/export", f.a)).status, 200);
    assert.equal((await f.request("/ask/runs/ra/queries/qa/result", f.b)).status, 404);
    assert.equal((await f.request("/ask/runs/ra/queries/qa/export", f.b)).status, 404);
  } finally { await f.close(); }
});
