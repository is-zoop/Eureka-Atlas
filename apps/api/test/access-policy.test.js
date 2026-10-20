const test = require("node:test");
const assert = require("node:assert/strict");

const matrix = {
  SYSTEM_ADMIN: [true, true, true, true],
  ADMIN: [true, true, false, true],
  DEVELOPER: [true, false, false, true],
  USER: [true, false, false, true],
};

test("one shared policy defines all four Haze roles and denies missing or unknown roles", async () => {
  const { hasPermission, isAuthRole } = await import("@eureka-atlas/types");
  const permissions = ["assets.read", "governance.write", "system.manage", "query.use"];
  for (const [role, expected] of Object.entries(matrix)) {
    assert.equal(isAuthRole(role), true);
    assert.deepEqual(permissions.map(permission => hasPermission(role, permission)), expected);
  }
  for (const role of [undefined, null, "", "admin", "OWNER", "ADMIN0001", "toString", "__proto__", {}, 1]) {
    assert.equal(isAuthRole(role), false);
    for (const permission of permissions) assert.equal(hasPermission(role, permission), false);
  }
});

test("page permissions cover direct links and nested pages without prefix collisions", async () => {
  const { canAccessPage, hasPermission } = await import("@eureka-atlas/types");
  const hasApi = role => hasPermission(role, "api.access");
  for (const [role, [, edit, manage]] of Object.entries(matrix)) {
    for (const path of ["/", "/profile", "/assets/tables", "/assets/tables/123", "/semantic/metrics", "/semantic/metrics/123", "/semantic/dimensions/123", "/query/ask/session", "/query/data"]) assert.equal(canAccessPage(role, path), true);
    assert.equal(hasApi(role), ["SYSTEM_ADMIN", "ADMIN"].includes(role));
    for (const path of ["/integrations", "/integrations/api", "/integrations/plugins"]) assert.equal(canAccessPage(role, path), ["SYSTEM_ADMIN", "ADMIN"].includes(role));
    assert.equal(canAccessPage(role, "/integrations/plugins/data-selector"), true);
    assert.equal(canAccessPage(role, "/integrations/plugins/data-selector-fake"), ["SYSTEM_ADMIN", "ADMIN"].includes(role));
    for (const path of ["/governance/tasks", "/governance/tables/123"]) assert.equal(canAccessPage(role, path), edit);
    for (const path of ["/assets/sources", "/models", "/settings"]) assert.equal(canAccessPage(role, path), manage);
    for (const path of ["/profile-fake", "/profile/other", "/assets/tables-fake", "/query/data-fake", "/unknown"]) assert.equal(canAccessPage(role, path), false);
  }
  assert.equal(canAccessPage(undefined, "/"), false);
  assert.equal(canAccessPage("OWNER", "/models"), false);
});
