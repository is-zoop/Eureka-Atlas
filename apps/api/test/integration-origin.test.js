const test = require('node:test'), assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { integrationOrigin, selectorUrl } = require('../dist/integrations/public-origin');
const {createPluginPackageService} = require('./helpers/plugin-fixture');

async function environment(fn) { const original = { NODE_ENV: process.env.NODE_ENV, WEB_ORIGIN: process.env.WEB_ORIGIN }; try { await fn(); } finally { for(const [key,value] of Object.entries(original)) if(value===undefined)delete process.env[key];else process.env[key]=value; } }

test('production metadata and all three client packages use the trusted public server domain for MCP and selection', () => environment(async () => {
 process.env.NODE_ENV='production'; process.env.WEB_ORIGIN='https://atlas.paiwo188.com,https://other.example';
 assert.equal(integrationOrigin(),'https://atlas.paiwo188.com');
 assert.equal(selectorUrl('owned-session'),'https://atlas.paiwo188.com/integrations/plugins/data-selector?session_id=owned-session');
 const service = createPluginPackageService({askPrompt:async()=>({prompt:'公开测试规则',customized:false})}), info = await service.info();
 assert.equal(info.mcp_url,'https://atlas.paiwo188.com/api/mcp'); assert.equal(info.selector_url,'https://atlas.paiwo188.com/integrations/plugins/data-selector');
 for(const client of ['codex','claude','eureka']) {
  const zip=unzipSync((await service.archive(client)).buffer), root='atlas-ask-'+client+'/';
  const config=JSON.parse(strFromU8(zip[root+(client==='claude'?'.mcp.json':'mcp.json')])); assert.equal(config.mcpServers.atlas.url,info.mcp_url);assert.equal(JSON.parse(strFromU8(zip[root+'atlas-release.json'])).development_only,false);
  assert.ok(strFromU8(zip[root+'README.md']).includes(info.mcp_url));
  if(client==='claude')assert.ok(strFromU8(zip[root+'hooks/register.js']).includes('https://atlas.paiwo188.com'));
  for(const contents of Object.values(zip)) assert.doesNotMatch(strFromU8(contents),/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|api:3001)(?=[/:\s"`]|$)/);
 }
}));

test('production requires an explicit HTTPS origin and rejects HTTP development/internal URLs and unsafe URL parts', () => environment(async () => {
 process.env.NODE_ENV='production';
 for(const value of ['', 'http://localhost:3000', 'http://api:3001', 'https://user:password@atlas.example', 'https://atlas.example/subpath', 'https://atlas.example?x=1', 'https://atlas.example#fragment', 'https://localhost', 'https://localhost.', 'https://api', 'https://127.0.0.1', 'https://10.1.2.3', 'https://172.17.0.2', 'https://192.168.1.5', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://api.docker.internal', 'https://atlas.local']) {
  process.env.WEB_ORIGIN=value; assert.throws(()=>integrationOrigin(), e=>e.getStatus()===503);
 }
 delete process.env.WEB_ORIGIN; assert.throws(()=>integrationOrigin(),e=>e.getStatus()===503);
 process.env.NODE_ENV='development'; assert.equal(integrationOrigin(),'http://localhost:3000');
}));
