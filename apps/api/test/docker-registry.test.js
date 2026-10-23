const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dockerfile=fs.readFileSync(path.join(__dirname,'../../../Dockerfile'),'utf8');
test('Docker registry is an explicit build choice shared by npm bootstrap and pnpm workspace install',()=>{
  assert.match(dockerfile,/ARG NPM_REGISTRY=https:\/\/registry\.npmjs\.org\//);
  assert.match(dockerfile,/npm install --global pnpm@11\.19\.0 --registry="\$NPM_REGISTRY"/);
  assert.match(dockerfile,/FROM base AS workspace/);
  assert.match(dockerfile,/npm_config_registry="\$NPM_REGISTRY"/);
  assert.match(dockerfile,/install --frozen-lockfile --store-dir \/pnpm\/store[^\n]* --registry="\$NPM_REGISTRY"/);
});
test('registry selection retains supply-chain, TLS, lockfile and native build safeguards',()=>{
  assert.doesNotMatch(dockerfile,/strict-ssl\s*[= ]\s*false|NODE_TLS_REJECT_UNAUTHORIZED|--trust-lockfile|--ignore-scripts|--no-verify|trustPolicyExclude/);
  assert.match(dockerfile,/id=atlas-pnpm,target=\/pnpm\/store/);
  assert.match(dockerfile,/npm_config_nodedir=\/usr\/local/);
  assert.match(dockerfile,/PRISMA_ENGINES_MIRROR=https:\/\/binaries\.prisma\.sh/);
  assert.doesNotMatch(dockerfile,/ENV\s+(?:NPM_REGISTRY|npm_config_registry)/);
});
