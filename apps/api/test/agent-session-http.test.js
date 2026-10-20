const test=require('node:test'),assert=require('node:assert/strict');
const {Test}=require('@nestjs/testing'),{APP_GUARD}=require('@nestjs/core'),{UnauthorizedException}=require('@nestjs/common');
const {prisma}=require('@eureka-atlas/database');
const {AuthGuard}=require('../dist/auth/auth.guard'),{AuthService}=require('../dist/auth/auth.service');
const {AgentSessionsController}=require('../dist/integrations/agent-sessions.controller'),{AgentSessionsService}=require('../dist/integrations/agent-sessions.service');
const {SelectableSemanticTablesService}=require('../dist/semantic/selectable-semantic-tables.service');
const {PluginPackageController}=require('../dist/integrations/plugin-package.controller'),{PluginPackageService}=require('../dist/integrations/plugin-package.service');const {SystemSettingsService}=require('../dist/system-settings/system-settings.service');
const {McpToolsService}=require('../dist/integrations/mcp-tools.service');const {createPluginTools}=require('./helpers/plugin-fixture');
const {ExternalLimitsGuard,ExternalLimitsService}=require('../dist/external-api/external-limits');
test('selector HTTP enforces Cookie role, stable owner and cross-site write protection',async()=>{
 const original=prisma.agentQuerySession,rows=new Map();prisma.agentQuerySession={create:async({data})=>{const row={scopeMode:'ALL',selectedTableIds:[],revision:0,...data};rows.set(row.id,row);return row},findFirst:async({where})=>{const row=rows.get(where.id);return row?.ownerMemberNo===where.ownerMemberNo?{...row}:null},updateMany:async({where,data})=>{const row=rows.get(where.id);if(!row||row.ownerMemberNo!==where.ownerMemberNo||where.revision!==undefined&&row.revision!==where.revision)return{count:0};Object.assign(row,{...data,...(data.revision?{revision:row.revision+1}:{})});return{count:1}}};
 let authentications=0;const mod=await Test.createTestingModule({controllers:[AgentSessionsController,PluginPackageController],providers:[AgentSessionsService,PluginPackageService,{provide:McpToolsService,useValue:createPluginTools()},{provide:SystemSettingsService,useValue:{askPrompt:async()=>({prompt:'有效业务规则',customized:true})}},ExternalLimitsGuard,ExternalLimitsService,{provide:SelectableSemanticTablesService,useValue:{list:async()=>({items:[{id:'table'}]})}},{provide:AuthService,useValue:{authenticate:async req=>{authentications++;const key=req.get('cookie');if(!['A','B','USER','DEVELOPER','SYSTEM_ADMIN'].includes(key))throw new UnauthorizedException();return{member_no:key,role_code:['USER','DEVELOPER','SYSTEM_ADMIN'].includes(key)?key:'ADMIN'}}}},{provide:APP_GUARD,useClass:AuthGuard}]}).compile();
 const app=mod.createNestApplication({logger:false});app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const request=(suffix='',method='GET',cookie='A',body,extra={})=>fetch(base+'/api/integrations/agent-sessions'+suffix,{method,headers:{Cookie:cookie,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
 try{
 assert.equal((await request('','POST','')).status,401);assert.equal((await request('','POST','',{},{Authorization:'Bearer personal-key'})).status,401);
 for(const role of ['USER','DEVELOPER','SYSTEM_ADMIN']){
 const created=await request('','POST',role);assert.equal(created.status,201);const own=await created.json();assert.equal(rows.get(own.session_id).ownerMemberNo,role);
 assert.equal((await request('/'+own.session_id,'GET',role)).status,200);assert.equal((await request('/'+own.session_id,'GET','A')).status,404);
 assert.equal((await request('/'+own.session_id,'PATCH',role,{scope_mode:'SELECTED',selected_table_ids:['table'],expected_revision:0})).status,200);
 assert.equal((await request('/'+own.session_id,'PATCH',role,{scope_mode:'ALL',selected_table_ids:[],expected_revision:1},{Origin:'https://evil.invalid'})).status,403);
 }
 assert.equal((await request('','POST','A',{ownerMemberNo:'B',scope_mode:'SELECTED'})).status,400);
 const created=await request('','POST');assert.equal(created.status,201);const session=await created.json();assert.equal(rows.get(session.session_id).ownerMemberNo,'A');
 assert.equal((await request('/'+session.session_id,'GET','B')).status,404);
 for(const path of ['/api/integrations/plugins','/api/integrations/plugins/codex.zip','/api/integrations/plugins/claude.zip','/api/integrations/plugins/eureka.zip']){assert.equal((await fetch(base+path,{headers:{Authorization:'Bearer personal-key'}})).status,401);for(const role of ['USER','DEVELOPER'])assert.equal((await fetch(base+path,{headers:{Cookie:role}})).status,403);assert.equal((await fetch(base+path,{headers:{Cookie:'SYSTEM_ADMIN'}})).status,200);const download=await fetch(base+path,{headers:{Cookie:'A'}});assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store');if(path.endsWith('.zip')){assert.equal(download.headers.get('content-type'),'application/zip');assert.ok(download.headers.get('content-disposition').includes('atlas-ask'));const bytes=Buffer.from(await download.arrayBuffer());assert.ok(bytes.byteLength>100);assert.equal(download.headers.get('x-atlas-archive-sha256'),require('node:crypto').createHash('sha256').update(bytes).digest('hex'));}}
 for(const client of ['atlas-ask','unknown'])assert.equal((await fetch(base+'/api/integrations/plugins/'+client+'.zip',{headers:{Cookie:'A'}})).status,404);
 const metadata=await(await fetch(base+'/api/integrations/plugins',{headers:{Cookie:'A'}})).json();
 assert.deepEqual(metadata.tools,(await createPluginTools().definitions()).map(({name,description})=>({name,description})));
 for(const item of metadata.downloads){const stale=await fetch(base+item.download_url.replace(/rules_version=[^&]+/,'rules_version=stale'),{headers:{Cookie:'A'}});assert.equal(stale.status,409);}
 const count=authentications;assert.equal((await request('/'+session.session_id,'PATCH','A',{scope_mode:'ALL',selected_table_ids:[],expected_revision:0},{Origin:'https://evil.invalid'})).status,403);assert.equal(authentications,count);
 const selected={scope_mode:'SELECTED',selected_table_ids:['table'],expected_revision:0};assert.equal((await request('/'+session.session_id,'PATCH','A',selected)).status,200);assert.equal((await request('/'+session.session_id,'PATCH','A',selected)).status,409);
 assert.equal((await request('/'+session.session_id,'PATCH','A',{...selected,ownerMemberNo:'B'})).status,400);
 }finally{await app.close();prisma.agentQuerySession=original;}
});
