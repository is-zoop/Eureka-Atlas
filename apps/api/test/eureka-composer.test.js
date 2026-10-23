const test=require('node:test'),assert=require('node:assert/strict');
const {unzipSync,strFromU8}=require('fflate');
const {createPluginPackageService}=require('./helpers/plugin-fixture');
const {EUREKA_COMPOSER,EUREKA_PLUGIN_VERSION}=require('../dist/integrations/eureka-plugin');
const {PLUGIN_VERSION,buildPluginSkill,buildSkillSnapshot}=require('../dist/integrations/plugin-skill');
const {buildMenuSkill}=require('../dist/integrations/menu-skill');

test('Eureka manifest explicitly declares persistent composer selection without changing capabilities, auth or shared skills',async()=>{
  const prompt='固定业务规则',service=createPluginPackageService({askPrompt:async()=>({prompt,customized:false})});
  const artifact=await service.archive('eureka'),files=unzipSync(artifact.buffer),root='atlas-ask-eureka/',read=n=>strFromU8(files[root+n]);
  const manifest=JSON.parse(read('plugin.json')),host=manifest.extensions['com.eureka'];
  assert.deepEqual(EUREKA_COMPOSER,{selectionMode:'persistent'});assert.deepEqual(host.composer,EUREKA_COMPOSER);
  assert.equal(host.schemaVersion,1);assert.equal(host.capabilities.requestUserInput,true);
  assert.deepEqual(host.auth,{atlas:{provider:'haze-personal-credential'}});
  assert.equal(manifest.version,EUREKA_PLUGIN_VERSION);assert.equal(JSON.parse(read('package.json')).version,EUREKA_PLUGIN_VERSION);
  assert.equal(JSON.parse(read('atlas-release.json')).version,EUREKA_PLUGIN_VERSION);
  assert.equal(read('skills/atlas-ask/SKILL.md'),buildPluginSkill('eureka'));assert.equal(read('skills/atlas-menu/SKILL.md'),buildMenuSkill('eureka'));
  assert.equal(artifact.rulesVersion,buildSkillSnapshot(prompt,false).rulesVersion);
  for(const term of ['composer.selectionMode=persistent','用户决定是否启用','直到用户主动移除','未选中或移除后','once 表示仅本条消息使用','不授予额外权限'])assert.ok(read('README.md').includes(term),term);
  assert.doesNotMatch(read('mcp.json'),/composer|selectionMode|persistent/);
});

test('composer selection is Eureka-only; Codex and Claude manifests and business content stay unchanged',async()=>{
  const service=createPluginPackageService({askPrompt:async()=>({prompt:'固定业务规则',customized:false})});
  for(const client of ['codex','claude']){
    const files=unzipSync((await service.archive(client)).buffer),root='atlas-ask-'+client+'/',read=n=>strFromU8(files[root+n]);
    const manifest=JSON.parse(read(client==='claude'?'.claude-plugin/plugin.json':'plugin.json'));
    assert.equal(manifest.version,PLUGIN_VERSION);assert.equal(manifest.extensions?.['com.eureka'],undefined);
    assert.doesNotMatch(read('README.md'),/composer\.selectionMode|输入框选用方式/);
    assert.equal(read('skills/atlas-ask/SKILL.md'),buildPluginSkill(client));assert.equal(read('skills/atlas-menu/SKILL.md'),buildMenuSkill(client));
  }
});
