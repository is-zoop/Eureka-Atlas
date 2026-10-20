const test=require('node:test'),assert=require('node:assert/strict');
const {Test}=require('@nestjs/testing'),{APP_GUARD,APP_FILTER}=require('@nestjs/core'),{prisma}=require('@eureka-atlas/database');
const {createExternalFixture,queryBody,nativeFetch}=require('./helpers/external-fixture');
const {McpController}=require('../dist/integrations/mcp.controller'),{McpToolsService}=require('../dist/integrations/mcp-tools.service'),{McpDataService}=require('../dist/integrations/mcp-data.service'),{AgentSessionsService}=require('../dist/integrations/agent-sessions.service');
const {SelectionAccessService}=require('../dist/integrations/selection-access.service');
const {AuthGuard}=require('../dist/auth/auth.guard'),{AuthService}=require('../dist/auth/auth.service');
const {ExternalDataService}=require('../dist/external-api/external-data.service'),{ExternalContractService}=require('../dist/external-api/external-contract.service'),{ExternalLimitsGuard,ExternalLimitsService}=require('../dist/external-api/external-limits'),{ExternalExceptionFilter}=require('../dist/external-api/external-http'),{SemanticScopeService}=require('../dist/semantic/semantic-scope.service');
test('actual SDK HTTP flow admits all valid Haze roles, isolates scoped tasks and preserves REST permissions and shared quotas',async()=>{
 const f=await createExternalFixture(),original={delegate:prisma.agentQuerySession,tx:prisma.$transaction},sessions=new Map();
 prisma.agentQuerySession={create:async({data})=>{const row={scopeMode:'ALL',selectedTableIds:[],revision:0,...data};sessions.set(row.id,row);return row},findFirst:async({where})=>{const row=sessions.get(where.id);return row?.ownerMemberNo===where.ownerMemberNo?{...row}:null},updateMany:async({where,data})=>{const row=sessions.get(where.id);if(!row||row.ownerMemberNo!==where.ownerMemberNo||where.revision!==undefined&&row.revision!==where.revision||row.expiresAt<=new Date())return{count:0};Object.assign(row,{...data,...(data.revision?{revision:row.revision+1}:{})});return{count:1}}};
 prisma.$transaction=async fn=>fn({agentQuerySession:prisma.agentQuerySession,queryExecution:prisma.queryExecution,$queryRaw:async()=>[]});
 const selectable={list:async()=>({items:[{id:'table'},{id:'other'}]})},scope=new AgentSessionsService(selectable),semantic=new SemanticScopeService(selectable,{get:async id=>({...f.pkg,table:{...f.pkg.table,id}})});
 const mod=await Test.createTestingModule({controllers:[McpController],providers:[McpToolsService,McpDataService,{provide:SelectionAccessService,useValue:{}},ExternalLimitsGuard,{provide:AgentSessionsService,useValue:scope},{provide:SemanticScopeService,useValue:semantic},...[AuthService,ExternalDataService,ExternalContractService,ExternalLimitsService].map(service=>({provide:service,useValue:f.app.get(service)})),{provide:APP_GUARD,useClass:AuthGuard},{provide:APP_FILTER,useClass:ExternalExceptionFilter}]}).compile();
 const app=mod.createNestApplication({logger:false});app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const rpc=async(method,params={},key='haze_A_key')=>{const response=await nativeFetch(base+'/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Cookie:f.cookie,...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return{response,body:await response.json()}};
 const tool=async(name,args={},key)=>{const reply=await rpc('tools/call',{name,arguments:args},key);assert.equal(reply.response.status,200,JSON.stringify(reply.body));return reply.body.result.structuredContent};
 try{
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const client=new Client({name:'official-sdk-client',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/api/mcp'),{fetch:nativeFetch,requestInit:{headers:{Authorization:'Bearer haze_A_key'}}}));
 try{assert.equal((await client.listTools()).tools.length,10);const created=await client.callTool({name:'create_query_session',arguments:{}});assert.ok(created.structuredContent.data.session_id);}finally{await client.close();}
 assert.equal((await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'integration-test',version:'1'}})).response.status,200);
 assert.equal((await rpc('tools/list')).body.result.tools.length,10);
 for(const [key,status]of[[null,401],['bad',401]]){const r=await rpc('tools/list',{},key);assert.equal(r.response.status,status);assert.equal(r.response.headers.get('set-cookie'),null);}
 const session=(await tool('create_query_session')).data,other=(await tool('create_query_session')).data,ctx={session_id:session.session_id,scope_revision:0};
 assert.equal((await tool('get_query_session',{session_id:session.session_id},'haze_B_key')).error.code,'NOT_FOUND');
 assert.equal((await tool('search_semantic_assets',{...ctx,keywords:['销售额']})).data.total,2);
 assert.equal((await tool('get_semantic_package',{...ctx,table_id:'table'})).data.content_version,'v1');
 const body=queryBody('mcp-query'),created=(await tool('query_data',{...ctx,...body})).data;assert.equal(f.rows.get(created.id).agentQuerySessionId,session.session_id);assert.equal(f.submissions(),1);
 f.state.remoteStatus='SUCCEEDED';assert.equal((await tool('get_query_status',{session_id:session.session_id,query_id:created.id})).data.status,'SUCCEEDED');const result=(await tool('get_query_result',{session_id:session.session_id,query_id:created.id})).data;assert.equal(result.result.rows.length,150);
 f.state.remoteStatus='RUNNING';
 const candidate=(await tool('get_dimension_values',{...ctx,table_id:'table',content_version:'v1',idempotency_key:'values',field_id:'shop',date_range:body.date_range})).data;
 assert.equal((await tool('cancel_query',{session_id:session.session_id,query_id:candidate.id})).data.status,'CANCELLING');
 await scope.update('A',session.session_id,{scope_mode:'SELECTED',selected_table_ids:['other'],expected_revision:0});
 const narrowed=(await tool('get_query_session',{session_id:session.session_id})).data;assert.deepEqual(narrowed.tables.map(t=>t.id),['other']);assert.equal(narrowed.available_tables,undefined);
 assert.equal((await tool('query_data',{...ctx,...body})).data.id,created.id);assert.equal((await tool('query_data',{...ctx,...queryBody('stale')})).error.code,'SCOPE_CHANGED');
 assert.equal((await tool('get_semantic_package',{...ctx,scope_revision:1,table_id:'table'})).error.code,'NOT_FOUND');
 assert.equal((await tool('search_semantic_assets',{...ctx,scope_revision:1,keywords:['销售额']})).data.items[0].table_id,'other');
 assert.equal((await tool('get_query_result',{session_id:session.session_id,query_id:created.id})).data.id,created.id);
 for(const name of ['get_query_status','get_query_result','cancel_query'])assert.equal((await tool(name,{session_id:other.session_id,query_id:created.id})).error.code,'NOT_FOUND');
 assert.equal((await tool('query_data',{session_id:other.session_id,scope_revision:0,...body})).error.code,'CONFLICT');
 const rest=(await f.request('/queries',{method:'POST',body:queryBody('ordinary')})).body.data;assert.equal((await tool('get_query_status',{session_id:session.session_id,query_id:rest.id})).error.code,'NOT_FOUND');
 for(const key of ['haze_user_key','haze_dev_key']){
 const owner=f.keys.get(key).member_no,own=(await tool('create_query_session',{},key)).data,c={session_id:own.session_id,scope_revision:0};
 assert.equal((await tool('get_query_session',{session_id:own.session_id},key)).data.scope_mode,'ALL');
 assert.equal((await tool('get_query_session',{session_id:session.session_id},key)).error.code,'NOT_FOUND');
 assert.equal((await tool('search_semantic_assets',{...c,keywords:['销售额']},key)).data.total,2);
 assert.equal((await tool('get_semantic_package',{...c,table_id:'table'},key)).data.content_version,'v1');
 const q=(await tool('query_data',{...c,...queryBody('member-query-'+owner)},key)).data;assert.equal(f.rows.get(q.id).ownerMemberNo,owner);
 f.state.remoteStatus='SUCCEEDED';assert.equal((await tool('get_query_status',{session_id:own.session_id,query_id:q.id},key)).data.status,'SUCCEEDED');assert.equal((await tool('get_query_result',{session_id:own.session_id,query_id:q.id},key)).data.result.rows.length,150);f.state.remoteStatus='RUNNING';
 const v=(await tool('get_dimension_values',{...c,table_id:'table',content_version:'v1',idempotency_key:'member-values-'+owner,field_id:'shop',date_range:body.date_range},key)).data;
 assert.equal((await tool('cancel_query',{session_id:own.session_id,query_id:v.id},key)).data.status,'CANCELLING');f.state.remoteStatus='RUNNING';
 assert.equal((await tool('get_query_status',{session_id:own.session_id,query_id:created.id},key)).error.code,'NOT_FOUND');
 assert.equal((await tool('get_query_result',{session_id:session.session_id,query_id:q.id})).error.code,'NOT_FOUND');
 assert.equal((await f.request('/queries/'+q.id,{key})).response.status,403,'MCP permission must not grant REST access');
 }
 const identity=f.keys.get('haze_A_key');f.keys.delete('haze_A_key');f.keys.set('haze_A_rotated',identity);assert.equal((await rpc('tools/list')).response.status,401);assert.equal((await tool('get_query_result',{session_id:session.session_id,query_id:created.id},'haze_A_rotated')).data.id,created.id);
 identity.role_code='USER';assert.equal((await rpc('tools/list',{},'haze_A_rotated')).response.status,200);assert.equal((await tool('get_query_result',{session_id:session.session_id,query_id:created.id},'haze_A_rotated')).data.id,created.id);assert.equal((await f.request('/queries/'+created.id,{key:'haze_A_rotated'})).response.status,403);identity.role_code='OWNER';assert.equal((await rpc('tools/list',{},'haze_A_rotated')).response.status,403);identity.role_code='ADMIN';identity.status='disabled';assert.equal((await rpc('tools/list',{},'haze_A_rotated')).response.status,401);identity.status='active';
 f.state.hazeOutage=true;assert.equal((await rpc('tools/list',{},'haze_A_rotated')).response.status,503);f.state.hazeOutage=false;
 const limits=f.app.get(ExternalLimitsService);limits.windows.set('A',{reset:Date.now()+60000,count:60});assert.equal((await rpc('tools/list',{},'haze_A_rotated')).response.status,429);assert.equal((await f.request('/queries/'+created.id,{key:'haze_A_rotated'})).response.status,429);
 assert.equal(JSON.stringify([...f.rows.values()]).includes('haze_A_'),false);
 }finally{await app.close();prisma.agentQuerySession=original.delegate;prisma.$transaction=original.tx;await f.close();}
});
