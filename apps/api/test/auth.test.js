const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { Test } = require("@nestjs/testing");
const { APP_GUARD } = require("@nestjs/core");
const { Controller, Get, Post, UnauthorizedException, ServiceUnavailableException } = require("@nestjs/common");
const { SwaggerModule, DocumentBuilder } = require("@nestjs/swagger");
const { prisma } = require("@eureka-atlas/database");
const { AuthController } = require("../dist/auth/auth.controller");
const { AuthService } = require("../dist/auth/auth.service");
const { AuthGuard } = require("../dist/auth/auth.guard");
const { HazeAuthService } = require("../dist/auth/haze-auth.service");
const { CredentialCryptoService } = require("../dist/datasource/credential-crypto.service");
const { HealthController } = require("../dist/common/health.controller");
const { AskController } = require("../dist/ask/ask.controller");
const { AskRunService } = require("../dist/ask/ask-run.service");
const { AskEventService } = require("../dist/ask/ask-event.service");
const { AskExportService } = require("../dist/ask/ask-export.service");

const nativeFetch = global.fetch;
const profile = { member_no: "test-member", name: "测试用户", phone: "13800000000", email: null, avatar_url: null, department: "测试部门", status: "active" };
const token = "mock-haze-token-not-a-jwt";
class ProbeController { read() { return { ok: true }; } write() { return { ok: true }; } }
Controller("private")(ProbeController);
Get()(ProbeController.prototype, "read", Object.getOwnPropertyDescriptor(ProbeController.prototype, "read"));
Post()(ProbeController.prototype, "write", Object.getOwnPropertyDescriptor(ProbeController.prototype, "write"));

async function fixture() {
  const records = new Map();
  const calls = [];
  const mode = { value: "ok" };
  const savedEnv = Object.fromEntries(["DATA_SOURCE_ENCRYPTION_KEY", "HAZE_API_ORIGIN", "WEB_ORIGIN", "NODE_ENV"].map(key => [key, process.env[key]]));
  process.env.DATA_SOURCE_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.HAZE_API_ORIGIN = "https://mock-haze.invalid";
  process.env.WEB_ORIGIN = "https://atlas.example";
  process.env.NODE_ENV = "test";
  const undo = [];
  const replace = (object, key, value) => { const previous = object[key]; object[key] = value; undo.push(() => { object[key] = previous; }); };
  replace(prisma.authSession, "create", async ({ data }) => { records.set(data.id, { ...data, createdAt: new Date() }); return records.get(data.id); });
  replace(prisma.authSession, "findUnique", async ({ where }) => records.get(where.id) || null);
  replace(prisma.authSession, "deleteMany", async ({ where }) => {
    const matches = (row, condition) => condition.id ? row.id === condition.id : condition.expiresAt ? row.expiresAt <= condition.expiresAt.lte : false;
    let count = 0;
    for (const [id, row] of records) if ((where.OR || [where]).some(condition => matches(row, condition))) { records.delete(id); count++; }
    return { count };
  });
  replace(global, "fetch", async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    if (mode.value === "timeout") throw new DOMException("mock timeout", "TimeoutError");
    if (mode.value === "malformed") return new Response("not-json");
    if (mode.value === "revoked") return Response.json({ code: 4010, message: "expired" }, { status: 401 });
    if (mode.value === "disabled") return Response.json({ code: 4031 }, { status: 403 });
    if (url.endsWith("/login")) {
      const body = JSON.parse(options.body);
      if (body.password !== "test-password") return Response.json({ code: 4011 }, { status: 401 });
      return Response.json({ code: 0, data: { access_token: token, token_type: "bearer", expires_in: 3600, user: { ...profile, role_code: "USER", permissions: ["secret.permission"] } } });
    }
    assert.ok(url.endsWith("/me"), "Eureka must never invoke Haze logout");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return Response.json({ code: 0, data: { ...profile, permissions: ["secret.permission"] } });
  });
  const module = await Test.createTestingModule({
    controllers: [ProbeController, AuthController, HealthController, AskController],
    providers: [AuthService, HazeAuthService, CredentialCryptoService, { provide: APP_GUARD, useClass: AuthGuard },
      { provide: AskRunService, useValue: { assertRunOwnership: async () => {}, detail: async () => ({}), queryResult: async () => ({}) } },
      { provide: AskEventService, useValue: { after: async () => [], subscribe: () => () => {} } },
      { provide: AskExportService, useValue: { workbook: async () => Buffer.from("mock-xlsx") } }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api");
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("test").build()), { useGlobalPrefix: true, jsonDocumentUrl: "docs-json" });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const request = (path, options = {}) => nativeFetch(base + path, options);
  const signIn = async (cookie) => {
    const response = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://atlas.example", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ phone: profile.phone, password: "test-password" }) });
    assert.equal(response.status, 200);
    return { response, cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  return { app, records, mode, calls, request, signIn, service: app.get(AuthService), crypto: app.get(CredentialCryptoService), haze: app.get(HazeAuthService), async close() { await app.close(); undo.reverse().forEach(fn => fn()); for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } };
}

test("real login exposes only user fields and stores a hashed cookie and encrypted token", async () => {
  const f = await fixture();
  try {
    const { response, cookie } = await f.signIn();
    assert.deepEqual(await response.json(), profile);
    const header = response.headers.get("set-cookie");
    assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.match(header, /Path=\//);
    assert.match(header, /Max-Age=359\d|Max-Age=3600/);
    assert.equal(header.includes(token), false);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const secret = cookie.split("=")[1];
    const row = [...f.records.values()][0];
    assert.equal(row.id, createHash("sha256").update(secret).digest("hex"));
    assert.notEqual(row.tokenEncrypted, token);
    assert.equal(f.crypto.decrypt(row.tokenEncrypted), token);
    const me = await f.request("/api/auth/me", { headers: { Cookie: cookie } });
    assert.equal(me.status, 200); assert.deepEqual(await me.json(), profile);
    const recovered = new AuthService(f.haze, f.crypto);
    assert.deepEqual(await recovered.authenticate({ headers: { cookie } }), profile);
    const { cookie: newCookie } = await f.signIn(cookie);
    assert.notEqual(newCookie, cookie); assert.equal(f.records.size, 1);
    assert.equal((await f.request("/api/private", { headers: { Cookie: cookie } })).status, 401);
  } finally { await f.close(); }
});

test("Haze requires an explicit origin and never requests a default when configuration is missing", async () => {
  const f = await fixture();
  try {
    for (const value of [undefined, "", "   "]) {
      if (value === undefined) delete process.env.HAZE_API_ORIGIN;
      else process.env.HAZE_API_ORIGIN = value;
      const response = await f.request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: profile.phone, password: "test-password" }) });
      assert.equal(response.status, 503);
      assert.match((await response.json()).message, /HAZE_API_ORIGIN/);
      await assert.rejects(f.haze.me(token), error => error instanceof ServiceUnavailableException && /HAZE_API_ORIGIN/.test(error.message));
      assert.equal(f.calls.length, 0);
      assert.equal(f.records.size, 0);
    }
    process.env.HAZE_API_ORIGIN = "  https://configured-haze.invalid///  ";
    const { cookie } = await f.signIn();
    assert.equal(f.calls[0].url, "https://configured-haze.invalid/api/auth/login");
    assert.equal((await f.request("/api/auth/me", { headers: { Cookie: cookie } })).status, 200);
    assert.equal(f.calls.at(-1).url, "https://configured-haze.invalid/api/auth/me");
  } finally { await f.close(); }
});

test("protected business, SSE and download routes reject missing or forged sessions; health and docs stay public", async () => {
  const f = await fixture();
  try {
    for (const path of ["/api/private", "/api/auth/me", "/api/ask/runs/test/events", "/api/ask/runs/test/queries/query/export"]) {
      assert.equal((await f.request(path)).status, 401);
      assert.equal((await f.request(path, { headers: { Cookie: "eureka_atlas_session=forged" } })).status, 401);
    }
    assert.equal(f.calls.length, 0);
    assert.equal((await f.request("/api/health")).status, 200);
    assert.equal((await f.request("/api/docs-json")).status, 200);
    const { cookie } = await f.signIn();
    assert.equal((await f.request("/api/private", { headers: { Cookie: cookie } })).status, 200);
    const download = await f.request("/api/ask/runs/test/queries/query/export", { headers: { Cookie: cookie } });
    assert.equal(download.status, 200); assert.match(download.headers.get("content-type"), /spreadsheet/);
    const stream = await f.request("/api/ask/runs/test/events", { headers: { Cookie: cookie } });
    assert.equal(stream.status, 200); assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    await stream.body.cancel();
  } finally { await f.close(); }
});

test("input validation, wrong password and disabled account never create a session", async () => {
  const f = await fixture();
  try {
    for (const [phone, password, status] of [["admin", "admin", 400], [profile.phone, "short", 400], [profile.phone, "incorrect", 401]]) {
      const response = await f.request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password }) });
      assert.equal(response.status, status); assert.equal(response.headers.get("set-cookie"), null);
    }
    f.mode.value = "disabled";
    const response = await f.request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: profile.phone, password: "test-password" }) });
    assert.equal(response.status, 403); assert.match((await response.json()).message, /停用/);
    assert.equal(f.records.size, 0);
  } finally { await f.close(); }
});

test("cross-site login, writes and logout are rejected before touching Haze or sessions", async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.signIn();
    const before = f.calls.length;
    for (const path of ["/api/auth/login", "/api/auth/logout", "/api/private"]) {
      const response = await f.request(path, { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
      assert.equal(response.status, 403);
    }
    assert.equal(f.calls.length, before); assert.equal(f.records.size, 1);
    assert.equal((await f.request("/api/private", { method: "POST", headers: { Cookie: cookie, Origin: "https://atlas.example", "Content-Type": "application/json" }, body: "{}" })).status, 201);
    assert.equal((await f.request("/api/private", { method: "POST", headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" } })).status, 403);
  } finally { await f.close(); }
});

test("expired, disabled and revoked sessions become 401 and are deleted", async () => {
  const f = await fixture();
  try {
    for (const mode of ["expired", "disabled", "revoked"]) {
      f.mode.value = "ok";
      const { cookie } = await f.signIn();
      if (mode === "expired") [...f.records.values()][0].expiresAt = new Date(0);
      else f.mode.value = mode;
      const response = await f.request("/api/auth/me", { headers: { Cookie: cookie } });
      assert.equal(response.status, 401); assert.equal(f.records.size, 0);
      assert.match(response.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
    }
  } finally { await f.close(); }
});

test("Haze timeouts and malformed replies return 503 without erasing sessions; retry recovers", async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.signIn();
    for (const mode of ["timeout", "malformed"]) {
      f.mode.value = mode;
      const response = await f.request("/api/auth/me", { headers: { Cookie: cookie } });
      assert.equal(response.status, 503); assert.equal(f.records.size, 1); assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(JSON.stringify(await response.json()).includes(token), false);
    }
    f.mode.value = "ok";
    assert.equal((await f.request("/api/auth/me", { headers: { Cookie: cookie } })).status, 200);
  } finally { await f.close(); }
});

test("logout is idempotent and revokes only the selected Eureka session even when Haze is down", async () => {
  const f = await fixture();
  try {
    const first = await f.signIn(); const second = await f.signIn();
    assert.equal(f.records.size, 2);
    const before = f.calls.length;
    f.mode.value = "timeout";
    for (let i = 0; i < 2; i++) assert.equal((await f.request("/api/auth/logout", { method: "POST", headers: { Cookie: first.cookie } })).status, 200);
    assert.equal(f.calls.length, before); assert.equal(f.records.size, 1);
    f.mode.value = "ok";
    assert.equal((await f.request("/api/auth/me", { headers: { Cookie: second.cookie } })).status, 200);
    assert.equal((await f.request("/api/auth/me", { headers: { Cookie: first.cookie } })).status, 401);
  } finally { await f.close(); }
});

test("production cookies are Secure", async () => {
  const f = await fixture();
  try {
    process.env.NODE_ENV = "production";
    const { response } = await f.signIn();
    assert.match(response.headers.get("set-cookie"), /; Secure/);
  } finally { await f.close(); }
});

test("SSE heartbeat closes on revoked sessions or outage, unsubscribes and never cancels the run", async () => {
  for (const [error, event] of [[new UnauthorizedException(), "auth-expired"], [new ServiceUnavailableException(), "auth-unavailable"]]) {
    let heartbeat; let unsubscribed = 0; let cleared = 0;
    const savedInterval = global.setInterval; const savedClear = global.clearInterval;
    global.setInterval = (fn, interval) => { assert.equal(interval, 20_000); heartbeat = fn; return 1; };
    global.clearInterval = () => { cleared++; };
    const response = new EventEmitter();
    const messages = [];
    response.setHeader = () => {}; response.flushHeaders = () => {};
    response.write = value => messages.push(value); response.end = () => { response.writableEnded = true; };
    try {
      const controller = new AskController({ assertRunOwnership: async () => {}, detail: async () => ({}) }, { after: async () => [], subscribe: () => () => { unsubscribed++; } }, {}, { authenticate: async () => { throw error; } });
      await controller.stream("run", "0", { authUser: profile, headers: {} }, response);
      heartbeat(); await new Promise(resolve => setImmediate(resolve));
      assert.match(messages.join(""), new RegExp(`event: ${event}`));
      assert.equal(response.writableEnded, true); assert.equal(unsubscribed, 1); assert.equal(cleared, 1);
      response.emit("close"); assert.equal(unsubscribed, 1);
    } finally { global.setInterval = savedInterval; global.clearInterval = savedClear; }
  }
});

test("disconnect during SSE replay releases the subscription without starting a heartbeat", async () => {
  let finishReplay; let unsubscribed = 0;
  const response = new EventEmitter();
  response.setHeader = () => {}; response.flushHeaders = () => {};
  response.write = () => { throw new Error("must not write after disconnect"); };
  response.end = () => { response.writableEnded = true; };
  const controller = new AskController({ assertRunOwnership: async () => {}, detail: async () => ({}) }, {
    subscribe: () => () => { unsubscribed++; },
    after: () => new Promise(resolve => { finishReplay = resolve; }),
  }, {}, { authenticate: async () => { throw new Error("must not validate after disconnect"); } });
  const stream = controller.stream("run", "0", { authUser: profile, headers: {} }, response);
  await new Promise(resolve => setImmediate(resolve));
  response.emit("close");
  finishReplay([{ sequence: 1, type: "status", payload: {} }]);
  await stream;
  assert.equal(unsubscribed, 1);
});

test("SSE heartbeat closes when the account changes or run ownership disappears", async () => {
  const { NotFoundException } = require("@nestjs/common");
  for (const scenario of ["account", "resource"]) {
    let heartbeat, unsubscribed = 0, cleared = 0, checked = 0;
    const oldInterval = global.setInterval, oldClear = global.clearInterval;
    global.setInterval = fn => { heartbeat = fn; return 1; };
    global.clearInterval = () => { cleared++; };
    const response = new EventEmitter(), messages = [];
    response.setHeader = () => {}; response.flushHeaders = () => {};
    response.write = value => messages.push(value); response.end = () => { response.writableEnded = true; };
    try {
      const controller = new AskController({
        assertRunOwnership: async () => { if (++checked > 1 && scenario === "resource") throw new NotFoundException(); },
        cancel: () => { throw new Error("must not cancel background work"); },
      }, { after: async () => [], subscribe: () => () => { unsubscribed++; } }, {}, {
        authenticate: async () => ({ ...profile, member_no: scenario === "account" ? "another-member" : profile.member_no }),
      });
      await controller.stream("run", "0", { authUser: profile, headers: {} }, response);
      heartbeat(); await new Promise(resolve => setImmediate(resolve));
      assert.match(messages.join(""), new RegExp("event: " + (scenario === "account" ? "auth-changed" : "resource-unavailable")));
      assert.equal(response.writableEnded, true); assert.equal(unsubscribed, 1); assert.equal(cleared, 1);
    } finally { global.setInterval = oldInterval; global.clearInterval = oldClear; }
  }
});
