const assert = require("node:assert/strict");
const test = require("node:test");
const { Test } = require("@nestjs/testing");
const { APP_GUARD } = require("@nestjs/core");
const { UnauthorizedException } = require("@nestjs/common");
const { AuthController } = require("../dist/auth/auth.controller");
const { AuthGuard } = require("../dist/auth/auth.guard");
const { AuthService } = require("../dist/auth/auth.service");
const { DatasourceController } = require("../dist/datasource/datasource.controller");
const { DatasourceService } = require("../dist/datasource/datasource.service");
const { DataSourceAdapterFactory } = require("../dist/metadata/database-adapters");

test("MaxCompute credential rejection returns 502 without clearing a valid Atlas session", async () => {
  const nativeFetch = global.fetch;
  let authenticated = true, upstreamCalls = 0;
  const user = { member_no: "test-member", role_code: "SYSTEM_ADMIN", name: "测试用户", status: "active" };
  global.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("https://mock-maxcompute.invalid/"));
    assert.match(options.headers.Authorization, /^ODPS /);
    upstreamCalls++;
    return new Response("mock credential rejection", { status: 401 });
  };
  let app;
  try {
    const module = await Test.createTestingModule({
      controllers: [AuthController, DatasourceController],
      providers: [
        { provide: AuthService, useValue: { authenticate: async () => {
          if (!authenticated) throw new UnauthorizedException("登录已过期，请重新登录。");
          return user;
        } } },
        { provide: DatasourceService, useValue: new DatasourceService({}, new DataSourceAdapterFactory()) },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const failed = await nativeFetch(base + "/api/datasources/test-connection", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "MAXCOMPUTE", connectionConfig: { region: "test", endpoint: "https://mock-maxcompute.invalid/api", project: "test" }, credentials: { accessKey: "fake-key", secretKey: "fake-secret" } }),
    });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).message, /MaxCompute 数据源凭据校验失败/);
    assert.equal(failed.headers.get("set-cookie"), null);
    assert.equal(upstreamCalls, 1);
    const me = await nativeFetch(base + "/api/auth/me");
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), user);
    authenticated = false;
    const expired = await nativeFetch(base + "/api/auth/me");
    assert.equal(expired.status, 401);
    assert.match(expired.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  } finally {
    if (app) await app.close();
    global.fetch = nativeFetch;
  }
});
