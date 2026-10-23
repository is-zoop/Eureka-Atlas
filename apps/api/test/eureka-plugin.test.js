const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { posix } = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');
const { AjvJsonSchemaValidator } = require('@modelcontextprotocol/sdk/validation/ajv');
const { createPluginPackageService } = require('./helpers/plugin-fixture');
const { PLUGIN_SKILL } = require('../dist/integrations/plugin-skill');
const { MENU_SKILL } = require('../dist/integrations/menu-skill');
const { PLUGIN_HOSTS } = require('../dist/integrations/plugin-host');
const { EUREKA_PLUGIN_VERSION, EUREKA_ASK_CLARIFICATION } = require('../dist/integrations/eureka-plugin');

function check(schema, value) { const { $schema, ...base } = schema; assert.equal(new AjvJsonSchemaValidator().getValidator(base)(value).valid, true); }

test('Eureka ZIP declares connection-layer auth and Pi skill discovery without executable code or duplicated MCP registration', async () => {
  const service = createPluginPackageService({ askPrompt: async () => ({ prompt: '只比较相同业务口径', customized: true }) });
  const info = await service.info(), entry = info.downloads.find(d => d.client === 'eureka');
  assert.equal(entry.label, 'Eureka'); assert.equal(entry.version,EUREKA_PLUGIN_VERSION); assert.ok(entry.download_url.startsWith('/api/integrations/plugins/eureka.zip?rules_version='));
  const artifact = await service.archive('eureka', info.rules_version), files = unzipSync(artifact.buffer), root = 'atlas-ask-eureka/';
  const read = name => strFromU8(files[root + name]), json = name => JSON.parse(read(name));
  assert.deepEqual(Object.keys(files).sort(), ['plugin.json','package.json','mcp.json','skills/atlas-ask/SKILL.md','skills/atlas-menu/SKILL.md','references/current-rules.md','assets/atlas.png','assets/atlas.svg','assets/LUCIDE-LICENSE.txt','atlas-release.json','README.md'].map(n => root+n).sort());
  assert.equal(artifact.sha256, createHash('sha256').update(artifact.buffer).digest('hex'));
  assert.match(artifact.filename, /^atlas-ask-eureka-2\.4\.2-[a-f0-9]{12}\.zip$/);
  const manifest = json('plugin.json'), pkg = json('package.json'), mcp = json('mcp.json'), release = json('atlas-release.json');
  check(require('./fixtures/agent-plugins-1.0-plugin.json'), manifest);
  check(require('./fixtures/agent-plugins-1.0-mcp.json'), mcp);
  assert.equal(manifest.name, 'atlas-ask'); assert.equal(pkg.name, manifest.name); assert.equal(pkg.version, manifest.version); assert.equal(manifest.version,EUREKA_PLUGIN_VERSION); assert.equal(pkg.description, manifest.description);
  assert.deepEqual(Object.keys(pkg).sort(), ['name','version','description','keywords','pi'].sort());
  assert.deepEqual(pkg.keywords, ['pi-package']); assert.deepEqual(pkg.pi, { skills: ['./skills'] });
  for(const dir of pkg.pi.skills) assert.ok(Object.keys(files).some(n => n.startsWith(root+dir.slice(2)+'/') && n.endsWith('/SKILL.md')));
  assert.deepEqual(mcp.mcpServers, { atlas: { type: 'streamable-http', url: info.mcp_url } });
  assert.deepEqual(manifest.extensions, { 'com.eureka': { schemaVersion: 1, displayName: 'Atlas数据助手', icon: './assets/atlas.png', auth: { atlas: { provider: 'haze-personal-credential' } }, composer: {selectionMode:'persistent'}, capabilities: {requestUserInput:true} } });
  const declaration = manifest.extensions['com.eureka'];
  assert.deepEqual(Object.keys(declaration.auth), Object.keys(mcp.mcpServers)); assert.ok(files[root+declaration.icon.slice(2)]);
  assert.equal(release.client, 'eureka'); assert.equal(release.version, manifest.version); assert.equal(release.rules_version, info.rules_version); assert.equal(release.mcp_url, info.mcp_url); assert.ok(Number.isFinite(Date.parse(release.generated_at)));
  for(const [name, shared] of [['atlas-ask', PLUGIN_SKILL], ['atlas-menu', MENU_SKILL]]) {
    const file = `skills/${name}/SKILL.md`, skill = read(file); assert.ok(skill.startsWith(shared));
    assert.ok(skill.includes('Eureka')); assert.ok(skill.includes(PLUGIN_HOSTS.eureka.selection+'\n')); if(name==='atlas-ask')assert.ok(skill.endsWith(EUREKA_ASK_CLARIFICATION)); else {assert.ok(skill.endsWith(PLUGIN_HOSTS.eureka.selection+'\n'));assert.doesNotMatch(skill,/request_user_input/);} assert.doesNotMatch(skill,/尚未实现|待实现/);
    for(const term of ['Atlas MCP 未加载或认证失败时','停止调用','不自行读取密钥或构造凭证','启动链接仅限当前对话','不转发或反复展示','凭证始终由 Eureka 连接层处理']) assert.ok(skill.includes(term),term);
    assert.doesNotMatch(skill, /Codex|Claude|\$atlas-menu|\/atlas_menu|ATLAS_PERSONAL_CREDENTIAL/);
    for(const term of ['open_selection_menu','session_id','scope_revision','不能静默新建全范围会话','实际支持']) assert.ok(skill.includes(term),term);
    for(const [, relative] of skill.matchAll(/\]\(([^)]+\.md)\)/g)) assert.ok(files[root+posix.normalize(posix.join(posix.dirname(file), relative))], 'included Markdown reference: '+relative);
  }
  assert.ok(read('README.md').includes(PLUGIN_HOSTS.eureka.install)); assert.ok(read('README.md').includes(PLUGIN_HOSTS.eureka.selection));
  assert.equal(PLUGIN_HOSTS.eureka.selection.split('\n\n').length,3);
  for(const term of ['com.eureka','来源 Haze','目标 HTTPS 地址','未上传','已支持组织插件功能','尚未完成真实安装与查询联调','新会话加载已安装插件，已有会话需在空闲时重载','localhost 指向 Eureka 服务端所在环境']) assert.ok(read('README.md').includes(term),term);
  assert.doesNotMatch(read('README.md'),/尚未实现|待实现|不是已经实现的 Eureka 能力/);
  for(const term of ['宿主能力 · 问题澄清','已有会话需在空闲时重载','Haze 发布版本','入口调用 → 歧义澄清 → 原业务会话继续查询'])assert.ok(read('README.md').includes(term),term);
  assert.ok(read('README.md').includes('填写为 '+EUREKA_PLUGIN_VERSION));
  assert.doesNotMatch(read('mcp.json'),/request_user_input|requestUserInput/);
  assert.equal(info.tools.length,10);assert.equal(info.tools.some(t=>t.name==='request_user_input'),false);
  for(const [name, bytes] of Object.entries(files)) {
    assert.doesNotMatch(name, /agents\/openai|hooks\/|\.mcp\.json|node_modules|\.js$/);
    if(name.endsWith('.png')) continue;
    assert.doesNotMatch(strFromU8(bytes), /[A-Z]:[\\/]|\/mnt\/[a-z]\/|haze_[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9_-]{24,}|"Authorization"\s*:|"session_id"\s*:/);
  }
});

test('generation time changes the ZIP checksum, not its business-rules revision; development exports are explicitly marked', async () => {
  const oldEnv = { NODE_ENV: process.env.NODE_ENV, WEB_ORIGIN: process.env.WEB_ORIGIN };
  const RealDate = Date;
  try {
    process.env.NODE_ENV = 'production'; process.env.WEB_ORIGIN = 'https://atlas.example';
    const service = createPluginPackageService({ askPrompt: async () => ({ prompt: '稳定业务规则', customized: false }) });
    global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-20T00:00:00Z'])); } };
    const a = await service.archive('eureka');
    global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-21T00:00:00Z'])); } };
    const b = await service.archive('eureka');
    assert.equal(a.rulesVersion,b.rulesVersion); assert.equal(a.filename,b.filename); assert.notEqual(a.sha256,b.sha256);
    process.env.NODE_ENV='development'; process.env.WEB_ORIGIN='http://localhost:3000';
    const dev=unzipSync((await service.archive('eureka')).buffer);
    assert.equal(JSON.parse(strFromU8(dev['atlas-ask-eureka/atlas-release.json'])).development_only,true);
    assert.ok(strFromU8(dev['atlas-ask-eureka/README.md']).includes('仅供开发测试'));
  } finally {
    global.Date=RealDate;
    for(const [key,value] of Object.entries(oldEnv)) if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
