const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { packageManager } = require("../../../package.json");

// pnpm run test:unit supplies npm_execpath. Direct node invocations must supply
// that path to exercise the real pinned pnpm rather than mocking its lifecycle.
const cli = process.env.npm_execpath;
const isPnpm = cli && /^pnpm\.(?:cjs|mjs|js)$/.test(path.basename(cli));
const gypPath = isPnpm
  ? path.resolve(path.dirname(cli), "../dist/node_modules/node-gyp/lib/node-gyp.js")
  : null;
const skip = !gypPath || !fs.existsSync(gypPath)
  ? "Requires the project's pinned pnpm installation (run via pnpm test:unit)."
  : false;

function probe(variable) {
  const pnpmPackage = JSON.parse(fs.readFileSync(path.resolve(path.dirname(cli), "../package.json"), "utf8"));
  assert.equal(`pnpm@${pnpmPackage.version}`, packageManager);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-gyp-lifecycle-"));
  try {
    const native = path.join(root, "native");
    const output = path.join(root, "probe.json");
    fs.mkdirSync(native);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "atlas-header-install-probe", version: "1.0.0", private: true,
      packageManager,
      dependencies: { "atlas-native-header-probe": "file:./native" },
    }));
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"),
      'packages: []\nallowBuilds:\n  "atlas-native-header-probe@file:native": true\n');
    fs.writeFileSync(path.join(native, "package.json"), JSON.stringify({
      name: "atlas-native-header-probe", version: "1.0.0",
      scripts: { install: "node check.cjs" },
    }));
    fs.writeFileSync(path.join(native, "check.cjs"), `
const fs = require('node:fs');
const gyp = require(${JSON.stringify(gypPath)})();
gyp.parseArgv([process.execPath, 'node-gyp', 'configure']);
fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({
  nodedir: gyp.opts.nodedir ?? null, version: gyp.version
}));
`);
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(?:npm_config_nodedir|npm_package_config_node_gyp_nodedir)$/i.test(key)) delete env[key];
    }
    env[variable] = "/usr/local";
    const result = spawnSync(process.execPath, [cli, "install", "--offline", "--no-frozen-lockfile",
      "--store-dir", path.join(root, "store"), "--cache-dir", path.join(root, "cache"),
      "--reporter=append-only"], { cwd: root, env, encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(output), "The dependency's actual install script must run");
    return JSON.parse(fs.readFileSync(output, "utf8"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("pnpm filters inherited npm_package_* header settings before dependency install scripts", { skip }, () => {
  assert.equal(probe("npm_package_config_node_gyp_nodedir").nodedir, null);
});

test("pnpm passes the Docker header setting to node-gyp in a real offline dependency installation", { skip }, () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, "../../../Dockerfile"), "utf8");
  assert.match(dockerfile, /&& npm_config_nodedir=\/usr\/local/);
  const result = probe("npm_config_nodedir");
  assert.equal(result.nodedir, "/usr/local");
});
