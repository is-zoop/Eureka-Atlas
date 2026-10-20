const test = require('node:test'), assert = require('node:assert/strict');
const {buildSkillSnapshot,buildPluginSkill}=require('../dist/integrations/plugin-skill');
const {buildMenuSkill}=require('../dist/integrations/menu-skill');
const {PLUGIN_HOSTS}=require('../dist/integrations/plugin-host');
const {ASK_QUERY_INSTRUCTIONS}=require('../dist/ask/ask-prompt');
test('plugin snapshots share effective web query rules with an explicit host adapter and stable revision',()=>{
 const custom='业务约束：只比较同口径；{{current_date}}，{{table_count}}';
 const a=buildSkillSnapshot(custom,true),b=buildSkillSnapshot(custom,true);
 assert.deepEqual(a,b);assert.ok(a.rules.includes(custom));assert.ok(a.rules.includes(ASK_QUERY_INSTRUCTIONS));
 for(const term of ['不是本插件工具','create_query_session','get_query_session','scope_revision','全部已发布','不静默','result.truncated','cancel_query'])assert.ok(a.skill.includes(term),term);
 assert.notEqual(a.rulesVersion,buildSkillSnapshot(custom+'更新',true).rulesVersion);
 for(const client of ['codex','claude','eureka']){assert.ok(buildPluginSkill(client).startsWith(a.skill));assert.ok(buildMenuSkill(client).includes('get_query_session'));assert.ok(buildPluginSkill(client).includes(PLUGIN_HOSTS[client].selection));}
 const saved=PLUGIN_HOSTS.eureka.selection;try{PLUGIN_HOSTS.eureka.selection+='新增宿主接入说明';assert.equal(buildSkillSnapshot(custom,true).rulesVersion,a.rulesVersion);assert.ok(buildPluginSkill('eureka').includes('新增宿主接入说明'));}finally{PLUGIN_HOSTS.eureka.selection=saved;}
 assert.match(a.rulesVersion,/^[a-f0-9]{64}$/);assert.ok(a.skill.startsWith('---\nname: atlas-ask\n'));
});
