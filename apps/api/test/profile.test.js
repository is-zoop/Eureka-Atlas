const test = require("node:test");
const assert = require("node:assert/strict");
const { Test } = require("@nestjs/testing");
const { APP_GUARD } = require("@nestjs/core");
const { prisma } = require("@eureka-atlas/database");
const { AuthController } = require("../dist/auth/auth.controller");
const { AuthService } = require("../dist/auth/auth.service");
const { AuthGuard } = require("../dist/auth/auth.guard");
const { HazeAuthService } = require("../dist/auth/haze-auth.service");
const { ProfileController } = require("../dist/auth/profile.controller");
const { ProfileService } = require("../dist/auth/profile.service");
const { CredentialCryptoService } = require("../dist/datasource/credential-crypto.service");
const nativeFetch = global.fetch;
const avatar = "data:image/jpeg;base64," + Buffer.from([255, 216, 255, 217]).toString("base64");

async function fixture() {
  const env = Object.fromEntries(["DATA_SOURCE_ENCRYPTION_KEY", "HAZE_API_ORIGIN", "WEB_ORIGIN", "NODE_ENV"].map(key => [key, process.env[key]]));
  Object.assign(process.env, { DATA_SOURCE_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"), HAZE_API_ORIGIN: "https://haze-profile.invalid", WEB_ORIGIN: "https://atlas.example", NODE_ENV: "test" });
  const originalSession = prisma.authSession, originalFetch = global.fetch;
  const records = new Map(), tokens = new Map(), calls = [];
  const users = ["A", "B"].map((member_no, index) => ({ member_no, name: "用户" + member_no, phone: index ? "13900000000" : "13800000000", department: "测试部门", role_code: "USER", role_name: "使用者", status: "active", email: null, avatar_url: null }));
  const credentials = new Map(users.map((user, index) => [user.member_no, { id: index + 1, name: "Personal Service Access Credential", masked_key: `haze_${user.member_no}********last`, key: `haze_${user.member_no}_private_key`, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }]));
  const mode = { outage: false, actionStatus: 0, malformed: false };
  prisma.authSession = {
    create: async ({ data }) => { records.set(data.id, data); return data; },
    findUnique: async ({ where }) => records.get(where.id) || null,
    deleteMany: async ({ where }) => { let count = 0; for (const [id, row] of records) if ((where.OR || [where]).some(condition => condition.id === id || condition.expiresAt && row.expiresAt <= condition.expiresAt.lte)) { records.delete(id); count++; } return { count }; },
  };
  global.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("https://haze-profile.invalid/api/auth/"));
    calls.push({ url, options });
    if (mode.outage) throw new Error("mock Haze outage");
    const route = new URL(url).pathname.replace("/api/auth/", "");
    if (route === "login") {
      const body = JSON.parse(options.body), user = users.find(user => user.phone === body.phone);
      const token = "haze-session-" + user.member_no;
      tokens.set(token, { user, revoked: false });
      return Response.json({ code: 0, data: { access_token: token, expires_in: 3600, user } });
    }
    const session = tokens.get(options.headers.Authorization?.slice(7));
    if (!session || session.revoked) return Response.json({ code: 4010 }, { status: 401 });
    if (route === "me") return Response.json({ code: 0, data: session.user });
    if (mode.actionStatus) return Response.json({ code: mode.actionStatus === 403 ? 4030 : 5000, message: "do not expose haze_A_private_key" }, { status: mode.actionStatus });
    if (mode.malformed) return Response.json({ code: 0, data: { key: "haze_A_private_key" } });
    if (route === "me/profile") { session.user.avatar_url = JSON.parse(options.body).avatar_url; return Response.json({ code: 0, data: session.user }); }
    if (route === "me/reset-password") {
      const body = JSON.parse(options.body);
      if (body.current_password !== "test-password") return Response.json({ code: 4012, message: "Current password is incorrect" }, { status: 401 });
      session.revoked = true;
      return Response.json({ code: 0, data: { reset: true } });
    }
    const credential = credentials.get(session.user.member_no);
    if (route === "me/mcp-credential/reset") { credential.key += "_reset"; credential.masked_key += "new"; credential.updated_at = "2026-01-03T00:00:00Z"; }
    else assert.equal(route, "me/mcp-credential", "must never call Haze logout");
    return Response.json({ code: 0, data: { ...credential, extra_private_field: "must-not-forward" } });
  };
  const module = await Test.createTestingModule({ controllers: [AuthController, ProfileController], providers: [AuthService, HazeAuthService, ProfileService, CredentialCryptoService, { provide: APP_GUARD, useClass: AuthGuard }] }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const request = (route, cookie, method = "GET", body, origin = "https://atlas.example") => nativeFetch(base + "/api/auth/" + route, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = async (index = 0) => (await request("login", null, "POST", { phone: users[index].phone, password: "test-password" })).headers.get("set-cookie").split(";")[0];
  return { app, calls, mode, records, users, credentials, request, login, async close() { await app.close(); prisma.authSession = originalSession; global.fetch = originalFetch; for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

test("profile routes require a valid session and reject cross-site writes before Haze calls", async () => {
  const f = await fixture();
  try {
    for (const [route, method, body] of [["me/mcp-credential", "GET"], ["me/profile", "PATCH", { avatar_url: avatar }], ["me/reset-password", "POST", {}], ["me/mcp-credential/reveal", "POST"], ["me/mcp-credential/reset", "POST"]]) assert.equal((await f.request(route, null, method, body)).status, 401);
    assert.equal(f.calls.length, 0);
    const cookie = await f.login(), before = f.calls.length;
    for (const [route, method, body] of [["me/profile", "PATCH", { avatar_url: avatar }], ["me/reset-password", "POST", {}], ["me/mcp-credential/reveal", "POST"], ["me/mcp-credential/reset", "POST"]]) assert.equal((await f.request(route, cookie, method, body, "https://evil.example")).status, 403);
    assert.equal(f.calls.length, before);
  } finally { await f.close(); }
});

test("all four roles can maintain their own profile; avatar changes are saved in Haze only", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER"]) {
      f.users[0].role_code = role;
      const response = await f.request("me/profile", cookie, "PATCH", { avatar_url: avatar });
      assert.equal(response.status, 200);
      const result = await response.json(); assert.equal(result.avatar_url, avatar); assert.equal(result.role_code, role);
      assert.equal(result.access_token, undefined);
      assert.equal(f.calls.at(-1).options.headers.Authorization, "Bearer haze-session-A");
    }
    const cleared = await f.request("me/profile", cookie, "PATCH", { avatar_url: null }); assert.equal((await cleared.json()).avatar_url, null);
    assert.equal(f.records.size, 1);
  } finally { await f.close(); }
});

test("avatar validation rejects unsafe URLs, wrong types, malformed encoding and oversized payloads", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    for (const body of [{}, { avatar_url: "https://external.example/a.jpg" }, { avatar_url: "data:image/svg+xml;base64,PHN2Zz4=" }, { avatar_url: "data:image/jpeg;base64,abc" }, { avatar_url: "data:image/jpeg;base64," + "a".repeat(65_000) }, { avatar_url: avatar, member_no: "B" }, { avatar_url: 123 }]) {
      const response = await f.request("me/profile", cookie, "PATCH", body);
      assert.equal(response.status, 400); assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal(f.calls.filter(call => call.url.endsWith("/profile")).length, 0);
  } finally { await f.close(); }
});

test("credential reads return metadata only; explicit reveal/reset are no-store and owner-scoped", async () => {
  const f = await fixture();
  try {
    const a = await f.login(), b = await f.login(1);
    for (const [cookie, owner] of [[a, "A"], [b, "B"]]) {
      const response = await f.request("me/mcp-credential", cookie);
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      const data = await response.json(); assert.equal(data.masked_key, f.credentials.get(owner).masked_key);
      assert.equal(data.key, undefined); assert.equal(data.extra_private_field, undefined); assert.equal(JSON.stringify(data).includes("private_key"), false);
      const revealed = await f.request("me/mcp-credential/reveal", cookie, "POST");
      assert.equal(revealed.headers.get("cache-control"), "no-store"); assert.equal((await revealed.json()).key, f.credentials.get(owner).key);
    }
    const bKey = f.credentials.get("B").key;
    const reset = await f.request("me/mcp-credential/reset", a, "POST");
    assert.equal(reset.status, 200); assert.equal(reset.headers.get("cache-control"), "no-store");
    assert.match((await reset.json()).key, /_reset$/); assert.equal(f.credentials.get("B").key, bKey);
    assert.equal((await f.request("me", a)).status, 200);
    assert.equal(f.records.size, 2);
  } finally { await f.close(); }
});

test("wrong current password stays a 400 and preserves login; successful password change clears the local session", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    for (const body of [{ current_password: "short", new_password: "new-password" }, { current_password: "test-password", new_password: "x".repeat(129) }, { current_password: "test-password", new_password: "new-password", member_no: "B" }, { current_password: "incorrect", new_password: "new-password" }]) {
      const failed = await f.request("me/reset-password", cookie, "POST", body);
      assert.equal(failed.status, 400); assert.equal(failed.headers.get("set-cookie"), null); assert.equal(f.records.size, 1);
    }
    assert.equal((await f.request("me", cookie)).status, 200);
    const success = await f.request("me/reset-password", cookie, "POST", { current_password: "test-password", new_password: "new-password" });
    assert.equal(success.status, 200); assert.deepEqual(await success.json(), { reset: true });
    assert.match(success.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/); assert.equal(f.records.size, 0);
    assert.equal(f.calls.some(call => call.url.endsWith("/logout")), false);
    assert.equal((await f.request("me", cookie)).status, 401);
  } finally { await f.close(); }
});

test("Haze outage, malformed credentials and upstream denials expose no secrets and do not erase sessions", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    for (const status of [403, 429, 500]) {
      f.mode.actionStatus = status;
      const failed = await f.request("me/mcp-credential", cookie);
      assert.equal(failed.status, status === 500 ? 503 : status);
      assert.equal((await failed.text()).includes("private_key"), false);
      assert.equal(failed.headers.get("set-cookie"), null); assert.equal(f.records.size, 1);
    }
    f.mode.actionStatus = 0; f.mode.malformed = true;
    assert.equal((await f.request("me/mcp-credential", cookie)).status, 503);
    f.mode.malformed = false; f.mode.outage = true;
    assert.equal((await f.request("me/mcp-credential", cookie)).status, 503); assert.equal(f.records.size, 1);
    f.mode.outage = false; assert.equal((await f.request("me/mcp-credential", cookie)).status, 200);
  } finally { await f.close(); }
});
