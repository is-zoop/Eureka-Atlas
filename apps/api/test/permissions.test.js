const test = require("node:test");
const assert = require("node:assert/strict");
const { Test } = require("@nestjs/testing");
const { APP_GUARD, Reflector } = require("@nestjs/core");
const { Controller, Get, UnauthorizedException } = require("@nestjs/common");
const { PATH_METADATA, METHOD_METADATA } = require("@nestjs/common/constants");
const { AuthGuard } = require("../dist/auth/auth.guard");
const { AuthService } = require("../dist/auth/auth.service");
const { ApiCenterController } = require("../dist/api-center/api-center.controller");
const { ProfileController } = require("../dist/auth/profile.controller");
const { REQUIRED_PERMISSION } = require("../dist/auth/permission.decorator");
const { DatasourceController } = require("../dist/datasource/datasource.controller");
const { MetadataController } = require("../dist/metadata/metadata.controller");
const { GovernanceController, GovernanceWorkspaceController } = require("../dist/governance/governance.controller");
const { SemanticController } = require("../dist/semantic/semantic.controller");
const { PackageController } = require("../dist/package/package.controller");
const { ModelConfigController } = require("../dist/model-config/model-config.controller");
const { PiCatalogController } = require("../dist/model-config/pi-catalog.controller");
const { SubscriptionAuthController } = require("../dist/model-config/subscription-auth.controller");
const { SystemSettingsController } = require("../dist/system-settings/system-settings.controller");

const { AskController } = require("../dist/ask/ask.controller");
const { QueryController } = require("../dist/query/query.controller");
const { DataQueryController } = require("../dist/query/data-query.controller");
const { SavedDataQueryController } = require("../dist/query/saved-data-query.controller");
const queryControllers = [AskController, QueryController, DataQueryController, SavedDataQueryController];

const {AgentSessionsController}=require('../dist/integrations/agent-sessions.controller');
const {PluginPackageController}=require('../dist/integrations/plugin-package.controller');
const {ExternalLimitsService}=require('../dist/external-api/external-limits');
const controllers = [AgentSessionsController, PluginPackageController, ApiCenterController, ...queryControllers, ProfileController, DatasourceController, MetadataController, GovernanceController, GovernanceWorkspaceController, SemanticController, PackageController, ModelConfigController, PiCatalogController, SubscriptionAuthController, SystemSettingsController];
const roles = {
  SYSTEM_ADMIN: ["assets.read", "governance.write", "system.manage", "query.use", "api.access"],
  ADMIN: ["assets.read", "governance.write", "query.use", "api.access"],
  DEVELOPER: ["assets.read", "query.use"],
  USER: ["assets.read", "query.use"],
};
const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"];
const reflector = new Reflector();
function endpoints() {
  return controllers.flatMap(controller => Object.getOwnPropertyNames(controller.prototype).filter(name => Reflect.hasMetadata(METHOD_METADATA, controller.prototype[name])).map(name => {
    const handler = controller.prototype[name];
    const base = Reflect.getMetadata(PATH_METADATA, controller);
    const path = Reflect.getMetadata(PATH_METADATA, handler);
    return { controller, name, method: methods[Reflect.getMetadata(METHOD_METADATA, handler)], path: "/api/" + [base, path].filter(part => part && part !== "/").join("/").replace(/:[A-Za-z_][A-Za-z0-9_]*/g, parameter => parameter === ':client' ? 'codex' : 'test'), permission: reflector.getAllAndOverride(REQUIRED_PERMISSION, [handler, controller]) };
  }));
}

async function fixture() {
  let role = "USER";
  const calls = [];
  const providers = new Map();
  for (const controller of controllers) for (const service of Reflect.getMetadata("design:paramtypes", controller) || []) {
    providers.set(service, { provide: service, useValue: new Proxy({}, { get: (_, name) => {
      if (name === "then") return undefined;
      if (name === "subscribe") return () => () => {};
      return async (...args) => {
        calls.push({ service: service.name, name, args });
        if (name === "after") return [];
        if (name === "archive") return {buffer:Buffer.from('zip'),filename:'atlas-ask.zip',rulesVersion:'version',sha256:'a'.repeat(64)};
        if (name === "workbook") return Buffer.from("test-xlsx");
        if (name === "write") { args.at(-1).end("test-xlsx"); return; }
        return { ok: true };
      };
    } }) });
  }
  class UnclassifiedController { read() { return { unsafe: true }; } }
  Controller("unclassified")(UnclassifiedController);
  Get()(UnclassifiedController.prototype, "read", Object.getOwnPropertyDescriptor(UnclassifiedController.prototype, "read"));
  const module = await Test.createTestingModule({
    controllers: [...controllers, UnclassifiedController],
    providers: [...providers.values(), {provide:ExternalLimitsService,useValue:{consume(){}}}, { provide: AuthService, useValue: { authenticate: async () => {
      if (role === "SIGNED_OUT") throw new UnauthorizedException();
      return { member_no: "member", name: "成员", role_code: role, role_name: "角色", status: "active" };
    } } }, { provide: APP_GUARD, useClass: AuthGuard }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  return { calls, setRole(value) { role = value; }, request(path, method = "GET") {
    return fetch(base + path, { method, headers: { "Content-Type": "application/json", Cookie: "eureka_atlas_session=existing" }, ...(!["GET", "HEAD"].includes(method) ? { body: JSON.stringify(path === '/api/integrations/agent-sessions' ? {} : { dataSourceId: "source", spaces: [{ project: "dw" }] }) } : {}) });
  }, close: () => app.close() };
}

test("every management endpoint declares permission and write overrides protect semantics and synchronization", () => {
  for (const endpoint of endpoints()) {
    assert.ok(endpoint.permission, `${endpoint.method} ${endpoint.path}`);
    if (endpoint.controller === AgentSessionsController) assert.equal(endpoint.permission, "query.use");
    if (endpoint.controller === PluginPackageController) assert.equal(endpoint.permission, "api.access");
    if (queryControllers.includes(endpoint.controller)) assert.equal(endpoint.permission, "query.use");
    if (endpoint.controller === MetadataController && endpoint.name === "sync") assert.equal(endpoint.permission, "system.manage");
    if (endpoint.controller === SemanticController && endpoint.method === "PATCH") assert.equal(endpoint.permission, "governance.write");
    if ([DatasourceController, PiCatalogController, SubscriptionAuthController].includes(endpoint.controller)) assert.equal(endpoint.permission, "system.manage");
  }
});

test("actual HTTP endpoints enforce all four roles; denied requests never reach services or erase cookies", async () => {
  const f = await fixture();
  try {
    for (const [role, allowed] of Object.entries(roles)) {
      f.setRole(role);
      for (const endpoint of endpoints().filter(endpoint => endpoint.name !== "stream")) {
        const before = f.calls.length;
        const response = await f.request(endpoint.path, endpoint.method);
        const permitted = allowed.includes(endpoint.permission);
        assert.equal(permitted ? response.status < 300 : response.status === 403, true, `${role} ${endpoint.method} ${endpoint.path}: ${response.status}`);
        if (!permitted) { assert.equal(f.calls.length, before); assert.equal(response.headers.get("set-cookie"), null); }
        await response.text();
      }
    }
  } finally { await f.close(); }
});

test("all roles can use POST/PATCH/DELETE query features, SSE and exports without configuration privileges", async () => {
  const f = await fixture();
  try {
    for (const role of Object.keys(roles)) {
      f.setRole(role);
      for (const endpoint of endpoints().filter(endpoint => queryControllers.includes(endpoint.controller))) {
        const response = await f.request(endpoint.path, endpoint.method);
        assert.ok(response.status < 300, `${role} ${endpoint.method} ${endpoint.path}`);
        if (endpoint.name === "stream") {
          assert.match(response.headers.get("content-type"), /text\/event-stream/);
          await response.body.cancel();
        } else if (endpoint.name === "export") {
          assert.match(response.headers.get("content-type"), /spreadsheet/);
          assert.ok((await response.arrayBuffer()).byteLength > 0);
        } else await response.text();
      }
    }
  } finally { await f.close(); }
});

test("business read dependencies remain usable without granting access to management configuration", async () => {
  const f = await fixture();
  try {
    for (const role of Object.keys(roles)) {
      f.setRole(role);
      for (const path of ["/api/metadata/tables", "/api/metadata/tables/test", "/api/metadata/tables/test/columns", "/api/governance/workspaces/by-table/test", "/api/packages/test", "/api/models/available", "/api/semantic/metrics/test", "/api/semantic/dimensions/test", "/api/semantic/queryable-tables"]) {
        assert.equal((await f.request(path)).status, 200, `${role} ${path}`);
      }
      assert.equal((await f.request("/api/settings/governance-options")).status, ["ADMIN", "SYSTEM_ADMIN"].includes(role) ? 200 : 403);
      for (const path of ["/api/settings/active-ai-model", "/api/settings/ai-prompt", "/api/settings/ask-prompt", "/api/models", "/api/models/builtin-catalog"]) {
        assert.equal((await f.request(path)).status, role === "SYSTEM_ADMIN" ? 200 : 403, `${role} ${path}`);
      }
    }
  } finally { await f.close(); }
});

test("undeclared endpoints and unknown roles are denied; role downgrade is checked on the next request", async () => {
  const f = await fixture();
  try {
    f.setRole("SYSTEM_ADMIN");
    assert.equal((await f.request("/api/unclassified")).status, 403);
    assert.equal((await f.request("/api/datasources")).status, 200);
    f.setRole("ADMIN");
    const denied = await f.request("/api/datasources");
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("set-cookie"), null);
    assert.equal((await f.request("/api/metadata/tables")).status, 200);
    for (const role of [undefined, "OWNER", "admin"]) {
      f.setRole(role);
      assert.equal((await f.request("/api/metadata/tables")).status, 403);
    }
    f.setRole("SIGNED_OUT");
    const expired = await f.request("/api/metadata/tables");
    assert.equal(expired.status, 401);
    assert.match(expired.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  } finally { await f.close(); }
});
