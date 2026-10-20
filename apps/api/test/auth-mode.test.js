const test = require("node:test"), assert = require("node:assert/strict");
const { Test } = require("@nestjs/testing"), { APP_GUARD } = require("@nestjs/core");
const { Controller, Post, Get, UnauthorizedException } = require("@nestjs/common");
const { AuthGuard } = require("../dist/auth/auth.guard"), { AuthService } = require("../dist/auth/auth.service");
const { ExternalApi } = require("../dist/auth/external-api.decorator"), { RequirePermission } = require("../dist/auth/permission.decorator");
class ExternalProbe { post(req) { return { ok: true }; } }
Controller("external/v1/probe")(ExternalProbe); ExternalApi()(ExternalProbe); RequirePermission("api.access")(ExternalProbe);
Post()(ExternalProbe.prototype, "post", Object.getOwnPropertyDescriptor(ExternalProbe.prototype, "post"));
class WebProbe { read() { return { ok: true }; } write() { return { ok: true }; } }
Controller("web-probe")(WebProbe); RequirePermission("api.access")(WebProbe);
Get()(WebProbe.prototype, "read", Object.getOwnPropertyDescriptor(WebProbe.prototype, "read")); Post()(WebProbe.prototype, "write", Object.getOwnPropertyDescriptor(WebProbe.prototype, "write"));
test("external routes never fall back to Cookie or clear it; web routes keep Cookie and CSRF authentication", async () => {
  let cookieCalls = 0, bearerCalls = 0;
  const module = await Test.createTestingModule({ controllers: [ExternalProbe, WebProbe], providers: [{ provide: AuthService, useValue: {
    authenticate: async req => { cookieCalls++; if (!req.headers.cookie?.includes("valid-cookie")) throw new UnauthorizedException(); return { member_no: "cookie-owner", role_code: "ADMIN" }; },
    authenticateCredential: async req => { bearerCalls++; if (req.get("authorization") === "Bearer user-key") return { member_no: "user-owner", role_code: "USER" }; if (req.get("authorization") !== "Bearer admin-key") throw new UnauthorizedException(); return { member_no: "key-owner", role_code: "ADMIN" }; },
  } }, { provide: APP_GUARD, useClass: AuthGuard }] }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  try {
    for (const auth of [undefined, "Bearer bad-key", "Bearer user-key"]) {
      const res = await fetch(base + "/api/external/v1/probe", { method: "POST", headers: { Cookie: "valid-cookie", ...(auth ? { Authorization: auth } : {}) } });
      assert.equal(res.status, auth?.includes("user-key") ? 403 : 401); assert.equal(res.headers.get("set-cookie"), null); assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal(cookieCalls, 0); assert.equal(bearerCalls, 3);
    const valid = await fetch(base + "/api/external/v1/probe", { method: "POST", headers: { Authorization: "Bearer admin-key", Origin: "https://server-caller.invalid" } });
    assert.equal(valid.status, 201); assert.equal(cookieCalls, 0);
    const notSession = await fetch(base + "/api/web-probe", { headers: { Authorization: "Bearer admin-key" } });
    assert.equal(notSession.status, 401); assert.ok(notSession.headers.get("set-cookie"));
    assert.equal((await fetch(base + "/api/web-probe", { headers: { Cookie: "valid-cookie" } })).status, 200);
    const before = cookieCalls;
    assert.equal((await fetch(base + "/api/web-probe", { method: "POST", headers: { Cookie: "valid-cookie", Origin: "https://evil.invalid" } })).status, 403);
    assert.equal(cookieCalls, before); assert.equal(bearerCalls, 4);
  } finally { await app.close(); }
});
