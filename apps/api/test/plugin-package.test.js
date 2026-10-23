const test = require('node:test'), assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const {createPluginPackageService,createPluginTools} = require('./helpers/plugin-fixture');
const { AjvJsonSchemaValidator } = require('@modelcontextprotocol/sdk/validation/ajv');
function check(schema, value) { const { $schema, ...base } = schema; const result = new AjvJsonSchemaValidator().getValidator(base)(value); assert.equal(result.valid, true, JSON.stringify(result)); }

test('client-specific ZIPs contain only native configuration and the same shared rules and selector', async () => {
  let calls = 0;
  const prompt = '业务约束：不比较不同单位';
  const service = createPluginPackageService({ askPrompt: async () => { calls++; return { prompt, customized: true }; } });
  const info = await service.info(), packages = {};
  assert.equal(info.tools.length,10);assert.deepEqual(info.tools,(await createPluginTools().definitions()).map(({name,description})=>({name,description})));assert.ok(info.tools.every(t=>Object.keys(t).sort().join(',')==='description,name'));
  assert.equal(new Set(info.tools.map(t=>t.name)).size,10);
  assert.equal(info.download_url, undefined); assert.deepEqual(info.downloads.map(d => d.client), ['codex', 'claude', 'eureka']);
  const common = ['skills/atlas-ask/SKILL.md', 'references/current-rules.md', 'skills/atlas-menu/SKILL.md', 'atlas-release.json', 'assets/atlas.svg', 'assets/atlas.png', 'assets/LUCIDE-LICENSE.txt', 'README.md'];
  for (const { client, download_url } of info.downloads) {
    assert.equal(download_url, `/api/integrations/plugins/${client}.zip?rules_version=${info.rules_version}`);
    const artifact = await service.archive(client, info.rules_version), zip = unzipSync(artifact.buffer), root = `atlas-ask-${client}/`;
    const read = p => strFromU8(zip[root + p]); packages[client] = { read, zip };
    assert.ok(artifact.filename.startsWith(`atlas-ask-${client}-`));
    const native = client === 'codex' ? ['plugin.json', 'mcp.json', ...['atlas-menu','atlas-ask'].flatMap(name=>[`skills/${name}/agents/openai.yaml`,`skills/${name}/assets/atlas.png`,`skills/${name}/assets/atlas.svg`])] : client === 'eureka' ? ['plugin.json','package.json','mcp.json'] : ['.claude-plugin/plugin.json', '.mcp.json','hooks/hooks.json','hooks/register.js'];
    assert.deepEqual(Object.keys(zip).sort(), [...common, ...native].map(p => root + p).sort());
    assert.ok(Object.keys(zip).every(p => p.startsWith(root) && !p.includes('..') && !p.includes('.codex-plugin')));
    const release = JSON.parse(read('atlas-release.json')); assert.equal(release.client, client); assert.equal(release.rules_version, info.rules_version);
    assert.ok(read('assets/LUCIDE-LICENSE.txt').includes('Lucide Contributors 2022'));assert.ok(read('references/current-rules.md').includes(prompt)); assert.ok(read('skills/atlas-ask/SKILL.md').includes('create_query_session'));
    assert.ok(read('README.md').includes('ADMIN/SYSTEM_ADMIN/DEVELOPER/USER均可使用本人个人凭证访问MCP'));
    assert.ok(read('README.md').includes('插件管理页面及下载仍仅ADMIN/SYSTEM_ADMIN可访问'));
    assert.ok(read('README.md').includes(client === 'codex' ? '本包仅用于 OpenAI Codex' : client === 'eureka' ? '本包仅用于 Eureka' : '本包仅用于 Claude Code'));
    assert.ok(read('skills/atlas-menu/SKILL.md').includes('open_selection_menu'));assert.equal(Object.keys(zip).some(p=>p.endsWith('select-data.html')),false);
    if(client==='claude'){assert.ok(read('hooks/register.js').includes("name:'atlas_menu'"));assert.ok(read('hooks/register.js').includes('selection-native'));assert.deepEqual(JSON.parse(read('hooks/hooks.json')),{modules:['./register.js']});}
  }
  assert.equal(calls, 4, 'one effective prompt read per info/package generation');
  for (const p of ['skills/atlas-ask/SKILL.md', 'references/current-rules.md', 'skills/atlas-menu/SKILL.md']) for(const client of ['claude','eureka']) assert.equal(packages.codex.read(p).split('\n## 当前宿主操作')[0], packages[client].read(p).split('\n## 当前宿主操作')[0]);
  const portable = JSON.parse(packages.codex.read('plugin.json')), claude = JSON.parse(packages.claude.read('.claude-plugin/plugin.json'));
  assert.equal(portable.name, claude.name); assert.equal(portable.version, claude.version); assert.equal(portable.version,'2.3.1'); assert.equal(info.title,'Atlas数据助手'); assert.equal(portable.extensions['com.openai'].interface.displayName,'Atlas数据助手'); assert.ok(portable.extensions['com.openai'].interface.shortDescription.length <= 30);
  check(require('./fixtures/agent-plugins-1.0-plugin.json'), portable);
  const presentation=portable.extensions['com.openai'].interface;
  assert.equal(presentation.logo,'./assets/atlas.png'); assert.equal(presentation.composerIcon,presentation.logo);
  for(const [name,label]of [['atlas-menu','Atlas数据目录'],['atlas-ask','Atlas数据助手']]){
    const base=`skills/${name}/`,yaml=packages.codex.read(base+'agents/openai.yaml');
    assert.ok(yaml.includes(`display_name: "${label}"`)); assert.ok(yaml.includes(`$${name}`)); assert.match(yaml,/allow_implicit_invocation: true/);
    const description=JSON.parse(yaml.match(/short_description: (.+)/)[1]); assert.ok(description.length>=25&&description.length<=64);
    for(const field of ['icon_small','icon_large']){const relative=JSON.parse(yaml.match(new RegExp(field+': (.+)'))[1]);assert.ok(packages.codex.zip['atlas-ask-codex/'+base+relative.slice(2)]?.length>0,'contained skill icon exists');}
    const png=packages.codex.zip['atlas-ask-codex/'+base+'assets/atlas.png']; assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]); const bytes=Buffer.from(png);assert.equal(bytes.readUInt32BE(16),128);assert.equal(bytes.readUInt32BE(20),128);
    assert.deepEqual(png,packages.codex.zip['atlas-ask-codex/assets/atlas.png']);
  }
  const mcp = JSON.parse(packages.codex.read('mcp.json')), cmcp = JSON.parse(packages.claude.read('.mcp.json'));
  const { extensions, ...server } = mcp.mcpServers.atlas;
  check(require('./fixtures/agent-plugins-1.0-mcp.json'), { ...mcp, mcpServers: { atlas: server } }); assert.deepEqual(extensions['com.openai'].auth, { type: 'api_key', headerScheme: 'bearer' });
  assert.equal(server.url, cmcp.mcpServers.atlas.url); assert.equal(cmcp.mcpServers.atlas.type, 'http'); assert.equal(cmcp.mcpServers.atlas.headers.Authorization, 'Bearer ${ATLAS_PERSONAL_CREDENTIAL}');
});

test('both downloads reject stale snapshots, unsafe configured credentials and unknown clients', async () => {
  let prompt = '当前业务规则'; const service = createPluginPackageService({ askPrompt: async () => ({ prompt, customized: true }) });
  const info = await service.info(); prompt += '更新';
  for (const client of ['codex', 'claude', 'eureka']) await assert.rejects(service.archive(client, info.rules_version), e => e.getStatus() === 409);
  for(const unsafe of ['禁止导出 haze_'+'a'.repeat(40), 'Authorization: Bearer '+'b'.repeat(40)]) {
    prompt=unsafe;
    for (const client of ['codex', 'claude', 'eureka']) await assert.rejects(service.archive(client), e => e.getStatus() === 400);
    await assert.rejects(service.info(),e=>e.getStatus()===400);
  }
  for (const client of ['atlas-ask', 'unknown', '../codex', '', undefined]) await assert.rejects(service.archive(client), e => e.getStatus() === 404);
});
