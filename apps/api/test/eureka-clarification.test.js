const test=require('node:test'),assert=require('node:assert/strict');
const {unzipSync,strFromU8}=require('fflate');
const {createPluginPackageService}=require('./helpers/plugin-fixture');
const {buildPluginSkill,buildSkillSnapshot,PLUGIN_VERSION}=require('../dist/integrations/plugin-skill');
const {buildMenuSkill}=require('../dist/integrations/menu-skill');
const {EUREKA_PLUGIN_VERSION,EUREKA_ASK_CLARIFICATION}=require('../dist/integrations/eureka-plugin');

test('Eureka ask skill requests only material missing information, stops after asking and preserves business context',()=>{
 const ask=buildPluginSkill('eureka');assert.ok(ask.includes(EUREKA_ASK_CLARIFICATION));
 for(const term of ['先读取适用规则','优先利用已有上下文','时间范围、指标定义、店铺范围或分析维度缺失','会显著改变结果','不要每次查询都提问','不编造指标、店铺','本轮立即停止','不继续调用查询工具','不要求用户另开浏览器','跳过不构成业务口径确认','不能解释为同意默认值','复用原 Atlas session_id','scope_revision','不得仅因澄清新建业务会话或清空选数','退回普通文字询问必要信息','不声称已展示卡片','完全禁用工具时不得通过声明自动恢复工具','日常“问题澄清”开关不控制本插件'])assert.ok(ask.includes(term),term);
 const block=EUREKA_ASK_CLARIFICATION.match(/```json\n([\s\S]*?)\n```/);assert.ok(block);const args=JSON.parse(block[1]);assert.equal(args.questions.length,1);const q=args.questions[0];assert.equal(q.selection,'single');assert.equal(q.options.length,2);assert.deepEqual(q.options.map(o=>o.id),['yesterday','last_7_days']);assert.ok(q.options.every(o=>o.label&&o.description));
 assert.doesNotMatch(buildMenuSkill('eureka'),/request_user_input|questions|问题澄清/);
});

test('only Eureka version and capability change; Codex and Claude keep existing manifests and skill instructions',async()=>{
 const service=createPluginPackageService({askPrompt:async()=>({prompt:'共享业务规则',customized:false})}),info=await service.info();assert.equal(PLUGIN_VERSION,'2.2.1');assert.equal(EUREKA_PLUGIN_VERSION,'2.3.0');assert.equal(info.version,PLUGIN_VERSION);const revision=buildSkillSnapshot('共享业务规则',false).rulesVersion;
 for(const c of ['codex','claude','eureka']){const artifact=await service.archive(c),files=unzipSync(artifact.buffer),root='atlas-ask-'+c+'/',read=n=>strFromU8(files[root+n]),manifest=JSON.parse(read(c==='claude'?'.claude-plugin/plugin.json':'plugin.json'));assert.equal(artifact.rulesVersion,revision);if(c==='eureka'){assert.equal(manifest.version,EUREKA_PLUGIN_VERSION);assert.equal(JSON.parse(read('package.json')).version,EUREKA_PLUGIN_VERSION);assert.deepEqual(manifest.extensions['com.eureka'].capabilities,{requestUserInput:true});assert.ok(read('skills/atlas-ask/SKILL.md').includes('request_user_input'));}else{assert.equal(manifest.version,PLUGIN_VERSION);assert.equal(manifest.extensions?.['com.eureka'],undefined);assert.doesNotMatch(read('skills/atlas-ask/SKILL.md'),/request_user_input|requestUserInput/);assert.doesNotMatch(read('README.md'),/request_user_input|requestUserInput|2\.3\.0/);}assert.doesNotMatch(read(c==='claude'?'.mcp.json':'mcp.json'),/request_user_input|requestUserInput/);}
});
