const test = require("node:test");
const assert = require("node:assert/strict");
const root = require("../../../package.json");
const api = require("../package.json");
const web = require("../../web/package.json");

test("API development and start scripts only run compiled JavaScript without watchers", () => {
  assert.equal(api.scripts.dev, api.scripts.start);
  assert.equal(api.scripts.start, "node --enable-source-maps dist/main.js");
  assert.doesNotMatch(api.scripts.dev, /--watch|nest|build/);
  assert.equal(api.scripts.build, "nest build");
});

test("combined development retains web hot reload and independent manual API build/start commands", () => {
  assert.equal(root.scripts.dev, "pnpm --parallel --filter @eureka-atlas/web --filter @eureka-atlas/api dev");
  assert.equal(root.scripts["dev:web"], "pnpm --filter @eureka-atlas/web dev");
  assert.equal(root.scripts["dev:api"], "pnpm --filter @eureka-atlas/api start");
  assert.equal(root.scripts["build:api"], "pnpm --filter @eureka-atlas/result-format build && pnpm --filter @eureka-atlas/api build");
  assert.equal(web.scripts.dev, "next dev");
});
