const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dockerfile = fs.readFileSync(path.join(__dirname, "../../../Dockerfile"), "utf8");
const root = require("../../../package.json");

test("Docker installs the pinned pnpm separately with visible logs and bounded network retries", () => {
  const base = dockerfile.split("FROM base AS workspace")[0];
  assert.ok(base.includes(`npm install --global ${root.packageManager}`));
  assert.match(base, /rm -rf \/var\/lib\/apt\/lists\/\*\r?\n/);
  assert.match(base, /RUN node --version && npm --version/);
  for (const flag of ["--loglevel=verbose", "--foreground-scripts", "--fetch-retries=1", "--fetch-timeout=60000"]) assert.ok(base.includes(flag));
});

test("Prisma binary mirror is a build-only override used for installation and generation without disabling verification", () => {
  const workspace = dockerfile.split("FROM base AS workspace")[1].split("FROM workspace AS api-build")[0];
  assert.match(workspace, /ARG PRISMA_ENGINES_MIRROR=https:\/\/binaries\.prisma\.sh/);
  assert.equal((workspace.match(/PRISMA_ENGINES_MIRROR="\$PRISMA_ENGINES_MIRROR"/g) ?? []).length, 2);
  assert.equal((workspace.match(/DEBUG="prisma:download,prisma:fetch-engine\*"/g) ?? []).length, 2);
  assert.match(workspace, /pnpm --reporter=append-only .*install --frozen-lockfile/);
  assert.match(workspace, /exec prisma generate/);
  assert.doesNotMatch(dockerfile, /ENV PRISMA_ENGINES_MIRROR|CHECKSUM_IGNORE_MISSING|NODE_TLS_REJECT_UNAUTHORIZED|--ignore-scripts/);
});

test("pnpm dependency fetches have their own bounded timeout, retries, and concurrency without weakening installation policies", () => {
  const install = dockerfile.split("# These options apply to pnpm registry requests")[1].split("COPY apps/api ./apps/api")[0];
  for (const flag of ["--network-concurrency=4", "--fetch-timeout=180000", "--fetch-retries=3", "--fetch-retry-mintimeout=10000", "--fetch-retry-maxtimeout=60000", "--frozen-lockfile"]) {
    assert.ok(install.includes(flag));
  }
  assert.match(install, /--mount=type=cache,id=atlas-pnpm,target=\/pnpm\/store/);
  assert.doesNotMatch(dockerfile, /strict-ssl=false|verify-store-integrity=false|--ignore-scripts/);
});

test("package metadata cache survives failed installs independently of the existing package store", () => {
  assert.match(dockerfile, /--mount=type=cache,id=atlas-pnpm,target=\/pnpm\/store/);
  assert.match(dockerfile, /--mount=type=cache,id=atlas-pnpm-metadata,target=\/pnpm\/cache,sharing=locked/);
  assert.match(dockerfile, /install --frozen-lockfile .*--cache-dir=\/pnpm\/cache/);
});

test("npm bootstrap and dependency installation use the same explicit registry without disabling supply-chain policies", () => {
  assert.match(dockerfile, /ARG NPM_REGISTRY=https:\/\/registry\.npmjs\.org\//);
  assert.match(dockerfile, /npm install --global pnpm@[^\s]+ --registry="\$NPM_REGISTRY"/);
  assert.match(dockerfile, /install --frozen-lockfile .*--registry="\$NPM_REGISTRY"/);
  assert.doesNotMatch(dockerfile, /ENV NPM_REGISTRY|--offline|--prefer-offline|trust-policy|minimum-release-age|CHECKSUM_IGNORE_MISSING/);
});

test("native addons compile with the official image's local Node headers without downloading them", () => {
  const install = dockerfile.split("# These options apply to pnpm registry requests")[1].split("COPY apps/api ./apps/api")[0];
  for (const file of ["node.h", "common.gypi", "config.gypi"]) {
    assert.ok(install.includes(`test -f /usr/local/include/node/${file}`));
  }
  assert.match(install, /&& npm_config_nodedir=\/usr\/local \\\r?\n/);
  assert.match(install, /pnpm --reporter=append-only .*install --frozen-lockfile/);
  assert.doesNotMatch(dockerfile, /ENV npm_config_nodedir|npm_package_config_node_gyp_nodedir|--ignore-scripts/);
});

test("Compose consistently forwards the persisted Prisma mirror to all build targets, not runtime environments", () => {
  const compose = fs.readFileSync(path.join(__dirname, "../../../docker-compose.yaml"), "utf8");
  for (const target of ["migrate", "api", "web"]) {
    const block = compose.split(`  ${target}:\n`)[1].split(/\n  [a-z]+:/)[0];
    const [build, runtime] = block.split("    restart:");
    assert.ok(build.includes(`target: ${target}`));
    assert.ok(build.includes('PRISMA_ENGINES_MIRROR: "${PRISMA_ENGINES_MIRROR:-https://binaries.prisma.sh}"'));
    assert.ok(!runtime.includes("PRISMA_ENGINES_MIRROR"));
    assert.ok(build.includes('NPM_REGISTRY: "${NPM_REGISTRY:-https://registry.npmjs.org/}"'));
    assert.ok(!runtime.includes("NPM_REGISTRY"));
  }
  const example = fs.readFileSync(path.join(__dirname, "../../../.env.docker.example"), "utf8");
  assert.match(example, /^PRISMA_ENGINES_MIRROR=https:\/\/binaries\.prisma\.sh$/m);
  assert.match(example, /^NPM_REGISTRY=https:\/\/registry\.npmjs\.org\/$/m);
});
